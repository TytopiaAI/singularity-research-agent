/* Actual Chromium microphone capture -> production IPC -> Windows ASR.
 * Uses a synthesized local WAV as a fake device. No physical mic, model, or paid API. */
const {app,BrowserWindow,ipcMain} = require('electron')
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict')
const root=path.resolve(__dirname,'..'), output=path.join(root,'.local-data','voice-recognition',String(Date.now()))
fs.mkdirSync(output,{recursive:true});app.setPath('userData',path.join(output,'profile'))
app.commandLine.appendSwitch('use-fake-ui-for-media-stream')
app.commandLine.appendSwitch('use-fake-device-for-media-stream')
app.commandLine.appendSwitch('use-file-for-fake-audio-capture',path.join(output,'input.wav'))
app.commandLine.appendSwitch('mute-audio')
const report={output,checks:[]}, wait=ms=>new Promise(r=>setTimeout(r,ms))
let win,voice
async function main(){
  const build=require('esbuild').build
  for(const [file,entry,platform] of [['speech.cjs','src/main/windows-speech.ts','node'],['service.cjs','src/main/voice-service.ts','node'],['fixture.js','scripts/fixtures/breeze-voice-settings.tsx','browser']])await build({entryPoints:[path.join(root,entry)],outfile:path.join(output,file),bundle:true,packages:platform==='node'?'external':undefined,platform,format:platform==='node'?'cjs':'esm',jsx:'automatic',logLevel:'silent'})
  await app.whenReady()
  const {windowsSpeech}=require(path.join(output,'speech.cjs'))
  const spoken=await windowsSpeech('speak',AbortSignal.timeout(30000),'你好，今天我们一起讨论科学研究。')
  // Add 9 seconds of waiting before quiet speech: the previous recognizer gave up at 8s.
  const original=Buffer.from(spoken.audio,'base64'),rate=original.readUInt32LE(24)
  let offset=12,data
  while(offset+8<=original.length){const n=original.readUInt32LE(offset+4);if(original.toString('ascii',offset,offset+4)==='data'){data=original.subarray(offset+8,offset+8+n);break}offset+=8+n+(n%2)}
  assert(data)
  const manual=process.argv.includes('--manual')
  const body=Buffer.alloc(rate*2*9+data.length+rate*2*(manual?18:3))
  for(let i=0;i<data.length;i+=2)body.writeInt16LE(Math.round(data.readInt16LE(i)*.04),rate*2*9+i)
  if(manual)for(let i=rate*2*9+data.length;i<body.length;i+=2)body.writeInt16LE(Math.round(Math.sin(i/rate*Math.PI*800)*140),i)
  const header=Buffer.alloc(44);header.write('RIFF');header.writeUInt32LE(36+body.length,4);header.write('WAVEfmt ',8);header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(1,22);header.writeUInt32LE(rate,24);header.writeUInt32LE(rate*2,28);header.writeUInt16LE(2,32);header.writeUInt16LE(16,34);header.write('data',36);header.writeUInt32LE(body.length,40)
  fs.writeFileSync(path.join(output,'input.wav'),Buffer.concat([header,body]))
  const multiBody=Buffer.concat([Buffer.alloc(rate*2*9),data,Buffer.alloc(rate*2*2),data,Buffer.alloc(rate*2)])
  const multiHeader=Buffer.from(header);multiHeader.writeUInt32LE(36+multiBody.length,4);multiHeader.writeUInt32LE(multiBody.length,40)
  report.multiplePhrases=await windowsSpeech('listen',AbortSignal.timeout(55000),Buffer.concat([multiHeader,multiBody]).toString('base64'))
  assert((report.multiplePhrases.text.match(/研究/g)||[]).length>=2,'Recognition must continue across phrases after long initial silence')
  const {VoiceService}=require(path.join(output,'service.cjs'))
  let replies=0
  voice=new VoiceService({voiceReply:async messages=>{replies++;report.sentText=messages.at(-1).content;return '已收到语音问题。'}})
  ipcMain.handle('test:capabilities',async()=>({...await voice.capabilities(),synthesis:false}))
  ipcMain.handle('test:start',()=>voice.start());ipcMain.handle('test:stop',(_e,id)=>voice.stop(id))
  ipcMain.handle('test:listen',async(_e,id,audio)=>{
    const bytes=Buffer.from(audio,'base64');report.capture={bytes:bytes.length,rate:bytes.readUInt32LE(24),seconds:(bytes.length-44)/2/bytes.readUInt32LE(24)}
    const result=await voice.listen(id,audio);report.recognition=result;return result
  })
  ipcMain.handle('test:reply',(_e,id,messages)=>voice.reply(id,messages))
  fs.writeFileSync(path.join(output,'preload.cjs'),`const{contextBridge,ipcRenderer:i}=require('electron');contextBridge.exposeInMainWorld('singularity',{voice:{settings:async()=>({provider:'windows'}),capabilities:()=>i.invoke('test:capabilities'),start:()=>i.invoke('test:start'),stop:id=>i.invoke('test:stop',id),listen:(id,audio)=>i.invoke('test:listen',id,audio),reply:(id,m)=>i.invoke('test:reply',id,m)},papers:{list:async()=>[]},knowledge:{projects:async()=>[]},windowControls:{onConcealed:()=>()=>{}}});`)
  fs.writeFileSync(path.join(output,'index.html'),'<html lang="zh-CN"><meta charset="utf-8"><link rel="stylesheet" href="fixture.css"><div id="root"></div><script type="module" src="fixture.js"></script></html>')
  win=new BrowserWindow({show:false,width:1250,height:950,webPreferences:{preload:path.join(output,'preload.cjs'),sandbox:true,contextIsolation:true,backgroundThrottling:false,offscreen:true}})
  await win.loadFile(path.join(output,'index.html'))
  const js=code=>win.webContents.executeJavaScript(code,true)
  for(let i=0;i<120;i++){if(await js(`!document.querySelector('.voice-start')?.disabled`))break;await wait(100)}
  await js(`document.querySelector('.voice-start').click()`)
  let capturedListening=false,manuallyFinished=false
  for(let i=0;i<600;i++){
    if(replies||await js(`Boolean(document.querySelector('.voice-error'))`))break
    if(!capturedListening&&await js(`document.querySelector('.voice-hint').textContent.includes('已收到声音')`)){
      capturedListening=true
      assert(await js(`Boolean(document.querySelector('[aria-label="麦克风输入音量"]'))`))
      assert(await js(`document.querySelector('.voice-input').getBoundingClientRect().bottom<document.querySelector('.voice-workspace').getBoundingClientRect().bottom`),'Text input must stay visible inside the voice viewport while recording')
      fs.writeFileSync(path.join(output,'listening.png'),(await win.webContents.capturePage()).toPNG())
    }
    if(manual&&!manuallyFinished&&await js(`Number(document.querySelector('.voice-input-level span')?.textContent.match(/([0-9]+) 秒/)?.[1]||0)>=15`)){
      await js(`([...document.querySelectorAll('button')].find(b=>b.textContent.includes('说完了'))).click()`);manuallyFinished=true
    }
    await wait(100)
  }
  report.ui=await js(`({status:document.querySelector('.voice-status').textContent,error:document.querySelector('.voice-error')?.textContent})`)
  fs.writeFileSync(path.join(output,'result.png'),(await win.webContents.capturePage()).toPNG())
  assert.equal(replies,1,'Captured microphone audio must produce text and one model turn')
  assert(report.sentText.includes('研究'), 'Recognized speech must contain the spoken subject')
  if(manual)assert(manuallyFinished,'Manual finish must work even with continuing background noise')
  report.checks.push('Production renderer records the fake microphone, ends on silence, sends WAV across IPC, Windows recognizes Chinese, and the recognized text reaches the conversation once')
}
main().catch(e=>{report.error=String(e.stack||e);process.exitCode=1}).finally(()=>{voice?.stop();win?.destroy();fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));app.quit()})
