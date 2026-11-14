import { useEffect, useRef, useState } from 'react'
import { stringTuning, type Note } from './song'

const fretCount = 25
const fretWidth = 64
const strings = [4, 3, 2, 1]
const inlays = [3, 5, 7, 9, 12, 15, 17, 19, 21, 24]
const fretX = (fret: number) => fretWidth * (fret + 0.5)
const stringY = (string: number) => 57 + (4 - string) * 33

interface Props {
  current: Note[]
}

export function Fretboard({ current }: Props) {
  const [visibleFrets, setVisibleFrets] = useState(7)
  const zoomRef = useRef(visibleFrets)
  const [boardWidth, setBoardWidth] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const scale = boardWidth / (visibleFrets * fretWidth) || 1
  const left = Math.min(...current.map((note) => note.fret)) * fretWidth * scale
  const right = (Math.max(...current.map((note) => note.fret)) + 1) * fretWidth * scale

  useEffect(() => {
    zoomRef.current = visibleFrets
  }, [visibleFrets])

  useEffect(() => {
    const scroll = scrollRef.current
    if (!scroll) return
    const observer = new ResizeObserver(([entry]) => setBoardWidth(entry.contentRect.width))
    observer.observe(scroll)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const scroll = scrollRef.current
    if (!scroll || !Number.isFinite(left)) return
    if (left < scroll.scrollLeft || right > scroll.scrollLeft + scroll.clientWidth) {
      scroll.scrollLeft = left
    }
  }, [left, right])

  useEffect(() => {
    const scroll = scrollRef.current
    if (!scroll) return
    let pinch: { distance: number; visibleFrets: number } | undefined
    const distance = (touches: TouchList) =>
      Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY)

    function start(event: TouchEvent) {
      if (event.touches.length === 2) pinch = { distance: distance(event.touches), visibleFrets: zoomRef.current }
    }
    function move(event: TouchEvent) {
      if (!pinch || event.touches.length !== 2) return
      if (event.cancelable) event.preventDefault()
      const count = Math.round(pinch.visibleFrets * pinch.distance / Math.max(distance(event.touches), 1))
      setVisibleFrets(Math.min(25, Math.max(4, count)))
    }
    function end() {
      pinch = undefined
    }

    scroll.addEventListener('touchstart', start)
    scroll.addEventListener('touchmove', move, { passive: false })
    scroll.addEventListener('touchend', end)
    scroll.addEventListener('touchcancel', end)
    return () => {
      scroll.removeEventListener('touchstart', start)
      scroll.removeEventListener('touchmove', move)
      scroll.removeEventListener('touchend', end)
      scroll.removeEventListener('touchcancel', end)
    }
  }, [])

  function moveBoard(direction: number) {
    const scroll = scrollRef.current
    if (scroll) scroll.scrollLeft += direction * scroll.clientWidth * 0.75
  }

  return (
    <section className="panel fretboard-panel" aria-labelledby="fretboard-title">
      <div className="board-heading">
        <h2 id="fretboard-title">4弦ベースの指板</h2>
        <div className="legend">
          <span><i className="current-dot" />発音中</span>
        </div>
      </div>
      <div className="zoom">
        <label htmlFor="visible-frets">表示範囲 <output htmlFor="visible-frets">{visibleFrets} フレット分</output></label>
        <input id="visible-frets" type="range" min="4" max={fretCount} value={visibleFrets}
          onChange={(event) => setVisibleFrets(event.currentTarget.valueAsNumber)} />
      </div>
      <p className="hint" id="scroll-help">左右にスクロールすると、開放弦（0）から24フレットまで確認できます。</p>
      <div className="board">
        <div className="string-labels" aria-hidden="true">
          {strings.map((string) => <span key={string}>{stringTuning[string - 1]}</span>)}
        </div>
        <div className="board-scroll" ref={scrollRef} tabIndex={0} role="region" aria-label="指板のスクロール領域" aria-describedby="scroll-help">
          <svg viewBox={`0 0 ${fretWidth * fretCount} 180`} preserveAspectRatio="none"
            style={{ width: `${100 * fretCount / visibleFrets}%` }}
            role="img" aria-label="上から G、D、A、E の4弦。開放弦から24フレットまで">
            <rect y="36" width="1600" height="142" fill="#263840" />
            <rect y="36" width={fretWidth} height="142" fill="#17262f" />
            {Array.from({ length: fretCount }, (_, fret) => (
              <g key={fret}>
                <text className={fretWidth * scale < 16 ? 'fret-number compact' : 'fret-number'}
                  transform={`translate(${fretX(fret)} 23) scale(${1 / scale} 1)`}>{fret}</text>
                <line x1={fretWidth * (fret + 1)} x2={fretWidth * (fret + 1)} y1="36" y2="178"
                  stroke={fret === 0 ? '#eef1dd' : '#86949a'} strokeWidth={fret === 0 ? 4 : 1} vectorEffect="non-scaling-stroke" />
              </g>
            ))}
            {inlays.map((fret) => (
              <g key={fret} fill="#53666d">
                <circle cx={fretX(fret)} cy={fret % 12 === 0 ? 74 : 106.5} r="4" />
                {fret % 12 === 0 && <circle cx={fretX(fret)} cy="140" r="4" />}
              </g>
            ))}
            {strings.map((string) => (
              <line key={string} x1="0" x2="1600" y1={stringY(string)} y2={stringY(string)}
                stroke="#adbdc0" strokeWidth={2.6 - string * 0.4} vectorEffect="non-scaling-stroke" />
            ))}
            {current.map((note) => (
              <ellipse key={note.string} className="current-dot" cx={fretX(note.fret)} cy={stringY(note.string)}
                ry={Math.min(11, fretWidth * scale * 0.4)} rx={Math.min(11 / scale, fretWidth * 0.4)} />
            ))}
          </svg>
        </div>
      </div>
      <div className="scroll-buttons">
        <button type="button" onClick={() => moveBoard(-1)}>← 指板を左へ</button>
        <button type="button" onClick={() => moveBoard(1)}>指板を右へ →</button>
      </div>
    </section>
  )
}
