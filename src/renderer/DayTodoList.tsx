import { useEffect, useState } from 'react'
import { Check, Plus, X } from 'lucide-react'
import { type PlanningSnapshot, type PlanningTodo } from '../shared/planning'
import { todosForDay } from '../shared/day-schedule'
import { DateField } from './DateField'

const newTodoId = () => `todo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
const shortDay = (day: string) => `${Number(day.slice(5, 7))}/${Number(day.slice(-2))}`
const DURATIONS = [15, 30, 45, 60, 90, 120] as const

/** Dated checklist: each chore is a candidate for that day's auto-built itinerary.
 *  Legacy undated todos stay on today, so nothing disappears after the upgrade. */
export function DayTodoList({ data, selected, today, busy, onWrite }: {
  data: PlanningSnapshot
  selected: string
  today: string
  busy: boolean
  onWrite: (todos: PlanningTodo[]) => void
}) {
  const [view, setView] = useState<'day' | 'all'>('day')
  const [draft, setDraft] = useState('')
  const [dateDraft, setDateDraft] = useState(selected)
  const [minutes, setMinutes] = useState<number>(30)
  useEffect(() => setDateDraft(selected), [selected])
  const todos = data.todos || []
  const dayTodos = todosForDay(data, selected, today)
  const visible = view === 'day' ? dayTodos : todos
  const add = () => {
    const title = draft.trim()
    if (!title) return
    onWrite([...todos, { id: newTodoId(), title, done: false, createdAt: new Date().toISOString(), date: dateDraft, minutes }])
    setDraft('')
  }
  const update = (id: string, patch: Partial<PlanningTodo>) => onWrite(todos.map(todo => todo.id === id ? { ...todo, ...patch } : todo))
  const doneCount = visible.filter(item => item.done).length
  return <section className="planning-card planning-checklist" aria-label="待办事项">
    <header className="planning-card-head">
      <h2>待办事项</h2>
      <span className="planning-todo-count">{doneCount} / {visible.length}</span>
      <div className="planning-todo-view"><button className={view === 'day' ? 'active' : ''} onClick={() => setView('day')}>本日</button><button className={view === 'all' ? 'active' : ''} onClick={() => setView('all')}>全部</button></div>
    </header>
    <form className="planning-checklist-add planning-todo-add" onSubmit={event => { event.preventDefault(); add() }}>
      <div className="planning-todo-add-title">
        <input className="planning-todo-title" aria-label="新待办内容" value={draft} onChange={event => setDraft(event.target.value)} maxLength={180} placeholder="记一件小事" />
        <button className="planning-todo-add-button" type="submit" aria-label="添加待办" disabled={busy || !draft.trim()}><Plus size={16} /></button>
      </div>
      <div className="planning-todo-add-row">
        <DateField ariaLabel="待办日期" value={dateDraft} today={today} onChange={setDateDraft} />
        <select aria-label="待办预计时长" value={minutes} onChange={event => setMinutes(Number(event.target.value))}>{DURATIONS.map(value => <option key={value} value={value}>{value} 分钟</option>)}</select>
      </div>
    </form>
    <div className="planning-checklist-items">
      {visible.length ? visible.map(item => <div key={item.id} className={`planning-checklist-item ${item.done ? 'done' : ''}`}>
        <button className="planning-checklist-check" aria-label={`${item.done ? '取消完成' : '完成'}：${item.title}`} aria-pressed={item.done} disabled={busy} onClick={() => update(item.id, { done: !item.done })}>{item.done && <Check size={12} />}</button>
        <div className="planning-checklist-body">
          <span className="planning-checklist-title" title={item.title}>{item.title}</span>
          <span className="planning-checklist-meta">
            {item.minutes ? <em>{item.minutes} 分钟</em> : null}
            {item.minutes && view === 'all' ? <i className="planning-checklist-dot" aria-hidden="true" /> : null}
            {view === 'all' ? <DateField bare ariaLabel={`设置${item.title}的日期`} today={today} value={item.date || today} onChange={date => update(item.id, { date })} /> : null}
          </span>
        </div>
        <button className="planning-checklist-remove" aria-label={`删除待办：${item.title}`} disabled={busy} onClick={() => onWrite(todos.filter(todo => todo.id !== item.id))}><X size={13} /></button>
      </div>) : <p className="planning-checklist-empty">{view === 'day' ? `${shortDay(selected)} 还没有待办` : '还没有待办'}</p>}
    </div>
  </section>
}
