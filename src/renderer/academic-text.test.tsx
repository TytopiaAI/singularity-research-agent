// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ReadableAcademicText } from './AcademicText'

let host: HTMLDivElement, root: Root

beforeEach(() => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('ReadableAcademicText', () => {
  it('sets $…$ fragments as mathematics instead of leaving TeX in the text', () => {
    act(() => root.render(<ReadableAcademicText text={'重建损失为 $\\ell_2(x,\\hat{x})$ 的均值。'}/>))
    expect(host.querySelector('.katex')).not.toBeNull()
    expect(host.textContent).toContain('的均值')
    // The visible layer shows symbols; the TeX only survives in the MathML annotation.
    expect(host.querySelector('.katex-html')?.textContent ?? '').not.toContain('\\ell')
  })

  it('keeps a formula the model wrote without delimiters readable', () => {
    act(() => root.render(<ReadableAcademicText text={'其中 \\frac{a}{b} 表示比例。'}/>))
    expect(host.textContent).toContain('(a)/(b)')
    act(() => root.render(<ReadableAcademicText text={'损失为 $\\frac{a}{b}$ 的比例。'}/>))
    expect(host.querySelector('.katex')).not.toBeNull()
  })

  it('renders a display formula block from a paragraph unit', () => {
    act(() => root.render(<ReadableAcademicText text={'$q\\cdot k$ 之后：\n$$\\mathrm{softmax}(qk)$$'}/>))
    expect(host.querySelectorAll('.katex').length).toBe(2)
    expect(host.textContent).toContain('之后')
  })
})
