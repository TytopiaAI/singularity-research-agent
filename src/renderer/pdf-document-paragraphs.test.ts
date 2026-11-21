import { describe, expect, it } from 'vitest'
import { buildDocumentParagraphs, type PdfPageText } from './pdf-document-paragraphs'

const WIDTH = 600, HEIGHT = 800

interface Piece { str: string; width: number; height: number; transform: number[]; fontName: string }

/** One text run placed by its baseline distance from the top of the page. */
const run = (str: string, x: number, baseline: number, size = 10, fontName = 'F1'): Piece => ({
  str, width: str.length * size * .48, height: size, transform: [1, 0, 0, 1, x, HEIGHT - baseline], fontName,
})

const page = (items: Piece[], pageNumber = 1): PdfPageText => ({
  pageNumber,
  viewport: { width: WIDTH, height: HEIGHT, convertToViewportPoint: (x: number, y: number) => [x, HEIGHT - y] },
  items,
  fontNames: { F1: 'Times-Roman', MATH: 'CMMI10' },
})

/** Justified body text: 10pt on a 12pt leading. */
const prose = (text: string, x: number, baseline: number): Piece[] => [run(text, x, baseline)]

describe('buildDocumentParagraphs', () => {
  it('merges a numbered contribution list into one translation unit', () => {
    const paragraphs = buildDocumentParagraphs([page([
      ...prose('In this paper we study latent visual reasoning and make three contributions that', 60, 100),
      ...prose('we summarise as follows:', 60, 112),
      ...prose('1. We recast latent-state reliance as a causal path-design problem,', 60, 130),
      ...prose('distinguishing informativeness from necessity.', 78, 142),
      ...prose('2. We introduce CVRR, which preserves pretrained competence.', 60, 160),
      ...prose('3. We show through ablations that CVRR refines predictions.', 60, 178),
    ])])
    const contributions = paragraphs.filter((paragraph) => paragraph.text.startsWith('1. We recast'))
    expect(contributions).toHaveLength(1)
    const items = contributions[0].text.split('\n')
    expect(items).toHaveLength(3)
    expect(items[0]).toContain('distinguishing informativeness from necessity.')
    expect(items[1]).toMatch(/^2\./)
    expect(items[2]).toMatch(/^3\./)
  })

  it('drops citation superscripts from the reading text', () => {
    const paragraphs = buildDocumentParagraphs([page([
      ...prose('Recent work extends this idea to visual inputs through latent tokens', 60, 100),
      run('CVRR', 60, 112), run('1', 82, 109.5, 7), run('preserves the pretrained competence of the model', 88, 112),
    ])])
    expect(paragraphs).toHaveLength(1)
    expect(paragraphs[0].text).toContain('CVRR preserves')
    expect(paragraphs[0].text).not.toContain('CVRR1')
  })

  it('keeps a superscript that belongs to an inline formula', () => {
    const paragraphs = buildDocumentParagraphs([page([
      ...prose('The energy of the system is written as follows in the paper', 60, 100),
      run('x', 60, 112, 10, 'MATH'), run('2', 66, 109.5, 7, 'MATH'), ...prose('for every observed sample of the dataset', 72, 112),
    ])])
    expect(paragraphs).toHaveLength(1)
    expect(paragraphs[0].text).toContain('2')
  })

  it('does not turn a lone cell fragment into a paragraph', () => {
    const paragraphs = buildDocumentParagraphs([page([
      ...prose('The benchmark compares several systems on the same evaluation split', 60, 100),
      ...prose('and reports every metric in the appendix of this paper.', 60, 112),
      ...prose('MME', 60, 200),
    ])])
    expect(paragraphs).toHaveLength(1)
    expect(paragraphs[0].text).not.toContain('MME')
  })

  it('continues a paragraph broken by the page edge', () => {
    const paragraphs = buildDocumentParagraphs([
      page([
        ...prose('We study how latent computation is actually used for prediction and', 60, 700),
        ...prose('the next question is whether this still holds when the', 60, 712),
      ], 1),
      page([...prose('tiveness from latent computation that is actually used for prediction.', 60, 100)], 2),
    ])
    expect(paragraphs).toHaveLength(1)
    expect(paragraphs[0].parts.map((part) => part.page)).toEqual([1, 2])
    expect(paragraphs[0].text).toContain('the tiveness from latent computation')
  })

  it('starts a new paragraph when a heading opens the next page', () => {
    const paragraphs = buildDocumentParagraphs([
      page([
        ...prose('We study how latent computation is actually used for prediction and', 60, 700),
        ...prose('the next question is whether this still holds when the', 60, 712),
      ], 1),
      page([
        ...prose('3 EXPERIMENTS', 60, 80),
        ...prose('tiveness from latent computation that is actually used for prediction.', 60, 100),
      ], 2),
    ])
    expect(paragraphs).toHaveLength(2)
    expect(paragraphs[1].parts[0].page).toBe(2)
  })
})
