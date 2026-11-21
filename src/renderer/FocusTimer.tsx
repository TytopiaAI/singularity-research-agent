import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Pause, Play, RotateCcw } from 'lucide-react'
import { focusOfToday, onFocusLog, recordFocus } from './focus-log'

const PRESETS = [25, 45, 60] as const
const STORE_KEY = 'singularity.planning.focus'
const MAX_HOURS = 24
const MAX_MINUTES = 60
const HOUR_OPTIONS = Array.from({ length: MAX_HOURS + 1 }, (_, index) => index)
const MINUTE_OPTIONS = Array.from({ length: MAX_MINUTES + 1 }, (_, index) => index)

type Stored = { hours: number; mins: number; endAt: number | null; left: number }
/** 旧版本只存 minutes，读的时候顺手迁成「时 / 分」。 */
type Saved = Partial<Stored> & { minutes?: number }

const clampInt = (value: number, min: number, max: number) => Math.min(max, Math.max(min, Number.isFinite(value) ? Math.round(value) : min))
const split = (totalMinutes: number) => ({ hours: Math.floor(totalMinutes / 60), mins: totalMinutes % 60 })

function readStored(): Stored {
  try {
    const raw = window.localStorage.getItem(STORE_KEY)
    if (raw) {
      const value = JSON.parse(raw) as Saved
      const legacy = typeof value.minutes === 'number' ? split(value.minutes) : null
      const hours = typeof value.hours === 'number' ? clampInt(value.hours, 0, MAX_HOURS) : legacy?.hours ?? 0
      const mins = typeof value.mins === 'number' ? clampInt(value.mins, 0, MAX_MINUTES) : legacy?.mins ?? 25
      const left = typeof value.left === 'number' ? value.left : (hours * 60 + mins) * 60
      return { hours, mins, endAt: typeof value.endAt === 'number' ? value.endAt : null, left }
    }
  } catch { /* 本地存储不可用时退回默认值 */ }
  return { hours: 0, mins: 25, endAt: null, left: 25 * 60 }
}

const pad = (value: number) => String(value).padStart(2, '0')
/** 一小时以内是 MM:SS，超过就进位成 H:MM:SS —— 否则 90 分钟会显示成 90:00。 */
const clock = (seconds: number) => {
  const hours = Math.floor(seconds / 3600)
  const rest = seconds % 3600
  return hours > 0 ? `${hours}:${pad(Math.floor(rest / 60))}:${pad(rest % 60)}` : `${pad(Math.floor(rest / 60))}:${pad(rest % 60)}`
}

/** Focus timer that replaces the old "day plan" card.
 *  Time is anchored to an end timestamp, so switching tabs or sleeping
 *  does not drift: on return the ring is already where it should be. */
export function FocusTimer() {
  const [initial] = useState(readStored)
  const [hours, setHours] = useState(initial.hours)
  const [mins, setMins] = useState(initial.mins)
  const [endAt, setEndAt] = useState<number | null>(initial.endAt)
  const [left, setLeft] = useState(initial.left)
  const [now, setNow] = useState(() => Date.now())
  /* 一轮只记一次账：endAt 不变但 effect 会重跑，用 ref 挡掉重复写入。 */
  const logged = useRef<number | null>(null)
  /* 卡片底部那句「今天几轮」跟着流水走：跑完一轮立刻刷新，不用重开面板。 */
  const [todayLog, setTodayLog] = useState(focusOfToday)

  const total = (hours * 60 + mins) * 60
  const remaining = endAt === null ? left : Math.max(0, Math.ceil((endAt - now) / 1000))
  const running = endAt !== null && remaining > 0
  /* 0 时 0 分时剩余也是 0，不能当成「跑完一轮」，那会显示成完成态。 */
  const finished = total > 0 && remaining === 0
  const progress = total > 0 ? Math.min(1, Math.max(0, 1 - remaining / total)) : 0

  useEffect(() => {
    if (endAt === null) return
    const id = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(id)
  }, [endAt])

  useEffect(() => {
    if (endAt !== null && remaining <= 0) {
      setEndAt(null); setLeft(0)
      /* 跑满一轮才算专注：中途暂停或重置不计入月度统计。 */
      if (logged.current !== endAt && total > 0) { logged.current = endAt; recordFocus(total / 60) }
    }
  }, [endAt, remaining])

  useEffect(() => onFocusLog(() => setTodayLog(focusOfToday())), [])

  useEffect(() => {
    try { window.localStorage.setItem(STORE_KEY, JSON.stringify({ hours, mins, endAt, left })) } catch { /* 忽略写入失败 */ }
  }, [hours, mins, endAt, left])

  /** 换时长一律重置：正计时到一半改数字，不如直接从头开始。 */
  const apply = (nextHours: number, nextMins: number) => {
    const safeHours = clampInt(nextHours, 0, MAX_HOURS)
    const safeMins = clampInt(nextMins, 0, MAX_MINUTES)
    setHours(safeHours); setMins(safeMins)
    setEndAt(null); setNow(Date.now()); setLeft((safeHours * 60 + safeMins) * 60)
  }
  const toggle = () => {
    if (running) { setLeft(remaining); setEndAt(null); return }
    const next = remaining > 0 ? remaining : total
    if (next <= 0) return
    const stamp = Date.now()
    setNow(stamp); setLeft(next); setEndAt(stamp + next * 1000)
  }
  const reset = () => { setNow(Date.now()); setEndAt(null); setLeft(total) }

  const radius = 52
  const circumference = 2 * Math.PI * radius
  const time = clock(remaining)
  const state = total <= 0 ? '先选个时长' : finished ? '完成一轮' : running ? '专注中' : remaining < total ? '已暂停' : '准备好了'
  const activePreset = PRESETS.find(value => value === hours * 60 + mins)
  return <section className="planning-card planning-focus" aria-label="专注计时">
    <header className="planning-card-head">
      <div className="planning-focus-heading"><span className="planning-kicker">FOCUS</span><h2>番茄钟</h2></div>
      <div className="planning-focus-presets" role="group" aria-label="常用时长">
        {PRESETS.map(value => <button key={value} type="button" className={activePreset === value ? 'active' : ''} aria-pressed={activePreset === value} disabled={running} onClick={() => apply(split(value).hours, split(value).mins)}>{value}</button>)}
      </div>
    </header>
    <div className="planning-focus-body">
      <div className="planning-focus-ring" style={{ '--focus-progress': progress } as CSSProperties}>
        <svg viewBox="0 0 120 120" aria-hidden="true">
          <circle className="planning-focus-face" cx="60" cy="60" r={45} />
          <circle className="planning-focus-track" cx="60" cy="60" r={radius} />
          <circle className="planning-focus-arc" cx="60" cy="60" r={radius} strokeDasharray={circumference} strokeDashoffset={circumference * (1 - progress)} />
          {/* 进度末端的小圆点跟着 --focus-progress 转，起点放在 3 点方向（父级已 rotate -90°）。 */}
          <circle className="planning-focus-dot" cx={60 + radius} cy={60} r={5} style={{ opacity: progress > 0 && progress < 0.999 ? 1 : 0 }} />
        </svg>
        <div className="planning-focus-clock"><strong className={time.length > 7 ? 'is-long' : ''}>{time}</strong><span>{state}</span></div>
      </div>
      {/* 时长选择常驻：一轮跑完还能直接改成下一轮的长度，不用先点「再来一轮」。 */}
      <div className="planning-focus-duration">
        <select aria-label="专注小时" title="小时" value={hours} disabled={running} onChange={event => apply(Number(event.target.value), mins)}>
          {HOUR_OPTIONS.map(value => <option key={value} value={value}>{value}</option>)}
        </select>
        <span>时</span>
        <select aria-label="专注分钟" title="分钟" value={mins} disabled={running} onChange={event => apply(hours, Number(event.target.value))}>
          {MINUTE_OPTIONS.map(value => <option key={value} value={value}>{value}</option>)}
        </select>
        <span>分</span>
      </div>
      <div className="planning-focus-actions">
        <button type="button" className="planning-focus-start" disabled={total <= 0} onClick={toggle}>{running ? <Pause size={15} /> : <Play size={15} />}{running ? '暂停' : finished ? '再来一轮' : '开始专注'}</button>
        <button type="button" className="planning-focus-reset" aria-label="重置计时" onClick={reset}><RotateCcw size={14} /></button>
      </div>
      </div>
      <p className="planning-focus-today">{todayLog.rounds > 0 ? <>今天 <b>{todayLog.rounds}</b> 轮 · <b>{todayLog.minutes}</b> 分钟</> : '今天还没有跑完一轮'}</p>
  </section>
}
