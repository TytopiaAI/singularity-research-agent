import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { nativeImage, nativeTheme, screen, type BrowserWindow } from 'electron'
import type { DesktopBackdrop, DesktopBackdropGeometry } from '../shared/types'

const wallpaperWidth = 1280
const wallpaperFile = (): string => path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Themes', 'TranscodedWallpaper')

/** Maps the Windows WallpaperStyle registry value to how the image fills a display. */
export function wallpaperFit(style: string | undefined): DesktopBackdrop['fit'] {
  if (style === '6') return 'contain'
  if (style === '2') return 'stretch'
  return 'cover'
}

function wallpaperStyle(): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile('reg', ['query', 'HKCU\\Control Panel\\Desktop', '/v', 'WallpaperStyle'], { windowsHide: true }, (error, stdout) => {
      resolve(error ? undefined : /WallpaperStyle\s+REG_SZ\s+(\d+)/.exec(stdout)?.[1])
    })
  })
}

export function backdropGeometry(window: BrowserWindow): DesktopBackdropGeometry {
  const bounds = window.getBounds(), display = screen.getDisplayMatching(bounds).bounds
  return { x: display.x - bounds.x, y: display.y - bounds.y, width: display.width, height: display.height }
}

/**
 * The frosted surface is painted by the renderer from the user's own wallpaper, which stays on this
 * machine. DWM Acrylic stays underneath as the fallback, but on some systems it composes as solid gray.
 */
export async function readDesktopBackdrop(window: BrowserWindow): Promise<DesktopBackdrop> {
  const geometry = backdropGeometry(window)
  if (process.platform !== 'win32' || nativeTheme.prefersReducedTransparency || nativeTheme.shouldUseHighContrastColors) return { image: null, fit: 'cover', ...geometry }
  try {
    const source = nativeImage.createFromBuffer(await fs.promises.readFile(wallpaperFile()))
    if (source.isEmpty()) return { image: null, fit: 'cover', ...geometry }
    const small = source.getSize().width > wallpaperWidth ? source.resize({ width: wallpaperWidth, quality: 'good' }) : source
    return { image: `data:image/jpeg;base64,${small.toJPEG(84).toString('base64')}`, fit: wallpaperFit(await wallpaperStyle()), ...geometry }
  } catch {
    return { image: null, fit: 'cover', ...geometry }
  }
}

/** Keeps the painted wallpaper aligned with the desktop, and picks up a changed wallpaper on focus. */
export function keepDesktopBackdrop(window: BrowserWindow): () => void {
  let stamp = 0
  const send = (): void => { if (!window.isDestroyed()) window.webContents.send('window:backdrop-geometry', backdropGeometry(window)) }
  const refresh = (): void => {
    void fs.promises.stat(wallpaperFile()).then(async ({ mtimeMs }) => {
      if (mtimeMs === stamp) return
      const first = stamp === 0
      stamp = mtimeMs
      if (!first && !window.isDestroyed()) window.webContents.send('window:backdrop', await readDesktopBackdrop(window))
    }).catch(() => {})
  }
  refresh()
  window.on('move', send); window.on('resize', send); window.on('focus', refresh)
  return () => { window.removeListener('move', send); window.removeListener('resize', send); window.removeListener('focus', refresh) }
}
