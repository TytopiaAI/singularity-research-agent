import { expect, it } from 'vitest'
import { buildDaySchedule, dayScheduleItems, scheduleTimeLabel, todosForDay, type ScheduleSlot } from '../src/shared/day-schedule'
import { timeMinutes } from '../src/shared/planning-calendar'
import type { Plan, PlanningSnapshot, PlanningTask, PlanningTodo } from '../src/shared/planning'

const DAY = '2026-11-15'
const plan = (id: string, title: string, time = '', endTime = '', priority: Plan['priority'] = 'ordinary'): Plan => ({ id, title, note: '', date: DAY, time, endTime, categoryId: 'study', priority, repeat: 'none', until: '', excludedDates: [], createdAt: '' })
const todo = (id: string, title: string, extra: Partial<PlanningTodo> = {}): PlanningTodo => ({ id, title, done: false, createdAt: '', date: DAY, ...extra })
const task = (id: string, title: string, extra: Partial<PlanningTask> = {}): PlanningTask => ({ id, title, note: '', dueDate: DAY, categoryId: 'study', icon: 'flag', tone: 'a', done: false, parentId: null, createdAt: '', ...extra })
const snapshot = (extra: Partial<PlanningSnapshot> = {}): PlanningSnapshot => ({
  categories: [{ id: 'study', name: '学习', kind: 'plan', parentId: null, color: 'rose', shade: 0 }],
  plans: [plan('class', '下午上课', '14:00', '16:00'), plan('gym', '健身计划', '18:00', '19:00'), plan('reading', '读论文')],
  tasks: [task('report', '交报告')],
  todos: [todo('laundry', '洗衣服', { minutes: 30 }), todo('codebuddy', '去实验室安装CodeBuddy', { minutes: 60 }), todo('other', '改天再做', { date: '2026-11-16' }), todo('legacy', '旧待办', { date: undefined })],
  completions: [], bookmarks: [], earnedDays: [], gallery: [], ...extra,
})
const find = (slots: ScheduleSlot[], id: string) => slots.find(slot => slot.id === id)

it('keeps fixed calendar plans (class, gym) immovable and fills meals only in free time', () => {
  const schedule = buildDaySchedule(snapshot(), DAY, { today: DAY })
  expect(find(schedule.slots, 'plan:class')).toMatchObject({ start: timeMinutes('14:00'), end: timeMinutes('16:00'), movable: false })
  expect(find(schedule.slots, 'plan:gym')).toMatchObject({ start: timeMinutes('18:00'), end: timeMinutes('19:00'), movable: false })
  expect(find(schedule.slots, 'meal-breakfast')).toMatchObject({ start: 450, end: 480 })
  expect(find(schedule.slots, 'meal-lunch')).toMatchObject({ start: 720, end: 760 })
  // Dinner overlaps the gym session, so it is skipped instead of moving the plan.
  expect(find(schedule.slots, 'meal-dinner')).toBeUndefined()
  expect(schedule.flexible).toBe(5)
})

it('only schedules todos of the selected day; undated legacy todos stay on today', () => {
  const data = snapshot()
  expect(todosForDay(data, DAY, DAY).map(item => item.id)).toEqual(['laundry', 'codebuddy', 'legacy'])
  expect(todosForDay(data, '2026-11-16', DAY).map(item => item.id)).toEqual(['other'])
  const schedule = buildDaySchedule(data, DAY, { today: DAY })
  expect(find(schedule.slots, 'todo:other')).toBeUndefined()
  expect(find(schedule.slots, 'todo:legacy')).toBeTruthy()
  expect(buildDaySchedule(data, '2026-11-16', { today: DAY }).slots.some(slot => slot.id === 'todo:legacy')).toBe(false)
  expect(dayScheduleItems(data, DAY, DAY).some(item => item.sourceId === 'todo:other')).toBe(false)
})

it('fits chores into gaps with a 10-minute buffer and never overlaps an occupied block', () => {
  const schedule = buildDaySchedule(snapshot(), DAY, { today: DAY })
  const occupied = schedule.slots.filter(slot => slot.kind !== 'free')
  expect(schedule.unscheduled).toHaveLength(0)
  for (const slot of occupied) {
    expect(slot.start).toBeGreaterThanOrEqual(420)
    expect(slot.end).toBeLessThanOrEqual(1380)
    for (const other of occupied) {
      if (other === slot) continue
      if (slot.start < other.end && slot.end > other.start) expect(`${slot.id} overlaps ${other.id}`).toBe('no overlap')
    }
  }
  // Auto items never butt directly against an anchor or a meal.
  for (const slot of occupied.filter(item => item.movable && !item.pinned)) {
    for (const anchor of occupied.filter(item => !item.movable)) {
      if (slot.end <= anchor.start) expect(anchor.start - slot.end).toBeGreaterThanOrEqual(10)
      if (slot.start >= anchor.end) expect(slot.start - anchor.end).toBeGreaterThanOrEqual(10)
    }
  }
  expect(schedule.slots.some(slot => slot.kind === 'free')).toBe(true)
  expect(scheduleTimeLabel(450, 480)).toBe('07:30–08:00')
})

it('honours a manual start time, flags a clash, and resets to automatic placement', () => {
  const data = snapshot({ scheduleOverrides: { [DAY]: { 'todo:laundry': '14:30' } } })
  const pinned = buildDaySchedule(data, DAY, { today: DAY })
  expect(find(pinned.slots, 'todo:laundry')).toMatchObject({ start: timeMinutes('14:30'), pinned: true, conflict: true })
  const auto = buildDaySchedule(data, DAY, { today: DAY, overrides: {} })
  expect(find(auto.slots, 'todo:laundry')?.pinned).toBe(false)
  expect(find(auto.slots, 'todo:laundry')?.start).not.toBe(timeMinutes('14:30'))
  expect(buildDaySchedule(snapshot(), DAY, { today: DAY, overrides: { 'todo:laundry': 'bad-time' } }).slots.find(slot => slot.id === 'todo:laundry')?.pinned).toBe(false)
})

it('sorts high-priority chores first and reports anything that cannot fit', () => {
  const data = snapshot({ todos: [todo('low', '低优先', { minutes: 60 }), todo('high', '高优先', { minutes: 60, priority: 'urgent-important' })] })
  const schedule = buildDaySchedule(data, DAY, { today: DAY })
  expect(find(schedule.slots, 'todo:high')!.start).toBeLessThan(find(schedule.slots, 'todo:low')!.start)
  const crowded = snapshot({ todos: Array.from({ length: 14 }, (_, index) => todo(`c${index}`, `长事项${index}`, { minutes: 180 })) })
  const result = buildDaySchedule(crowded, DAY, { today: DAY })
  expect(result.unscheduled.length).toBeGreaterThan(0)
  expect(result.unscheduled[0].minutes).toBe(180)
  const occupied = result.slots.filter(slot => slot.kind !== 'free')
  const sorted = [...occupied].sort((a, b) => a.start - b.start)
  for (let index = 1; index < sorted.length; index++) expect(sorted[index].start).toBeGreaterThanOrEqual(sorted[index - 1].end)
})

it('skips completed items and untimed plans already marked done', () => {
  const data = snapshot({ todos: [todo('done', '已洗完', { done: true })], tasks: [], plans: [plan('class', '下午上课', '14:00', '16:00')], completions: [{ planId: 'class', date: DAY, completedAt: '' }] })
  const schedule = buildDaySchedule(data, DAY, { today: DAY })
  expect(schedule.flexible).toBe(0)
  expect(find(schedule.slots, 'todo:done')).toBeUndefined()
  // A completed timed plan still occupies its real slot.
  expect(find(schedule.slots, 'plan:class')).toBeTruthy()
})
