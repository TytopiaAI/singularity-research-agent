// Reserved for source-grounded Q&A. The initial shades are deliberately
// distinct from the eleven review colors and the default note palette.
export const answerColors = [
  '#C8E6F6', '#FFE4B8', '#E4CDF8', '#C9EFE5', '#FAD6E3', '#DDEAC1',
  '#F6D3BE', '#C7D7F1', '#E9E5B9', '#C2E7D0', '#F1CFEF', '#CFDAEA',
]
const reservedReviewColors = ['#B8D4E3', '#FFF5E1', '#E8D5E0', '#B5E5D6', '#F7C5CC', '#D5E8C7', '#F7DDC9', '#D9D7EE', '#D2E2EF', '#E9DFC6', '#C5C9D4']

function pastel(hue) {
  const saturation = .5, lightness = .84
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation
  const second = chroma * (1 - Math.abs((hue / 60) % 2 - 1))
  const [r, g, b] = hue < 60 ? [chroma, second, 0] : hue < 120 ? [second, chroma, 0]
    : hue < 180 ? [0, chroma, second] : hue < 240 ? [0, second, chroma]
      : hue < 300 ? [second, 0, chroma] : [chroma, 0, second]
  const offset = lightness - chroma / 2
  return '#' + [r, g, b].map((value) => Math.round((value + offset) * 255).toString(16).padStart(2, '0')).join('').toUpperCase()
}

export function pickAnswerColor(usedColors) {
  const used = new Set([...usedColors, ...reservedReviewColors].map((color) => String(color).toUpperCase()))
  for (const color of answerColors) if (!used.has(color)) return color
  for (let index = 0; index < 3600; index++) {
    const color = pastel((index * 137.508) % 360)
    if (!used.has(color)) return color
  }
  throw new Error('No unused answer highlight color available')
}
