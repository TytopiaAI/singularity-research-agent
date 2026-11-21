import { describe, expect, it } from 'vitest'
import { planningColors, type Plan, type PlanningCategory, type PlanningSnapshot } from '../shared/planning'
import { buildStrataLayers, groupStrataMonths } from './planning-strata'

const category = (id: string, name: string, color: PlanningCategory['color'], parentId: string | null = null): PlanningCategory => ({ id, name, kind: 'plan', parentId, color, shade: 0 })
const plan = (id: string, date: string, categoryId: string): Plan => ({ id, title: id, note: '', date, time: '', categoryId, priority: 'ordinary', repeat: 'none', until: '', excludedDates: [], createdAt: `${date}T08:00:00` })

function snapshot(plans: Plan[], categories: PlanningCategory[], completed: string[]): PlanningSnapshot {
  return {
    categories, plans,
    tasks: [], bookmarks: [], gallery: [], todos: [],
    completions: completed.map(id => ({ planId: id, date: plans.find(item => item.id === id)!.date, completedAt: `${plans.find(item => item.id === id)!.date}T20:00:00` })),
    earnedDays: [],
  }
}

describe('buildStrataLayers', () => {
  const categories = [category('research', '科研', 'blue'), category('life', '生活', 'green'), category('paper', '读论文', 'blue', 'research')]
  const plans = [
    plan('a', '2026-11-16', 'research'),
    plan('b', '2026-11-16', 'life'),
    plan('c', '2026-11-16', 'paper'),
    plan('d', '2026-11-16', 'missing'),
    plan('e', '2026-11-10', 'life'),
    plan('f', '2026-11-17', 'research'),
  ]
  const data = snapshot(plans, categories, ['a', 'b', 'c', 'd', 'e'])

  it('按周分层，最新的一周在最上面', () => {
    const layers = buildStrataLayers(data, '2026-11-16', 4)
    expect(layers).toHaveLength(4)
    expect(layers[0]).toMatchObject({ start: '2026-11-16', end: '2026-11-22', month: '2026-11' })
    expect(layers[1]).toMatchObject({ start: '2026-11-09', end: '2026-11-15' })
    expect(layers[3].start).toBe('2026-10-26')
  })

  it('只算完成的计划，子分类计到父分类，缺分类的归入其他', () => {
    const [current, previous] = buildStrataLayers(data, '2026-11-16', 4)
    expect(current.total).toBe(4)
    expect(current.segments.map(segment => [segment.label, segment.count])).toEqual([['科研', 2], ['生活', 1], ['其他', 1]])
    expect(previous.total).toBe(1)
    expect(previous.segments).toEqual([{ id: 'life', label: '生活', color: planningColors.green[0], count: 1 }])
  })

  it('没完成任何计划的一周是空层，颜色与分段都为空', () => {
    const layers = buildStrataLayers(data, '2026-11-16', 4)
    expect(layers[2].total).toBe(0)
    expect(layers[2].segments).toEqual([])
  })

  it('分类顺序在每层都一致，才会连成纵向的矿脉', () => {
    const layers = buildStrataLayers(data, '2026-11-16', 4)
    const order = (segments: Array<{ id: string }>) => segments.map(segment => segment.id)
    expect(order(layers[0].segments)).toEqual(['research', 'life', '__other'])
    expect(order(layers[1].segments)).toEqual(['life'])
    expect(order(layers[0].segments).filter(id => id !== '__other')).toEqual(['research', 'life'])
  })
})

describe('groupStrataMonths', () => {
  it('相邻同月的层合成一个标签，月份从上到下递减', () => {
    const layers = [
      { month: '2026-11' }, { month: '2026-11' }, { month: '2026-10' }, { month: '2026-10' }, { month: '2026-10' }, { month: '2026-09' },
    ] as Parameters<typeof groupStrataMonths>[0]
    expect(groupStrataMonths(layers)).toEqual([
      { month: '2026-11', from: 0, to: 1 },
      { month: '2026-10', from: 2, to: 4 },
      { month: '2026-09', from: 5, to: 5 },
    ])
  })
})
