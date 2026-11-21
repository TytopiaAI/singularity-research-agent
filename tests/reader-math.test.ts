import { describe, expect, it } from 'vitest'
import { readableMath } from '../src/renderer/readable-math'

describe('readable mathematics in paragraph cards',()=>{
 it('turns common provider TeX fragments into readable symbols',()=>{
  expect(readableMath(String.raw`$E=mc^2$; \frac{a}{b} \times \sqrt{x} \leq \alpha`))
    .toContain('E=mc²')
  expect(readableMath(String.raw`\frac{a}{b} \times \sqrt{x} \leq \alpha`))
    .toBe('(a)/(b) × √(x) ≤ α')
 })
})
