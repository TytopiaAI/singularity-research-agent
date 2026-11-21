// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DayScheduleCard } from './DayScheduleCard'
import type { Plan, PlanningSnapshot, PlanningTodo } from '../shared/planning'

const DAY = '2026-11-15'
const plan = (id: string, title: string, time = '', endTime = ''): Plan => ({ id, title, note: '', date: DAY, time, endTime, categoryId: 'study', priority: 'ordinary', repeat: 'none', until: '', excludedDates: [], createdAt: '' })
const todo = (id: string, title: string, extra: Partial<PlanningTodo> = {}): PlanningTodo => ({ id, title, done: false, createdAt: '', date: DAY, ...extra })
const data = (extra: Partial<PlanningSnapshot> = {}): PlanningSnapshot => ({
  categories: [], plans: [plan('class', '下午上课', '14:00', '16:00'), plan('gym', '健身计划', '18:00', '19:00')],
  tasks: [], todos: [todo('laundry', '洗衣服', { minutes: 30 }), todo('codebuddy', '去实验室安装CodeBuddy', { minutes: 60 })],
  completions: [], bookmarks: [], earnedDays: [], gallery: [], ...extra,
})
let saveScheduleOverrides: ReturnType<typeof vi.fn>
let cleanup: () => void = () => {}
const perform = async (task: () => Promise<PlanningSnapshot>) => { await task(); return true }
beforeEach(() => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true })
  saveScheduleOverrides = vi.fn().mockResolvedValue(data())
  Object.defineProperty(window, 'singularity', { configurable: true, value: { planning: { saveScheduleOverrides } } })
})
afterEach(async () => { await act(async () => cleanup()); vi.restoreAllMocks() })
async function mount(snapshot: PlanningSnapshot) {
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  cleanup = () => { root.unmount(); host.remove() }
  await act(async () => root.render(<DayScheduleCard data={snapshot} selected={DAY} busy={false} perform={perform} />))
  return host
}
const setValue = async (input: HTMLInputElement, value: string) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
  await act(async () => { input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })) })
}

it('renders a full-day timeline with fixed plans, auto-fitted chores and free time', async () => {
  const host = await mount(data())
  const text = host.textContent || ''
  expect(text).toContain('一日行程')
  expect(text).toContain('07:00–23:00')
  expect(text).toContain('下午上课')
  expect(text).toContain('14:00–16:00')
  expect(text).toContain('健身计划')
  expect(text).toContain('洗衣服')
  expect(text).toContain('去实验室安装CodeBuddy')
  expect(text).toContain('空闲 · 可休息')
  expect(host.querySelector('[aria-label="调整洗衣服的开始时间"]')).toBeTruthy()
  // Fixed plans have no time input: they are immovable anchors.
  expect(host.querySelector('[aria-label="调整下午上课的开始时间"]')).toBeNull()
  expect(host.querySelector<HTMLButtonElement>('.planning-schedule-reset')!.disabled).toBe(true)
})

it('saves a manual start time and can reset the whole day', async () => {
  const host = await mount(data({ scheduleOverrides: { [DAY]: { 'todo:laundry': '09:30' } } }))
  expect(host.textContent).toContain('已手动调整')
  const input = host.querySelector<HTMLInputElement>('[aria-label="调整去实验室安装CodeBuddy的开始时间"]')!
  await setValue(input, '20:15')
  expect(saveScheduleOverrides).toHaveBeenCalledWith(DAY, { 'todo:laundry': '09:30', 'todo:codebuddy': '20:15' })
  const reset = host.querySelector<HTMLButtonElement>('.planning-schedule-reset')!
  expect(reset.disabled).toBe(false)
  await act(async () => reset.click())
  expect(saveScheduleOverrides).toHaveBeenLastCalledWith(DAY, {})
})

it('flags a manual time that collides with a fixed plan', async () => {
  const host = await mount(data({ scheduleOverrides: { [DAY]: { 'todo:laundry': '14:30' } } }))
  expect(host.querySelector('.planning-schedule-row.conflict')?.textContent).toContain('与固定安排冲突')
})
