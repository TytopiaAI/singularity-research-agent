import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { AcademicText } from '../src/renderer/AcademicText'
import { academicTextParts, canReuseAcademicTranslation, protectAcademicScripts } from '../src/shared/academic-text'

describe('safe academic inline formatting', () => {
  it('renders citation superscripts and math subscripts while escaping untrusted markup', () => {
    const html = renderToStaticMarkup(createElement(AcademicText, { text: '证据<sup>[12, 14]</sup> h<sub>t</sub><img src=x onerror=alert(1)>' }))
    expect(html).toContain('<sup>[12, 14]</sup>')
    expect(html).toContain('<sub>t</sub>')
    expect(html).toContain('&lt;img')
    expect(html).not.toContain('<img')
  })
  it('accepts plain cached text and avoids placeholder collisions with paper content', () => {
    expect(academicTextParts('普通段落 [1]')).toEqual([{ text: '普通段落 [1]' }])
    const protectedText = protectAcademicScripts('⟦PDF_SCRIPT_0⟧ is text<sup>3</sup>')
    expect(protectedText.spans[0].token).toBe('⟦PDF_SCRIPT__0⟧')
    expect(protectedText.text).toContain('⟦PDF_SCRIPT_0⟧ is text⟦PDF_SCRIPT__0⟧')
  })
  it('does not reuse flattened citations as ordinary numeric text when upgrading old translations', () => {
    expect(canReuseAcademicTranslation('Method<sup>2</sup> evaluates 20 pairs.', '方法2评估20对。')).toBe(false)
    expect(canReuseAcademicTranslation('Method<sup>2</sup> evaluates 20 pairs.', '方法<sup>2</sup>评估20对。')).toBe(true)
    expect(canReuseAcademicTranslation('Our method evaluates 20 pairs.', '我们的方法评估20对。')).toBe(true)
    expect(canReuseAcademicTranslation('Use $h_{t-1}$ and $M_{x^{\\prime}}$.', '使用ht-1和Mx。')).toBe(false)
    expect(canReuseAcademicTranslation('Use $h_{t-1}$.', '使用 $h_{t-1}$。')).toBe(true)
  })
  it('renders complete inline mathematics with real subscripts and protects it as one unit', () => {
    const source=String.raw`Use $h_{t-1}$ and $\frac{m_i(\ell)}{m_i(0)}$.`
    const value=protectAcademicScripts(source)
    expect(value.spans).toHaveLength(2);expect(value.text).toBe('Use ⟦PDF_MATH_0⟧ and ⟦PDF_MATH_1⟧.')
    const html=renderToStaticMarkup(createElement(AcademicText,{text:String.raw`状态 $h_{t-1}$ 和 $M_{x^{\prime}}$。`}))
    expect(html).toContain('class="katex"');expect(html).toContain('<msub>');expect(html).toContain('状态')
  })
})
