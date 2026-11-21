import { addDays, planningPalette, plansForDay, type PlanningSnapshot } from '../shared/planning'
import type { ChatTheme } from '../shared/chat-theme'
import { weekDays } from '../shared/planning-calendar'

/** One category's share of a week's completed plans. */
export type StrataSegment = { id: string; label: string; color: string; count: number }
/** One horizontal band: a week of completed plans, newest first. */
export type StrataLayer = { start: string; end: string; month: string; label: string; total: number; segments: StrataSegment[] }

/** Plans whose category was deleted (or never set) still count: they are shown as 其他. */
const OTHER_ID = '__other'

const shortDate = (day: string) => `${Number(day.slice(5, 7))}/${Number(day.slice(-2))}`

/**
 * Weeks of completed plans for the strata chart, newest first. A layer's thickness comes from
 * its total, and the segments keep the category order stable across layers so the same category
 * lines up vertically — that is what makes a consistently invested category look like a vein.
 */
export function buildStrataLayers(data: PlanningSnapshot, today: string, weeks = 8, theme: ChatTheme = 'transparent'): StrataLayer[] {
  const palette = planningPalette(theme)
  const parents = data.categories.filter(category => category.kind === 'plan' && !category.parentId)
  const parentOf = new Map(data.categories.map(category => [category.id, category.parentId ?? category.id]))
  return Array.from({ length: weeks }, (_, index) => {
    const days = weekDays(addDays(today, -7 * index))
    const done = days.flatMap(day => plansForDay(data, day).filter(plan => plan.done))
    const counts = new Map<string, number>()
    for (const plan of done) {
      const parent = parentOf.get(plan.categoryId) ?? OTHER_ID
      counts.set(parent, (counts.get(parent) ?? 0) + 1)
    }
    const segments: StrataSegment[] = []
    for (const category of parents) {
      const count = counts.get(category.id) ?? 0
      counts.delete(category.id)
      if (count) segments.push({ id: category.id, label: category.name, color: palette[category.color][0], count })
    }
    let rest = 0
    for (const count of counts.values()) rest += count
    if (rest) segments.push({ id: OTHER_ID, label: '其他', color: palette.slate[0], count: rest })
    return { start: days[0], end: days[6], month: days[0].slice(0, 7), label: `${shortDate(days[0])}–${shortDate(days[6])}`, total: done.length, segments }
  })
}

/** Consecutive layers sharing a month, so the left column can label October once instead of 4 times. */
export function groupStrataMonths(layers: StrataLayer[]): Array<{ month: string; from: number; to: number }> {
  const groups: Array<{ month: string; from: number; to: number }> = []
  for (const [index, layer] of layers.entries()) {
    const last = groups.at(-1)
    if (last && last.month === layer.month) last.to = index
    else groups.push({ month: layer.month, from: index, to: index })
  }
  return groups
}
