// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MonthReview } from './PlanningPanels'
import type { Plan, PlanningSnapshot } from '../shared/planning'

const categories: PlanningSnapshot['categories'] = [
  { id: 'research', name: '科研', kind: 'plan', parentId: null, color: 'blue', shade: 0 },
  { id: 'life', name: '生活', kind: 'plan', parentId: null, color: 'green', shade: 0 },
]
const plan = (id: string, date: string, categoryId: string): Plan => ({ id, title: id, note: '', date, time: '', categoryId, priority: 'ordinary', repeat: 'none', until: '', excludedDates: [], createdAt: `${date}T08:00:00` })

const plans = [plan('a', '2026-11-16', 'research'), plan('b', '2026-11-16', 'life'), plan('c', '2026-11-09', 'research')]
const data: PlanningSnapshot = {
  categories, plans, tasks: [], bookmarks: [], gallery: [], todos: [],
  completions: plans.map(item => ({ planId: item.id, date: item.date, completedAt: `${item.date}T20:00:00` })),
  earnedDays: ['2026-11-15', '2026-11-16'],
}
const monthList = Array.from({ length: 30 }, (_, index) => `2026-11-${String(index + 1).padStart(2, '0')}`)

let container: HTMLDivElement
let root: Root
beforeEach(async () => {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root.render(<MonthReview data={data} monthList={monthList} today="2026-11-16" />))
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

describe('MonthReview', () => {
  it('只保留活跃天数、当前连续与每天的完成节奏', () => {
    expect(container.textContent).toContain('活跃天数')
    expect(container.textContent).toContain('当前连续')
    expect(container.textContent).toContain('每天的完成节奏')
    expect(container.textContent).toContain('知识地层')
    expect(container.textContent).not.toContain('优先级分布')
    expect(container.textContent).not.toContain('任务进度')
  })

  it('活跃天数只数有完成计划的日子，连续天数接着今天往前算', () => {
    const figures = [...container.querySelectorAll('.planning-rhythm-metrics strong')].map(node => node.textContent)
    expect(figures).toEqual(['2 / 30', '2 天'])
  })

  it('地层按周分层并给出分类图例', () => {
    expect(container.querySelectorAll('.planning-strata-canvas svg > g, .planning-strata-canvas svg > path')).toHaveLength(8)
    const legend = [...container.querySelectorAll('.planning-strata-legend span')].map(node => node.textContent)
    expect(legend).toEqual(['科研', '生活'])
  })

  it('悬停一层时改写成那一周的完成分布', async () => {
    const hint = container.querySelector('.planning-strata-hint')!
    expect(hint.textContent).toBe('悬停在某一层查看当周的投入分布。')
    const layer = container.querySelectorAll('.planning-strata-canvas svg > g')[0]
    await act(async () => { layer.dispatchEvent(new Event('pointerover', { bubbles: true })) })
    expect(hint.textContent).toContain('11/16–11/22')
    expect(hint.textContent).toContain('科研 1')
  })
})
