import type { ReaderRect } from './types'
import { protectAcademicScripts } from './academic-text'

export const translationLayoutRevision = 4
export type TranslationScope = 'body' | 'appendix'
export interface TranslationBlock {
  id: string; scope: TranslationScope; kind: 'heading' | 'paragraph' | 'formula' | 'figure' | 'table'
  text: string; parts: Array<{ page: number; rects: ReaderRect[] }>
  imageRect?: ReaderRect
  math?: { tex: string; label?: string }
}
export interface DocumentTranslation {
  version: 1; layoutRevision?: number; checksum: string; blocks: TranslationBlock[]
  translations: Record<string, string>; running: TranslationScope[]; errors: Partial<Record<TranslationScope, string>>
}
export interface TranslationBatch { version: 1; scope: TranslationScope; checksum: string; blocks: Array<{ id: string; text: string }> }

export function translationRequestBlocks(batch: TranslationBatch): TranslationBatch['blocks'] {
  return batch.blocks.map((block) => ({ id: block.id, text: protectAcademicScripts(block.text).text }))
}

export function translationBatches(document: DocumentTranslation, scope: TranslationScope): TranslationBatch[] {
  const batches: TranslationBatch[] = []
  let blocks: TranslationBatch['blocks'] = [], size = 0
  const flush = () => { if (blocks.length) batches.push({ version: 1, scope, checksum: document.checksum, blocks }); blocks = []; size = 0 }
  for (const block of document.blocks) {
    if (block.scope !== scope || block.kind === 'formula' || !block.text.trim() || document.translations[block.id]) continue
    if (size + block.text.length > 7000 || blocks.length >= 16) flush()
    blocks.push({ id: block.id, text: block.text }); size += block.text.length
  }
  flush()
  return batches
}

export function parseTranslationResult(text: string, batch: TranslationBatch): Record<string, string> {
  const value = JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, '')) as unknown
  if (!Array.isArray(value) || value.length !== batch.blocks.length) throw new Error('翻译结果缺少段落，请重试未完成部分。')
  const result: Record<string, string> = {}
  for (const item of value) {
    if (!item || typeof item.id !== 'string' || !batch.blocks.some((block) => block.id === item.id) ||
      typeof item.translation !== 'string' || !item.translation.trim() || item.translation.length > 100000 || result[item.id]) throw new Error('翻译段落与原文不匹配。')
    const source = batch.blocks.find((block) => block.id === item.id)!
    let translation = item.translation.trim()
    for (const { token, value } of protectAcademicScripts(source.text).spans) {
      if (translation.split(token).length !== 2) throw new Error('译文未完整保留引用或上下标，请重试未完成部分。')
      translation = translation.replace(token, () => value)
    }
    result[item.id] = translation
  }
  return result
}
