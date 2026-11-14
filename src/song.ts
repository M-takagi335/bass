import { z } from 'zod'

export const stringTuning = ['E1', 'A1', 'D2', 'G2'] as const

const integer = (min: number, max: number) =>
  z.number({ error: '整数を指定してください。' })
    .int('整数を指定してください。')
    .min(min, `${min} 以上を指定してください。`)
    .max(max, `${max} 以下を指定してください。`)

const timing = {
  measure: integer(1, 1_000_000),
  startTick: integer(0, 1_000_000_000),
  durationTicks: integer(1, 1_000_000_000),
}

const noteSchema = z.strictObject({
  ...timing,
  type: z.literal('note', { error: '音符は note、休符は rest を指定してください。' }),
  string: integer(1, 4),
  fret: integer(0, 24),
  tieFromPrevious: z.boolean().optional(),
})

const restSchema = z.strictObject({
  ...timing,
  type: z.literal('rest'),
})

const songSchema = z.strictObject({
  version: z.literal(1, { error: '対応する形式のバージョンは 1 です。' }),
  title: z.string().trim().min(1, '曲名を入力してください。').max(200, '曲名は200文字以内で入力してください。'),
  bpm: z.number().positive('BPM は正の数を指定してください。').max(1000, 'BPM は1000以下を指定してください。'),
  timeSignature: z.strictObject({
    numerator: integer(1, 32),
    denominator: z.literal([1, 2, 4, 8, 16, 32], { error: '拍子の分母は 1、2、4、8、16、32 のいずれかを指定してください。' }),
  }),
  ticksPerQuarter: integer(24, 96000).refine((ticks) => ticks % 24 === 0, '24 の倍数を指定してください。'),
  tuning: z.tuple([z.literal('E1'), z.literal('A1'), z.literal('D2'), z.literal('G2')], {
    error: 'チューニングは弦番号順に E1、A1、D2、G2 を指定してください。',
  }),
  events: z.array(z.discriminatedUnion('type', [noteSchema, restSchema])).min(1, '音符または休符を入力してください。'),
})

export type Note = z.infer<typeof noteSchema>
type Song = z.infer<typeof songSchema>
type SongEvent = Song['events'][number]

export function parseSong(value: unknown): Song {
  const result = songSchema.safeParse(value)
  if (!result.success) {
    const [issue] = result.error.issues
    const location = issue.path.join('.') || '曲データ'
    const message = /[ぁ-んァ-ヶ一-龠]/.test(issue.message)
      ? issue.message
      : '項目名、値の型、指定できる範囲を確認してください。'
    throw new Error(`${location}：${message}`)
  }

  const song = result.data
  const { numerator, denominator } = song.timeSignature
  const measureTicks = song.ticksPerQuarter * 4 * numerator / denominator
  const indexedEvents = song.events.map((event, index) => ({ event, index }))
  indexedEvents.sort((a, b) => a.event.startTick - b.event.startTick)
  const previousNotes = new Map<number, Note>()
  let restEnd = 0
  let latestNoteEnd = 0

  for (const { event, index } of indexedEvents) {
    const end = event.startTick + event.durationTicks
    const fail = (message: string): never => { throw new Error(`events.${index}：${message}`) }
    if (event.measure !== Math.floor(event.startTick / measureTicks) + 1) {
      fail('小節番号が発音開始位置と一致しません。')
    }
    if (event.startTick < restEnd) fail('休符と別のイベントが重なっています。')
    if (event.type === 'rest') {
      if (event.startTick < latestNoteEnd) fail('休符と音符が重なっています。')
      restEnd = end
      continue
    }
    const previous = previousNotes.get(event.string)
    const previousEnd = previous && previous.startTick + previous.durationTicks
    if (previousEnd !== undefined && event.startTick < previousEnd) {
      fail('同じ弦の音符が重なっています。')
    }
    if (event.tieFromPrevious && (previous?.fret !== event.fret || previousEnd !== event.startTick)) {
      fail('タイは同じ弦・フレットの直前の音符に続けてください。')
    }
    previousNotes.set(event.string, event)
    latestNoteEnd = Math.max(latestNoteEnd, end)
  }

  return { ...song, events: indexedEvents.map(({ event }) => event) }
}

export interface SongPosition {
  measure: number
  startTick: number
  events: SongEvent[]
  notes: Note[]
}

export function getPositions(song: Song): SongPosition[] {
  const positions: SongPosition[] = []

  for (const event of song.events) {
    let position = positions.at(-1)
    if (position?.startTick !== event.startTick) {
      position = { measure: event.measure, startTick: event.startTick, events: [], notes: [] }
      positions.push(position)
    }
    position.events.push(event)
    if (event.type === 'note') position.notes.push(event)
  }

  return positions
}
