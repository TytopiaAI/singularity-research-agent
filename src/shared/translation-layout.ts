import type { PdfLine } from '../renderer/pdf-document-paragraphs'

const mathWords = /^(?:softmax|log|exp|sin|cos|max|min|arg|cross|entropy|relu|sigmoid|diag|norm)$/i
export const isDisplayFormula = (text: string): boolean => !/^(?:we|the|this|these|our|where|let|given|for|with)\b/i.test(text) && /[=∑∏∫≤≥∈≈]/.test(text) && (text.match(/[A-Za-z]{3,}/g) ?? []).filter((word) => !mathWords.test(word)).length < 4

// PDF text streams split fractions, scalable brackets, scripts and right-aligned
// equation numbers. Keep the complete geometric region as a single source crop.
export function translationFormulaLines(lines: PdfLine[], width: number): Array<PdfLine & { formula?: boolean }> {
  const candidate = (line: PdfLine) => isDisplayFormula(line.text) || (
    line.text.length < 100 && !/[\u3400-\u9fff]/.test(line.text) &&
    !(line.text.match(/[A-Za-z]{3,}/g) ?? []).some((word) => !mathWords.test(word)))
  const remaining = new Set(lines.filter(candidate)), groups: PdfLine[][] = []
  for (const seed of lines.filter((line) => isDisplayFormula(line.text))) {
    if (!remaining.delete(seed)) continue
    const group = [seed]
    for (let index = 0; index < group.length; index++) {
      const a = group[index]
      for (const b of remaining) {
        const verticalGap = Math.max(a.rect.top - b.rect.bottom, b.rect.top - a.rect.bottom, 0)
        const horizontalGap = Math.max(a.rect.left - b.rect.right, b.rect.left - a.rect.right, 0)
        const oppositeColumns = a.rect.right < width * .487 && b.rect.left > width * .513 || b.rect.right < width * .487 && a.rect.left > width * .513
        const equationNumber = /^\(\d+[a-z]?\)$/.test(b.text) && Math.abs((a.rect.top + a.rect.bottom - b.rect.top - b.rect.bottom) / 2) < Math.max(a.height, b.height)
        if (oppositeColumns || verticalGap > Math.max(a.height, b.height) * 1.6 || horizontalGap > width * (equationNumber ? .28 : .13)) continue
        remaining.delete(b); group.push(b)
      }
    }
    // A number may be centered vertically against a multi-line aligned equation,
    // farther from each individual row than from the complete equation region.
    const top = Math.min(...group.map((line) => line.rect.top)), bottom = Math.max(...group.map((line) => line.rect.bottom))
    const left = Math.min(...group.map((line) => line.rect.left)), right = Math.max(...group.map((line) => line.rect.right))
    for (const label of remaining) {
      if (!/^\(\d+[a-z]?\)$/.test(label.text) || label.rect.top > bottom || label.rect.bottom < top || label.rect.left < right || label.rect.left - right > width * .28) continue
      if (right < width * .487 && label.rect.left > width * .513 || left > width * .513 && label.rect.right < width * .487) continue
      remaining.delete(label); group.push(label)
    }
    groups.push(group)
  }
  const grouped = new Set(groups.flat())
  return [...lines.filter((line) => !grouped.has(line)), ...groups.map((group) => {
    group.sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left)
    const left = Math.min(...group.map((line) => line.rect.left)), right = Math.max(...group.map((line) => line.rect.right))
    const top = Math.min(...group.map((line) => line.rect.top)), bottom = Math.max(...group.map((line) => line.rect.bottom))
    return { text: group.map((line) => line.text).join(' '), clean: group.map((line) => line.clean ?? line.text).join(' '),
      glyphs: group.flatMap((line) => line.glyphs ?? []), formula: true,
      rect: { left, right, top, bottom, width: right - left, height: bottom - top }, height: bottom - top }
  })].sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left)
}
