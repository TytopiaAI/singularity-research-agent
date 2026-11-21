import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(__dirname, '..')
const css = fs.readFileSync(path.join(root, 'src/renderer/research-minimal.css'), 'utf8')
const action = fs.readFileSync(path.join(root, 'src/renderer/ResearchAction.tsx'), 'utf8')

describe('discovery action spacing', () => {
  it('keeps the refresh button clear of the field document above and the card below', () => {
    expect(css).toMatch(/\.digest-page \.discovery-sections\s*\{[^}]*margin-top:\s*\d+px/)
    expect(css).toMatch(/\.digest-page \.discovery-section > \.discovery-heading\s*\{[^}]*margin-bottom:\s*\d+px/)
  })

  it('leaves the dark tooltip and the rest of the layout as they were', () => {
    expect(css).not.toMatch(/discovery-sections\s*\{[^}]*border-top/)
    expect(css).not.toMatch(/discovery-heading > div\s*\{[^}]*z-index/)
    expect(action).toMatch(/top:Math\.min\(y\+9/)
    expect(action).not.toMatch(/tooltipPosition/)
  })
})
