/* Real Electron startup artwork check. No model calls, installation or user data. */
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const root = path.resolve(__dirname, '..')
const output = path.join(root, '.local-data', 'startup-splash-verification', String(Date.now()))
fs.mkdirSync(output, { recursive: true })
app.setPath('userData', path.join(output, 'electron-data'))
const report = { output, checks: [], errors: [], externalRequests: [] }
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
let win
async function screenshot(name) {
  // Windows can report UnknownVizError while a new surface is being created.
  // Wait for that surface, without hiding a persistent capture failure.
  for (let attempt = 0; attempt < 3; attempt++) {
    try { fs.writeFileSync(path.join(output, name), (await win.webContents.capturePage()).toPNG()); return }
    catch (error) { if (attempt === 2) throw error; await wait(300) }
  }
}
async function until(fn, label, timeout = 15000) {
  const began = Date.now()
  while (Date.now() - began < timeout) { if (await fn()) return; await wait(100) }
  throw Error('Timeout: ' + label)
}
async function main() {
  const entry = path.join(output, 'entry.tsx')
  fs.writeFileSync(entry, `import React, { StrictMode } from ${JSON.stringify(path.join(root, 'node_modules/react/index.js'))};
import { createRoot } from ${JSON.stringify(path.join(root, 'node_modules/react-dom/client.js'))};
import { StartupSplash } from ${JSON.stringify(path.join(root, 'src/renderer/StartupSplash.tsx'))};
window.__calls = []; window.singularity = { windowControls: Object.fromEntries(['minimize', 'toggleMaximize', 'close'].map(name => [name, () => window.__calls.push(name)])) };
const host = createRoot(document.getElementById('root'));
window.__render = () => host.render(<StrictMode><StartupSplash /></StrictMode>);
window.__finish = () => host.unmount(); window.__render();`)
  await require('esbuild').build({ entryPoints: [entry], outfile: path.join(output, 'entry.js'), bundle: true, format: 'iife', platform: 'browser', jsx: 'automatic', loader: { '.png': 'dataurl' }, define: { 'import.meta.env.BASE_URL': JSON.stringify('file://' + path.join(root, 'dist').replaceAll('\\', '/') + '/') }, logLevel: 'silent' })
  fs.copyFileSync(path.join(root, 'src/renderer/startup.css'), path.join(output, 'startup.css'))
  fs.writeFileSync(path.join(output, 'base.css'), 'html,body,#root {width:100%;height:100%;margin:0;} :root {--text:#172034;--accent:#ff7e5f;--danger:#cf4050;--glass-field:#fff8; } .app-shell {position:relative;width:100%;height:100%;background:#f3efe6;}')
  for (const [name, previous] of [['planets', 'armor'], ['willow', 'planets'], ['sail', 'willow'], ['armor', 'sail']]) {
    fs.writeFileSync(path.join(output, name + '.js'), 'localStorage.setItem("singularity.startup.last-variant", ' + JSON.stringify(previous) + ');')
    fs.writeFileSync(path.join(output, name + '.html'), `<html><head><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'none'"><link rel="stylesheet" href="base.css"><link rel="stylesheet" href="startup.css"><link rel="stylesheet" href="entry.css"></head><body><div class="app-shell"><div id="root"></div></div><script src="${name}.js"></script><script src="entry.js"></script></body></html>`)
  }
  await app.whenReady()
  win = new BrowserWindow({ width: 1440, height: 900, show: false, frame: false, webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true, backgroundThrottling: false, offscreen: true } })
  win.webContents.session.webRequest.onBeforeRequest((details, done) => {
    const remote = /^https?:/i.test(details.url)
    if (remote) report.externalRequests.push(details.url)
    done({ cancel: remote })
  })
  win.webContents.on('console-message', event => { if (event.level === 'error') report.errors.push(event.message) })
  // Render independently of the desktop compositor (including locked screens).
  win.webContents.setFrameRate(60)
  const evaluate = script => win.webContents.executeJavaScript(script)
  for (const variant of ['planets', 'willow', 'sail', 'armor']) {
    win.setContentSize(1440, 900)
    await win.loadFile(path.join(output, variant + '.html'))
    await until(async () => await evaluate('document.querySelector("[data-startup-variant]")?.dataset.startupVariant') === variant, variant + ' selected')
    await evaluate('Math.random = () => 0.1; window.__render()')
    await wait(100)
    assert.equal(await evaluate('document.querySelector("[data-startup-variant]").dataset.startupVariant'), variant)
    report.checks.push(variant + ': selection remains fixed through StrictMode remounts and rerenders')
    if (variant === 'willow' || variant === 'sail') {
      await until(() => win.webContents.mainFrame.frames.length === 1, 'painting frame')
      const frame = win.webContents.mainFrame.frames[0]
      await until(() => frame.executeJavaScript('Boolean(document.querySelector("canvas"))'), 'local WebGL canvas')
      await wait(4500)
      assert.equal(await evaluate('document.querySelector("[data-startup-variant]").dataset.startupVariant'), variant)
      const painting = await frame.executeJavaScript('({ canvas: [width, height], viewport: [innerWidth, innerHeight], frames: frameCount })')
      ;(report.paintings ||= {})[variant] = painting
      await screenshot(variant + '-painting.png')
      assert.ok(painting.frames > 10)
      assert.ok(Math.abs(painting.canvas[0] / painting.canvas[1] - painting.viewport[0] / painting.viewport[1]) < 0.01)
      await wait(5000)
      await screenshot(variant + '-complete.png')
      win.setContentSize(1000, 720); await wait(250)
      const coverage = await evaluate('(() => { const a = document.querySelector("iframe").getBoundingClientRect(); return {width:a.width,height:a.height,windowWidth:innerWidth,windowHeight:innerHeight} })()')
      assert.equal(coverage.width, coverage.windowWidth); assert.equal(coverage.height, coverage.windowHeight)
      await screenshot(variant + '-resized.png')
      report.checks.push(variant + ': local animated WebGL painting fills the window and remains full screen after resizing')
      await evaluate('window.postMessage({type:"singularity:painting-error"}, "*")')
      await wait(100)
      assert.equal(await evaluate('document.querySelector("[data-startup-variant]").dataset.startupVariant'), variant)
      await frame.executeJavaScript('notifyPaintingError()')
      await until(async () => await evaluate('document.querySelector("[data-startup-variant]")?.dataset.startupVariant') === 'planets', 'graphics fallback')
      await until(() => win.webContents.mainFrame.frames.length === 0, 'failed GPU frame removed')
      report.checks.push(variant + ': graphics failure falls back to planets and releases the frame; unrelated messages are ignored')
    } else if(variant==='armor') {
      assert(await evaluate(`(() => {
        const parts = [...document.querySelectorAll('[data-armor-panel]')];
        return ['helmet-shell','faceplate','jaw-plate','chest','torso-understructure'].every(name => parts.some(p => p.dataset.armorPanel===name)) && parts.every(p => p.querySelector('.armor-panel-trace').getTotalLength()>0);
      })()`))
      assert.equal(await evaluate('document.querySelectorAll(".armor-hardware path").length'),1)
      assert(await evaluate(`(() => {
        const back=document.querySelector('[data-armor-layer="back"]'),front=document.querySelector('.armor-body');
        const maskId=back.querySelector('g[mask]').getAttribute('mask').slice(5,-1);
        return Boolean(back.compareDocumentPosition(front)&Node.DOCUMENT_POSITION_FOLLOWING) && document.getElementById(maskId).querySelectorAll('path').length===front.querySelectorAll('[data-armor-panel]').length;
      })()`),'Rear attachments must render behind the suit with foreground occlusion')
      await screenshot('armor-01-ignition.png');await wait(1500);await screenshot('armor-02-tracing.png');await wait(2300);await screenshot('armor-03-reveal.png');await wait(1400);await screenshot('armor-04-complete.png')
      assert.equal(await evaluate('getComputedStyle(document.querySelector(".armor-eyes")).opacity'),'1')
      assert(await evaluate('document.querySelector(".armor-sparks").getContext("2d").getImageData(0,0,200,200).data.some(v=>v>0)'))
      for(const [w,h] of [[1000,720],[1920,1080],[800,600],[640,760]]) {
        win.setContentSize(w,h);await wait(150)
        assert(await evaluate('document.documentElement.scrollWidth<=innerWidth && document.documentElement.scrollHeight<=innerHeight'))
        const additions=await evaluate(`['hand-left-shell','hand-right-shell','back-upper-right-shell','back-lower-left-shell','back-lower-right-shell'].map(name=>{
          const bounds=document.querySelector('[data-armor-panel="'+name+'"] .armor-panel-trace').getBoundingClientRect();
          return {name,left:bounds.left,right:bounds.right,top:bounds.top,bottom:bounds.bottom,width:bounds.width,viewportWidth:innerWidth,viewportHeight:innerHeight};
        })`)
        assert(additions.every(bounds=>bounds.width>0 && bounds.left>=0 && bounds.right<=bounds.viewportWidth && bounds.top>=0 && bounds.bottom<=bounds.viewportHeight),'Hands and rear armor must remain fully visible: '+JSON.stringify(additions))
        await screenshot('armor-'+w+'x'+h+'.png')
      }
      report.checks.push('Armor ignition, reference contours, rear-layer occlusion, particles, lit eyes, and four viewport sizes with both fists and rear armor fully visible verified')
    } else {
      assert.equal(await evaluate('document.querySelectorAll(".startup-orbit").length'), 3)
      await screenshot('planets.png')
    }
    await evaluate('document.querySelectorAll(".startup-window-actions button").forEach(button => button.click())')
    assert.deepEqual(await evaluate('window.__calls'), ['minimize', 'toggleMaximize', 'close'])
    await evaluate('window.__finish()')
    await until(() => win.webContents.mainFrame.frames.length === 0, 'frame cleanup')
    assert.equal(await evaluate('Boolean(document.querySelector(".startup-splash"))'), false)
    report.checks.push(variant + ': window actions work; startup completion removes artwork and painting frame')
  }
  win.webContents.debugger.attach('1.3')
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  for (const variant of ['willow', 'sail']) {
    await win.loadFile(path.join(output, variant + '.html'))
    await until(() => win.webContents.mainFrame.frames.length === 1, 'reduced motion frame')
    const stillFrame = win.webContents.mainFrame.frames[0]
    await until(() => stillFrame.executeJavaScript('typeof isLooping === "function" && !isLooping()'), 'reduced motion still painting')
    const stoppedAt = await stillFrame.executeJavaScript('frameCount')
    await wait(500)
    assert.equal(await stillFrame.executeJavaScript('frameCount'), stoppedAt)
    assert.equal(await evaluate('document.querySelector("[data-startup-variant]").dataset.startupVariant'), variant)
    await screenshot(variant + '-reduced-motion.png')
    await evaluate('window.__finish()')
    await until(() => win.webContents.mainFrame.frames.length === 0, 'still painting cleanup')
    report.checks.push(variant + ': reduced motion paints a still scene and stops the animation loop')
  }
  await win.loadFile(path.join(output,'armor.html'));await wait(300)
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".armor-eyes")).opacity'),'1')
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".armor-panel-trace")).strokeDashoffset'),'0px')
  await screenshot('armor-reduced-motion.png');await evaluate('window.__finish()')
  report.checks.push('Armor reduced-motion mode shows the completed suit without animated drawing')
  win.webContents.debugger.detach()
  assert.equal(report.externalRequests.length, 0)
  report.checks.push('All four styles run offline with no HTTP requests and release their artwork on unmount')
  assert.equal(report.errors.length, 0, report.errors.join('\n'))
}
main().catch(error => { report.errors.push(String(error.stack || error)); console.error(error) }).finally(() => {
  if (win && !win.isDestroyed()) win.destroy()
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2)); app.exit(report.errors.length ? 1 : 0)
})
