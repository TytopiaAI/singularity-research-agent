/* Production voice UI + service using an isolated encrypted dummy key and offline audio. */
const { app, BrowserWindow, ipcMain } = require('electron')
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const root = path.resolve(__dirname, '..'), output = path.join(root, '.local-data', 'breeze-voice-verification', String(Date.now()))
fs.mkdirSync(output, { recursive: true }); app.setPath('userData', path.join(output, 'profile')); app.commandLine.appendSwitch('mute-audio')
const report = { output, checks: [], errors: [] }, wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const dummyKey = 'brz_offline_only_fixture_credential'
let win
async function until(fn, label) { for(let i=0;i<200;i++){if(await fn())return;await wait(50)}throw Error('Timeout: '+label) }
function wave() {
  const rate = 24000, frames = rate * 2, b = Buffer.alloc(44 + frames * 2)
  b.write('RIFF');b.writeUInt32LE(36+frames*2,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(frames*2,40)
  for(let i=0;i<frames;i++)b.writeInt16LE(Math.round(Math.sin(i*440*2*Math.PI/rate)*14000*(.5+.4*Math.sin(i/rate*8))),44+i*2)
  return b
}
async function main() {
  const esbuild=require('esbuild')
  await esbuild.build({entryPoints:[path.join(root,'src/main/breeze-voice.ts')],outfile:path.join(output,'service.cjs'),bundle:true,packages:'external',platform:'node',format:'cjs',logLevel:'silent'})
  await esbuild.build({entryPoints:[path.join(root,'scripts/fixtures/breeze-voice-settings.tsx')],outfile:path.join(output,'fixture.js'),bundle:true,platform:'browser',format:'esm',jsx:'automatic',logLevel:'silent'})
  fs.writeFileSync(path.join(output,'preload.cjs'), `const{contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('singularity',{voice:{settings:()=>ipcRenderer.invoke('fixture:settings'),saveSettings:v=>ipcRenderer.invoke('fixture:save',v),verifySettings:()=>ipcRenderer.invoke('fixture:verify'),capabilities:async()=>({recognition:false,synthesis:true,language:'zh-CN'}),start:async()=>'offline-session',stop:async()=>{},reply:()=>ipcRenderer.invoke('fixture:reply'),speak:(_id,text)=>ipcRenderer.invoke('fixture:speak',text)},papers:{list:async()=>[]},knowledge:{projects:async()=>[]},windowControls:{onConcealed:()=>()=>{}}});`)
  fs.writeFileSync(path.join(output,'index.html'),'<html lang="zh-CN" data-theme="light"><head><meta charset="utf-8"><link rel="stylesheet" href="fixture.css"></head><body><div id="root"></div><script type="module" src="fixture.js"></script></body></html>')
  await app.whenReady()
  const {BreezeVoice}=require(path.join(output,'service.cjs'))
  let requests=0,lookups=0,reply='这是离线语音接入验证。'
  const voice=new BreezeVoice(path.join(output,'config'),path.join(output,'cache'),async(_url,options)=>{if(options?.method==='POST'){requests++;return new Response(wave(),{headers:{'content-type':'audio/wav'}})}lookups++;return new Response('{}')})
  await voice.save({provider:'breezeblue',voiceId:'voc_offline_fixture',apiKey:dummyKey,monthlyCreditLimit:10000,replyCharacterLimit:1000})
  ipcMain.handle('fixture:settings',()=>voice.settings());ipcMain.handle('fixture:save',(_event,input)=>voice.save(input));ipcMain.handle('fixture:verify',()=>voice.verify());ipcMain.handle('fixture:reply',()=>reply);ipcMain.handle('fixture:speak',(_event,text)=>voice.speak(text,new AbortController().signal))
  win=new BrowserWindow({width:1440,height:1000,show:false,webPreferences:{preload:path.join(output,'preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false,offscreen:true,backgroundThrottling:false}})
  win.webContents.setAudioMuted(true)
  win.webContents.on('console-message',event=>{if(event.level==='error')report.errors.push(event.message)})
  await win.loadFile(path.join(output,'index.html'))
  const js=code=>win.webContents.executeJavaScript(code,true)
  const click=text=>js(`([...document.querySelectorAll('button')].find(b=>(b.getAttribute('aria-label')||b.textContent.trim())===${JSON.stringify(text)})).click()`)
  const input=(selector,value)=>js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  const capture=async name=>{await wait(200);fs.writeFileSync(path.join(output,name+'.png'),(await win.webContents.capturePage()).toPNG())}
  await until(()=>js(`!document.querySelector('.voice-start').disabled`),'voice capabilities')
  await click('语音设置');await until(()=>js(`Boolean(document.querySelector('dialog input[type="password"]'))`),'settings loaded')
  assert.equal(await js(`document.querySelector('input[type="password"]').value`),'')
  assert(!(await js(`document.body.textContent`)).includes(dummyKey))
  await click('保存并检查连接');await until(()=>js(`document.querySelector('dialog [role="status"]')?.textContent.includes('检查未生成音频')`),'non-billable verification')
  assert.equal(requests,0);assert.equal(lookups,1)
  await capture('voice-settings')
  await js(`document.querySelector('[aria-label="关闭语音设置"]').click()`)
  const submit=async()=>{await input('[aria-label="文字输入"]','测试声音');await js(`document.querySelector('.voice-input').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))`)}
  await submit();await until(()=>js(`document.querySelector('.voice-status').textContent.includes('正在说话')`),'decoded audio playback')
  await wait(350);await capture('cloud-voice-speaking');assert.equal(requests,1)
  await click('结束对话');await until(()=>js(`!document.querySelector('.voice-start')?.disabled`),'stopped playback')
  await submit();await until(()=>js(`document.querySelector('.voice-hint').textContent.includes('本地缓存')`),'cached playback')
  assert.equal(requests,1);await click('结束对话')
  report.checks.push('Real production settings save an encrypted key without rendering it; connection check only uses GET; decoded audio drives production playback; replay uses cache without another POST')
  await click('语音设置');await until(()=>js(`Boolean(document.querySelector('dialog input[type="number"]'))`),'budget settings')
  await input('dialog input[type="number"]','0');await click('保存设置');await until(()=>js(`document.querySelector('dialog [role="status"]')?.textContent.includes('已保存')`),'saved zero budget')
  await js(`document.querySelector('[aria-label="关闭语音设置"]').click()`)
  reply='这是一段未缓存的新回答。';await submit()
  await until(()=>js(`document.querySelector('.voice-error')?.textContent.includes('月度云端额度')`),'budget rejection')
  assert.equal(requests,1);assert((await js(`document.querySelector('.voice-caption').textContent`)).includes(reply))
  report.checks.push('Zero monthly budget blocks a new generation before any POST and preserves the full text answer')
  await click('语音设置');await until(()=>js(`Boolean(document.querySelector('dialog select'))`),'reopened settings')
  win.setSize(860,800);await js(`document.documentElement.dataset.theme='dark'`);await wait(250)
  assert(await js(`(()=>{const d=document.querySelector('dialog');return d.scrollWidth<=d.clientWidth+1&&d.getBoundingClientRect().right<=innerWidth})()`))
  await capture('voice-settings-dark-narrow')
  await js(`(()=>{const s=document.querySelector('dialog select');s.value='windows';s.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  await click('保存设置');await until(()=>js(`document.querySelector('dialog [role="status"]')?.textContent.includes('已保存')`),'local voice saved')
  assert.equal((await voice.settings()).provider,'windows');assert((await voice.settings()).hasCredential)
  report.checks.push('Dark/narrow dialog remains readable; local Windows voice can be restored without deleting the encrypted cloud credential')
  report.synthesisRequests=requests;report.voiceLookups=lookups;report.mode='offline audio and dummy credential; no network, actual microphone or paid requests'
  win.destroy()
}
main().catch(error=>report.errors.push(String(error.stack||error).replaceAll(dummyKey,'[REDACTED]'))).finally(()=>{if(win&&!win.isDestroyed())win.destroy();fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));app.exit(report.errors.length?1:0)})
