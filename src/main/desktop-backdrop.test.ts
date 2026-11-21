import { expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ nativeImage: {}, nativeTheme: {}, screen: {} }))
import { wallpaperFit } from './desktop-backdrop'

it('maps Windows wallpaper styles to how the image fills a display', () => {
  expect(wallpaperFit('10')).toBe('cover')
  expect(wallpaperFit('6')).toBe('contain')
  expect(wallpaperFit('2')).toBe('stretch')
  expect(wallpaperFit(undefined)).toBe('cover')
})
