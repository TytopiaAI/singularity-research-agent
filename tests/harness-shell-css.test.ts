import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(__dirname, '..')
const source = fs.readFileSync(path.join(root, 'src/main/main.ts'), 'utf8')
const start = source.indexOf('const singularityHarnessCss = String.raw`')
const css = source.slice(source.indexOf('`', start) + 1, source.indexOf('`', source.indexOf('`', start) + 1))

describe('assistant pane shell', () => {
  it('never overrides Harness\'s own inline column grid', () => {
    expect(start).toBeGreaterThanOrEqual(0)
    expect(css).toMatch(/\.pI_x6G_frame\s*\{[^}]*display:\s*block\s*!important/)
    expect(css).not.toMatch(/\.pI_x6G_frame[^{]*\{[^}]*grid-template-columns/)
    expect(css).not.toMatch(/:\s*(268|224|56)px\s+minmax\(/)
    expect(css).toMatch(/\.pI_x6G_centerCol\s*\{[^}]*width:\s*100%\s*!important/)
  })

  it('places history vertically at the inner left edge with a subtle theme shade', () => {
    expect(css).toMatch(/--sg-sidebar-width:\s*248px/)
    expect(css).toMatch(/--sg-sidebar-shade:\s*rgba\(0, 0, 0, \.03\)/)
    expect(css).toMatch(/\.pI_x6G_sidebarCol\s*\{[^}]*position:\s*absolute\s*!important/)
    expect(css).toMatch(/\.pI_x6G_sidebarCol\s*\{[^}]*inset:\s*0 auto 0 0\s*!important/)
    expect(css).toMatch(/\.pI_x6G_sidebarCol\s*\{[^}]*background:\s*var\(--sg-sidebar-shade\)/)
    expect(css).toMatch(/\.hHd-Xa_root[^{]*\{[^}]*flex-direction:\s*column\s*!important/)
    expect(css).not.toContain('--sg-dock-height')
  })

  it('reclaims the sidebar width when hidden and keeps the upper-left control', () => {
    expect(css).toMatch(/body:not\(\[data-singularity-rail-collapsed\]\)\s+\.pI_x6G_centerCol\s*\{[^}]*margin-left:\s*var\(--sg-sidebar-width\)/)
    expect(css).toMatch(/body\[data-singularity-rail-collapsed\]\s+\.pI_x6G_sidebarCol\s*\{\s*display:\s*none/)
    expect(css).toMatch(/body\[data-singularity-rail-collapsed\]\s+\.pI_x6G_centerCol\s*\{\s*margin-left:\s*0/)
    expect(css).toMatch(/#singularity-rail-toggle\s*\{[^}]*position:\s*fixed;\s*left:\s*14px;\s*top:\s*14px/)
  })

  it('keeps the theme-coloured bottom surfaces and balanced braces', () => {
    expect(css).toMatch(/\.pI_x6G_bottomRow\s*\{\s*grid-column:\s*auto\s*!important;\s*background:\s*var\(--sg-surface\)/)
    expect(css).toMatch(/html\[data-singularity-chat-theme="transparent"\][\s\S]{0,500}backdrop-filter/)
    let depth = 0
    for (const ch of css) {
      if (ch === '{') depth++
      else if (ch === '}') depth--
      expect(depth).toBeGreaterThanOrEqual(0)
    }
    expect(depth).toBe(0)
  })
})
