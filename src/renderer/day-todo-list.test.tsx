// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DayTodoList } from './DayTodoList'
import type { PlanningSnapshot, PlanningTodo } from '../shared/planning'

const DAY = '2026-11-15'
const todo = (id: string, title: string, extra: Partial<PlanningTodo> = {}): PlanningTodo => ({ id, title, done: false, createdAt: '', date: DAY, ...extra })
const data: PlanningSnapshot = {
  categories: [], plans: [], tasks: [],
  todos: [todo('laundry', '洗衣服', { minutes: 30 }), todo('codebuddy', '去实验室安装CodeBuddy', { minutes: 60 }), todo('later', '改天再做', { date: '2026-11-16' })],
  completions: [], bookmarks: [], earnedDays: [], gallery: [],
}
let onWrite: ReturnType<typeof vi.fn>
let cleanup: () => void = () => {}
beforeEach(() => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true })
  onWrite = vi.fn()
})
afterEach(async () => { await act(async () => cleanup()); vi.restoreAllMocks() })
async function mount(selected = DAY) {
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  cleanup = () => { root.unmount(); host.remove() }
  await act(async () => root.render(<DayTodoList data={data} selected={selected} today={DAY} busy={false} onWrite={onWrite} />))
  return host
}
const setValue = async (input: HTMLInputElement, value: string) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
  await act(async () => { input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })) })
}
const click = async (host: HTMLElement, label: string) => {
  const button = [...host.querySelectorAll('button')].find(item => item.textContent === label)!
  expect(button, label).toBeTruthy()
  await act(async () => button.click())
}

it('shows only the selected day by default and can switch to all dates', async () => {
  const host = await mount()
  expect(host.textContent).toContain('洗衣服')
  expect(host.textContent).toContain('去实验室安装CodeBuddy')
  expect(host.textContent).not.toContain('改天再做')
  await click(host, '全部')
  expect(host.textContent).toContain('改天再做')
})

it('creates a chore with an explicit date and estimated duration', async () => {
  const host = await mount()
  const form = host.querySelector<HTMLFormElement>('.planning-todo-add')!
  await setValue(form.querySelector<HTMLInputElement>('[aria-label="新待办内容"]')!, '取快递')
  const date = form.querySelector<HTMLInputElement>('[aria-label="待办日期"]')!
  expect(date.value).toBe(DAY)
  const select = form.querySelector<HTMLSelectElement>('[aria-label="待办预计时长"]')!
  await act(async () => { select.value = '45'; select.dispatchEvent(new Event('change', { bubbles: true })) })
  await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  expect(onWrite).toHaveBeenCalledTimes(1)
  const next: PlanningTodo[] = onWrite.mock.calls[0][0]
  expect(next).toHaveLength(4)
  expect(next[3]).toMatchObject({ title: '取快递', date: DAY, minutes: 45, done: false })
})

it('can move an existing chore to another day and complete it in place', async () => {
  const host = await mount()
  // 本日视图里每条待办都是同一天，日期编辑放在「全部」视图里显示。
  await click(host, '全部')
  const dateInput = host.querySelector<HTMLInputElement>('[aria-label="设置洗衣服的日期"]')!
  expect(dateInput.value).toBe(DAY)
  await setValue(dateInput, '2026-11-17')
  expect(onWrite.mock.calls[0][0][0]).toMatchObject({ id: 'laundry', date: '2026-11-17' })
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="完成：洗衣服"]')!.click())
  expect(onWrite.mock.calls[1][0][0]).toMatchObject({ id: 'laundry', done: true })
})

it('follows the calendar selection when creating a chore for another day', async () => {
  const host = await mount('2026-11-16')
  expect(host.querySelector<HTMLInputElement>('[aria-label="待办日期"]')!.value).toBe('2026-11-16')
  expect(host.textContent).toContain('改天再做')
  expect(host.textContent).not.toContain('洗衣服')
})
