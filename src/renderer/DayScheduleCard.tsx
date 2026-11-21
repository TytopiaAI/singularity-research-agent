import { useMemo } from 'react'
import { Clock3, RotateCcw } from 'lucide-react'
import { dayDate, type PlanningSnapshot } from '../shared/planning'
import { buildDaySchedule, scheduleOverridesFor, scheduleTimeLabel, SCHEDULE_END, SCHEDULE_START } from '../shared/day-schedule'
import { minuteTime } from '../shared/planning-calendar'

/** A full-day itinerary card: fixed calendar plans and meals stay put, while
 *  the day's todos, deadlines and untimed plans are fitted into the gaps. */
export function DayScheduleCard({ data, selected, busy, perform }: {
  data: PlanningSnapshot
  selected: string
  busy: boolean
  perform: (task: () => Promise<PlanningSnapshot>) => Promise<boolean>
}) {
  const overrides = scheduleOverridesFor(data, selected)
  const schedule = useMemo(() => buildDaySchedule(data, selected, { overrides }), [data, selected, overrides])
  const fixed = schedule.slots.filter(slot => slot.kind === 'plan' || slot.kind === 'meal').length
  const freeMinutes = schedule.slots.filter(slot => slot.kind === 'free').reduce((sum, slot) => sum + slot.end - slot.start, 0)
  const setStart = (sourceId: string, value: string) => {
    const next = { ...overrides }
    if (value) next[sourceId] = value
    else delete next[sourceId]
    void perform(() => window.singularity.planning.saveScheduleOverrides(selected, next))
  }
  const parts = [
    { id: 'morning', label: '上午', from: SCHEDULE_START, to: 12 * 60 },
    { id: 'afternoon', label: '下午', from: 12 * 60, to: 18 * 60 },
    { id: 'evening', label: '晚上', from: 18 * 60, to: SCHEDULE_END + 1 },
  ]
  return <section className="planning-card planning-day-schedule" aria-label="一日行程">
    <header className="planning-card-head">
      <div><h2>一日行程 · {dayDate(selected).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })}</h2></div>
      <button className="planning-schedule-reset" disabled={busy || !Object.keys(overrides).length} onClick={() => void perform(() => window.singularity.planning.saveScheduleOverrides(selected, {}))}><RotateCcw size={13} />重新排程</button>
    </header>
    <div className="planning-schedule-summary"><span><Clock3 size={12} />{minuteTime(SCHEDULE_START)}–{minuteTime(SCHEDULE_END)}</span><span>固定 {fixed} 项</span><span>自动排入 {schedule.flexible} 项</span><span>空闲 {Math.floor(freeMinutes / 60)} 小时 {freeMinutes % 60} 分</span></div>
    <div className="planning-schedule-grid">
      {parts.map(part => {
        const rows = schedule.slots.filter(slot => slot.start >= part.from && slot.start < part.to)
        return <div className="planning-schedule-column" key={part.id}>
          <div className="planning-schedule-part"><strong>{part.label}</strong><span>{scheduleTimeLabel(part.from, Math.min(SCHEDULE_END, part.to))}</span></div>
          <div className="planning-schedule-list">
            {rows.length ? rows.map(slot => <div key={slot.id} className={`planning-schedule-row ${slot.kind} tone-${slot.tone} ${slot.conflict ? 'conflict' : ''}`}>
              <span className="planning-schedule-time">{scheduleTimeLabel(slot.start, slot.end)}</span>
              <div className="planning-schedule-body"><strong title={slot.title}>{slot.title}</strong><small>{slot.conflict ? '与固定安排冲突' : slot.note || '留白'}{slot.pinned && ' · 已手动调整'}</small></div>
              {slot.movable && <input className="planning-schedule-start" type="time" aria-label={`调整${slot.title}的开始时间`} title="调整开始时间" disabled={busy} value={minuteTime(slot.start)} onChange={event => setStart(slot.sourceId, event.target.value)} />}
            </div>) : <p className="planning-schedule-idle">这段时间没有安排。</p>}
          </div>
        </div>
      })}
    </div>
    {schedule.unscheduled.length > 0 && <p className="planning-schedule-overflow">今天排不下的 {schedule.unscheduled.length} 项：{schedule.unscheduled.map(item => item.title).join('、')}。可以缩短预计时长，或改到别的一天。</p>}  </section>
}
