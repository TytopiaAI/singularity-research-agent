/* Isolated Electron smoke check. Uses a local mock model; never reads installed credentials. */
const { app, BrowserWindow, dialog } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const assert = require('node:assert/strict')
const { pathToFileURL } = require('node:url')
const root = path.resolve(__dirname, '..')
const output = path.join(root, '.local-data', 'voice-verification', String(Date.now()))
fs.mkdirSync(output, { recursive: true })
process.env.SINGULARITY_PROJECT_ROOT = root
process.env.SINGULARITY_DATA_ROOT = path.join(output, 'data')
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function until(fn, label, timeout = 45000) {
  const started = Date.now()
  while (Date.now() - started < timeout) { if (await fn()) return; await wait(100) }
  throw new Error(`Timeout: ${label}`)
}
const report = { output, checks: [], errors: [] }
dialog.showErrorBox = (title, message) => { report.errors.push(`${title}: ${message}`) }
let server
async function main() {
  let requests = 0
  server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      const input = JSON.parse(body)
      requests++
      assert.equal(input.messages.at(-1).content, '你好，介绍一下自己。')
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { content: '你好，我是 Singularity。很高兴和你交流，我们可以一起聊聊研究中的新想法。' }, finish_reason: 'stop' }] }))
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  await import(pathToFileURL(path.join(root, 'dist-electron', 'main.js')).href)
  let win
  await until(() => { win = BrowserWindow.getAllWindows()[0]; return !!win }, 'window')
  win.webContents.setAudioMuted(true)
  win.webContents.on('console-message', (_e, level, message) => { if (level >= 3) report.errors.push(message) })
  const js = (code) => win.webContents.executeJavaScript(code, true).catch((error) => { throw new Error(`${error.message}
  in: ${code.slice(0, 160)}`) })
  await until(() => js('Boolean(window.singularity && document.querySelector(".sidebar-navigation"))').catch(() => false), 'shell')
  await until(() => js('!document.querySelector(".startup-active")'), 'startup', 90000)
  // The ready status precedes the native assistant's loadURL completion.
  // Do not restart its provider while bootstrap is still loading that view.
  await until(() => {
    const native = win.contentView.children.find((view) => view.webContents && view.webContents !== win.webContents)
    return native && native.webContents.getURL().startsWith('http://127.0.0.1:') && !native.webContents.isLoading()
  }, 'assistant initial navigation')
  await js(`window.singularity.providers.save({kind:'openai-compatible',displayName:'Local voice verification',baseUrl:'http://127.0.0.1:${server.address().port}/v1',modelId:'voice-test',maxOutputTokens:8192,apiKey:'local-test-key'}).catch(e => { if (!String(e).includes('ERR_FAILED')) throw e })`)
  await js(`document.querySelector('[aria-label="语音对话"]').click()`)
  await until(() => js('Boolean(document.querySelector(".voice-start:not(:disabled)"))'), 'native capabilities')
  report.capabilities = await js('window.singularity.voice.capabilities()')
  assert(report.capabilities.recognition && report.capabilities.synthesis, 'Chinese speech missing')
  report.checks.push('Windows Chinese recognition and synthesis detected')
  win.setSize(1360, 900)
  await wait(500)
  fs.writeFileSync(path.join(output, 'voice-idle.png'), (await win.webContents.capturePage()).toPNG())
  await js(`(() => {const input=document.querySelector('.voice-input input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'你好，介绍一下自己。');input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  await wait(100)
  await js(`document.querySelector('.voice-input').requestSubmit()`)
  report.timeline = []
  process.on('exit', () => fs.writeFileSync(path.join(output, 'timeline.json'), JSON.stringify(report.timeline, null, 1)))
  for (let i = 0; i < 50; i++) { report.timeline.push(await js(`[document.querySelector('.voice-status')?.textContent, document.querySelector('.voice-hint')?.textContent, document.querySelector('.voice-error')?.textContent ?? '', 'hidden=' + document.hidden, document.visibilityState].join(' | ')`)); await wait(150) }
  await until(() => js('document.querySelector(".voice-status")?.textContent.includes("正在说话")'), 'actual WAV playback')
  report.checks.push('Text → configured model endpoint → native Chinese WAV → Web Audio playback')
  assert.equal(requests, 1)
  fs.writeFileSync(path.join(output, 'voice-speaking.png'), (await win.webContents.capturePage()).toPNG())
  await js(`Array.from(document.querySelectorAll('.voice-controls button')).find(b=>b.textContent.includes('结束对话')).click()`)
  await wait(300)
  assert(await js('Boolean(document.querySelector(".voice-start"))'))
  report.checks.push('Stop releases playback and restores start control')
  await js(`document.querySelector('.voice-start').click()`)
  await until(() => js('document.querySelector(".voice-status")?.textContent.includes("我在听")'), 'listen start')
  await wait(3000)
  assert(await js('document.querySelector(".voice-status")?.textContent.includes("我在听")'), 'Microphone failed to remain in listening state')
  assert.equal(await js('document.querySelector(".voice-error")?.textContent || ""'), '')
  await js(`document.querySelector('[aria-label="科研发现"]').click()`)
  await wait(600)
  assert.equal(await js('Boolean(document.querySelector(".voice-workspace"))'), false)
  assert.equal(requests, 1, 'Navigation must not send a microphone transcript')
  report.checks.push('Navigation cancels microphone operation without additional model requests')
  assert.deepEqual(report.errors, [], 'Unexpected desktop errors')
  console.log(JSON.stringify(report, null, 2))
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
}
main().catch((error) => { report.errors.push(String(error)); fs.writeFileSync(path.join(output, 'failed.json'), JSON.stringify(report, null, 2)); console.error(error); process.exitCode = 1 }).finally(() => { server?.close(); app.quit() })
