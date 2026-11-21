/* Development-only native glass check against a synthetic desktop; no user credentials. */
const { app, BrowserWindow, desktopCapturer, screen, nativeTheme, dialog } = require('electron')
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const { pathToFileURL } = require('node:url')
const root = path.resolve(__dirname, '..')
const output = path.join(root, '.local-data', 'glass-verification', String(Date.now()))
fs.mkdirSync(output, { recursive: true })
process.env.SINGULARITY_PROJECT_ROOT = root
process.env.SINGULARITY_DATA_ROOT = path.join(output, 'data')
const report = { output, checks: [], errors: [] }
dialog.showErrorBox = (title, message) => report.errors.push(`${title}: ${message}`)
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(fn, label, timeout = 90000) {
  const start = Date.now()
  while (Date.now() - start < timeout) { if (await fn()) return; await wait(120) }
  throw Error(`Timeout: ${label}`)
}
let underlay
async function main() {
  await import(pathToFileURL(path.join(root, 'dist-electron/main.js')).href)
  let win
  await until(() => { win = BrowserWindow.getAllWindows()[0]; return !!win }, 'window')
  const js = code => win.webContents.executeJavaScript(code, true)
  await until(() => js('Boolean(window.singularity && document.querySelector(".sidebar-navigation"))').catch(() => false), 'shell')
  await until(() => js('!document.querySelector(".startup-active")'), 'startup')
  assert.equal(win.getOpacity(), 1)
  report.checks.push('Whole-window opacity stays 1; foreground does not blend with desktop')
  const area = screen.getPrimaryDisplay().workArea
  win.setBounds({ x: area.x + 40, y: area.y + 30, width: 1320, height: 840 })
  const bounds = win.getBounds()
  underlay = new BrowserWindow({ ...bounds, frame: false, show: false, backgroundColor: '#668a9b', webPreferences: { backgroundThrottling: false, nodeIntegration: false, contextIsolation: true } })
  const fixture = `<html><body style="margin:0;width:100vw;height:100vh;background:linear-gradient(125deg,#497e9a 0%,#89acb7 35%,#dcba7e 65%,#ef8d82 85%)"><div style="position:absolute;inset:0;display:grid;grid-template-columns:repeat(9,1fr);align-content:space-around;font:18px sans-serif;color:#10212b">${'<span>DESKTOP 123</span>'.repeat(81)}</div><div style="position:absolute;left:0;right:0;bottom:0;height:18%;background:repeating-linear-gradient(90deg,#111 0 4px,#eee 4px 8px)"></div></body></html>`
  await underlay.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(fixture))
  underlay.show(); underlay.moveTop()
  await wait(600)
  win.setAlwaysOnTop(true); win.show(); win.moveTop(); win.focus()
  await wait(600)
  const capture = async name => {
    win.moveTop(); win.focus(); await wait(400)
    const display = screen.getDisplayMatching(win.getBounds())
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 3000, height: 2200 } })
    const source = sources.find(item => item.display_id === String(display.id))
    assert(source && !source.thumbnail.isEmpty(), 'Native desktop capture unavailable')
    const size = source.thumbnail.getSize(), b = win.getBounds(), d = display.bounds
    const crop = { x: Math.round((b.x-d.x)*size.width/d.width), y: Math.round((b.y-d.y)*size.height/d.height), width: Math.round(b.width*size.width/d.width), height: Math.round(b.height*size.height/d.height) }
    const image = source.thumbnail.crop(crop)
    fs.writeFileSync(path.join(output, name+'.png'), image.toPNG())
    return image
  }
  await js('window.singularity.runtime.setTheme("light");document.documentElement.dataset.theme="light"')
  await js('document.querySelector(\'[aria-label="语音对话"]\').click()')
  await until(() => js('Boolean(document.querySelector(".voice-select-trigger"))'), 'voice route')
  const style = await js(`(() => {const s=selector=>getComputedStyle(document.querySelector(selector)); return {side:s('.app-sidebar').backgroundColor,top:s('.titlebar').backgroundColor,main:s('.main-content').backgroundColor,buttonShadow:s('.voice-start').boxShadow}})()`)
  report.styles = style
  assert.equal(style.buttonShadow, 'none')
  assert.equal(await js('getComputedStyle(document.documentElement).backgroundColor'), 'rgba(0, 0, 0, 0)', 'Root canvas must not obscure the native backdrop')
  const light = await capture('glass-light-voice')
  // The bottom-left rail is empty and covers the 4px black/white desktop stripes.
  // Native Acrylic must erase sharp edges through the low-tint rail.
  const bitmap = light.toBitmap(), size = light.getSize()
  const y = Math.round(size.height*.93), start = Math.round(size.width*32/bounds.width), end = Math.round(size.width*82/bounds.width)
  const levels=[]
  for(let x=start;x<end;x++){const i=(y*size.width+x)*4;levels.push((bitmap[i]+bitmap[i+1]+bitmap[i+2])/3)}
  report.stripeContrast = Math.max(...levels)-Math.min(...levels)
  const pixel = (x,y) => { const i=(Math.round(y*size.height)*size.width+Math.round(x*size.width))*4; return [bitmap[i+2],bitmap[i+1],bitmap[i]] }
  const tint = pixel(0.04,0.7)
  report.backdropTint = tint
  await underlay.webContents.executeJavaScript("document.body.style.background='#e56a68'; document.querySelectorAll('body > div').forEach(e=>e.style.visibility='hidden')")
  await wait(1500)
  const changed = await capture('glass-backdrop-change'), changedBitmap = changed.toBitmap()
  const sampleIndex = (Math.round(.7*size.height)*size.width+Math.round(.04*size.width))*4
  const changedTint = [changedBitmap[sampleIndex+2],changedBitmap[sampleIndex+1],changedBitmap[sampleIndex]]
  report.backdropColorDelta = changedTint.reduce((sum,v,i)=>sum+Math.abs(v-tint[i]),0)
  await underlay.webContents.executeJavaScript("document.body.style.background='linear-gradient(125deg,#497e9a 0%,#89acb7 35%,#dcba7e 65%,#ef8d82 85%)'; document.querySelectorAll('body > div').forEach(e=>e.style.visibility='visible')")
  report.nativeCaptureNeedsReview = true
  report.notes = ['Desktop pixel measurements are diagnostic only: focus changes, capture caching and unrelated foreground windows can invalidate them. Review native screenshots; these numbers are not an automated blur pass.']
  await js('document.querySelector(\'[aria-label="语音讨论范围"]\').click()')
  await capture('glass-light-menu')
  await js('document.querySelector(".voice-select-menu [role=option]").click()')
  await js('document.querySelector(\'[aria-label="科研发现"]\').click()')
  await capture('glass-light-discovery')
  await js('document.querySelector(\'[aria-label="论文库"]\').click()')
  await capture('glass-light-library')
  await js('window.singularity.runtime.setTheme("dark");document.documentElement.dataset.theme="dark"')
  await wait(200)
  assert.equal(nativeTheme.themeSource, 'dark')
  assert.equal(await js('getComputedStyle(document.documentElement).backgroundColor'), 'rgba(0, 0, 0, 0)')
  await capture('glass-dark-library')
  await js('window.singularity.runtime.setTheme("light");document.documentElement.dataset.theme="light"')
  await js('document.querySelector(\'[aria-label="首页"]\').click()')
  const native = () => win.contentView.children.find(view => view.webContents && view.webContents !== win.webContents)
  await until(() => native() && !native().webContents.isLoading(), 'native assistant')
  for(const label of ['继续','稍后配置']) { await native().webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(label)})?.click()`); await wait(200) }
  await capture('glass-light-assistant')
  report.checks.push('Voice, dropdown, research discovery, library, assistant and light/dark native theme inspected')
  win.maximize(); await wait(350); assert.equal(win.getOpacity(),1)
  win.unmaximize(); await wait(350); assert.equal(win.getOpacity(),1)
  report.checks.push('Native maximize/restore retains opacity and window handling')
  win.setAlwaysOnTop(false)
  assert.deepEqual(report.errors, [])
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report,null,2))
  console.log(JSON.stringify(report,null,2))
}
main().catch(error => { report.errors.push(String(error)); fs.writeFileSync(path.join(output,'failed.json'),JSON.stringify(report,null,2)); console.error(error) }).finally(() => {
  underlay?.destroy()
  // Let main's before-quit handler stop the isolated runtime before setting exit status.
  app.once('will-quit', () => app.exit(report.errors.length ? 1 : 0))
  app.quit()
})
