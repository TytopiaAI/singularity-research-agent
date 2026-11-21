import fs from 'node:fs/promises'
import crypto from 'node:crypto'
import path from 'node:path'
import { createRequire } from 'node:module'
import type { PaperIndexStatus } from '../shared/types'

export interface ExtractedPdf {
  checksum: string
  size: number
  modifiedAt: number
  title: string
  authors: string[]
  year: number | null
  doi: string | null
  language: string
  pageCount: number
  pages: string[]
  indexStatus: PaperIndexStatus
}

export async function extractPdf(filePath: string): Promise<ExtractedPdf> {
  const [buffer, stat] = await Promise.all([fs.readFile(filePath), fs.stat(filePath)])
  if (path.extname(filePath).toLowerCase() !== '.pdf') throw new Error('仅支持 PDF 文件。')
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const pdfjsRoot = path.dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'))
  const standardFontDataUrl = `${path.join(pdfjsRoot, 'standard_fonts').replaceAll('\\', '/')}/`
  const document = await pdfjs.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, standardFontDataUrl }).promise
  const metadata = await document.getMetadata().catch(() => null)
  const pageCount = document.numPages
  const pages: string[] = []
  for (let index = 1; index <= pageCount; index += 1) {
    const page = await document.getPage(index)
    const content = await page.getTextContent()
    const text = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
    pages.push(text)
    page.cleanup()
  }
  await document.destroy()
  const allText = pages.join('\n')
  const info = (metadata?.info ?? {}) as Record<string, unknown>
  const title = cleanMetadata(info.Title) || inferTitle(allText, path.basename(filePath, path.extname(filePath)))
  const authors = splitAuthors(cleanMetadata(info.Author))
  const doi = allText.match(/\b10\.\d{4,9}\/[\w.()/:;-]+/i)?.[0]?.replace(/[.,;)]$/, '') ?? null
  const yearText = `${cleanMetadata(info.CreationDate)} ${allText.slice(0, 4_000)}`.match(/\b(19|20)\d{2}\b/)?.[0]
  const visibleCharacters = allText.replace(/\s/g, '').length
  // A text PDF may have a sparse cover page; scans usually expose almost no characters at all.
  const indexStatus: PaperIndexStatus = visibleCharacters < Math.max(40, pageCount * 20) ? 'needs-ocr' : 'ready'
  return {
    checksum: crypto.createHash('sha256').update(buffer).digest('hex'),
    size: stat.size,
    modifiedAt: stat.mtimeMs,
    title,
    authors,
    year: yearText ? Number(yearText) : null,
    doi,
    language: inferLanguage(allText),
    pageCount: pages.length,
    pages,
    indexStatus,
  }
}

function cleanMetadata(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
}

function inferTitle(text: string, fallback: string): string {
  const line = text.split(/\n| {3,}/).map((item) => item.trim()).find((item) => item.length >= 8 && item.length <= 240)
  return line || fallback
}

function splitAuthors(value: string): string[] {
  if (!value) return []
  return value.split(/;|,\s+(?=[A-Z\u4e00-\u9fff])|\band\b/i).map((item) => item.trim()).filter(Boolean)
}

function inferLanguage(text: string): string {
  const sample = text.slice(0, 20_000)
  const chinese = (sample.match(/[\u3400-\u9fff]/g) ?? []).length
  const latin = (sample.match(/[A-Za-z]/g) ?? []).length
  return chinese > latin * 0.2 ? 'zh-CN' : 'en'
}
