export const noteColors = [
  { value: '#F7C5CC', label: '柔粉' },
  { value: '#B8D4E3', label: '雾蓝' },
  { value: '#E8D5E0', label: '浅紫' },
  { value: '#B5E5D6', label: '薄荷' },
  { value: '#FFF5E1', label: '奶油黄' },
  { value: '#FFF8F0', label: '暖白' },
  { value: '#C5C9D4', label: '灰紫' },
] as const

export type NoteColor = string
export const defaultNoteColor: NoteColor = '#B8D4E3'

export function isNoteColor(value: unknown): value is NoteColor {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)
}
