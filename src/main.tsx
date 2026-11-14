import { StrictMode, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { createRoot } from 'react-dom/client'
import sampleData from './sample-song.json'
import sampleUrl from './sample-song.json?url'
import { Fretboard } from './Fretboard'
import { parseSong, stringTuning, type Note } from './song'
import { AudioTransport, createTimeline } from './playback'
import './styles.css'

const sampleSong = parseSong(sampleData)
const emptyNotes: Note[] = []

function describeNotes(notes: Note[]) {
  return notes.map((note) => {
    const fret = note.fret === 0 ? '開放弦' : `${note.fret} フレット`
    return `${stringTuning[note.string - 1]}弦 ${fret}${note.tieFromPrevious ? '（タイ）' : ''}`
  }).join('、')
}

function formatTime(seconds: number) {
  const whole = Math.floor(seconds)
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

function App() {
  const [song, setSong] = useState(sampleSong)
  const [transport] = useState(() => new AudioTransport())
  const [tick, setTick] = useState(0)
  const [soundingTick, setSoundingTick] = useState<number | null>(null)
  const [playing, setPlaying] = useState(false)
  const [bpm, setBpm] = useState(sampleSong.bpm)
  const [bpmInput, setBpmInput] = useState(String(sampleSong.bpm))
  const [speed, setSpeed] = useState(1)
  const [audioError, setAudioError] = useState('')
  const [error, setError] = useState('')
  const request = useRef(0)
  const playRequest = useRef(0)
  const timeline = useMemo(() => createTimeline(song), [song])
  const rate = bpm * speed * song.ticksPerQuarter / 60
  const current = soundingTick === null ? emptyNotes : timeline.at(soundingTick)
  const finished = tick >= timeline.endTick

  useEffect(() => () => transport.close(), [transport])

  useEffect(() => {
    if (!playing) return
    let frame: number
    function update() {
      const sounding = transport.soundingPosition()
      const position = Math.min(sounding ?? transport.position(), timeline.endTick)
      setTick(position)
      setSoundingTick(position < timeline.endTick ? sounding : null)
      if (position >= timeline.endTick) transport.stop(timeline.endTick)
      if (transport.playing) frame = requestAnimationFrame(update)
      else setPlaying(false)
    }
    frame = requestAnimationFrame(update)
    return () => cancelAnimationFrame(frame)
  }, [playing, timeline, transport])

  function loadSong(loaded: typeof sampleSong) {
    playRequest.current++
    transport.stop(0)
    setSoundingTick(null)
    setPlaying(false)
    setAudioError('')
    setSong(loaded)
    setTick(0)
    setBpm(loaded.bpm)
    setBpmInput(String(loaded.bpm))
    setSpeed(1)
  }

  async function loadFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return
    const id = ++request.current
    setError('')

    try {
      const contents = await file.text()
      if (id !== request.current) return
      const value: unknown = JSON.parse(contents.replace(/^\uFEFF/, ''))
      loadSong(parseSong(value))
    } catch (cause) {
      if (id !== request.current) return
      const message = cause instanceof SyntaxError
        ? 'JSON の書式が正しくありません。'
        : cause instanceof DOMException
          ? 'ファイルを読み取れませんでした。'
          : cause instanceof Error ? cause.message : 'ファイルを読み取れませんでした。'
      setError(`${file.name} を読み込めませんでした。 ${message}`)
    }
  }

  function loadSample() {
    request.current++
    setError('')
    loadSong(sampleSong)
  }

  async function togglePlayback() {
    const id = ++playRequest.current
    setAudioError('')
    if (transport.playing) {
      const position = Math.min(transport.position(), timeline.endTick)
      transport.stop(position)
      setSoundingTick(null)
      setTick(position)
      setPlaying(false)
      return
    }
    const position = transport.position()
    try {
      await transport.play(timeline, position >= timeline.endTick ? 0 : position, rate)
      if (id !== playRequest.current) return
      setTick(transport.position())
      setPlaying(transport.playing)
    } catch (cause) {
      if (id !== playRequest.current) return
      setAudioError(cause instanceof Error && cause.message.startsWith('このブラウザー')
        ? cause.message : '音声を開始できませんでした。もう一度「再生」をタップしてください。')
    }
  }

  function seek(target: number) {
    playRequest.current++
    const position = Math.min(timeline.endTick, Math.max(0, target))
    if (transport.playing) transport.start(timeline, position, rate)
    else transport.stop(position)
    setSoundingTick(null)
    setTick(position)
    setPlaying(transport.playing)
  }

  function changeTempo(nextBpm: number, nextSpeed: number) {
    playRequest.current++
    const position = Math.min(transport.position(), timeline.endTick)
    if (transport.playing) transport.start(timeline, position, nextBpm * nextSpeed * song.ticksPerQuarter / 60)
    else transport.stop(position)
    setSoundingTick(null)
    setTick(position)
    setPlaying(transport.playing)
    setBpm(nextBpm)
    setSpeed(nextSpeed)
  }

  function commitBpm(value: number) {
    if (value > 0 && value <= 1000 && value !== bpm) changeTempo(value, speed)
    else setBpmInput(String(bpm))
  }

  return (
    <main>
      <header className="page-header">
        <h1>ベースTAB譜プレイヤー</h1>
        <a href={sampleUrl} download="sample-song.json">サンプル JSON を保存</a>
      </header>
      <section className="panel song-panel" aria-labelledby="song-title">
        <div className="song-heading">
          <div>
            <h2 id="song-title">{song.title}</h2>
            <dl className="metadata">
              <div><dt>テンポ</dt><dd>{song.bpm} BPM</dd></div>
              <div><dt>拍子</dt><dd>{song.timeSignature.numerator}/{song.timeSignature.denominator}</dd></div>
              <div><dt>チューニング</dt><dd>{song.tuning.join(' / ')}</dd></div>
            </dl>
          </div>
          <div className="file-actions">
            <label className="file-button">
              JSON ファイルを開く
              <input type="file" accept=".json,application/json" onChange={loadFile} />
            </label>
            <button type="button" onClick={loadSample}>サンプル曲に戻す</button>
          </div>
        </div>
        {error && <p className="error" role="alert">{error}</p>}
      </section>
      <Fretboard current={current} />
      <section className="panel playback" aria-labelledby="playback-title">
        <h2 id="playback-title">自動演奏</h2>
        <div className="transport-buttons">
          <button type="button" disabled={tick === 0} onClick={() => seek(transport.position() - 5 * rate)}>↶ 5秒戻る</button>
          <button type="button" className="primary" onClick={() => void togglePlayback()}>{playing ? '一時停止' : '再生'}</button>
          <button type="button" disabled={finished} onClick={() => seek(transport.position() + 5 * rate)}>5秒進む ↷</button>
        </div>
        <div className="progress-label">
          <label htmlFor="playback-position">再生位置</label>
          <span>{formatTime(tick / rate)} / {formatTime(timeline.endTick / rate)}</span>
        </div>
        <input id="playback-position" type="range" min="0" max={timeline.endTick} step="any" value={tick}
          aria-valuetext={formatTime(tick / rate)} onChange={(event) => seek(event.currentTarget.valueAsNumber)} />
        <div className="tempo-controls">
          <label>演奏 BPM
            <input type="number" min="0" max="1000" step="any" inputMode="decimal" value={bpmInput}
              onChange={(event) => setBpmInput(event.currentTarget.value)}
              onBlur={(event) => commitBpm(event.currentTarget.valueAsNumber)}
              onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }} />
          </label>
          <label>再生倍率
            <select value={speed} onChange={(event) => changeTempo(bpm, Number(event.currentTarget.value))}>
              {[0.25, 0.5, 0.75, 1, 1.25, 1.5, 2].map((factor) => <option key={factor} value={factor}>{factor} 倍</option>)}
            </select>
          </label>
        </div>
        <div aria-live={playing ? 'off' : 'polite'}>
          <p className="position">{finished ? '演奏終了' : `${Math.floor(tick / timeline.measureTicks) + 1} 小節目`}</p>
          <p className="current-position"><strong>現在</strong> {finished ? '曲の終わり' : !playing ? '停止中' : describeNotes(current) || '無音'}</p>
        </div>
        {audioError && <p className="error" role="alert">{audioError}</p>}
      </section>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
