import path from 'node:path'
import { Menu, nativeImage, Tray } from 'electron'

/** Retained by the main process for the entire application lifetime. */
export class DesktopTray {
  readonly tray: Tray
  readonly menu: Menu

  constructor(resources: string, actions: { restore: () => void; minimize: () => void; quit: () => void }) {
    let icon = nativeImage.createFromPath(path.join(resources, 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png'))
    if (icon.isEmpty()) icon = nativeImage.createFromPath(path.join(resources, 'build', 'icon.png'))
    if (icon.isEmpty()) throw new Error('无法加载 Singularity 托盘图标')
    this.tray = new Tray(icon)
    this.tray.setToolTip('Singularity')
    this.menu = Menu.buildFromTemplate([
      { label: '显示主窗口', click: actions.restore },
      { label: '最小化到任务栏', click: actions.minimize },
      { type: 'separator' },
      { label: '完全退出应用', click: actions.quit },
    ])
    this.tray.setContextMenu(this.menu)
    this.tray.on('click', actions.restore)
    this.tray.on('double-click', actions.restore)
  }

  destroy(): void {
    if (!this.tray.isDestroyed()) this.tray.destroy()
  }
}
