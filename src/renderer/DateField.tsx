import { useEffect, useRef, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { dayDate, localDay, monthDays, weekdayLabels, weekdayOrder } from '../shared/planning'
import './date-field.css'

const monthOf = (day: string) => day.slice(0, 7)
const monthLabel = (month: string) => `${month.slice(0, 4)}年${Number(month.slice(5, 7))}月`
const display = (day: string) => day ? `${day.slice(0, 4)}/${day.slice(5, 7)}/${day.slice(8, 10)}` : ''
/** 上一月 / 下一月：用 Date 算，避免 12 月 +1 变成 13 月。 */
function shiftMonth(month: string, delta: number) {
  const date = dayDate(`${month}-01`)
  date.setMonth(date.getMonth() + delta)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

/** 原生 <input type="date"> 的日历弹层由 Chromium 自己画，CSS 完全碰不到；
    要跟界面统一就只能自己画一个。点开是一张和下拉菜单同款的浮层日历，
    选中即回调，Esc 只关日历不关整个弹窗。 */
export function DateField({ value, onChange, ariaLabel, placeholder = '选择日期', clearable = false, min, max, today, bare = false }: {
  value: string
  onChange: (day: string) => void
  ariaLabel: string
  placeholder?: string
  clearable?: boolean
  min?: string
  max?: string
  today?: string
  /** 行内只有文字的形态：外边距、边框、图标都去掉，点开还是同一张日历。 */
  bare?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [month, setMonth] = useState(monthOf(value || today || localDay()))
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const wrap = useRef<HTMLSpanElement>(null)
  const pop = useRef<HTMLDivElement>(null)
  const now = today || localDay()

  useEffect(() => {
    if (!open) return
    const el = pop.current
    /* 挂到 top layer，否则会被 dialog 的滚动容器裁掉（原生 select 的菜单也是这么躲的）。 */
    el?.showPopover?.()
    const place = () => {
      const rect = wrap.current?.getBoundingClientRect()
      if (!rect) return
      const height = pop.current?.offsetHeight || 320, width = pop.current?.offsetWidth || 268
      const below = rect.bottom + 8, above = rect.top - height - 8
      const top = below + height > window.innerHeight - 8 && above > 8 ? above : below
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))
      setPos({ top, left })
    }
    place()
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (wrap.current?.contains(target) || pop.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      el?.hidePopover?.()
      document.removeEventListener('pointerdown', onDown)
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open])

  const blocked = (day: string) => Boolean((min && day < min) || (max && day > max))
  const pick = (day: string) => {
    if (blocked(day)) return
    onChange(day)
    setOpen(false)
  }
  /* Esc 只收日历：在字段和浮层上就地拦掉，别让它冒到 dialog 触发关闭。 */
  const onEscape = (event: React.KeyboardEvent) => {
    if (event.key !== 'Escape' || !open) return
    event.preventDefault()
    event.stopPropagation()
    setOpen(false)
  }
  const lead = (dayDate(`${month}-01`).getDay() + 6) % 7
  const days = monthDays(month)

  return <span className={`planning-date-field ${bare ? 'bare' : ''}`} ref={wrap} onKeyDown={onEscape}>
    <button type="button" className={`planning-date-trigger ${value ? '' : 'empty'}`} aria-label={ariaLabel} aria-haspopup="dialog" aria-expanded={open} onClick={() => { setMonth(monthOf(value || now)); setOpen(!open) }}>
      <span>{display(value) || placeholder}</span>
      {!bare && <CalendarDays size={13} aria-hidden="true" />}
    </button>
    {open && <div className="planning-date-pop" ref={pop} popover="manual" role="dialog" aria-label={`${ariaLabel}：选择日期`} style={{ visibility: pos ? 'visible' : 'hidden', top: pos?.top ?? 0, left: pos?.left ?? 0 }}>
      <header>
        <strong>{monthLabel(month)}</strong>
        <div>
          <button type="button" aria-label="上个月" onClick={() => setMonth(shiftMonth(month, -1))}><ChevronLeft size={14} /></button>
          <button type="button" aria-label="下个月" onClick={() => setMonth(shiftMonth(month, 1))}><ChevronRight size={14} /></button>
        </div>
      </header>
      <div className="planning-date-week" aria-hidden="true">{weekdayOrder.map(day => <span key={day}>{weekdayLabels[day]}</span>)}</div>
      <div className="planning-date-grid" role="group">
        {Array.from({ length: lead }, (_, index) => <span key={`lead-${index}`} />)}
        {days.map(day => <button type="button" key={day} className={`${day === value ? 'selected' : ''} ${day === now ? 'today' : ''}`} aria-label={day} aria-pressed={day === value} disabled={blocked(day)} onClick={() => pick(day)}>{Number(day.slice(-2))}</button>)}
      </div>
      <footer>
        <button type="button" onClick={() => pick(now)} disabled={blocked(now)}>今天</button>
        {clearable && value ? <button type="button" onClick={() => { onChange(''); setOpen(false) }}>清除</button> : null}
      </footer>
    </div>}
  </span>
}
