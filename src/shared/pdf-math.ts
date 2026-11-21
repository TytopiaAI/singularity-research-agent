export interface MathGlyph { text: string; left: number; right: number; top: number; bottom: number; baseline: number; size: number; font: string }
export interface MathRule { left: number; right: number; y: number }
const symbols: Record<string, string> = { '−': '-', '∗': '*', '′': '\\prime ', 'ℓ': '\\ell ', 'ϕ': '\\phi ', 'φ': '\\phi ', 'β': '\\beta ', 'α': '\\alpha ', 'θ': '\\theta ', 'π': '\\pi ', 'σ': '\\sigma ', '∈': '\\in ', '≤': '\\leq ', '≥': '\\geq ', '←': '\\leftarrow ', '→': '\\rightarrow ', '∑': '\\sum ', '∏': '\\prod ', '∫': '\\int ', '∞': '\\infty ', '×': '\\times ', '·': '\\cdot ', '≈': '\\approx ', '∣': '|', '{': '\\{', '}': '\\}', '%': '\\%', '#': '\\#', '&': '\\&', '$': '\\$' }
/** Characters that only occur in typeset mathematics, whatever the font. */
const mathGlyph = /[=∑∏∫∮≤≥∈≈±×÷−∗∞∂∇√≠≪≫→←↔⟨⟩⊥⊤⊢⊨]/
// CMR is Computer Modern *roman*: it sets body text in LaTeX-native papers, so
// matching it turns every word into a formula. Only the symbol and italic
// families (CMMI, CMSY, CMEX) actually mark mathematics.
export const isMathFont = (font: string, text: string): boolean => /CMMI|CMSY|CMEX|CMBSY|CMMIB|MSAM|MSBM|EUSM|EUFM|RSFS|STIX|Math|Symbol/i.test(font) || text.trim().length <= 4 && mathGlyph.test(text) || text.length === 1 && /Italic|Ital$/i.test(font)
function glyphTex(glyph: MathGlyph): string {
  if (/CMEX/.test(glyph.font)) {
    const extensions: Record<string, string> = { h: '\\bigl[', i: '\\bigr]', X: '\\sum ', Y: '\\prod ', Z: '\\int ', b: '\\widehat', e: '\\widetilde' }
    if (extensions[glyph.text]) return extensions[glyph.text]
  }
  const text = [...glyph.text].map((character) => symbols[character] ?? (/CMSY/.test(glyph.font) && /[A-Z]/.test(character) ? `\\mathcal{${character}}` : character)).join('')
  return /^[A-Za-z]{3,}$/.test(text) ? `\\mathrm{${text}}` : text
}
interface Atom extends MathGlyph { tex: string; sub: Atom[]; sup: Atom[]; parent?: Atom }

/** Rebuild scripts/fractions from PDF coordinates, without asking a model to invent mathematics. */
export function pdfMathTex(glyphs: MathGlyph[], rules: MathRule[] = []): string {
  if (!glyphs.length) return ''
  const atoms: Atom[] = glyphs.map((glyph) => ({ ...glyph, tex: glyphTex(glyph), sub: [], sup: [],
    baseline: glyph.baseline + (/CMEX/.test(glyph.font) && /^[hiXY]$/.test(glyph.text) ? glyph.size * (/[XY]/.test(glyph.text) ? .95 : 1.11) : 0) }))
  const mainSize = Math.max(...atoms.filter((atom) => !/CMEX/.test(atom.font)).map((atom) => atom.size), 1)
  for (const rule of [...rules].sort((a, b) => a.right - a.left - (b.right - b.left))) {
    const inside = atoms.filter((atom) => (atom.left + atom.right) / 2 >= rule.left - .8 && (atom.left + atom.right) / 2 <= rule.right + .8 && Math.abs(atom.baseline - rule.y) < mainSize * 1.8)
    const numerator = inside.filter((atom) => atom.baseline < rule.y - .4), denominator = inside.filter((atom) => atom.baseline > rule.y + .4)
    if (!numerator.length || !denominator.length) continue
    const fraction: Atom = { text: '', tex: `\\frac{${scriptedTex(numerator)}}{${scriptedTex(denominator)}}`, left: rule.left, right: rule.right,
      top: Math.min(...inside.map((atom) => atom.top)), bottom: Math.max(...inside.map((atom) => atom.bottom)), baseline: rule.y + mainSize * .25, size: mainSize, font: '', sub: [], sup: [] }
    for (const atom of inside) atoms.splice(atoms.indexOf(atom), 1)
    atoms.push(fraction)
  }
  // CMEX accent glyphs overlap their base rather than occupying another column.
  for (const accent of atoms.filter((atom) => /^\\wide(?:hat|tilde)$/.test(atom.tex))) {
    const base = atoms.find((atom) => atom !== accent && atom.left < accent.right && atom.right > accent.left && Math.abs(atom.baseline - accent.baseline) < mainSize * .4)
    if (base) { base.tex = `${accent.tex}{${base.tex}}`; atoms.splice(atoms.indexOf(accent), 1) }
  }
  for (const operator of atoms.filter((atom) => /\\(?:sum|prod|int)\s*$/.test(atom.tex))) {
    const limits = atoms.filter((atom) => atom !== operator && atom.size < operator.size * .85 && atom.left >= operator.left - operator.size * .6 && atom.right <= operator.right + operator.size * 1.2 && atom.baseline > operator.baseline + operator.size * .65 && atom.baseline < operator.baseline + operator.size * 2.1)
    if (limits.length) { operator.tex += `_{${scriptedTex(limits)}}`; for (const atom of limits) atoms.splice(atoms.indexOf(atom), 1) }
  }
  return scriptedTex(atoms)
}

function scriptedTex(atoms: Atom[]): string {
  // Adjacent glyphs in the same small-font script (t−1, txt,i, …) form one unit.
  const largest = Math.max(...atoms.map((atom) => atom.size), 1)
  for (const atom of [...atoms].sort((a,b) => a.left-b.left)) {
    if (!atoms.includes(atom) || atom.size >= largest * .88) continue
    for (;;) {
      const next = atoms.find((candidate) => candidate !== atom && Math.abs(candidate.size - atom.size) < .5 && Math.abs(candidate.baseline - atom.baseline) < atom.size * .25 && candidate.left >= atom.right - .4 && candidate.left - atom.right < atom.size * .65)
      if (!next) break
      atom.tex += next.tex; atom.right = next.right; atoms.splice(atoms.indexOf(next), 1)
    }
  }
  for (const atom of [...atoms].sort((a, b) => a.size - b.size)) {
    const candidates = atoms.filter((base) => base !== atom && base.size > atom.size * 1.16 &&
      atom.left >= base.left + (base.right - base.left) * .4 && atom.left - base.right > -base.size * .45 && atom.left - base.right < base.size * .9 &&
      Math.abs(atom.baseline - base.baseline) > base.size * .09 && Math.abs(atom.baseline - base.baseline) < base.size * .9)
    const base = candidates.sort((a, b) => Math.abs(atom.left - a.right) + Math.abs(atom.baseline - a.baseline) - Math.abs(atom.left - b.right) - Math.abs(atom.baseline - b.baseline))[0]
    if (base) { atom.parent = base; (atom.baseline < base.baseline ? base.sup : base.sub).push(atom) }
  }
  const render = (atom: Atom): string => atom.tex + (atom.sub.length ? `_{${atom.sub.sort((a,b) => a.left-b.left).map(render).join('')}}` : '') + (atom.sup.length ? `^{${atom.sup.sort((a,b) => a.left-b.left).map(render).join('')}}` : '')
  const roots = atoms.filter((atom) => !atom.parent).sort((a, b) => a.baseline - b.baseline || a.left - b.left)
  const rows: Atom[][] = []
  for (const atom of roots) {
    const row = rows.find((items) => Math.abs(items[0].baseline - atom.baseline) < Math.max(items[0].size, atom.size) * .4)
    if (row) row.push(atom); else rows.push([atom])
  }
  const text = rows.map((row) => row.sort((a,b) => a.left-b.left).map(render).join(' '))
  return text.length > 1 ? `\\begin{gathered}${text.join(' \\\\ ')}\\end{gathered}` : text[0] ?? ''
}

export function inlinePdfMath(glyphs: MathGlyph[], fallback: (glyph: MathGlyph, previous?: MathGlyph) => string): string {
  let text = '', run: MathGlyph[] = []
  let previous: MathGlyph | undefined
  const flush = () => { if (run.length) { text += `$${pdfMathTex(run)}$`; run = [] } }
  for (const glyph of glyphs) {
    const math = isMathFont(glyph.font, glyph.text)
    if (math && (!run.length || glyph.left - run.at(-1)!.right < glyph.size * 1.5)) {
      if (!run.length && previous && glyph.left - previous.right > glyph.size * .15) text += ' '
      run.push(glyph)
    } else { flush(); text += fallback(glyph, previous) }
    previous = glyph
  }
  flush()
  return text.replace(/\$\$/g, '')
}
