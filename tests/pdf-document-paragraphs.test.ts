import { describe, expect, it } from 'vitest'
import { buildDocumentParagraphs, paragraphsOnPage, pdfVisualLines, readingOrder, type PdfPageText } from '../src/renderer/pdf-document-paragraphs'

const width = 612
const height = 792

function page(pageNumber: number, rows: Array<[string, number, number]>, scale = 1): PdfPageText {
  return {
    pageNumber,
    viewport: {
      width: width * scale,
      height: height * scale,
      convertToViewportPoint: (x, y) => [x * scale, (height - y) * scale],
    },
    items: rows.map(([str, x, y]) => ({
      str, width: Math.min(485, str.length * 5.3), height: 10,
      transform: [10, 0, 0, 10, x, height - y],
    })),
  }
}

const first = [
  ['A Paper Title', 80, 72], ['First Author, Second Author', 80, 90],
  ['ABSTRACT', 250, 125],
  ['Abstract starts and includes a full description of the method', 80, 155],
  ['and its experiments, with a larger gap inside the abstract.', 80, 177],
  ['1 INTRODUCTION', 80, 230],
  ['Latent visual reasoning starts the first natural paragraph', 80, 255],
  ['and ends here with multi-step inference.', 80, 267],
  ['However, the next paragraph starts late on this page', 80, 650],
  ['and its thought has not ended because we seek to', 80, 662],
] as Array<[string, number, number]>

const second = [
  ['not simply make states informative, but improve prediction', 80, 100],
  ['without sacrificing competence formed by pretraining.', 80, 112],
  ['2 METHOD', 80, 175],
  ['Our contributions are:', 80, 225],
  ['1. We identify the causal path needed for reliable prediction.', 90, 255],
  ['2. We propose a recurrent mechanism for visual refinement.', 90, 275],
  ['3. We test the mechanism on multiple benchmarks.', 90, 295],
  ['REFERENCES', 80, 420],
  ['[1] This citation must not be a translation target.', 80, 445],
] as Array<[string, number, number]>

describe('PDF-coordinate paragraph targets', () => {
  it('keeps bottom-of-page captions and prose while removing centered footer numbers', () => {
    const input=page(2,[['Figure 1: Caption begins here.',80,700],['The pretrained model is evaluated before adaptation.',80,735],['2',303,760]])
    const lines=pdfVisualLines(input)
    expect(lines.some(line=>line.text.includes('before adaptation'))).toBe(true)
    expect(lines.some(line=>line.text==='2')).toBe(false)
  })
  it('attaches raised numeric citations to their sentence and preserves their script geometry', () => {
    const input = page(1, [['Previous studies', 80, 150], ['support our method.', 185, 150]])
    input.items.push({ str: '12', width: 8, height: 6.8, transform: [6.8, 0, 0, 6.8, 165, 792 - 146] })
    const lines = pdfVisualLines(input)
    expect(lines).toHaveLength(1)
    expect(lines[0].formattedText).toContain('studies<sup>12</sup>')
    expect(lines[0].text).not.toContain('<sup>')
  })
  it('reads real two-column prose left-to-right and preserves full-width section boundaries', () => {
    const input = page(2, [['Full-width section heading across two columns', 72, 90],
      ['Left column describes the method.', 72, 120], ['Left column continues the argument.', 72, 132], ['Left column concludes the argument.', 72, 144],
      ['Right column provides the evidence.', 325, 120], ['Right column continues the evidence.', 325, 132], ['Right column concludes the evidence.', 325, 144],
      ['Second full-width heading across two columns', 72, 200], ['Following section starts here.', 72, 230]])
    input.items[0].width = 460; input.items[7].width = 460
    const text = readingOrder(pdfVisualLines(input), width).map((line) => line.text)
    expect(text.slice(1, 4).every((line) => line.startsWith('Left'))).toBe(true)
    expect(text.slice(4, 7).every((line) => line.startsWith('Right'))).toBe(true)
    expect(text[7]).toContain('Second full-width')
  })
  it('skips title and authors, keeps the abstract whole and joins a paragraph across pages', () => {
    const paragraphs = buildDocumentParagraphs([page(1, first), page(2, second)])
    expect(paragraphs.some((p) => /Paper Title|First Author|citation must not/.test(p.text))).toBe(false)
    expect(paragraphs[0].text).toContain('larger gap inside the abstract')
    expect(paragraphs[1].text).toContain('multi-step inference.')
    const crossPage = paragraphs.find((p) => p.text.startsWith('However,'))!
    expect(crossPage.parts.map((part) => part.page)).toEqual([1, 2])
    expect(crossPage.text).toContain('formed by pretraining.')
    expect(paragraphsOnPage(paragraphs, 2).find((p) => p.id === crossPage.id)?.text).toBe(crossPage.text)
  })

  it('groups all three contribution bullets into one translation target', () => {
    const paragraphs = buildDocumentParagraphs([page(1, first), page(2, second)])
    const contributions = paragraphs.filter((p) => p.text.startsWith('1. We identify'))
    expect(contributions).toHaveLength(1)
    expect(contributions[0].text).toContain('2. We propose')
    expect(contributions[0].text).toContain('3. We test')
  })

  it('projects every supported zoom step from the same PDF coordinates', () => {
    const canonical = buildDocumentParagraphs([page(1, first), page(2, second)])
    const rects = canonical.flatMap((paragraph) => paragraph.parts.flatMap((part) => part.rects))
    for (let step = 4; step <= 25; step++) {
      const scale = step / 10
      const scaled = buildDocumentParagraphs([page(1, first, scale), page(2, second, scale)])
      expect(scaled.map((paragraph) => paragraph.text)).toEqual(canonical.map((paragraph) => paragraph.text))
      const scaledRects = scaled.flatMap((paragraph) => paragraph.parts.flatMap((part) => part.rects))
      for (const [index, rect] of rects.entries()) {
        const atScale = scaledRects[index]
        expect(rect.x * width * scale).toBeCloseTo(atScale.x * width * scale, 8)
        expect(rect.y * height * scale).toBeCloseTo(atScale.y * height * scale, 8)
        expect(rect.width * width * scale).toBeCloseTo(atScale.width * width * scale, 8)
        expect(rect.height * height * scale).toBeCloseTo(atScale.height * height * scale, 8)
      }
    }
    const line = rects[0]
    expect(line.width).toBeLessThan(.85)
    expect(line.x + line.width).toBeLessThan(1)
  })

  // Regression geometry from real papers: wrapped figures, near-touching columns, proofs and IEEE indents.
  const sized = (pageNumber: number, rows: Array<[string, number, number, number]>, extra: Partial<PdfPageText> = {}): PdfPageText => ({
    ...page(pageNumber, []), ...extra,
    items: rows.map(([str, x, y, w]) => ({ str, width: w, height: 10, transform: [10, 0, 0, 10, x, height - y] })),
  })
  it('keeps a caption beside wrapped prose out of the paragraph and drops text inside the figure', () => {
    const rows: Array<[string, number, number, number]> = [
      ['A further alternative explanation remains. Replacing', 108, 300, 188], ['hT across examples changes both image-conditioned', 108, 311, 188],
      ['80', 330, 305, 8], ['73.3', 360, 300, 14], ['Clean', 340, 380, 18],
      ['content, so we use MMVP pairs with the same question.', 108, 322, 188],
      ['As shown in Figure 4, clean accuracy is 73.3%,', 108, 400, 188], ['Figure 4: Same-question MMVP intervention', 306, 409, 198],
      ['while whole-state and same-question replace-', 108, 411, 188], ['with a fixed question and text-only anchor.', 306, 420, 170],
      ['ment reduce it to 23.6% and 26.7%. Similar', 108, 422, 188],
      ['question disruption as the primary explanation. The text-only anchor reaches 50.0%, above', 108, 433, 396],
    ]
    const input = sized(8, rows, { visualRects: [{ x: .5, y: (292 - 8) / height, width: .32, height: (385 - 292) / height }] })
    const paragraphs = buildDocumentParagraphs([input])
    expect(paragraphs.some((p) => /80|73\.3 |Clean/.test(p.text.split('accuracy is')[0]))).toBe(false)
    expect(paragraphs.some((p) => p.text.includes('Figure 4:') || p.text.includes('fixed question and text-only'))).toBe(false)
    const shown = paragraphs.find((p) => p.text.startsWith('As shown in Figure 4'))!
    expect(shown.text).toContain('replace-ment reduce it to 23.6%')
    expect(shown.text).toContain('The text-only anchor reaches 50.0%')
  })
  it('splits two-column rows at the gutter even when the columns nearly touch', () => {
    const rows: Array<[string, number, number, number]> = []
    for (let line = 0; line < 24; line++) {
      rows.push([`left column sentence number ${line} continues the method description`, 49, 100 + line * 12, 251])
      rows.push([`right column sentence number ${line} reports the experiment results`, 312, 100 + line * 12, 251])
    }
    const lines = pdfVisualLines(sized(4, rows))
    expect(lines.every((line) => line.rect.right <= 301 || line.rect.left >= 311)).toBe(true)
    const [left, right] = buildDocumentParagraphs([sized(4, rows)])
    expect(left.text).not.toContain('right column')
    expect(right.text).not.toContain('left column')
  })
  it('removes proof line numbers printed in the margin', () => {
    const rows: Array<[string, number, number, number]> = []
    for (let line = 0; line < 16; line++) rows.push([String(line + 2), 8, 100 + line * 12, 5], [`body text line ${line} of a proof copy with numbered lines`, 49, 100 + line * 12, 251])
    const [paragraph] = buildDocumentParagraphs([sized(3, rows)])
    expect(paragraph.text).not.toMatch(/(?:2|3|17)\s+body/)
    expect(paragraph.text).toContain('body text line 0')
  })
  it('starts a new paragraph at an IEEE first-line indent without paragraph spacing', () => {
    const rows: Array<[string, number, number, number]> = [
      ['The first paragraph explains the setting in detail and', 59, 100, 241], ['continues on a second full line of the column text.', 49, 112, 251],
      ['It ends with a long final line that fills most width.', 49, 124, 240],
      ['The second paragraph begins with an indent of one em', 59, 136, 241], ['and keeps going on the next line of this column here.', 49, 148, 251],
    ]
    const paragraphs = buildDocumentParagraphs([sized(3, rows)])
    expect(paragraphs.map((p) => p.text.slice(0, 20))).toEqual(['The first paragraph ', 'The second paragraph'])
  })
})
