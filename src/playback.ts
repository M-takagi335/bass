import type { Note, parseSong } from './song'

type Song = ReturnType<typeof parseSong>
type Voice = Note & { endTick: number; frequency: number }
const openStringMidi = [28, 33, 38, 43]

function firstAfter<T>(items: T[], tick: number, start: (item: T) => number) {
  let low = 0
  let high = items.length
  while (low < high) {
    const mid = Math.floor((low + high) / 2)
    if (start(items[mid]) <= tick) low = mid + 1
    else high = mid
  }
  return low
}

const startOf = (note: Note) => note.startTick

export function createTimeline(song: Song) {
  const strings: Voice[][] = [[], [], [], []]
  let endTick = 0
  for (const event of song.events) {
    const end = event.startTick + event.durationTicks
    endTick = Math.max(endTick, end)
    if (event.type === 'rest') continue
    const notes = strings[event.string - 1]
    const previous = notes.at(-1)
    if (event.tieFromPrevious && previous) {
      previous.endTick = end
    } else {
      const midi = openStringMidi[event.string - 1] + event.fret
      notes.push({ ...event, endTick: end, frequency: 440 * 2 ** ((midi - 69) / 12) })
    }
  }

  const measureTicks = song.ticksPerQuarter * 4 * song.timeSignature.numerator / song.timeSignature.denominator

  return {
    strings,
    endTick,
    measureTicks,
    at(tick: number) {
      return strings.flatMap((notes) => {
        const voice = notes[firstAfter(notes, tick, startOf) - 1]
        return voice && tick < voice.endTick ? [voice] : []
      })
    },
  }
}

export type Timeline = ReturnType<typeof createTimeline>

export class AudioTransport {
  private context?: AudioContext
  private output?: GainNode
  private timer?: number
  private anchorTime = 0
  private anchorTick = 0
  private rate = 0
  private generation = 0
  private voices = new Set<OscillatorNode>()

  get playing() {
    return this.output !== undefined
  }

  soundingPosition() {
    if (!this.context || !this.playing || this.context.state !== 'running') return null
    const elapsed = this.context.currentTime - this.anchorTime
    return elapsed < 0 ? null : this.anchorTick + elapsed * this.rate
  }

  position() {
    if (!this.context || !this.playing) return this.anchorTick
    return this.anchorTick + Math.max(0, this.context.currentTime - this.anchorTime) * this.rate
  }

  async play(timeline: Timeline, tick: number, rate: number) {
    this.stop(tick)
    const generation = this.generation
    const Audio = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Audio) throw new Error('このブラウザーでは音声再生を利用できません。')
    const context = this.context ??= new Audio()
    // Call resume during the play tap, before yielding to the event loop.
    await context.resume()
    if (generation !== this.generation) return
    this.start(timeline, tick, rate)
  }

  start(timeline: Timeline, tick: number, rate: number) {
    this.stop(tick)
    const context = this.context
    if (!context || tick >= timeline.endTick) return

    const output = context.createGain()
    output.gain.value = 0.65
    output.connect(context.destination)
    this.output = output
    this.anchorTime = context.currentTime + 0.03
    this.rate = rate
    const cursors = timeline.strings.map((notes) => {
      const next = firstAfter(notes, tick, startOf)
      return next > 0 && notes[next - 1].endTick > tick ? next - 1 : next
    })

    const schedule = () => {
      const now = context.currentTime
      const horizon = now + 0.15
      for (const [string, notes] of timeline.strings.entries()) {
        while (cursors[string] < notes.length) {
          const voice = notes[cursors[string]]
          const start = this.anchorTime + (Math.max(voice.startTick, tick) - tick) / rate
          if (start > horizon) break
          const end = this.anchorTime + (voice.endTick - tick) / rate
          const onset = Math.max(start, now)
          if (end > onset) this.sound(context, output, voice.frequency, onset, end)
          cursors[string]++
        }
      }
      if (this.position() >= timeline.endTick) this.stop(timeline.endTick)
    }
    this.timer = window.setInterval(schedule, 25)
    schedule()
  }

  stop(tick = this.position()) {
    this.generation++
    this.anchorTick = tick
    window.clearInterval(this.timer)
    this.output?.disconnect()
    this.output = undefined
    for (const oscillator of this.voices) oscillator.stop()
    this.voices.clear()
  }

  close() {
    this.stop()
    void this.context?.close()
    this.context = undefined
  }

  private sound(context: AudioContext, output: GainNode, frequency: number, start: number, end: number) {
    const oscillator = context.createOscillator()
    const envelope = context.createGain()
    const duration = end - start
    oscillator.type = 'triangle'
    oscillator.frequency.value = frequency
    envelope.gain.setValueAtTime(0, start)
    envelope.gain.linearRampToValueAtTime(0.27, start + Math.min(0.008, duration * 0.2))
    envelope.gain.setValueAtTime(0.27, end - Math.min(0.02, duration * 0.3))
    envelope.gain.linearRampToValueAtTime(0, end)
    oscillator.connect(envelope)
    envelope.connect(output)
    this.voices.add(oscillator)
    oscillator.onended = () => {
      this.voices.delete(oscillator)
      oscillator.disconnect()
      envelope.disconnect()
    }
    oscillator.start(start)
    oscillator.stop(end)
  }
}
