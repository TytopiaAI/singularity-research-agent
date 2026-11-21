// Real Electron + Harness, isolated data, no installer and no model requests.
const fs = require('node:fs'), path = require('node:path'), net = require('node:net')
const { spawn } = require('node:child_process')
const assert = require('node:assert/strict')
const root = path.resolve(__dirname, '..')
const output = path.join(root, '.local-data/startup-performance', String(Date.now()))
fs.mkdirSync(output, { recursive: true })
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const report = { output, runs: [] }
const wrapper = path.join(output, 'launch.cjs')
const slowBackend = process.argv.includes('--slow-backend')
// Test-only delay before importing the real backend; production has no delay hook.
const delayHook = slowBackend ? `const cp=require('node:child_process'),spawn=cp.spawn;cp.spawn=(file,args,options)=>{if(args?.some(a=>a.endsWith('harness-launcher.js'))){const launcher=args.find(a=>a.endsWith('harness-launcher.js'));return spawn(file,['--input-type=module','-e','process.argv='+JSON.stringify([file,...args])+';await new Promise(r=>setTimeout(r,12000));await import('+JSON.stringify(require('node:url').pathToFileURL(launcher).href)+');'],options)}return spawn(file,args,options)};require('node:module').syncBuiltinESMExports();` : ''
fs.writeFileSync(wrapper, `const{dialog}=require('electron');dialog.showMessageBox=async()=>({response:1});dialog.showErrorBox=(t,m)=>console.error(t,m);${delayHook}import(${JSON.stringify(require('node:url').pathToFileURL(path.join(root, 'dist-electron/main.js')).href)});`)
async function run(index) {
  const port = await new Promise(resolve => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)) }) })
  const env = { ...process.env, SINGULARITY_DATA_ROOT: path.join(output, 'data') }
  delete env.ELECTRON_RUN_AS_NODE
  const log = fs.openSync(path.join(output, `process-${index}.log`), 'w')
  const began = Date.now(), result = { index }
  const child = spawn(require('electron'), [wrapper, '--remote-debugging-port=' + port], { cwd: root, env, windowsHide: true, stdio: ['ignore', log, log] })
  fs.closeSync(log)
  let socket, next = 0
  try {
    let target
    while (Date.now() - began < 135000) {
      try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t => t.type === 'page' && t.url.endsWith('/dist/index.html')); if (target) break } catch {}
      await wait(100)
    }
    assert(target, 'desktop renderer appears')
    result.rendererMs = Date.now() - began
    socket = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
    const pending = new Map()
    socket.addEventListener('message', e => { const m = JSON.parse(e.data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } })
    const js = expression => new Promise((resolve, reject) => {
      const id = ++next
      pending.set(id, m => m.error || m.result?.exceptionDetails ? reject(Error(JSON.stringify(m))) : resolve(m.result.result.value))
      socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }))
    })
    while (Date.now() - began < 135000) {
      const phase = await js(`window.singularity?.runtime.get().then(r=>r.phase)`)
      assert.notEqual(phase, 'error', 'runtime startup succeeds')
      if (!result.shellMs && await js(`Boolean(document.querySelector('.sidebar-navigation'))&&!document.querySelector('.startup-splash')`)) {
        result.shellMs = Date.now() - began
        if (slowBackend) {
          assert.notEqual(phase, 'ready', 'test backend is still starting when shell opens')
          assert(await js(`document.querySelector('.harness-host').textContent.includes('正在启动研究引擎')`))
          await js(`document.querySelector('.sidebar-navigation [aria-label="计划"]').click()`)
          for (let i = 0; i < 100; i++) { if (await js(`document.querySelectorAll('.planning-calendar-grid [role="gridcell"]').length===42`)) { result.localPageBeforeBackend = true; break } await wait(50) }
          assert(result.localPageBeforeBackend, 'local planner usable before the backend starts')
        }
      }
      if (phase === 'ready' && !result.backendMs) result.backendMs = Date.now() - began
      const mainLog = path.join(output, 'data/logs/main.log')
      const text = fs.existsSync(mainLog) ? fs.readFileSync(mainLog, 'utf8') : ''
      const current = text.slice(text.lastIndexOf('process started'))
      if (current.includes('Harness view loaded') && await js(`!document.querySelector('.startup-splash')`)) {
        result.usableMs = Date.now() - began
        result.backendStages = fs.readFileSync(path.join(output, 'data/logs/harness.log'), 'utf8').split('\n').filter(l => l.includes('[startup]')).slice(-7)
        result.initialScripts = await js(`[...document.scripts].filter(s=>s.src).map(s=>s.src.split('/').pop())`)
        break
      }
      await wait(100)
    }
    assert(result.usableMs, 'native assistant is loaded and splash exits')
    // Exercise a deferred route through the real shell and preload.
    await js(`document.querySelector('.sidebar-navigation [aria-label="计划"]').click()`)
    for (let i = 0; i < 100; i++) { if (await js(`document.querySelectorAll('.planning-calendar-grid [role="gridcell"]').length===42`)) { result.plannerLoaded = true; break } await wait(100) }
    assert(result.plannerLoaded)
    await js(`document.querySelector('.sidebar-navigation [aria-label="论文库"]').click()`)
    for (let i = 0; i < 100; i++) { if (await js(`Boolean(document.querySelector('.library-filter'))`)) { result.libraryLoaded = true; break } await wait(100) }
    assert(result.libraryLoaded, 'PDF library loads after deferred import')
    socket.send(JSON.stringify({ id: ++next, method: 'Browser.close' }))
    for (let i = 0; i < 100 && child.exitCode === null; i++) await wait(100)
    assert.notEqual(child.exitCode, null, 'normal shutdown')
    return result
  } finally {
    if (child.exitCode === null && socket?.readyState === WebSocket.OPEN) { socket.send(JSON.stringify({ id: ++next, method: 'Browser.close' })); for (let i = 0; i < 100 && child.exitCode === null; i++) await wait(100) }
    socket?.close()
    if (child.exitCode === null) child.kill()
  }
}
(async () => { for (let i = 0; i < Number(process.argv[2] || 2); i++) { report.runs.push(await run(i)); console.log(JSON.stringify(report.runs.at(-1))) } })().catch(e => { report.error = String(e.stack || e); process.exitCode = 1 }).finally(() => { fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log('Report: ' + path.join(output, 'report.json')) })
