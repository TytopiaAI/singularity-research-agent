import { describe, expect, it } from 'vitest'
import { pdfMathTex, type MathGlyph } from '../src/shared/pdf-math'
import { visualRegions } from '../src/main/pdf-visual-regions'
const glyph = (text: string, left: number, baseline: number, size = 10, width = 5, font = 'CMMI10'): MathGlyph => ({ text, left, right: left + width, baseline, size, top: baseline-size*.82, bottom:baseline+size*.14, font })
describe('source-grounded mathematical geometry', () => {
  it('reconstructs multi-glyph subscripts and simultaneous primes without flattening them', () => {
    expect(pdfMathTex([glyph('h',10,100),glyph('t',15,102,7,3),glyph('−',18,102,7,4),glyph('1',22,102,7,3)])).toBe('h_{t-1}')
    expect(pdfMathTex([glyph('M',10,100),glyph('x',15,102,7,3),glyph('′',18,100,5,2)])).toBe('M_{x^{\\prime }}')
  })
  it('keeps fraction denominators, including parenthesized zero, as source mathematics', () => {
    const tex=pdfMathTex([glyph('m',10,90),glyph('i',15,91.5,7,3),glyph('(ℓ)',19,90,10,12),glyph('m',10,105),glyph('i',15,106.5,7,3),glyph('(0)',19,105,10,12)],[{left:10,right:31,y:95}])
    expect(tex.replace(/\s/g,'')).toBe('\\frac{m_{i}(\\ell)}{m_{i}(0)}')
  })
  it('joins adjacent vector-chart panels while leaving a later side figure separate', () => {
    const regions=visualRegions([{x:.17,y:.1,width:.31,height:.16},{x:.51,y:.1,width:.31,height:.16},{x:.5,y:.68,width:.32,height:.16}])
    expect(regions).toHaveLength(2);expect(regions[0].width).toBeCloseTo(.65)
  })
})
