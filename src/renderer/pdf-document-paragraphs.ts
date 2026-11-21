import type { ReaderRect } from '../shared/types'
import { isReferenceHeading, type VisualParagraph } from './reader-paragraphs'
import { inlinePdfMath, isMathFont, pdfMathTex, type MathGlyph, type MathRule } from '../shared/pdf-math'
import { translationFormulaLines } from '../shared/translation-layout'

interface Bounds { left: number; top: number; right: number; bottom: number; width: number; height: number }
export interface PdfLine {
  text: string
  /** Reading text: citation superscripts dropped, inline formulas as $…$. */
  clean?: string
  formattedText?: string
  /** Rebuilt LaTeX for a display formula line, when it could be reconstructed. */
  mathTex?: string
  glyphs?: MathGlyph[]
  rect: Bounds
  height: number
  formula?: boolean
}
export interface DocumentParagraph {
  id: string
  text: string
  startPage: number
  parts: Array<{ page: number; rects: ReaderRect[] }>
}
export interface PageParagraph extends VisualParagraph {
  startPage: number
  parts: DocumentParagraph['parts']
}
export interface PdfPageText {
  imageRects?: ReaderRect[]
  /** Ruled (booktabs) tables, also included in visualRects. */
  tableRects?: ReaderRect[]
  visualRects?: ReaderRect[]
  mathRules?: MathRule[]
  fontNames?: Record<string, string>
  columnBands?: Array<{ x: number; top: number; bottom: number }>
  pageNumber: number
  viewport: { width: number; height: number; convertToViewportPoint(x: number, y: number): [number, number] }
  items: Array<{ str: string; width: number; height: number; transform: number[]; fontName?: string }>
}

const isHeading = (text: string): boolean => {
  const value = text.trim()
  const letters = value.replace(/[^A-Za-z]/g, '')
  return value.length <= 90 && (
    /^(?:(?:\d+(?:\.\d+)*|[IVX]+)[.\s]+)[A-Z][A-Z\d\s:&/-]+$/.test(value) ||
    /^[A-Z][A-Z\d\s:&/-]{3,}$/.test(value) ||
    // Numbered small-caps headings may contain a lowercase symbol such as h1.
    /^\d+(?:\.\d+)*\s+[A-Z]/.test(value) && letters.length >= 6 && letters.replace(/[^A-Z]/g, '').length / letters.length >= .8
  )
}

function normalize(rect: Bounds, width: number, height: number): ReaderRect {
  const left = Math.max(0, Math.min(width, rect.left))
  const right = Math.max(left, Math.min(width, rect.right))
  const top = Math.max(0, Math.min(height, rect.top))
  const bottom = Math.max(top, Math.min(height, rect.bottom))
  return { x: left / width, y: top / height, width: (right - left) / width, height: (bottom - top) / height }
}

const captionStart = /^(?:fig(?:ure)?\.?|table)\s*\d+[a-z]?\s*[.:]/i

/**
 * The prose layer of a page: text inside figures, charts and ruled tables is
 * removed, and a narrow figure straddling the page middle marks two columns below it.
 */
export function bodyPage(page: PdfPageText): PdfPageText & { columnBands: NonNullable<PdfPageText['columnBands']> } {
  const visuals = page.visualRects ?? page.imageRects ?? []
  // A figure starting at the page middle implies a second column only when no text
  // line below it runs across that middle (single-column papers wrap text around figures).
  const crossesBelow = (image: ReaderRect) => page.items.some((item) => {
    const [left, y] = page.viewport.convertToViewportPoint(item.transform[4], item.transform[5])
    const middle = image.x * page.viewport.width
    return y / page.viewport.height > image.y + image.height + .01 && left < middle - 10 && left + item.width > middle + 10
  })
  return { ...page,
    columnBands: page.columnBands ?? visuals.filter((image) => image.x >= .45 && image.x <= .55 && image.width < .48 && !crossesBelow(image)).map((image) => ({ x: image.x, top: image.y, bottom: .975 })),
    items: page.items.filter((item) => {
      const [x, y] = page.viewport.convertToViewportPoint(item.transform[4] + item.width / 2, item.transform[5] + item.height * .3)
      return !visuals.some((image) => x / page.viewport.width > image.x - .002 && x / page.viewport.width < image.x + image.width + .002 && y / page.viewport.height > image.y - .002 && y / page.viewport.height < image.y + image.height + .002)
    }) }
}

/** Order lines column by column; below the first column band the page is forced into two columns. */
export function columnOrder(lines: PdfLine[], page: PdfPageText & { columnBands: NonNullable<PdfPageText['columnBands']> }): PdfLine[] {
  const columnStart = Math.min(...page.columnBands.map((band) => band.top * page.viewport.height))
  return Number.isFinite(columnStart) ? [
    ...readingOrder(lines.filter((line) => line.rect.top < columnStart), page.viewport.width),
    ...readingOrder(lines.filter((line) => line.rect.top >= columnStart), page.viewport.width, true),
  ] : readingOrder(lines, page.viewport.width)
}

/** Caption lines ("Figure 3: …", "Table 2. …") and their aligned continuation lines. */
export function captionLines(lines: PdfLine[], width: number): Set<PdfLine> {
  const captions = new Set<PdfLine>()
  for (const [index, line] of lines.entries()) {
    if (!captionStart.test(line.text.trim()) || captions.has(line)) continue
    captions.add(line)
    let previous = line
    for (const next of lines.slice(index + 1)) {
      // Continuation lines share the caption's left edge (centred captions: its centre) and line spacing.
      const aligned = Math.abs(next.rect.left - line.rect.left) < width * .05 || Math.abs((next.rect.left + next.rect.right) - (line.rect.left + line.rect.right)) < width * .04
      // Prose wrapped beside the caption interleaves in top order; it is not part of the chain.
      if (Math.abs(next.rect.top - previous.rect.top) < .5 || next.rect.right < line.rect.left - 2 || next.rect.left > line.rect.right + 2) continue
      if (next.rect.top - previous.rect.bottom > Math.max(previous.height, next.height) * .55 || !aligned || captionStart.test(next.text.trim())) break
      captions.add(next)
      previous = next
    }
  }
  return captions
}

function joinLines(lines: string[]): string {
  return lines.reduce((text, next) => {
    const value = next.trim()
    if (!value) return text
    if (!text) return value
    return text + (text.endsWith('-') ? '' : ' ') + value
  }, '').replace(/\s+/g, ' ').trim()
}

export function readingOrder(lines: PdfLine[], width: number, forceColumns = false): PdfLine[] {
  const mid = width / 2
  const columnGap = width * .013
  const left = lines.filter((line) => line.rect.right < mid)
  const right = lines.filter((line) => line.rect.left >= mid)
  // Equation numbers, fractions and scripts are not evidence of a second column.
  const prose = (line: PdfLine) => line.rect.width > width * .18 && ((line.text.match(/[A-Za-z]{3,}/g)?.length ?? 0) >= 3 || /[\u3400-\u9fff]{10}/.test(line.text))
  const leftProse = left.filter(prose), rightProse = right.filter(prose)
  if (!forceColumns && (leftProse.length < 3 || rightProse.length < 3)) return lines
  if (!forceColumns) {
    const overlapTop = Math.max(leftProse[0].rect.top, rightProse[0].rect.top)
    const overlapBottom = Math.min(leftProse.at(-1)!.rect.bottom, rightProse.at(-1)!.rect.bottom)
    if (overlapBottom - overlapTop <= 30) return lines
  }
  // Full-width headings divide column bands; keep each heading before its section.
  const ordered: PdfLine[] = [], band: PdfLine[] = []
  const flush = () => {
    ordered.push(...band.filter((line) => (line.rect.left + line.rect.right) / 2 < mid), ...band.filter((line) => (line.rect.left + line.rect.right) / 2 >= mid))
    band.length = 0
  }
  for (const line of lines) {
    if (line.rect.left < mid - columnGap && line.rect.right > mid + columnGap) { flush(); ordered.push(line) }
    else band.push(line)
  }
  flush()
  return ordered
}

interface LineBlock { text: string; lines: PdfLine[]; rects: ReaderRect[] }

const LIST_ITEM = /^\s*(?:\d{1,2}[.)]|[a-h][.)]|[(](?:\d{1,2}|[a-h])[)])\s+\S/
const LIST_LEAD = /[:：]\s*$|(?:follows?|below)\s*[.:]\s*$/i

/**
 * Numbered claims introduced by a colon ("Our contributions are:") are one
 * paragraph. Cut into three cards they arrive at the translator one sentence at
 * a time, with no lead-in to anchor them.
 */
function listRuns(lines: PdfLine[]): { group: Map<PdfLine, number>; starts: Set<PdfLine> } {
  const group = new Map<PdfLine, number>(), starts = new Set<PdfLine>()
  let run = 0
  for (let index = 0; index < lines.length; index++) {
    if (!LIST_ITEM.test(lines[index].text) || isHeading(lines[index].text)) continue
    const lead = lines[index - 1]
    if (lead && !LIST_LEAD.test(lead.text.trim())) continue
    const left = lines[index].rect.left
    let items = 1, end = index
    for (let probe = index + 1; probe < lines.length; probe++) {
      const line = lines[probe], previous = lines[probe - 1]
      if (isHeading(line.text) || isReferenceHeading(line.text)) break
      if (line.rect.top - previous.rect.bottom > Math.max(line.height, previous.height) * 2.2) break
      if (LIST_ITEM.test(line.text)) {
        if (Math.abs(line.rect.left - left) > 3) break
        if (++items > 6) break
        end = probe
        continue
      }
      // Wrapped lines of an item sit right of its marker; anything flush with
      // the marker column has left the list.
      if (line.rect.left > left + 3) { end = probe; continue }
      break
    }
    if (items < 2 || lines.slice(index, end + 1).map((line) => line.text).join(' ').length > 1200) continue
    for (let member = index; member <= end; member++) {
      if (group.has(lines[member])) continue
      group.set(lines[member], run)
      if (member === index || LIST_ITEM.test(lines[member].text)) starts.add(lines[member])
    }
    run++
    index = end
  }
  return { group, starts }
}

function groupLines(input: PdfLine[], width: number, height: number, firstPage: boolean, order: (lines: PdfLine[]) => PdfLine[] = (lines) => readingOrder(lines, width), formulaTex: (line: PdfLine) => string = () => ''): { blocks: LineBlock[]; references: boolean } {
  const abstractIndex = firstPage ? input.findIndex((line) => /^abstract\s*:?$/i.test(line.text.trim())) : -1
  const firstSectionIndex = firstPage && abstractIndex < 0 ? input.findIndex((line) => isHeading(line.text)) : -1
  // Use explicit document headings to exclude front matter; unstructured PDFs keep their text selectable.
  const bodyStart = abstractIndex >= 0 ? abstractIndex + 1 : firstSectionIndex >= 0 ? firstSectionIndex + 1 : 0
  const ordered = order(input.slice(bodyStart))
  const captions = captionLines(ordered, width)
  const lines = ordered.filter((line) => !captions.has(line))
  const lists = listRuns(lines)
  let inAbstract = abstractIndex >= 0
  let references = false
  let current: PdfLine[] = []
  const blocks: LineBlock[] = []
  const joinBlock = (items: PdfLine[]): string => items.reduce((text, line, index) => {
    if (line.mathTex) return `${text}\n$$${line.mathTex}$$`
    const value = (line.clean ?? line.text).trim()
    if (!value) return text
    if (!text) return value
    if (index > 0 && lists.starts.has(line)) return `${text}\n${value}`
    return text + (text.endsWith('-') ? '' : ' ') + value
  }, '')
  const flush = (): void => {
    if (!current.length) return
    const text = joinBlock(current).replace(/[ \t]{2,}/g, ' ').trim()
    const rects = current.map((line) => normalize(line.rect, width, height)).filter((rect) => rect.width > 0 && rect.height > 0)
    // A lone short line is cell or axis debris ("MME"), not a paragraph.
    const words = text.match(/[A-Za-z]{2,}|[\u3400-\u9fff]/g) ?? []
    const debris = current.length === 1 && (words.length < 3 || text.length < 24)
    if (text.length >= 12 && rects.length && !debris && !/^(?:fig(?:ure)?\.?|table)\s*\d+[.:\s]/i.test(text)) blocks.push({ text, lines: current, rects })
    current = []
  }
  for (const line of lines) {
    if (isReferenceHeading(line.text)) { flush(); references = true; break }
    if (isHeading(line.text)) { flush(); inAbstract = false; continue }
    // Display equations separate prose and are not paragraphs themselves — but
    // when their LaTeX can be rebuilt they stay in the unit, so a translated
    // paragraph keeps the formula it explains.
    if (line.formula) {
      const tex = formulaTex(line)
      if (!tex) { flush(); continue }
      line.mathTex = tex
      current.push(line)
      continue
    }
    if (inAbstract) { current.push(line); continue }
    const previous = current.at(-1)
    // One numbered list never splits, whatever its hanging indent does.
    if (previous && lists.group.has(line) && lists.group.get(line) === lists.group.get(previous)) { current.push(line); continue }
    if (previous) {
      const gap = line.rect.top - previous.rect.bottom
      // Measure indents from the block's left edge: its own first line may be indented.
      const blockLeft = Math.min(...current.map((item) => item.rect.left))
      const indent = line.rect.left - blockLeft
      const fullWidth = Math.max(...current.map((item) => item.rect.width), line.rect.width)
      const shortEnding = previous.rect.width < fullWidth * .65 && /[.!?。！？][)\]”’]*$/.test(previous.text.trim()) && current.length >= 2
      // A first-line indent of about one em starts a paragraph (IEEE/ACM set no paragraph space).
      const firstLineIndent = current.length >= 2 && indent > Math.max(width * .011, previous.height * .7) && indent < width * .12 &&
        Math.abs(previous.rect.left - blockLeft) < 1.5 && /[.!?:。！？][)\]”’]*$/.test(previous.text.trim())
      if (gap > Math.max(previous.height, line.height) * .38 ||
        gap < -previous.height * .5 || indent > Math.max(width * .02, previous.height * 1.3) || firstLineIndent || shortEnding) flush()
    }
    current.push(line)
  }
  flush()
  return { blocks, references }
}

export function pdfVisualLines(page: PdfPageText): PdfLine[] {
  const { viewport } = page
  const allPieces = page.items.flatMap((item) => {
    const text = item.str.trim()
    const transform = item.transform
    if (!text || item.width <= 0 || item.height <= 2 ||
      Math.abs(transform[1]) > .01 || Math.abs(transform[2]) > .01) return []
    const [x1, y1] = viewport.convertToViewportPoint(transform[4], transform[5] + item.height * .82)
    const [x2, y2] = viewport.convertToViewportPoint(transform[4] + item.width, transform[5] - item.height * .14)
    const left = Math.min(x1, x2), right = Math.max(x1, x2)
    const top = Math.min(y1, y2), bottom = Math.max(y1, y2)
    // Captions and equation explanations can reach below 90% of the page.
    // Exclude centered footer numbers by geometry instead of truncating that text.
    if (top < viewport.height * .065 || top > viewport.height * .975) return []
    if (top > viewport.height * .91 && /^\d+$/.test(text) && Math.abs((left + right) / 2 - viewport.width / 2) < viewport.width * .06) return []
    const baseline = viewport.convertToViewportPoint(transform[4], transform[5])[1]
    const glyph: MathGlyph = { text, left, right, top, bottom, baseline, size: bottom - top, font: page.fontNames?.[item.fontName ?? ''] ?? '' }
    return [{ text, glyph, baseline, rect: { left, top, right, bottom, width: right - left, height: bottom - top } }]
  }).sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left)
  // Proof copies print line numbers in the margins or gutter: many short integers
  // stacked at one x position. They are not part of the text.
  const numberColumns = new Map<number, number>()
  for (const piece of allPieces) if (/^\d{1,3}$/.test(piece.text)) numberColumns.set(Math.round(piece.rect.right / 4), (numberColumns.get(Math.round(piece.rect.right / 4)) ?? 0) + 1)
  const lineNumber = (piece: typeof allPieces[number]) => /^\d{1,3}$/.test(piece.text) && [-2, -1, 0, 1, 2].reduce((sum, offset) => sum + (numberColumns.get(Math.round(piece.rect.right / 4) + offset) ?? 0), 0) >= 12
  const pieces = allPieces.filter((piece) => !lineNumber(piece))
  const rows: Array<typeof pieces> = []
  for (const piece of pieces) {
    const center = (piece.rect.top + piece.rect.bottom) / 2
    const row = rows.slice(-4).find((items) => {
      const reference = items.reduce((a, b) => a.rect.height >= b.rect.height ? a : b).rect
      return Math.abs((reference.top + reference.bottom) / 2 - center) < Math.max(1.5, Math.min(reference.height, piece.rect.height) * .85)
    })
    if (row) row.push(piece)
    else rows.push([piece])
  }
  const gutter = columnGutter(pieces, viewport.width)
  // A narrow figure beside wrapped text: its inner edge separates prose from the
  // caption sitting next to the prose, even when the two nearly touch.
  const sideEdges = (page.visualRects ?? []).filter((region) => region.width > .12 && region.width < .7).map((region) => ({
    x: (region.x + region.width / 2 > .5 ? region.x : region.x + region.width) * viewport.width,
    top: region.y * viewport.height, bottom: (region.y + region.height + .14) * viewport.height,
  }))
  // Left edges of captions found beside prose; they keep splitting following rows.
  const captionEdges: Array<{ x: number; until: number }> = []
  const straddles = (items: typeof pieces, x: number) => items.some((item) => item.rect.left < x - 3 && item.rect.right > x + 3)
  return rows.flatMap((items) => {
    items.sort((a, b) => a.rect.left - b.rect.left)
    const rowTop = Math.min(...items.map((item) => item.rect.top))
    // A caption column ends at the first row that runs continuously across its edge.
    const continuous = (x: number) => items.some((item, index) => index > 0 && items[index - 1].rect.right <= x + 3 && item.rect.left >= x - 3 && (items[index - 1].rect.right >= x - 5 || item.rect.left > x + 2.5))
    for (const edge of [...captionEdges]) if (rowTop > edge.until || straddles(items, edge.x) || continuous(edge.x)) captionEdges.splice(captionEdges.indexOf(edge), 1)
    const edges = [...sideEdges.filter((edge) => rowTop >= edge.top && rowTop <= edge.bottom && !straddles(items, edge.x)).map((edge) => edge.x), ...captionEdges.map((edge) => edge.x)]
    const groups: Array<typeof items> = []
    for (const [index, item] of items.entries()) {
      const previous = groups.at(-1)?.at(-1)
      const gap = previous ? item.rect.left - previous.rect.right : 0
      const acrossGutter = previous && gutter !== null && previous.rect.right <= gutter + 1 && item.rect.left >= gutter - 1
      const acrossColumn = acrossGutter || previous && page.columnBands?.some((band) => item.rect.top / viewport.height >= band.top && item.rect.top / viewport.height <= band.bottom && previous.rect.left / viewport.width < band.x && item.rect.left / viewport.width >= band.x - .002)
      // Wider than a justified word space: prose and a neighbouring caption never touch.
      // A real gutter: prose stops clearly before the edge and the neighbour starts on it.
      const acrossEdge = previous && gap > Math.max(2.5, item.rect.height * .6) && edges.some((x) => previous.rect.right < x - 5 && item.rect.left >= x - 2 && item.rect.left <= x + 2.5)
      const caption = previous && gap > Math.max(2.5, item.rect.height * .35) && captionStart.test(`${item.text} ${items[index + 1]?.text ?? ''}`.trim())
      if (caption) captionEdges.push({ x: item.rect.left, until: item.rect.bottom + item.rect.height * 12 })
      if (!previous || acrossColumn || acrossEdge || caption || gap > viewport.width * .055) groups.push([item])
      else groups.at(-1)!.push(item)
    }
    return groups.map((group) => {
      const left = Math.min(...group.map((item) => item.rect.left))
      const right = Math.max(...group.map((item) => item.rect.right))
      const top = Math.min(...group.map((item) => item.rect.top))
      const bottom = Math.max(...group.map((item) => item.rect.bottom))
      const reference = group.reduce((a, b) => a.rect.height >= b.rect.height ? a : b)
      let text = '', formattedText = '', previousRight = left
      for (const item of group) {
        const gap = item.rect.left - previousRight
        const offset = item.baseline - reference.baseline
        const script = item.rect.height < reference.rect.height * .82 && Math.abs(offset) > reference.rect.height * .1 &&
          Math.abs(offset) < reference.rect.height * .85 && gap < reference.rect.height * .65
          ? offset < 0 ? 'sup' : 'sub' : null
        if (text && !script && gap > Math.max(1.1, item.rect.height * .12) && !/[-/([{]$/.test(text)) { text += ' '; formattedText += ' ' }
        text += item.text
        formattedText += script ? `<${script}>${item.text}</${script}>` : item.text
        previousRight = item.rect.right
      }
      formattedText = formattedText.replace(/<\/(sup|sub)><\1>/g, '')
      if (page.fontNames) {
        formattedText = inlinePdfMath(group.map((item) => item.glyph), (glyph, previous) => {
          const gap = glyph.left - (previous?.right ?? left), offset = glyph.baseline - reference.baseline
          const script = glyph.size < reference.rect.height * .82 && Math.abs(offset) > reference.rect.height * .1 && Math.abs(offset) < reference.rect.height * .85 && gap < reference.rect.height * .65 ? offset < 0 ? 'sup' : 'sub' : null
          const space = glyph.left > left && !script && gap > Math.max(1.1, glyph.size * .12) ? ' ' : ''
          return space + (script ? `<${script}>${glyph.text}</${script}>` : glyph.text)
        })
      }
      // Citation marks, affiliation numbers and unit exponents are set as small
      // upright superscripts. They carry no meaning once the sentence leaves the
      // page, so the reading text drops them while real math (CMSY/CMMI fonts,
      // written as $…$) is kept intact.
      const clean = inlinePdfMath(group.map((item) => item.glyph), (glyph, previous) => {
        const gap = glyph.left - (previous?.right ?? left), offset = glyph.baseline - reference.baseline
        const script = glyph.size < reference.rect.height * .82 && Math.abs(offset) > reference.rect.height * .1 &&
          Math.abs(offset) < reference.rect.height * .85 && gap < reference.rect.height * .65
        if (script && offset < 0 && !isMathFont(glyph.font, glyph.text)) return ''
        const space = glyph.left > left && !script && gap > Math.max(1.1, glyph.size * .12) ? ' ' : ''
        return space + glyph.text
      }).replace(/\s{2,}/g, ' ').trim()
      return { text, clean, formattedText, glyphs: group.map((item) => item.glyph), rect: { left, top, right, bottom, width: right - left, height: bottom - top }, height: bottom - top }
    })
  }).sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left)
}

/**
 * The x position of a two-column gutter: a strip near the page middle that almost
 * no text run crosses while many runs end just before it and start just after it.
 * Columns can sit closer than any fixed gap threshold, so rows split here.
 */
export function columnGutter(pieces: Array<{ rect: Bounds }>, width: number): number | null {
  if (pieces.length < 40) return null
  let best: { x: number; crossing: number } | null = null
  for (let x = width * .4; x <= width * .6; x += 1) {
    const crossing = pieces.filter((piece) => piece.rect.left < x - 1 && piece.rect.right > x + 1).length
    if (!best || crossing < best.crossing) best = { x, crossing }
  }
  if (!best) return null
  // Widen to the centre of the empty strip so both column edges are clear of it.
  let start = best.x, end = best.x
  const crossingAt = (x: number) => pieces.filter((piece) => piece.rect.left < x - 1 && piece.rect.right > x + 1).length
  while (start > width * .38 && crossingAt(start - 1) <= best.crossing) start -= 1
  while (end < width * .62 && crossingAt(end + 1) <= best.crossing) end += 1
  const x = (start + end) / 2
  const endingLeft = pieces.filter((piece) => piece.rect.right <= x + 1 && piece.rect.right > x - width * .12).length
  const startingRight = pieces.filter((piece) => piece.rect.left >= x - 1 && piece.rect.left < x + width * .06).length
  return best.crossing <= Math.max(2, pieces.length * .04) && endingLeft >= 12 && startingRight >= 12 ? x : null
}

export function buildDocumentParagraphs(pages: PdfPageText[]): DocumentParagraph[] {
  const paragraphs: DocumentParagraph[] = []
  let previousLastLine: PdfLine | null = null
  let previousPageHeight = 0
  for (const page of pages) {
    const body = bodyPage(page)
    const lines = translationFormulaLines(pdfVisualLines(body), page.viewport.width)
    const { blocks, references } = groupLines(lines, page.viewport.width, page.viewport.height, page.pageNumber === 1, (items) => columnOrder(items, body), (line) => {
      const glyphs = line.glyphs ?? []
      if (!glyphs.length) return ''
      // A sentence that happens to contain "=" is not an equation: it is set in
      // word-length runs and carries no math glyph. Rebuilding it as LaTeX would
      // turn readable prose into commands.
      const mathy = glyphs.some((glyph) => /CMMI|CMSY|CMEX|CMBSY|CMMIB|MSAM|MSBM|EUSM|EUFM/i.test(glyph.font) || /[∑∏∫∮≤≥∈≈±×÷−∗∞∂∇√≠≪≫→←↔⟨⟩]/.test(glyph.text))
      const wordy = glyphs.filter((glyph) => /^[A-Za-z]{3,}$/.test(glyph.text.trim())).length / glyphs.length
      // Rows of measured numbers are a data table, not an equation.
      const numbers = glyphs.filter((glyph) => /^[−-]?\d+(?:\.\d+)?$/.test(glyph.text.trim())).length
      return mathy && wordy < .3 && numbers < 4 ? pdfMathTex(glyphs, page.mathRules ?? []) : ''
    })
    for (const [index, block] of blocks.entries()) {
      const preceding = paragraphs.at(-1)
      const firstLine = block.lines[0]
      // A paragraph broken by the page edge continues when the page ends
      // mid-sentence — with a hyphen, or with no terminal mark at all. A heading
      // above the first block means a new section started instead.
      const headingAbove = lines.some((line) => isHeading(line.text) && line.rect.top < firstLine.rect.top)
      const hyphenated = previousLastLine !== null && previousLastLine.text.trim().endsWith('-')
      const firstText = (firstLine.clean ?? firstLine.text).trim()
      // A paragraph broken by the page edge resumes in lower case — after a
      // hyphen, or after a sentence that simply ran out of page. A capitalised
      // opening belongs to whatever starts the new page.
      const unfinished = previousLastLine !== null && preceding !== undefined &&
        previousLastLine.rect.bottom > previousPageHeight * .74 &&
        // Only a wrapped line runs into the next page; a short one ended a block.
        previousLastLine.rect.width > page.viewport.width * .2 &&
        !headingAbove && firstLine.rect.top < page.viewport.height * .3 &&
        /^[a-z(“‘\d]/.test(firstText) &&
        (hyphenated || !/[.!?。！？][)\]”’\d]*$/.test(preceding.text))
      const carry = index === 0 && preceding && unfinished && !/^(?:fig(?:ure)?|table)\s*\d+[.:\s]/i.test(preceding.text)
      if (carry) {
        preceding.text = joinLines([preceding.text, block.text])
        preceding.parts.push({ page: page.pageNumber, rects: block.rects })
      } else paragraphs.push({ id: `paragraph-${page.pageNumber}-${index}`, text: block.text,
        startPage: page.pageNumber, parts: [{ page: page.pageNumber, rects: block.rects }] })
    }
    previousLastLine = blocks.at(-1)?.lines.at(-1) ?? null
    previousPageHeight = page.viewport.height
    if (references) break
  }
  return paragraphs
}

export function paragraphsOnPage(paragraphs: DocumentParagraph[], page: number): PageParagraph[] {
  return paragraphs.flatMap((paragraph) => paragraph.parts.filter((part) => part.page === page).map((part) => ({
    id: paragraph.id, text: paragraph.text, startPage: paragraph.startPage, parts: paragraph.parts, rects: part.rects,
  })))
}
