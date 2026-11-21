/* Smoke check of the installed application with an isolated, empty data root. */
const fs = require('node:fs'), path = require('node:path'), net = require('node:net')
const { spawn } = require('node:child_process')
const assert = require('node:assert/strict')
const root = path.resolve(__dirname, '..')
const executable = process.argv[2] || 'E:\\Singularity\\Singularity.exe'
const output = path.join(root, '.local-data', 'package-verification', 'installed-smoke-' + Date.now())
fs.mkdirSync(output, { recursive: true })
const report = { executable, output, checks: [] }
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
let child, socket
async function main() {
  const port = await new Promise(resolve => {
    const server = net.createServer()
    server.listen(0, '127.0.0.1', () => { const value = server.address().port; server.close(() => resolve(value)) })
  })
  const log = fs.openSync(path.join(output, 'process.log'), 'w')
  const environment = { ...process.env, SINGULARITY_DATA_ROOT: path.join(output, 'data') }
  delete environment.ELECTRON_RUN_AS_NODE
  child = spawn(executable, ['--remote-debugging-port=' + port], { env: environment, windowsHide: true, stdio: ['ignore', log, log] })
  fs.closeSync(log)
  let target
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      const targets = await (await fetch('http://127.0.0.1:' + port + '/json')).json()
      target = targets.find(value => value.type === 'page' && value.url.startsWith('file:') && value.url.endsWith('/dist/index.html'))
      if (target) break
    } catch {}
    if (child.exitCode !== null) throw Error('Installed application exited before opening its renderer')
    await wait(250)
  }
  assert.ok(target, 'installed renderer is reachable')
  socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
  let nextId = 0
  const pending = new Map()
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    if (pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id) }
  })
  const call = (method, params) => new Promise(resolve => { const id = ++nextId; pending.set(id, resolve); socket.send(JSON.stringify({ id, method, params })) })
  const evaluate = async expression => {
    const answer = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (answer.error || answer.result?.exceptionDetails) throw Error(JSON.stringify(answer))
    return answer.result.result.value
  }
  let status
  // Match the application's 120 second runtime startup allowance, with room
  // for renderer/IPC delivery and the first installed-file security scan.
  for (let attempt = 0; attempt < 520; attempt++) {
    status = await evaluate('window.singularity?.runtime.get()')
    if (status?.phase === 'ready' || status?.phase === 'error') break
    await wait(250)
  }
  report.runtime = status
  assert.equal(status?.phase, 'ready', 'packaged runtime must start successfully')
  const expectedHarness = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).dependencies['@deepseek-ai/dsh']
  const installedHarness = JSON.parse(fs.readFileSync(path.join(path.dirname(executable), 'resources/app/node_modules/@deepseek-ai/dsh/package.json'), 'utf8')).version
  assert.equal(installedHarness, expectedHarness, 'packaged Harness dependency matches the requested upgrade')
  assert.equal(status.harnessVersion, installedHarness, 'runtime reports the actual packaged Harness version')
  report.checks.push('Packaged dependency and running Harness version both match ' + installedHarness)
  const voiceSettings = await evaluate('window.singularity.voice.settings()')
  assert.equal(voiceSettings.provider, 'windows', 'isolated empty profile uses local voice by default')
  assert.equal(voiceSettings.hasCredential, false)
  assert.equal(voiceSettings.monthlyCreditLimit, 10000)
  assert.equal(Object.hasOwn(voiceSettings, 'apiKey'), false)
  assert.equal(await evaluate('typeof window.singularity.voice.saveSettings'), 'function')
  assert.equal(await evaluate('typeof window.singularity.voice.verifySettings'), 'function')
  report.checks.push('Installed BreezeBlue settings IPC is available with the expected budget and no plaintext credential; no speech API is called')
  // Runtime readiness precedes the native assistant view's load. Closing in
  // that gap aborts loadURL and exercises shutdown rather than startup.
  const mainLog = path.join(output, 'data/logs/main.log')
  let assistantLoaded = false
  for (let attempt = 0; attempt < 80; attempt++) {
    const contents = fs.existsSync(mainLog) ? fs.readFileSync(mainLog, 'utf8') : ''
    if (contents.includes('Harness view loaded')) { assistantLoaded = true; break }
    if (contents.includes('Agent runtime failed')) throw Error('Native assistant view failed to load: ' + contents)
    await wait(250)
  }
  assert.equal(assistantLoaded, true, 'native assistant view loads before shutdown')
  // Harness 0.2+ requires the process launch token; an unauthenticated request must be refused.
  assert.equal((await fetch(status.url)).status, 401, 'packaged assistant server responds and requires its launch token')
  assert.equal(await evaluate('Boolean(document.querySelector(".startup-splash"))'), false)
  assert.equal(await evaluate('localStorage.getItem("singularity.startup.last-variant")'), 'planets')
  assert.equal(await evaluate('Boolean(document.querySelector(".harness-host"))'), true)
  report.checks.push('Installed renderer, preload IPC, runtime server and native assistant view start; loading artwork is removed when ready')
  assert.equal(await evaluate('typeof window.singularity.research.createField'), 'function')
  assert.equal(await evaluate('typeof window.singularity.research.star'), 'function')
  assert.deepEqual(await evaluate('window.singularity.research.fields()'), [])
  assert.equal(await evaluate('Boolean(document.getElementById("singularity-scrollbars"))'), true)
  report.checks.push('Installed field-knowledge preload/IPC and shared scrollbar styles are present')
  for(const [label,selector] of [['消息订阅','.messages-page .message-new'],['科研发现','.digest-page .research-entry']]) {
    await evaluate(`([...document.querySelectorAll('.sidebar-navigation button')].find(b=>b.getAttribute('aria-label').replace(/\\s/g,'')===${JSON.stringify(label.replace(/\s/g,''))})).click()`)
    for(let i=0;i<100;i++){if(await evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`))break;await wait(100)}
    assert.equal(await evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`),true)
    if(label==='科研发现')assert.equal(await evaluate(`[...document.querySelectorAll('.digest-page .header-actions button')].every(b=>!b.textContent.trim()&&b.querySelector('svg')&&b.getAttribute('aria-label'))`),true)
    const capture=await call('Page.captureScreenshot',{format:'png'})
    fs.writeFileSync(path.join(output,label==='消息订阅'?'installed-minimal-news.png':'installed-minimal-discovery.png'),Buffer.from(capture.result.data,'base64'))
  }
  report.checks.push('Installed multi-topic message subscriptions and research discovery open with current actions; no generation request')
  await evaluate(`document.querySelector('.sidebar-navigation [aria-label="语音对话"]').click()`)
  for(let i=0;i<100;i++){if(await evaluate(`Boolean(document.querySelector('[aria-label="切换语音形象"]'))`))break;await wait(100)}
  assert.equal(await evaluate(`Boolean(document.querySelector('.voice-orb'))`),true)
  assert.equal(await evaluate(`Boolean(document.querySelector('.voice-hud-core'))`),false)
  assert.equal(await evaluate(`document.querySelector('[aria-label="切换语音形象"]').textContent`),'')
  assert.equal(await evaluate(`Boolean(document.querySelector('[aria-label="切换语音形象"] svg'))`),true)
  await evaluate(`document.querySelector('[aria-label="切换语音形象"]').click()`)
  await wait(100)
  await wait(200)
  assert.equal(await evaluate(`localStorage.getItem('singularity.voice.visualizer')`),'pet')
  assert.equal(await evaluate(`Boolean(document.querySelector('[role="listbox"]'))`),false)
  assert.equal(await evaluate(`document.querySelector('.pet-body').getAttribute('fill')`),'#f00000')
  assert.equal(await evaluate(`document.querySelector('.pet-eye').getAttribute('fill')`),'#ffffff')
  assert.equal(await evaluate(`Boolean(document.querySelector('.pet-edge-light'))`),false)
  await evaluate(`document.querySelector('.voice-pet').click()`)
  await wait(100)
  assert.equal(await evaluate(`document.querySelector('.voice-pet').dataset.cue`),'surprise')
  const petCapture=await call('Page.captureScreenshot',{format:'png'})
  fs.writeFileSync(path.join(output,'installed-voice-pet.png'),Buffer.from(petCapture.result.data,'base64'))
  report.checks.push('Installed voice appearance selector and flat red pet with white eyes work, interaction responds, and retired HUD is absent; no model/TTS request')
  for (const variant of ['willow', 'sail']) {
    const filename = path.join(path.dirname(executable), 'resources/app/dist/startup', variant + '.js')
    assert.equal(fs.readFileSync(filename, 'utf8'), fs.readFileSync(path.join(root, 'public/startup', variant + '.js'), 'utf8'))
  }
  report.checks.push('Installed Willow and Sail painting engines exactly match the current source')
  assert.equal(await evaluate('typeof window.singularity.writing.groups'),'function')
  assert.equal(await evaluate('typeof window.singularity.writing.previewLatex'),'function')
  assert.equal(await evaluate('typeof window.singularity.latex.importZip'),'function')
  assert.equal(fs.readFileSync(path.join(path.dirname(executable),'resources/app/skills/bilingual-academic-paragraph/SKILL.md'),'utf8'),fs.readFileSync(path.join(root,'skills/bilingual-academic-paragraph/SKILL.md'),'utf8'))
  await evaluate(`document.querySelector('.sidebar-navigation [aria-label="论文写作"]').click()`)
  for(let i=0;i<100;i++){if(await evaluate(`Boolean(document.querySelector('.latex-welcome'))`))break;await wait(100)}
  assert.equal(await evaluate(`Boolean(document.querySelector('.latex-welcome'))`),true)
  await evaluate(`[...document.querySelectorAll('.writing-studio-modes button')].find(b=>b.textContent.trim()==='段落写作').click()`)
  for(let i=0;i<100;i++){if(await evaluate(`Boolean(document.querySelector('.writing-page'))`))break;await wait(100)}
  assert.equal(await evaluate(`Boolean(document.querySelector('.writing-page'))`),true)
  assert.equal(await evaluate(`[...document.querySelectorAll('.writing-page button')].some(b=>b.textContent.trim()==='从模板开始')`),true)
  report.checks.push('Installed LaTeX and hierarchical writing entry points load; bilingual academic skill exactly matches current source')
  const planning = await evaluate('window.singularity.planning.get()')
  assert.deepEqual(planning.plans, [])
  assert.deepEqual(planning.earnedDays, [])
  assert.ok(planning.categories.length >= 10)
  const labels = await evaluate(`[...document.querySelectorAll('.sidebar-navigation button')].map(b=>b.getAttribute('aria-label'))`)
  assert.equal(labels[labels.indexOf('插件管理') + 1], '计划')
  await evaluate(`document.querySelector('.sidebar-navigation [aria-label="计划"]').click()`)
  for (let i=0;i<100;i++) { if(await evaluate(`Boolean(document.querySelector('.planning-calendar-grid'))`))break;await wait(100) }
  assert.equal(await evaluate(`document.querySelectorAll('.planning-calendar-grid [role="gridcell"]').length`),42)
  assert.equal(await evaluate(`document.querySelector('[aria-label="月视图"]').getAttribute('aria-selected')`),'true')
  await evaluate(`document.querySelector('[aria-label="周视图"]').click()`)
  assert.equal(await evaluate(`document.querySelectorAll('.planning-time-column').length`),7)
  await evaluate(`document.querySelector('[aria-label="单日视图"]').click()`)
  assert.equal(await evaluate(`document.querySelectorAll('.planning-time-column').length`),1)
  await evaluate(`document.querySelector('[aria-label="月视图"]').click()`)
  report.checks.push('Installed calendar defaults to month and switches between seven-day week and single-day time grids')
  const today = await evaluate(`(()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')})()`)
  const saved = await evaluate(`window.singularity.planning.savePlan({title:'安装验证计划',note:'隔离验证数据',date:${JSON.stringify(today)},time:'',categoryId:'plan-reading',priority:'important',repeat:'none',until:''})`)
  await evaluate(`window.singularity.planning.complete(${JSON.stringify(saved.plans[0].id)},${JSON.stringify(today)},true)`)
  await evaluate(`([...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='我的画廊')).click()`)
  for(let i=0;i<100;i++){if(await evaluate(`document.querySelectorAll('.planning-art-card.unlocked').length===1`))break;await wait(100)}
  assert.equal(await evaluate(`document.querySelectorAll('.planning-art-card.unlocked').length`),1)
  await evaluate(`document.querySelectorAll('.planning-art-thumb img').forEach(img=>img.loading='eager')`)
  for(let i=0;i<100;i++){if(await evaluate(`[...document.querySelectorAll('.planning-art-thumb img')].every(img=>img.complete&&img.naturalWidth>0)`))break;await wait(100)}
  assert.equal(await evaluate(`[...document.querySelectorAll('.planning-art-thumb img')].filter(img=>img.complete&&img.naturalWidth>0).length`),6)
  const galleryCapture=await call('Page.captureScreenshot',{format:'png'})
  fs.writeFileSync(path.join(output,'installed-gallery.png'),Buffer.from(galleryCapture.result.data,'base64'))
  report.checks.push('Installed Plans rail, month calendar, secure persistence, completion reward and separate gallery work; all six bundled museum paintings load locally')
  report.localSpeech = await evaluate(`(async()=>{const id=await window.singularity.voice.start();try{const wave=await window.singularity.voice.speak(id,'你好，今天我们一起讨论科学研究。');const result=await window.singularity.voice.listen(id,wave.audio);return{provider:wave.provider,recognized:result.text,confidence:result.confidence}}finally{await window.singularity.voice.stop(id)}})()`)
  assert.equal(report.localSpeech.provider,'windows')
  assert.ok(report.localSpeech.recognized.includes('研究'))
  report.checks.push('Packaged Windows synthesis and revised recognition round-trip succeeds through real voice IPC with local test audio; no physical microphone or paid service is used')
  // Chromium Browser.close requests a normal application shutdown, including
  // the existing before-quit handler that stops the research runtime.
  socket.send(JSON.stringify({ id: ++nextId, method: 'Browser.close' }))
  for (let attempt = 0; attempt < 80 && child.exitCode === null; attempt++) await wait(250)
  assert.notEqual(child.exitCode, null, 'smoke application shuts down normally')
  report.checks.push('Isolated smoke application exits normally; real application data was not used')
}
main().catch(error => { report.error = String(error.stack || error); process.exitCode = 1 }).finally(async () => {
  if (child?.exitCode === null && socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ id: 999999, method: 'Browser.close' }))
    for (let attempt = 0; attempt < 40 && child.exitCode === null; attempt++) await wait(250)
  }
  socket?.close()
  if (child?.exitCode === null) child.kill()
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
})
