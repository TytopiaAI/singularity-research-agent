import { localDay, plansForDay, tasksForDay, type PlanPriority, type PlanningSnapshot, type PlanningTodo } from './planning'
import { minuteTime, timeMinutes } from './planning-calendar'

/** The itinerary covers a waking day. Fixed calendar plans and meals are anchors;
 *  chores, deadlines and untimed plans are fitted into the gaps between them. */
export const SCHEDULE_START = 7 * 60
export const SCHEDULE_END = 23 * 60
/** Breathing room kept around every occupied block. */
export const SCHEDULE_GAP = 10
/** Shorter gaps are too fragmented to be worth showing as free time. */
export const MIN_FREE_MINUTES = 15

export type ScheduleKind = 'plan' | 'todo' | 'task' | 'meal' | 'free'
export type ScheduleTone = 'a' | 'b' | 'c'
export interface ScheduleSlot {
  id: string
  kind: ScheduleKind
  title: string
  start: number
  end: number
  /** Stable key used for manual start-time overrides. Empty for anchors/free time. */
  sourceId: string
  note: string
  tone: ScheduleTone
  /** Only auto-scheduled items can be moved; calendar plans are fixed. */
  movable: boolean
  pinned: boolean
  conflict: boolean
}
export interface UnscheduledItem { sourceId: string; title: string; minutes: number }
export interface DaySchedule {
  day: string
  slots: ScheduleSlot[]
  unscheduled: UnscheduledItem[]
  /** Number of auto-scheduled chores/tasks/untimed plans. */
  flexible: number
  busyMinutes: number
}
interface Interval { start: number; end: number }
interface FlexibleItem {
  sourceId: string
  title: string
  minutes: number
  note: string
  tone: ScheduleTone
  order: number
  priority: number
  pinnedAt?: number
}

const MEALS = [
  { id: 'meal-breakfast', title: '早餐', start: 7 * 60 + 30, end: 8 * 60 },
  { id: 'meal-lunch', title: '午餐', start: 12 * 60, end: 12 * 60 + 40 },
  { id: 'meal-dinner', title: '晚餐', start: 18 * 60, end: 18 * 60 + 40 },
]
const PRIORITY_WEIGHT: Record<PlanPriority, number> = { 'urgent-important': 0, important: 1, urgent: 2, ordinary: 3 }
const DEFAULT_CHORE_MINUTES = 30
const DEFAULT_TASK_MINUTES = 60

/** Todos with an explicit date belong to that day. Legacy undated todos stay on today. */
export function todosForDay(data: PlanningSnapshot, day: string, today = localDay()): PlanningTodo[] {
  return (data.todos || []).filter(todo => todo.date ? todo.date === day : day === today)
}
export function scheduleOverridesFor(data: PlanningSnapshot, day: string): Record<string, string> {
  return data.scheduleOverrides?.[day] || {}
}
export function scheduleTimeLabel(start: number, end: number): string {
  return `${minuteTime(start)}–${minuteTime(end)}`
}
function boundedMinutes(value: number | undefined, fallback: number): number {
  return Math.max(15, Math.min(240, Math.round(value || fallback)))
}
function merge(intervals: Interval[]): Interval[] {
  const sorted = intervals.filter(item => item.end > item.start).sort((a, b) => a.start - b.start || a.end - b.end)
  const result: Interval[] = []
  for (const item of sorted) {
    const last = result[result.length - 1]
    if (last && item.start <= last.end) last.end = Math.max(last.end, item.end)
    else result.push({ ...item })
  }
  return result
}
function overlaps(intervals: Interval[], start: number, end: number): boolean {
  return intervals.some(item => start < item.end && end > item.start)
}

/** Collect everything that wants a slot on this day, in scheduling order. */
export function dayScheduleItems(data: PlanningSnapshot, day: string, today = localDay()): FlexibleItem[] {
  const items: FlexibleItem[] = []
  let order = 0
  for (const todo of todosForDay(data, day, today)) {
    if (todo.done) continue
    items.push({ sourceId: `todo:${todo.id}`, title: todo.title, minutes: boundedMinutes(todo.minutes, DEFAULT_CHORE_MINUTES), note: '待办', tone: 'b', order: order++, priority: PRIORITY_WEIGHT[todo.priority || 'ordinary'] })
  }
  for (const task of tasksForDay(data, day)) {
    if (task.done) continue
    items.push({ sourceId: `task:${task.id}`, title: task.title, minutes: DEFAULT_TASK_MINUTES, note: task.parentId ? '任务 · 子任务' : '任务 · 截止日', tone: 'c', order: order++, priority: PRIORITY_WEIGHT.important })
  }
  // 未定时间的计划不进一日行程（定了时间才排），只保留已定时间的固定日程
  return items.sort((a, b) => a.priority - b.priority || a.minutes - b.minutes || a.order - b.order)
}

/**
 * Build a full-day itinerary. Everything is computed locally: no model call, no network.
 * Calendar plans with a time are immovable anchors; meals are inserted when free;
 * the remaining items take the earliest gap that fits, padded by SCHEDULE_GAP.
 */
export function buildDaySchedule(data: PlanningSnapshot, day: string, options: { today?: string; overrides?: Record<string, string>; start?: number; end?: number } = {}): DaySchedule {
  const today = options.today ?? localDay()
  const start = Math.max(0, options.start ?? SCHEDULE_START)
  const end = Math.min(1440, options.end ?? SCHEDULE_END)
  const overrides = options.overrides ?? scheduleOverridesFor(data, day)
  const slots: ScheduleSlot[] = []
  const blocked: Interval[] = []

  for (const plan of plansForDay(data, day)) {
    if (!plan.time) continue
    const from = timeMinutes(plan.time)
    const s = Math.max(start, from)
    const e = Math.min(end, plan.endTime ? timeMinutes(plan.endTime) : from + 60)
    if (e <= s) continue
    slots.push({ id: `plan:${plan.id}`, kind: 'plan', title: plan.title, start: s, end: e, sourceId: '', note: '日历计划', tone: 'a', movable: false, pinned: false, conflict: false })
    blocked.push({ start: s, end: e })
  }
  for (const meal of MEALS) {
    const s = Math.max(start, meal.start), e = Math.min(end, meal.end)
    if (e <= s || overlaps(blocked, s, e)) continue
    slots.push({ id: meal.id, kind: 'meal', title: meal.title, start: s, end: e, sourceId: '', note: '用餐与休息', tone: 'c', movable: false, pinned: false, conflict: false })
    blocked.push({ start: s, end: e })
  }

  const anchored = merge(blocked)
  const items = dayScheduleItems(data, day, today)
  const unscheduled: UnscheduledItem[] = []
  let flexible = 0

  // Explicitly pinned items go first so automatic placement always yields to them.
  for (const item of items) {
    const raw = overrides[item.sourceId]
    if (!raw || !/^([01]\d|2[0-3]):[0-5]\d$/.test(raw)) continue
    const s = Math.max(start, Math.min(end - item.minutes, timeMinutes(raw)))
    const e = Math.min(end, s + item.minutes)
    if (e <= s) continue
    item.pinnedAt = s
    slots.push({ id: item.sourceId, kind: item.sourceId.split(':')[0] as ScheduleKind, title: item.title, start: s, end: e, sourceId: item.sourceId, note: item.note, tone: item.tone, movable: true, pinned: true, conflict: overlaps(anchored, s, e) })
    blocked.push({ start: s, end: e })
    flexible++
  }

  for (const item of items) {
    if (item.pinnedAt !== undefined) continue
    const padded = merge(blocked).map(block => ({ start: Math.max(start, block.start - SCHEDULE_GAP), end: Math.min(end, block.end + SCHEDULE_GAP) }))
    let cursor = start, placed: Interval | null = null
    for (const block of padded) {
      if (block.start - cursor >= item.minutes) { placed = { start: cursor, end: cursor + item.minutes }; break }
      cursor = Math.max(cursor, block.end)
    }
    if (!placed && end - cursor >= item.minutes) placed = { start: cursor, end: cursor + item.minutes }
    if (!placed) { unscheduled.push({ sourceId: item.sourceId, title: item.title, minutes: item.minutes }); continue }
    slots.push({ id: item.sourceId, kind: item.sourceId.split(':')[0] as ScheduleKind, title: item.title, start: placed.start, end: placed.end, sourceId: item.sourceId, note: item.note, tone: item.tone, movable: true, pinned: false, conflict: false })
    blocked.push(placed)
    flexible++
  }

  const occupied = merge(slots.map(slot => ({ start: slot.start, end: slot.end })))
  let cursor = start
  for (const block of occupied) {
    if (block.start - cursor >= MIN_FREE_MINUTES) slots.push({ id: `free:${cursor}`, kind: 'free', title: '空闲 · 可休息', start: cursor, end: block.start, sourceId: '', note: '', tone: 'c', movable: false, pinned: false, conflict: false })
    cursor = Math.max(cursor, block.end)
  }
  if (end - cursor >= MIN_FREE_MINUTES) slots.push({ id: `free:${cursor}`, kind: 'free', title: '空闲 · 可休息', start: cursor, end, sourceId: '', note: '', tone: 'c', movable: false, pinned: false, conflict: false })

  slots.sort((a, b) => a.start - b.start || a.end - b.end || a.id.localeCompare(b.id))
  return { day, slots, unscheduled, flexible, busyMinutes: occupied.reduce((sum, item) => sum + item.end - item.start, 0) }
}
