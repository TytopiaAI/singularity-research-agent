/* Build an offline preview, then record a short MP4 using the production renderer. */
const {app,BrowserWindow}=require('electron')
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process')
const root=path.resolve(__dirname,'..'),out=path.join(root,'.local-data','armor-preview')
fs.mkdirSync(out,{recursive:true});app.setPath('userData',path.join(out,'electron-data'))
const wait=ms=>new Promise(r=>setTimeout(r,ms))
let win
async function captureHelmet(){
 win.setContentSize(640,760)
 await win.webContents.executeJavaScript(`document.querySelector('.armor-svg').setAttribute('viewBox','485 65 190 300');document.querySelector('.armor-scene').style.cssText='width:580px;height:680px;aspect-ratio:auto;top:50%';document.querySelectorAll('.armor-sparks,.armor-caption,.armor-corner,.replay').forEach(el=>el.style.display='none')`)
 await wait(100)
 fs.writeFileSync(path.join(out,'armor-helmet.png'),(await win.webContents.capturePage()).toPNG())
}
async function main(){
 const contents=`import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{StartupSplash}from'./src/renderer/StartupSplash';import './src/renderer/startup.css';window.singularity={windowControls:{minimize:()=>{},toggleMaximize:()=>{},close:()=>{}}};function Preview(){const [key,setKey]=useState(0);window.replay=()=>setKey(v=>v+1);return <><StartupSplash key={key} variant="armor" ready={false}/><button className="replay" onClick={()=>setKey(v=>v+1)}>↻ 重播动画</button></>}createRoot(document.getElementById('root')).render(<Preview/>);`
 await require('esbuild').build({stdin:{contents,resolveDir:root,loader:'tsx'},bundle:true,format:'iife',platform:'browser',jsx:'automatic',loader:{'.png':'dataurl'},define:{'import.meta.env.BASE_URL':'"./"'},outfile:path.join(out,'preview.js')})
 fs.writeFileSync(path.join(out,'index.html'),`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Singularity · Armor</title><link rel="stylesheet" href="preview.css"><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden;background:#050508}body{font-family:system-ui,sans-serif}button{cursor:pointer}.startup-window-actions{display:none}.replay{position:fixed;right:26px;bottom:24px;z-index:101;border:1px solid #a46d3f66;border-radius:20px;padding:9px 16px;background:#100a09;color:#d0ab7c;font-size:11px}</style></head><body><div id="root"></div><script src="preview.js"></script></body></html>`)
 await app.whenReady();win=new BrowserWindow({width:1280,height:800,frame:false,show:false,webPreferences:{offscreen:true,backgroundThrottling:false}})
 // Deterministically sample at 30 fps; recording speed must not depend on the desktop GPU.
 fs.writeFileSync(path.join(out,'clock.js'),`window.__clock=0;let callbacks=new Map(),serial=0;window.requestAnimationFrame=cb=>{callbacks.set(++serial,cb);return serial};window.cancelAnimationFrame=id=>callbacks.delete(id);performance.now=()=>window.__clock;window.__step=t=>{window.__clock=t;const pending=[...callbacks.values()];callbacks.clear();pending.forEach(cb=>cb(t));document.getAnimations().forEach(a=>{a.pause();a.currentTime=t})};`)
 fs.writeFileSync(path.join(out,'record.html'),fs.readFileSync(path.join(out,'index.html'),'utf8').replace('<script src="preview.js">','<script src="clock.js"></script><script src="preview.js">'))
 win.webContents.on('console-message',event=>{if(event.level==='error')console.error(event.message)})
 await win.loadFile(path.join(out,'record.html'))
 await wait(300)
 if(process.argv.includes('--still')){
  await win.webContents.executeJavaScript('window.__step(6000)')
  await wait(100)
  fs.writeFileSync(path.join(out,'armor-complete.png'),(await win.webContents.capturePage()).toPNG())
  await captureHelmet();console.log(JSON.stringify({still:path.join(out,'armor-complete.png'),helmet:path.join(out,'armor-helmet.png')}));return
 }
 const encoder=spawn('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','image2pipe','-framerate','30','-i','pipe:0','-an','-c:v','libx264','-preset','fast','-crf','19','-pix_fmt','yuv420p',path.join(out,'armor-startup.mp4')],{windowsHide:true})
 let encoderError='';encoder.stderr.on('data',c=>encoderError+=c);encoder.on('error',e=>encoderError+=String(e))
 let frames=0
 encoder.stdin.on('error',()=>{})
 for(let i=0;i<210;i++){
  await win.webContents.executeJavaScript(`window.__step(${i*1000/30})`)
  const shot=await win.webContents.capturePage()
  if(i===180)fs.writeFileSync(path.join(out,'armor-complete.png'),shot.toPNG())
  if(!encoder.stdin.write(shot.toPNG()))await new Promise(r=>encoder.stdin.once('drain',r))
  frames++
 }
 encoder.stdin.end()
 const code=await new Promise(resolve=>encoder.on('close',resolve));if(code!==0)throw Error(encoderError)
 if(frames<120)throw Error('Recording did not produce enough frames: '+frames)
 await captureHelmet()
 console.log(JSON.stringify({output:out,frames,preview:path.join(out,'index.html'),video:path.join(out,'armor-startup.mp4')}))
}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{if(win&&!win.isDestroyed())win.destroy();app.exit(process.exitCode||0)})
