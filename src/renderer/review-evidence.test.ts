// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest'
import type { PaperReview } from '../shared/types'
import { locateEvidenceQuotes, locateReviewEvidence } from './review-evidence'
import { reviewColors } from './review-colors'

afterEach(() => { delete (Range.prototype as { getClientRects?: () => DOMRectList }).getClientRects; vi.restoreAllMocks() })

test('eleven summary angles have distinct pastel colors and innovation uses warm yellow', () => {
  expect(Object.keys(reviewColors)).toHaveLength(11)
  expect(new Set(Object.values(reviewColors).map((color) => color.tint)).size).toBe(11)
  expect(reviewColors.innovation.tint).toBe('#FFF5E1')
})

test('PDF highlights are created only for quotes actually located in the text layer', () => {
  const sheet = document.createElement('div')
  const layer = document.createElement('div')
  layer.append(document.createTextNode('The model has a limitation. This is the key contribution.'))
  sheet.append(layer)
  vi.spyOn(sheet, 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ x: 0, y: 0, width: 200, height: 100 }))
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [DOMRect.fromRect({ x: 20, y: 30, width: 80, height: 10 })] })
  const review: PaperReview = { version: 1, sections: [
    { key: 'innovation', body: '关键贡献', evidence: [{ page: 1, quote: 'This is the key contribution.' }] },
    { key: 'future', body: '未来想象力', evidence: [{ page: 1, quote: 'The model has a limitation.' }] },
    { key: 'dataset', body: '数据集分析', evidence: [{ page: 1, quote: 'Not present in the PDF.' }] },
  ] }
  expect(locateReviewEvidence(layer, sheet, review, 1)).toEqual([
    expect.objectContaining({ key: 'innovation', x: .1, y: .3, width: .4, height: .1 }),
    expect.objectContaining({ key: 'future', x: .1, y: .3, width: .4, height: .1 }),
  ])
  expect(locateReviewEvidence(layer, sheet, review, 2)).toEqual([])
  expect(locateEvidenceQuotes(layer, sheet, [{ key: 'answer-1', index: 0, page: 1, quote: 'The model has a limitation.' }], 1))
    .toEqual([expect.objectContaining({ key: 'answer-1', index: 0, x: .1, y: .3 })])
})

test('evidence across PDF text spans uses clipped text fragments instead of a cross-span line box', () => {
  const sheet = document.createElement('div')
  const layer = document.createElement('div')
  const first = document.createTextNode('This is the key')
  const second = document.createTextNode(' contribution.')
  const firstSpan = document.createElement('span')
  const secondSpan = document.createElement('span')
  firstSpan.append(first)
  secondSpan.append(second)
  layer.append(firstSpan, secondSpan)
  sheet.append(layer)
  vi.spyOn(sheet, 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ x: 0, y: 0, width: 200, height: 100 }))
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: function (this: Range) {
    if (this.startContainer !== this.endContainer) return [DOMRect.fromRect({ x: 0, y: 0, width: 300, height: 80 })]
    return [this.startContainer === first
      ? DOMRect.fromRect({ x: 20, y: 30, width: 80, height: 10 })
      : DOMRect.fromRect({ x: 120, y: 30, width: 120, height: 10 })]
  } })
  expect(locateEvidenceQuotes(layer, sheet, [{ key: 'innovation', index: 0, page: 1, quote: 'This is the key contribution.' }], 1)).toEqual([
    expect.objectContaining({ x: .1, y: .3, width: .4, height: .1 }),
    expect.objectContaining({ x: .6, y: .3, width: .4, height: .1 }),
  ])
})
