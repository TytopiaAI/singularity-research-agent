// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanSelectedText, readPdfSelection, stitchSelections } from '../src/renderer/reader-selection'

afterEach(() => { document.body.replaceChildren(); window.getSelection()?.removeAllRanges(); vi.restoreAllMocks() })
describe('PDF text selection', () => {
  it('extracts partial boundaries across pages without labels or full-sheet rectangles', () => {
    document.body.innerHTML = '<div id="reader"><div class="continuous-page-frame" data-page="1"><div>1 / 2</div><div class="pdf-sheet"><div class="textLayer"><span>First selected words</span></div></div></div><div class="continuous-page-frame" data-page="2"><div>2 / 2</div><div class="pdf-sheet"><div class="textLayer"><span>Second selected words</span></div></div></div></div>'
    const root = document.getElementById('reader')!, sheets = [...root.querySelectorAll<HTMLElement>('.pdf-sheet')]
    sheets.forEach((sheet, index) => vi.spyOn(sheet, 'getBoundingClientRect').mockReturnValue(new DOMRect(0,index*850,600,800)))
    Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: function(this: Range) {
      const second = sheets[1].contains(this.startContainer)
      return [new DOMRect(60+this.startOffset*5, (second?850:0)+100, (this.endOffset-this.startOffset)*5, 12)]
    } })
    const nodes = [...root.querySelectorAll('.textLayer span')].map((span) => span.firstChild!)
    const range = document.createRange(); range.setStart(nodes[0],6); range.setEnd(nodes[1],6)
    window.getSelection()!.addRange(range)
    const selected = readPdfSelection(root)!
    expect(selected.text).toBe('selected words Second')
    expect(selected.segments?.map((part) => part.page)).toEqual([1,2])
    expect(selected.segments?.every((part) => part.rects.length === 1 && part.rects[0].width < .2)).toBe(true)
    expect(selected.text).not.toContain('/ 2')
  })
  it('joins line-break hyphenation and retains all page anchors in manually stitched selections', () => {
    expect(cleanSelectedText('These multi-\nmodal models\nare reliable.')).toBe('These multimodal models are reliable.')
    const rect = { x: .1, y: .2, width: .3, height: .04 }
    const combined = stitchSelections([{ page: 1, text: 'These multi-', rects: [rect] }, { page: 2, text: 'modal models are reliable.', rects: [rect] }])!
    expect(combined.text).toBe('These multimodal models are reliable.')
    expect(combined.segments?.map((part) => part.page)).toEqual([1,2])
    expect(stitchSelections([])).toBeNull()
  })
  it('rejects oversized stitched text instead of silently truncating it', () => {
    expect(() => stitchSelections([{ page: 1, text: 'x'.repeat(20001), rects: [] }])).toThrow('20,000')
  })
})
