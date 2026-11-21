import type { ReviewSectionKey } from '../shared/types'

// One stable, pale color per review angle. These colors are for grounded PDF
// evidence and its matching reading card, not for unverified model inferences.
export const reviewColors: Record<ReviewSectionKey, { tint: string; edge: string }> = {
  problem: { tint: '#B8D4E3', edge: '#4E819B' },
  innovation: { tint: '#FFF5E1', edge: '#A67C35' },
  method: { tint: '#E8D5E0', edge: '#966C87' },
  dataset: { tint: '#B5E5D6', edge: '#4E927E' },
  setup: { tint: '#F7C5CC', edge: '#B45D70' },
  results: { tint: '#D5E8C7', edge: '#6F9253' },
  explanation: { tint: '#F7DDC9', edge: '#AA7856' },
  context: { tint: '#D9D7EE', edge: '#7773AA' },
  future: { tint: '#D2E2EF', edge: '#5681A1' },
  concepts: { tint: '#E9DFC6', edge: '#96804F' },
  action: { tint: '#C5C9D4', edge: '#6E7689' },
}
