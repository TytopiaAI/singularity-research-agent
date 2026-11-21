import type { SourceSeed } from '../shared/knowledge'
import { buildDocumentParagraphs, pdfVisualLines, type PdfPageText, type PdfLine } from './pdf-document-paragraphs'

/** All source geometry is calculated once at PDF scale 1, never from screen pixels. */
export function buildSourceSeeds(pages: PdfPageText[]): SourceSeed[] {
  const paragraphs = buildDocumentParagraphs(pages)
  const seeds: SourceSeed[] = paragraphs.map((paragraph, i) => ({ kind: 'paragraph', label: `S${String(i + 1).padStart(3, '0')}`, text: paragraph.text, parts: paragraph.parts }))
  let references = false
  let reference: SourceSeed | null = null
  let sequence = 0
  const rect = (line: PdfLine, page: PdfPageText) => {
    const x = Math.max(0, Math.min(1, line.rect.left / page.viewport.width)), y = Math.max(0, Math.min(1, line.rect.top / page.viewport.height))
    return { x, y, width: Math.max(0, Math.min(1 - x, line.rect.width / page.viewport.width)), height: Math.max(0, Math.min(1 - y, line.rect.height / page.viewport.height)) }
  }
  for (const page of pages) {
    const lines = pdfVisualLines(page)
    for (const [index, line] of lines.entries()) {
      if (/^(?:references|bibliography|参考文献)\s*$/i.test(line.text.trim())) references = true
      const caption = /^(fig(?:ure)?\.?|table)\s*(\d+[a-z]?)\s*[.:]/i.exec(line.text.trim())
      if (caption && !references) {
        const following: PdfLine[] = []
        for (const item of lines.slice(index + 1, index + 7)) {
          const previous = following.at(-1) ?? line
          if (item.rect.top - previous.rect.bottom > line.height * .55 || Math.abs(item.rect.left - line.rect.left) > page.viewport.width * .05 || /^(?:fig(?:ure)?\.?|table)\s*\d+\s*[.:]/i.test(item.text)) break
          following.push(item)
        }
        const text = [line.text, ...following.map((item) => item.text)].join(' ')
        const kind = caption[1].toLowerCase() === 'table' ? 'table' : 'figure'
        seeds.push({ kind, label: `${kind === 'figure' ? 'Fig.' : 'Table'} ${caption[2]}`, text,
          parts: [{ page: page.pageNumber, rects: [line, ...following].map((item) => rect(item, page)) }] })
      }
      if (references && !/^(?:references|bibliography|参考文献)\s*$/i.test(line.text.trim())) {
        const number = /^(?:\[(\d+)\]|(\d+)\.\s)/.exec(line.text.trim())
        const author = /^[A-Z][\p{L}'’\-]+,\s*(?:[A-Z]\.|[A-Z][\p{L}]+).*\b(?:19|20)\d{2}[a-z]?\b/u.test(line.text)
        if (number || author) {
          sequence++
          reference = { kind: 'reference', label: `R${number?.[1] ?? number?.[2] ?? sequence}`, text: line.text, parts: [{ page: page.pageNumber, rects: [rect(line, page)] }] }
          seeds.push(reference)
        } else if (reference) {
          reference.text += ' ' + line.text
          const part = reference.parts.find((item) => item.page === page.pageNumber)
          if (part) part.rects.push(rect(line, page))
          else reference.parts.push({ page: page.pageNumber, rects: [rect(line, page)] })
        }
      }
    }
  }
  return seeds
}
