import type { ReaderRect } from '../shared/types'
import type { PageSelection } from './ContinuousPdfPage'

export function cleanSelectedText(text: string): string {
  return text.replace(/([a-zA-Z])-\s*\n\s*([a-z])/g, '$1$2').replace(/\s+/g, ' ').trim()
}

// Read only text-layer spans: page labels, canvas containers and overlays never
// contribute text or large wrapper rectangles to a selection.
export function readPdfSelection(root: HTMLElement, selection = window.getSelection()): PageSelection | null {
  if (!selection?.rangeCount || selection.isCollapsed || !root.contains(selection.anchorNode) || !root.contains(selection.focusNode)) return null
  const range = selection.getRangeAt(0), texts: string[] = []
  const segments: NonNullable<PageSelection['segments']> = []
  for (const frame of root.querySelectorAll<HTMLElement>('.continuous-page-frame')) {
    const sheet = frame.querySelector<HTMLElement>('.pdf-sheet')
    if (!sheet) continue
    const bounds = sheet.getBoundingClientRect(), rects: ReaderRect[] = [], words: string[] = []
    let previous: DOMRect | undefined
    for (const span of sheet.querySelectorAll('.textLayer span')) {
      for (const node of Array.from(span.childNodes)) {
        if (node.nodeType !== Node.TEXT_NODE || !range.intersectsNode(node)) continue
        const part = document.createRange()
        part.selectNodeContents(node)
        if (range.startContainer === node) part.setStart(node, range.startOffset)
        if (range.endContainer === node) part.setEnd(node, range.endOffset)
        const text = part.toString()
        if (!text) continue
        const clientRects = Array.from(part.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0)
        const first = clientRects[0]
        const newLine = previous && first && Math.abs(first.top - previous.top) > Math.min(first.height, previous.height) * .55
        const gap = previous && first ? first.left - previous.right : 0
        words.push((words.length ? newLine ? '\n' : gap > (first?.height ?? 10) * .10 ? ' ' : '' : '') + text)
        previous = clientRects.at(-1) ?? previous
        for (const rect of clientRects) {
          const left = Math.max(bounds.left, rect.left), top = Math.max(bounds.top, rect.top)
          const right = Math.min(bounds.right, rect.right), bottom = Math.min(bounds.bottom, rect.bottom)
          if (right > left && bottom > top) rects.push({ x: (left - bounds.left) / bounds.width, y: (top - bounds.top) / bounds.height, width: (right - left) / bounds.width, height: (bottom - top) / bounds.height })
        }
      }
    }
    if (words.length && rects.length) { texts.push(words.join('')); segments.push({ page: Number(frame.dataset.page), rects }) }
  }
  const text = cleanSelectedText(texts.join('\n'))
  if (!text || !segments.length) return null
  // Never silently truncate a selected paragraph.
  if (text.length > 20000 || segments.reduce((n, part) => n + part.rects.length, 0) > 1000) throw new Error('选区过长，请分成较小段落翻译。')
  return { page: segments[0].page, text, rects: segments[0].rects, segments }
}

export function stitchSelections(selections: PageSelection[]): PageSelection | null {
  if (!selections.length) return null
  const parts = new Map<number, ReaderRect[]>()
  for (const selection of selections) for (const part of selection.segments ?? [{ page: selection.page, rects: selection.rects }]) parts.set(part.page, [...parts.get(part.page) ?? [], ...part.rects])
  const segments = [...parts].map(([page, rects]) => ({ page, rects }))
  const text = cleanSelectedText(selections.map((selection) => selection.text).join('\n'))
  if (text.length > 20000) throw new Error('拼接内容超过 20,000 字符，请先翻译当前段落。')
  return { page: segments[0].page, text, rects: segments[0].rects, segments }
}
