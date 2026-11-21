/* Real Electron tray lifecycle check; isolated data, no user files or model calls. */
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const root = path.resolve(__dirname, '..')
const output = path.join(root, '.local-data', 'desktop-tray-verification', String(Date.now()))
fs.mkdirSync(output, { recursive: true })
app.setPath('userData', path.join(output, 'electron-data'))
const report = { output, checks: [], errors: [] }
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(fn, label) {
  const start = Date.now()
  while (Date.now() - start < 10000) { if (fn()) return; await wait(50) }
  throw Error('Timeout: ' + label)
}
let tray, win
async function main() {
  await require('esbuild').build({ entryPoints: [path.join(root, 'src/main/desktop-tray.ts')], bundle: true, platform: 'node', format: 'cjs', external: ['electron'], outfile: path.join(output, 'tray.cjs'), logLevel: 'silent' })
  const { DesktopTray } = require(path.join(output, 'tray.cjs'))
  await app.whenReady()
  win = new BrowserWindow({ width: 400, height: 250, show: false, title: 'Singularity 托盘验证', webPreferences: { sandbox: true } })
  await win.loadURL('data:text/html,<title>Singularity tray verification</title>')
  // Consume the hidden Windows launch flag before checking user restore actions.
  win.show(); await wait(100); win.hide()
  let quitRequested = false
  tray = new DesktopTray(root, {
    restore: () => { if (win.isMinimized()) win.restore(); win.show(); win.focus() },
    minimize: () => win.minimize(),
    quit: () => { quitRequested = true },
  })
  assert.equal(tray.tray.isDestroyed(), false)
  assert.deepEqual(tray.menu.items.filter(item => item.type !== 'separator').map(item => item.label), ['显示主窗口', '最小化到任务栏', '完全退出应用'])
  report.checks.push('Real Windows tray icon created from packaged ICO; context menu has restore, minimize and quit')
  tray.tray.emit('click')
  await until(() => win.isVisible(), 'click restores hidden window')
  tray.menu.items[1].click()
  await until(() => win.isMinimized(), 'menu minimizes window')
  tray.tray.emit('double-click')
  await until(() => !win.isMinimized() && win.isVisible(), 'double click restores minimized window')
  win.hide(); tray.menu.items[0].click()
  await until(() => win.isVisible(), 'menu restores hidden window')
  assert.equal(win.isDestroyed(), false)
  report.checks.push('Tray click, double click and menu restore the window; taskbar minimize retains it')
  tray.menu.items[3].click()
  assert.equal(quitRequested, true)
  tray.destroy(); tray.destroy()
  assert.equal(tray.tray.isDestroyed(), true)
  report.checks.push('Quit action is wired and tray destruction removes the icon safely')
}
main().catch(error => { report.errors.push(String(error.stack || error)); console.error(error) }).finally(() => {
  tray?.destroy(); if (win && !win.isDestroyed()) win.destroy()
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2)); app.exit(report.errors.length ? 1 : 0)
})
