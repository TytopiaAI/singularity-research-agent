/** hue 是该主题主色的色相，计划分类配色靠它避开撞色；透明主题不占色相。 */
export const chatThemes = [
  { id: 'warm', label: '浅黄', color: '#F2DF9F', hue: 46 },
  { id: 'blue', label: '浅蓝', color: '#83B3EF', hue: 214 },
  { id: 'purple', label: '浅紫', color: '#B9A0ED', hue: 258 },
  { id: 'green', label: '浅绿', color: '#89CBA0', hue: 146 },
  { id: 'transparent', label: '透明', color: 'transparent', hue: null },
] as const

export type ChatTheme = typeof chatThemes[number]['id']
export function isChatTheme(value: unknown): value is ChatTheme {
  return chatThemes.some(theme => theme.id === value)
}
