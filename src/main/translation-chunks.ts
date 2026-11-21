import type { PaperPage } from '../shared/types'

export interface TranslationChunk {
  index: number
  fromPage: number
  toPage: number
  text: string
  characters: number
}

export function createTranslationChunks(pages: PaperPage[], targetCharacters = 12_000): TranslationChunk[] {
  if (targetCharacters < 500) throw new Error('翻译分块过小。')
  const chunks: TranslationChunk[] = []
  let current: PaperPage[] = []
  let characters = 0
  const flush = (): void => {
    if (!current.length) return
    chunks.push({
      index: chunks.length,
      fromPage: current[0].pageNumber,
      toPage: current.at(-1)!.pageNumber,
      text: current.map((page) => `<!-- page:${page.pageNumber} -->\n\n${page.text}`).join('\n\n'),
      characters,
    })
    current = []
    characters = 0
  }
  for (const page of pages) {
    if (current.length && characters + page.text.length > targetCharacters) flush()
    current.push(page)
    characters += page.text.length
  }
  flush()
  return chunks
}
