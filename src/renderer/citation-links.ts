import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { ReaderRect } from '../shared/types'

// In-text markers such as "[12]", "Fig. 3" or "Table 2" are turned into jump
// targets the way desktop readers (Sioyek) do it: the PDF does not need any
// embedded links, we rebuild them from the text layer itself.

export interface TextRun { str: string; x: number; y: number; width: number; height: number }
export interface RunPage { page: number; runs: TextRun[] }
export type CitationTargetKind = 'reference' | 'figure' | 'table'
export interface CitationTarget { kind: CitationTargetKind; label: string; page: number; rect: ReaderRect }
export interface CitationLink { page: number; text: string; rect: ReaderRect; target: CitationTarget }

/** A 400-page paper still indexes in well under a second; beyond that we stop. */
const MAX_PAGES = 400

const HEADING = /^(references|bibliography|works cited|literature cited|参考文献)$/iu
const BRACKET_ENTRY = /^\s*\[(\d{1,3})\]/
const NUMERIC_ENTRY = /^(\d{1,3})\.\s+\S/u
const FIGURE_CAPTION = /^fig(?:ure)?s?\b\.?\s*(\d{1,3})\s*[.:|]/iu
const TABLE_CAPTION = /^tab(?:le)?s?\b\.?\s*(\d{1,3})\s*[.:|]/iu
const BRACKET_MARKER = /\[(\d{1,3}(?:\s*[,;]\s*\d{1,3}|\s*[–—-]\s*\d{1,3})*)\]/gu
const FIGURE_MARKER = /\bfig(?:ure)?s?\b\.?\s*(\d{1,3})(?!\d)/giu
const TABLE_MARKER = /\btab(?:le)?s?\b\.?\s*(\d{1,3})(?!\d)/giu
// Author-year styles (Elsevier, Springer, APA) have no numbers to key on, so
// entries and in-text citations are paired on "first author + year".
const AUTHOR_ENTRY = /^([\p{Lu}][\p{L}'’\-]{1,30}),\s*[\p{Lu}]\./u
const YEAR = /\b((?:19|20)\d{2})[a-z]?\b/u
const CITATION_GROUP = /\(([^()]{2,180})\)/gu
const GROUP_ITEM = /^\s*([\p{Lu}][\p{L}'’\-]{1,30})(?=,|\s+et\s+al|\s+and\s|\s*&)/u
const NARRATIVE = /([\p{Lu}][\p{L}'’\-]{1,30})(?:\s+et\s+al\.?|\s+(?:and|&)\s+[\p{Lu}][\p{L}'’\-]{1,30})?\s*\(((?:19|20)\d{2})[a-z]?\)/gu

function multiply(a: number[], b: number[]): number[] {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ]
}

/** PDF text items → rects normalised against a scale-1 viewport. */
export function normalizeTextRuns(items: Array<{ str?: unknown; transform?: unknown; width?: unknown; height?: unknown }>, viewport: { width: number; height: number; transform: number[] }): TextRun[] {
  if (!viewport.width || !viewport.height) return []
  const runs: TextRun[] = []
  for (const item of items) {
    if (typeof item.str !== 'string' || !item.str.trim() || !Array.isArray(item.transform)) continue
    const tx = multiply(viewport.transform, item.transform as number[])
    const fontHeight = Math.hypot(tx[2], tx[3])
    if (!fontHeight) continue
    const width = typeof item.width === 'number' && item.width > 0 ? item.width : fontHeight * item.str.length * .5
    runs.push({
      str: item.str,
      x: tx[4] / viewport.width,
      y: (tx[5] - fontHeight) / viewport.height,
      width: width / viewport.width,
      height: fontHeight / viewport.height,
    })
  }
  return runs
}

export async function readPdfTextRuns(document: PDFDocumentProxy, isActive: () => boolean = () => true): Promise<RunPage[]> {
  const pages: RunPage[] = []
  const total = Math.min(document.numPages, MAX_PAGES)
  for (let number = 1; number <= total; number++) {
    if (!isActive()) return pages
    const page = await document.getPage(number)
    const viewport = page.getViewport({ scale: 1 })
    const content = await page.getTextContent()
    pages.push({
      page: number,
      runs: normalizeTextRuns(content.items as unknown as Array<{ str?: unknown; transform?: unknown; width?: unknown; height?: unknown }>, { width: viewport.width, height: viewport.height, transform: viewport.transform as number[] }),
    })
  }
  return pages
}

function rectOfLine(line: TextLine, start: number, length: number): ReaderRect | null {
  const end = start + length
  let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity
  let height = 0
  for (const item of line.runs) {
    if (item.end <= start || item.start >= end) continue
    const total = Math.max(1, item.run.str.length)
    const begin = Math.max(0, Math.min(total, start - item.start))
    const stop = Math.max(begin, Math.min(total, end - item.start))
    const x = item.run.x + item.run.width * (begin / total)
    left = Math.min(left, x)
    right = Math.max(right, x + item.run.width * ((stop - begin) / total))
    top = Math.min(top, item.run.y)
    bottom = Math.max(bottom, item.run.y + item.run.height)
    height = Math.max(height, item.run.height)
  }
  if (!Number.isFinite(left) || right - left <= 0) return null
  return { x: left, y: top, width: right - left, height: Math.max(bottom - top, height, .008) }
}

/** "3–5" expands to one hop, "1, 2" to one hop per number. */
function bracketParts(body: string, offset: number): Array<{ numbers: number[]; start: number; length: number }> {
  const parts: Array<{ numbers: number[]; start: number; length: number }> = []
  const pattern = /\d{1,3}(?:\s*[–—-]\s*\d{1,3})?/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(body))) {
    const [whole] = match
    const range = whole.match(/^(\d{1,3})\s*[–—-]\s*(\d{1,3})$/)
    const start = offset + match.index
    if (range) {
      const first = Number(range[1]), last = Number(range[2])
      parts.push({ numbers: last >= first && last - first <= 20 ? [first, last] : [first], start, length: whole.length })
    } else parts.push({ numbers: [Number(whole)], start, length: whole.length })
  }
  return parts
}

function addTarget<K>(map: Map<K, CitationTarget>, number: K, target: CitationTarget): void {
  if (!map.has(number)) map.set(number, target)
}

interface LineRun { run: TextRun; start: number; end: number }
interface TextLine { page: number; text: string; runs: LineRun[] }

/** A gap wider than this share of the page width starts a new column. */
const COLUMN_GAP = .04
const LINE_TOLERANCE = .6
const WORD_GAP = .012

/**
 * Markers and captions routinely straddle text items ("Figure" / "3" arrive as
 * two runs), so the index works on reconstructed lines instead of single runs.
 */
export function pageLines(page: RunPage): TextLine[] {
  const lines: TextLine[] = []
  const emit = (segment: TextRun[]): void => {
    if (!segment.length) return
    let text = ''
    const runs: LineRun[] = []
    for (const run of segment) {
      if (text) text += ' '
      runs.push({ run, start: text.length, end: text.length + run.str.length })
      text += run.str
    }
    lines.push({ page: page.page, text, runs })
  }
  // Two-column pages put a body paragraph and a reference entry on the same
  // baseline, so a row is cut at its widest gap: word spaces are far narrower
  // than a column gutter, and a single-column row has no such gap at all.
  const emitRow = (row: TextRun[]): void => {
    if (row.length < 3) { emit(row); return }
    let cut = -1, widest = 0
    for (let index = 1; index < row.length; index++) {
      const gap = row[index].x - (row[index - 1].x + row[index - 1].width)
      if (gap > widest) { widest = gap; cut = index }
    }
    if (cut < 1 || row.length - cut < 1 || widest < WORD_GAP) { emit(row); return }
    emit(row.slice(0, cut))
    emit(row.slice(cut))
  }
  const sorted = [...page.runs].sort((a, b) => a.y - b.y || a.x - b.x)
  let bucket: TextRun[] = []
  const flush = (): void => {
    let segment: TextRun[] = []
    for (const run of bucket) {
      const previous = segment[segment.length - 1]
      if (previous && (run.x < previous.x - .005 || run.x > previous.x + previous.width + COLUMN_GAP)) { emit(segment); segment = [] }
      segment.push(run)
    }
    if (segment.length) emitRow(segment)
    bucket = []
  }
  for (const run of sorted) {
    const head = bucket[0]
    if (head && Math.abs(run.y - head.y) > Math.max(run.height, head.height) * LINE_TOLERANCE) flush()
    bucket.push(run)
  }
  flush()
  return lines
}

/** First reference entry in the back half of the paper, when no heading exists. */
function looksLikeEntry(line: TextLine): boolean {
  if (BRACKET_ENTRY.test(line.text)) return true
  return AUTHOR_ENTRY.test(line.text) && YEAR.test(line.text)
}

function referenceStart(lines: TextLine[]): number {
  const from = Math.floor(lines.length * .45)
  // A single bracketed line can sit in the body, so the section only starts
  // where entry-shaped lines keep coming.
  for (let index = from; index < lines.length; index++) {
    if (!looksLikeEntry(lines[index])) continue
    let hits = 0
    for (let probe = index; probe < Math.min(lines.length, index + 8); probe++) if (looksLikeEntry(lines[probe])) hits++
    if (hits >= 3) return index
  }
  for (let index = from; index < lines.length; index++) if (looksLikeEntry(lines[index])) return index
  return 0
}

/** Page-relative hit test used for hovering and clicking a marker. */
export function linkIndexAtPoint(links: CitationLink[] | undefined, x: number, y: number, padX: number, padY: number): number {
  if (!links?.length) return -1
  return links.findIndex((link) => x >= link.rect.x - padX && x <= link.rect.x + link.rect.width + padX && y >= link.rect.y - padY && y <= link.rect.y + link.rect.height + padY)
}

export function buildCitationIndex(pages: RunPage[]): CitationLink[] {
  const lines = pages.flatMap(pageLines)
  if (!lines.length) return []

  const headingIndex = lines.findIndex((line) => HEADING.test(line.text.trim()))
  const references = new Map<number, CitationTarget>()
  const authorYears = new Map<string, CitationTarget>()
  // A missing "References" heading is common (typeset as a graphic or merged
  // into a running head), so the entries themselves can mark the section.
  const sectionStart = headingIndex >= 0 ? headingIndex + 1 : referenceStart(lines)
  const sectionPage = sectionStart > 0 ? lines[sectionStart].page : 0
  if (sectionStart > 0) {
    // Entries are read from the text items themselves, not from reconstructed
    // lines: on two-column pages a justified body line can touch the reference
    // column with no visible gap, which glues "[12]" onto body text.
    for (const page of pages) {
      if (page.page < sectionPage || references.size >= 300) continue
      for (const run of page.runs) {
        const head = run.str.trimStart()
        const bracketed = head.match(BRACKET_ENTRY)
        if (!bracketed) continue
        const lead = run.str.length - head.length
        const total = Math.max(1, run.str.length)
        const width = run.width * ((lead + bracketed[0].trim().length) / total)
        const number = Number(bracketed[1])
        addTarget(references, number, { kind: 'reference', label: `[${number}]`, page: page.page, rect: { x: run.x + run.width * (lead / total), y: run.y, width, height: run.height } })
      }
    }
    // Numeric styles ("1. Author…") are only trusted when nothing is bracketed,
    // because a climbing sequence alone cannot tell references from body lists.
    if (!references.size) {
      let previous = 0
      for (let index = sectionStart; index < lines.length && references.size < 300; index++) {
        const line = lines[index]
        const numeric = line.text.match(NUMERIC_ENTRY)
        if (!numeric || Number(numeric[1]) !== previous + 1) continue
        previous = Number(numeric[1])
        const rect = rectOfLine(line, 0, numeric[0].trimEnd().length)
        if (rect) addTarget(references, previous, { kind: 'reference', label: `[${previous}]`, page: line.page, rect })
      }
    }
    for (let index = sectionStart; index < lines.length && authorYears.size < 500; index++) {
      const line = lines[index]
      const author = line.text.match(AUTHOR_ENTRY)
      const year = line.text.match(YEAR)
      if (!author || !year) continue
      const surname = author[1]
      const rect = rectOfLine(line, 0, author[0].length + year[1].length)
      if (rect) addTarget(authorYears, `${surname.toLowerCase()}:${year[1]}`, { kind: 'reference', label: `${surname} ${year[1]}`, page: line.page, rect })
    }
  }

  const figures = new Map<number, CitationTarget>()
  const tables = new Map<number, CitationTarget>()
  const captions = new Set<TextLine>()
  for (const line of lines) {
    const head = line.text.trimStart()
    const lead = line.text.length - head.length
    const figure = head.match(FIGURE_CAPTION)
    if (figure) {
      const rect = rectOfLine(line, lead, figure[0].trimEnd().length)
      if (rect) { addTarget(figures, Number(figure[1]), { kind: 'figure', label: `图 ${figure[1]}`, page: line.page, rect }); captions.add(line) }
    }
    const table = head.match(TABLE_CAPTION)
    if (table) {
      const rect = rectOfLine(line, lead, table[0].trimEnd().length)
      if (rect) { addTarget(tables, Number(table[1]), { kind: 'table', label: `表 ${table[1]}`, page: line.page, rect }); captions.add(line) }
    }
  }

  const seen = new Set<string>()
  const links: CitationLink[] = []
  const push = (line: TextLine, text: string, start: number, length: number, target: CitationTarget | undefined): void => {
    if (!target) return
    const rect = rectOfLine(line, start, length)
    if (!rect) return
    // The entry's own number would otherwise link to itself.
    if (target.page === line.page && Math.abs(target.rect.y - rect.y) < .004 && Math.abs(target.rect.x - rect.x) < .01) return
    const key = `${line.page}:${Math.round(rect.x * 1000)}:${Math.round(rect.y * 1000)}:${target.kind}:${target.page}`
    if (seen.has(key)) return
    seen.add(key)
    links.push({ page: line.page, text, rect, target })
  }

  lines.forEach((line, index) => {
    const head = line.text.trimStart()
    if (!head) return
    const lead = line.text.length - head.length
    const isEntry = sectionStart > 0 && index >= sectionStart && (BRACKET_ENTRY.test(line.text) || AUTHOR_ENTRY.test(line.text))
    const isCaption = captions.has(line)

    for (const match of line.text.matchAll(BRACKET_MARKER)) {
      const open = line.text.indexOf('[', match.index)
      if (isEntry && open === lead) continue
      for (const part of bracketParts(match[1], 0)) {
        const start = open + 1 + part.start
        push(line, `[${line.text.slice(start, start + part.length)}]`, start, part.length, references.get(part.numbers[0]))
      }
    }
    if (authorYears.size && !isEntry) {
      for (const group of line.text.matchAll(CITATION_GROUP)) {
        const body = group[1]
        const base = (group.index ?? 0) + 1
        let offset = 0
        for (const raw of body.split(';')) {
          const item = raw.match(GROUP_ITEM)
          const year = raw.match(YEAR)
          if (item && year) {
            const start = base + offset + raw.indexOf(item[1])
            push(line, raw.trim(), start, raw.trim().length, authorYears.get(`${item[1].toLowerCase()}:${year[1]}`))
          }
          offset += raw.length + 1
        }
      }
      for (const match of line.text.matchAll(NARRATIVE)) {
        push(line, match[0], match.index ?? 0, match[0].length, authorYears.get(`${match[1].toLowerCase()}:${match[2]}`))
      }
    }
    for (const match of line.text.matchAll(FIGURE_MARKER)) {
      if (isCaption && (match.index ?? 0) === lead) continue
      push(line, match[0].trim(), match.index ?? 0, match[0].length, figures.get(Number(match[1])))
    }
    for (const match of line.text.matchAll(TABLE_MARKER)) {
      if (isCaption && (match.index ?? 0) === lead) continue
      push(line, match[0].trim(), match.index ?? 0, match[0].length, tables.get(Number(match[1])))
    }
  })

  return links.sort((a, b) => a.page - b.page || a.rect.y - b.rect.y || a.rect.x - b.rect.x)
}
