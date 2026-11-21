import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import type { PdfPageText } from '../renderer/pdf-document-paragraphs'
import type { MathRule } from '../shared/pdf-math'
import type { ReaderRect } from '../shared/types'
import { visualRegions } from './pdf-visual-regions'

/**
 * Read every page at PDF scale 1 with its text items and the non-text geometry
 * that paragraph and translation layout depend on: images, vector drawings,
 * horizontal rules (fraction bars, table rules) and ruled tables.
 * Shared by the source-map index and full-document translation so both see the same page.
 */
export async function loadPdfPages(sourcePath: string): Promise<PdfPageText[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const root = path.dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'))
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await fs.readFile(sourcePath)), isEvalSupported: false, standardFontDataUrl: path.join(root, 'standard_fonts').replaceAll('\\', '/') + '/' }).promise
  try {
    const pages: PdfPageText[] = []
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber)
      const viewport = page.getViewport({ scale: 1 })
      const operators = await page.getOperatorList(), images: ReaderRect[] = [], drawings: ReaderRect[] = [], rules: MathRule[] = [], stack: number[][] = []
      let matrix = [1, 0, 0, 1, 0, 0]
      for (let index = 0; index < operators.fnArray.length; index++) {
        const operation = operators.fnArray[index], args = operators.argsArray[index]
        if (operation === pdfjs.OPS.save) stack.push([...matrix])
        else if (operation === pdfjs.OPS.restore) matrix = stack.pop() ?? [1, 0, 0, 1, 0, 0]
        else if (operation === pdfjs.OPS.transform) {
          const m = matrix, n = args as number[]
          matrix = [m[0]*n[0]+m[2]*n[1], m[1]*n[0]+m[3]*n[1], m[0]*n[2]+m[2]*n[3], m[1]*n[2]+m[3]*n[3], m[0]*n[4]+m[2]*n[5]+m[4], m[1]*n[4]+m[3]*n[5]+m[5]]
        } else if ([pdfjs.OPS.paintImageXObject, pdfjs.OPS.paintInlineImageXObject, pdfjs.OPS.constructPath].includes(operation)) {
          const bounds = operation === pdfjs.OPS.constructPath ? Array.from(args[2] as ArrayLike<number> ?? []) : [0, 0, 1, 1]
          if (bounds.length !== 4) continue
          const corners = [[bounds[0],bounds[1]],[bounds[2],bounds[1]],[bounds[0],bounds[3]],[bounds[2],bounds[3]]].map(([x,y]) => viewport.convertToViewportPoint(matrix[0]*x+matrix[2]*y+matrix[4], matrix[1]*x+matrix[3]*y+matrix[5]))
          const x = Math.max(0, Math.min(...corners.map((p) => p[0])) / viewport.width), y = Math.max(0, Math.min(...corners.map((p) => p[1])) / viewport.height)
          const width = Math.min(1, Math.max(...corners.map((p) => p[0])) / viewport.width) - x, height = Math.min(1, Math.max(...corners.map((p) => p[1])) / viewport.height) - y
          if (operation === pdfjs.OPS.constructPath) {
            if (height * viewport.height < 1 && width * viewport.width > 2) rules.push({ left: x * viewport.width, right: (x + width) * viewport.width, y: y * viewport.height })
            else drawings.push({ x, y, width, height })
          } else if (width > .01 && height > .01) images.push({ x, y, width, height })
        }
      }
      const items = (await page.getTextContent()).items.filter((item) => 'str' in item), fontNames: Record<string, string> = {}
      for (const item of items) if (!fontNames[item.fontName] && page.commonObjs.has(item.fontName)) fontNames[item.fontName] = (page.commonObjs.get(item.fontName) as { name?: string }).name ?? ''
      const tableRects = ruledTables(items, rules, viewport)
      pages.push({ pageNumber, imageRects: images, tableRects, visualRects: visualRegions([...drawings, ...images, ...tableRects]), mathRules: rules, fontNames,
        viewport: { width: viewport.width, height: viewport.height, convertToViewportPoint: (x, y) => viewport.convertToViewportPoint(x, y) as [number, number] },
        items: items.map((item) => ({ str: item.str, width: item.width, height: item.height, transform: item.transform, fontName: item.fontName })) })
      page.cleanup()
    }
    return pages
  } finally { await pdf.destroy() }
}

/**
 * Locate booktabs-style tables: a "Table N" caption with at least two aligned
 * full-width horizontal rules below (caption above) or above it (caption below).
 */
function ruledTables(items: Array<{ str: string; transform: number[] }>, rules: MathRule[], viewport: { width: number; height: number; convertToViewportPoint(x: number, y: number): number[] }): ReaderRect[] {
  const tables: ReaderRect[] = []
  const wide = rules.filter((rule) => rule.right - rule.left > viewport.width * .18).sort((a, b) => a.y - b.y)
  for (const item of items.filter((item) => /^Table\s*\d+[.:\s]/i.test(item.str.trim()))) {
    const [, captionY] = viewport.convertToViewportPoint(item.transform[4], item.transform[5])
    for (const direction of [1, -1]) {
      const candidates = wide.filter((rule) => direction > 0 ? rule.y > captionY && rule.y - captionY < viewport.height * .45 : rule.y < captionY && captionY - rule.y < viewport.height * .45)
      const first = direction > 0 ? candidates[0] : candidates.at(-1)
      if (!first) continue
      const ordered = candidates.filter((rule) => Math.abs(rule.left - first.left) < 10 && Math.abs(rule.right - first.right) < 10)
      if (direction < 0) ordered.reverse()
      // Walk away from the caption; a long gap means the next rule belongs to something else.
      const aligned = [first]
      for (const rule of ordered.slice(1)) {
        if (Math.abs(rule.y - aligned.at(-1)!.y) > viewport.height * .18) break
        aligned.push(rule)
      }
      const top = Math.min(...aligned.map((rule) => rule.y)), bottom = Math.max(...aligned.map((rule) => rule.y))
      if (aligned.length < 2 || bottom - top < 18) continue
      tables.push({ x: first.left / viewport.width, y: top / viewport.height, width: (first.right - first.left) / viewport.width, height: (bottom - top + 2) / viewport.height })
      break
    }
  }
  return tables
}
