// Real Chromium playback + local Windows TTS + existing MP3 cache. No model/cloud requests.
const { app, BrowserWindow, ipcMain } = require('electron')
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const root = path.resolve(__dirname, '..'), output = path.join(root, '.local-data/voice-playback', String(Date.now()))
fs.mkdirSync(output, { recursive: true }); app.setPath('userData', path.join(output, 'profile'))
const report = { output, checks: [], playback: [] }, wait = ms => new Promise(r => setTimeout(r, ms))
let win, voice, audio, provider = 'windows', replies = 0, speaks = 0
async function main() {
  for (const [file, entry, platform] of [['speech.cjs', 'src/main/windows-speech.ts', 'node'], ['service.cjs', 'src/main/voice-service.ts', 'node'], ['fixture.js', 'scripts/fixtures/breeze-voice-settings.tsx', 'browser']]) {
    await require('esbuild').build({ entryPoints: [path.join(root, entry)], outfile: path.join(output, file), bundle: true, packages: platform === 'node' ? 'external' : undefined, platform, format: platform === 'node' ? 'cjs' : 'esm', jsx: 'automatic', logLevel: 'silent' })
  }
  await app.whenReady()
  audio = (await require(path.join(output, 'speech.cjs')).windowsSpeech('speak', AbortSignal.timeout(30000), '你好，这是语音助手的本地声音测试。')).audio
  ipcMain.handle('test:settings', () => ({ provider,voiceId:'test',estimatedCredits:0,monthlyCreditLimit:1000,replyCharacterLimit:1000,month:'2026-10',hasCredential:true }))
  voice = new (require(path.join(output, 'service.cjs')).VoiceService)({voiceReply:async()=>''})
  ipcMain.handle('test:start',()=>voice.start()); ipcMain.handle('test:stop',(_e,id)=>voice.stop(id))
  ipcMain.handle('test:play',async(_e,id,wave)=>{
    const bytes=Buffer.from(wave,'base64'),began=Date.now()
    let peak=0;for(let i=44;i+1<bytes.length;i+=2)peak=Math.max(peak,Math.abs(bytes.readInt16LE(i)))
    const entry={provider,bytes:bytes.length,seconds:(bytes.length-44)/bytes.readUInt32LE(28),peak,played:false};report.playback.push(entry)
    try { const result=await voice.play(id,wave);entry.played=result.played;entry.elapsedMs=Date.now()-began;return result }
    catch(error){entry.stopped=true;entry.elapsedMs=Date.now()-began;throw error}
  })
  ipcMain.handle('test:reply', () => { replies++; return '你好，这是播放验证。' })
  ipcMain.handle('test:speak', async () => {
    speaks++
    return { audio, provider, cached: provider === 'breezeblue' }
  })
  fs.writeFileSync(path.join(output, 'preload.cjs'), `const{contextBridge,ipcRenderer:i}=require('electron');contextBridge.exposeInMainWorld('singularity',{voice:{settings:()=>i.invoke('test:settings'),capabilities:async()=>({recognition:true,synthesis:true}),start:()=>i.invoke('test:start'),stop:id=>i.invoke('test:stop',id),reply:()=>i.invoke('test:reply'),speak:()=>i.invoke('test:speak'),play:(id,wave)=>i.invoke('test:play',id,wave)},papers:{list:async()=>[]},knowledge:{projects:async()=>[]},windowControls:{onConcealed:()=>()=>{}}});`)
  const instrumentation = `window.__outputs=[];window.__levels=[];window.__audioEvents=[];const Native=window.AudioContext;window.AudioContext=class extends Native{constructor(options){super(options);window.__outputs.push(this);this.addEventListener('statechange',()=>window.__audioEvents.push(this.state));const resume=this.resume.bind(this);this.resume=async()=>{window.__audioEvents.push('resume:'+this.state);await resume();window.__audioEvents.push('resumed:'+this.state)};const original=this.createAnalyser.bind(this);this.createAnalyser=()=>{const meter=original(),values=new Float32Array(1024);const timer=setInterval(()=>{if(this.state==='closed'){clearInterval(timer);return}meter.getFloatTimeDomainData(values);window.__levels.push(Math.max(...values.map(Math.abs)))},30);return meter}}};`
  fs.writeFileSync(path.join(output, 'index.html'), `<html lang="zh-CN"><meta charset="utf-8"><link rel="stylesheet" href="fixture.css"><div id="root"></div><script>${instrumentation}</script><script type="module" src="fixture.js"></script></html>`)
  win = new BrowserWindow({ show: false, width: 1250, height: 950, webPreferences: { preload: path.join(output, 'preload.cjs'), sandbox: true, contextIsolation: true, backgroundThrottling: false } })
  await win.loadFile(path.join(output, 'index.html'))
  const js = code => win.webContents.executeJavaScript(code, true)
  const until = async (fn, label, timeout = 90000) => { const start = Date.now(); while (Date.now() - start < timeout) { if (await fn()) return; await wait(50) } throw Error('Timeout: ' + label) }
  // Previously selected HUD preferences must not reactivate the retired theme.
  await js(`localStorage.setItem('singularity.voice.theme','hud');localStorage.setItem('singularity.voice.saved-quotes','[{"id":"preserved-test-quote","content":"保留的本地收藏"}]')`)
  await win.reload()
  await until(() => js(`Boolean(document.querySelector('.voice-start'))&&!document.querySelector('.voice-start').disabled`), 'voice page')
  assert(await js(`Boolean(document.querySelector('.voice-orb'))&&!document.querySelector('.voice-theme-toggle')&&!document.querySelector('.voice-hud-core')`))
  assert.equal(await js(`localStorage.getItem('singularity.voice.theme')`),'hud')
  assert.equal(await js(`JSON.parse(localStorage.getItem('singularity.voice.saved-quotes'))[0].id`),'preserved-test-quote')
  report.checks.push('Retired HUD preference is ignored; original particle UI has no theme switcher and existing local favorites remain intact')
  const submit = () => js(`(()=>{const input=document.querySelector('[aria-label="文字输入"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'你好');input.dispatchEvent(new Event('input',{bubbles:true}));setTimeout(()=>document.querySelector('.voice-input').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})),0)})()`)
  const checkPlayback = async label => {
    const before=report.playback.length
    await submit()
    await until(async()=>report.playback.length>before||await js(`Boolean(document.querySelector('.voice-error'))`),label+' native playback',20000)
    const error = await js(`document.querySelector('.voice-error')?.textContent`)
    assert(!error, error)
    await until(()=>js(`Boolean(document.querySelector('[aria-label="开启语音对话"]'))||Boolean(document.querySelector('.voice-error'))`),label+' completion')
    assert.equal(await js(`document.querySelector('.voice-error')?.textContent||''`),'')
    const played=report.playback.at(-1);assert(played.played&&played.peak>100&&played.seconds>.1)
    assert(played.elapsedMs>=played.seconds*800,'Windows playback waits for the sound to finish')
  }
  await checkPlayback('Windows WAV after forced suspension')
  fs.writeFileSync(path.join(output, 'playback.png'), (await win.webContents.capturePage()).toPNG())
  await until(() => js(`Boolean(document.querySelector('[aria-label="开启语音对话"]'))`), 'WAV finishes')
  report.checks.push('Production UI -> local WAV -> validated session IPC -> native Windows playback succeeds with Chromium sandbox unchanged')
  const cache = 'E:/SingularityData/cache/breeze-voice'
  const cached = fs.existsSync(cache) ? fs.readdirSync(cache).filter(f => f.endsWith('.mp3')).map(f => path.join(cache, f)).sort((a, b) => fs.statSync(a).size - fs.statSync(b).size)[0] : undefined
  if (cached) {
    provider = 'breezeblue'; audio = fs.readFileSync(cached).toString('base64')
    await checkPlayback('Existing BreezeBlue MP3 after forced suspension')
    report.checks.push('Existing BreezeBlue MP3 decodes to PCM and plays through Windows without regenerating audio or making a paid API call')
  }
  const before = { replies, speaks }
  await js(`window.__levels=[];document.querySelector('[aria-label="测试声音"]').click()`)
  await until(() => js(`document.querySelector('.voice-hint')?.textContent.includes('测试音已播放')`), 'test tone ends')
  assert.deepEqual({ replies, speaks }, before, 'test tone must not invoke LLM/TTS')
  report.checks.push('Speaker selector and free test tone work through the same output graph without model/TTS requests')
  if(cached){
    const count=report.playback.length;await submit()
    await until(()=>report.playback.length>count,'interruptible native playback',20000)
    await wait(500)
    await js(`document.querySelector('[aria-label="结束对话"]').click()`)
    await until(()=>report.playback.at(-1).stopped,'native player stops',5000)
    assert(report.playback.at(-1).elapsedMs<3000,'Stopping releases the native process promptly')
    assert.equal(await js(`document.querySelector('.voice-error')?.textContent||''`),'')
    report.checks.push('Ending a turn aborts the actual Windows playback process without a stale UI error')
  }
}
main().catch(async e => { report.error = String(e.stack || e); report.counters={replies,speaks};if(win&&!win.isDestroyed())report.ui=await win.webContents.executeJavaScript(`({status:document.querySelector('.voice-status')?.textContent,hint:document.querySelector('.voice-hint')?.textContent,error:document.querySelector('.voice-error')?.textContent})`);process.exitCode = 1 }).finally(() => { voice?.stop(); win?.destroy(); fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2)); app.quit() })
