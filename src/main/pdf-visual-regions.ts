import type { ReaderRect } from '../shared/types'

export function visualRegions(rects: ReaderRect[]): ReaderRect[] {
  const remaining = new Set(rects.filter((rect) => rect.width > .006 && rect.height > .006 && rect.width * rect.height < .72))
  const regions: ReaderRect[] = []
  for (const seed of [...remaining]) {
    if (!remaining.delete(seed)) continue
    let bounds = { ...seed }, changed = true
    while (changed) {
      changed = false
      for (const next of remaining) {
        if (next.x > bounds.x + bounds.width + .005 || next.x + next.width < bounds.x - .005 || next.y > bounds.y + bounds.height + .005 || next.y + next.height < bounds.y - .005) continue
        const x = Math.min(bounds.x, next.x), y = Math.min(bounds.y, next.y)
        bounds = { x, y, width: Math.max(bounds.x + bounds.width, next.x + next.width) - x, height: Math.max(bounds.y + bounds.height, next.y + next.height) - y }
        remaining.delete(next); changed = true
      }
    }
    if (bounds.width > .14 && bounds.height > .04) regions.push(bounds)
  }
  // Earlier small components may have been emitted before a later background
  // rectangle connected them. Merge those completed groups as well.
  const merged: ReaderRect[] = []
  for (const region of regions) {
    let bounds = { ...region }, changed = true
    while (changed) {
      changed = false
      for (const other of [...merged]) {
        const horizontalGap = Math.max(other.x - bounds.x - bounds.width, bounds.x - other.x - other.width, 0)
        const verticalOverlap = Math.min(other.y + other.height, bounds.y + bounds.height) - Math.max(other.y, bounds.y)
        const adjacentPanels = horizontalGap < .035 && verticalOverlap > Math.min(other.height, bounds.height) * .5
        if (!adjacentPanels && (other.x > bounds.x + bounds.width + .003 || other.x + other.width < bounds.x - .003 || other.y > bounds.y + bounds.height + .003 || other.y + other.height < bounds.y - .003)) continue
        const x = Math.min(bounds.x, other.x), y = Math.min(bounds.y, other.y)
        bounds = { x, y, width: Math.max(bounds.x + bounds.width, other.x + other.width) - x, height: Math.max(bounds.y + bounds.height, other.y + other.height) - y }
        merged.splice(merged.indexOf(other), 1); changed = true
      }
    }
    merged.push(bounds)
  }
  return merged
}
