import type { ReaderCard, ReaderRect } from '../shared/types'

export interface VisualParagraph { id: string; text: string; rects: ReaderRect[] }
export const paragraphKey = (text: string): string => text.replace(/\s+/g, ' ').trim()

export function translatedParagraphTexts(cards: ReaderCard[], page?: number): Set<string> {
  return new Set(cards.filter((card) => card.kind === 'translation' && !card.hidden && (page === undefined || card.pageNumber === page) && !!card.content.trim())
    .map((card) => paragraphKey(card.sourceText)))
}
export interface VisualLine { text: string; rect: DOMRect; height: number }

export const isReferenceHeading = (text: string): boolean =>
  /^(?:(?:\d+(?:\.\d+)*|[IVX]+)[.\s]+)?(?:references|bibliography|参考文献)\s*$/i.test(text.trim())

const isSectionHeading = (text: string): boolean => {
  const value = text.trim()
  return value.length <= 90 && (
    /^(?:(?:\d+(?:\.\d+)*|[IVX]+)[.\s]+)[A-Z][\w\s:&/-]+$/i.test(value) ||
    /^[A-Z][A-Z\d\s:&/-]{3,}$/.test(value)
  )
}

function normalizedRect(rect: DOMRect, sheet: DOMRect): ReaderRect {
  const left = Math.max(sheet.left, Math.min(sheet.right, rect.left))
  const right = Math.max(left, Math.min(sheet.right, rect.right))
  const top = Math.max(sheet.top, Math.min(sheet.bottom, rect.top))
  const bottom = Math.max(top, Math.min(sheet.bottom, rect.bottom))
  return {
    x: (left - sheet.left) / sheet.width,
    y: (top - sheet.top) / sheet.height,
    width: (right - left) / sheet.width,
    height: (bottom - top) / sheet.height,
  }
}

export function groupVisualLines(lines: VisualLine[], bounds: DOMRect, firstPage = false): VisualParagraph[] {
  if (!lines.length) return []
  const abstractIndex = firstPage ? lines.findIndex((line) => /^abstract\s*:?$/i.test(line.text.trim())) : -1
  if (abstractIndex >= 0) lines = lines.slice(abstractIndex + 1)
  if (!lines.length) return []
  const mid = bounds.left + bounds.width / 2
  const leftColumn = lines.filter((line) => line.rect.right < mid - 8)
  const rightColumn = lines.filter((line) => line.rect.left > mid + 8)
  const overlapTop = Math.max(Math.min(...leftColumn.map((line)=>line.rect.top)),Math.min(...rightColumn.map((line)=>line.rect.top)))
  const overlapBottom = Math.min(Math.max(...leftColumn.map((line)=>line.rect.bottom)),Math.max(...rightColumn.map((line)=>line.rect.bottom)))
  const twoColumns = leftColumn.length >= 3 && rightColumn.length >= 3 && overlapBottom - overlapTop > 30
  const ordered = twoColumns ? [
    ...lines.filter((line)=>line.rect.top < overlapTop - 8),
    ...leftColumn.filter((line)=>line.rect.top >= overlapTop - 8),
    ...rightColumn.filter((line)=>line.rect.top >= overlapTop - 8),
    ...lines.filter((line)=>line.rect.top >= overlapTop - 8 && !leftColumn.includes(line) && !rightColumn.includes(line)),
  ] : lines
  const paragraphs: VisualParagraph[] = []
  let current: VisualLine[] = []
  const flush = (): void => {
    if (!current.length) return
    const text = current.map((line) => line.text).join(' ').replace(/\s+/g,' ').trim()
    if (text.length >= 12) paragraphs.push({ id:`paragraph-${paragraphs.length}`, text, rects:current.map((line) => normalizedRect(line.rect,bounds)).filter((rect) => rect.width > 0 && rect.height > 0) })
    current = []
  }
  for (const line of ordered) {
    if (isReferenceHeading(line.text)) { flush(); break }
    if (isSectionHeading(line.text)) { flush(); continue }
    const previous = current.at(-1)
    if (previous) {
      const gap = line.rect.top - previous.rect.bottom
      const indent = line.rect.left - current[0].rect.left
      const fullWidth = Math.max(...current.map((item) => item.rect.width), line.rect.width)
      const terminalPunctuation = /[.!?。！？][)\]”’]*$/.test(previous.text.trim())
      const shortLastLine = previous.rect.width < fullWidth * .82 && !/[-‐‑–]$/.test(previous.text.trim()) &&
        (terminalPunctuation || previous.rect.width < fullWidth * .58) && (current.length >= 2 || terminalPunctuation)
      const separate = gap > Math.max(7,previous.height * .75) || gap < -previous.height * .5 ||
        indent > Math.max(16,previous.height * 1.15) || shortLastLine
      if (separate) flush()
    }
    current.push(line)
  }
  flush()
  return paragraphs.filter((paragraph) => paragraph.rects.length > 0)
}

export function buildVisualParagraphs(layer: HTMLElement, sheet: HTMLElement, firstPage = false): VisualParagraph[] {
  const bounds = sheet.getBoundingClientRect()
  if (!bounds.width || !bounds.height) return []
  const pieces = Array.from(layer.querySelectorAll('span'))
    .map((span) => {
      const node = Array.from(span.childNodes).find((child) => child.nodeType === Node.TEXT_NODE && child.textContent?.trim())
      const raw = node?.textContent ?? ''
      const start = raw.search(/\S/)
      if (!node || start < 0) return null
      const end = raw.trimEnd().length
      const range = document.createRange()
      range.setStart(node, start)
      range.setEnd(node, end)
      const rects = typeof range.getClientRects === 'function' ? Array.from(range.getClientRects()) : [span.getBoundingClientRect()]
      const rect = rects.find((item) => item.width > 1 && item.height > 1)
      return rect ? { text: raw.slice(start, end), rect } : null
    })
    .filter((piece): piece is { text: string; rect: DOMRect } => piece !== null)
    .filter((piece) => piece.text && piece.rect.width > 1 && piece.rect.height > 1)
    .sort((a,b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left)
  const rows: Array<typeof pieces> = []
  for (const piece of pieces) {
    const row = rows.slice(-3).find((items) => Math.abs(items[0].rect.top - piece.rect.top) <= Math.max(3, piece.rect.height * .38))
    if (row) row.push(piece)
    else rows.push([piece])
  }
  const lines: VisualLine[] = rows.flatMap((items) => {
    items.sort((a,b) => a.rect.left - b.rect.left)
    const groups: Array<typeof items> = []
    for (const item of items) {
      const group = groups.at(-1)
      const previous = group?.at(-1)
      if (!group || previous && item.rect.left - previous.rect.right > Math.max(42,bounds.width*.075)) groups.push([item])
      else group.push(item)
    }
    return groups.map((group) => {
      const left = Math.min(...group.map((item) => item.rect.left))
      const top = Math.min(...group.map((item) => item.rect.top))
      const right = Math.max(...group.map((item) => item.rect.right))
      const bottom = Math.max(...group.map((item) => item.rect.bottom))
      let text = ''
      let previousRight = left
      for (const item of group) {
        const gap = item.rect.left - previousRight
        if (text && gap > Math.max(2, item.rect.height * .15) && !/[-/([{]$/.test(text)) text += ' '
        text += item.text
        previousRight = item.rect.right
      }
      return { text, rect: new DOMRect(left,top,right-left,bottom-top), height:bottom-top }
    })
  }).sort((a,b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left)
  return groupVisualLines(lines, bounds, firstPage)
}

export function paragraphAt<T extends VisualParagraph>(paragraphs: T[], sheet: HTMLElement, x: number, y: number): T | null {
  const box = sheet.getBoundingClientRect()
  const px = (x-box.left)/box.width
  const py = (y-box.top)/box.height
  return paragraphs.find((paragraph) => paragraph.rects.some((rect) => px >= rect.x-.004 && px <= rect.x+rect.width+.004 && py >= rect.y-.005 && py <= rect.y+rect.height+.005)) ?? null
}
