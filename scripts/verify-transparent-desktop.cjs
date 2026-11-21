// Actual development application over an isolated colored host window.
// Captures only the marker-validated test rectangle; never stores full-screen captures.
const {app,BrowserWindow,desktopCapturer,screen}=require('electron')
const fs=require('node:fs'),path=require('node:path'),net=require('node:net'),assert=require('node:assert/strict'),{spawn}=require('node:child_process')
const root=path.resolve(__dirname,'..'),output=path.join(root,'.local-data/transparent-desktop',String(Date.now()))
fs.mkdirSync(output,{recursive:true});app.setPath('userData',path.join(output,'driver-profile'))
app.on('window-all-closed',()=>{}) // Closing the small focus probe must not quit the test driver.
const report={output,checks:[],errors:[]},wait=ms=>new Promise(r=>setTimeout(r,ms));let host,child,connection,assistant
const store=path.join(root,'node_modules/.pnpm'),ffi=fs.readdirSync(store).find(name=>name.startsWith('koffi@'))
assert(ffi,'Installed native FFI is available for the test driver')
const koffi=require(path.join(store,ffi,'node_modules/koffi'))
const getPid=koffi.load('user32.dll').func('uint32 __stdcall GetWindowThreadProcessId(void *window,_Out_ uint32 *pid)')
const raise=koffi.load('user32.dll').func('bool __stdcall SetWindowPos(void *window,intptr after,int x,int y,int width,int height,uint32 flags)')
const show=koffi.load('user32.dll').func('bool __stdcall ShowWindow(void *window,int command)')
async function until(fn,label,time=120000){const began=Date.now();while(Date.now()-began<time){if(await fn())return;await wait(150)}throw Error('Timeout: '+label)}
async function connect(target){
 const socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise((done,reject)=>{socket.onopen=done;socket.onerror=reject})
 let id=0;const pending=new Map()
 socket.onmessage=e=>{const result=JSON.parse(e.data),p=pending.get(result.id);if(p){clearTimeout(p.timer);p.done(result);pending.delete(result.id)}}
 socket.onclose=()=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('Test target closed'))}pending.clear()}
 const call=(method,params={})=>new Promise((done,reject)=>{const n=++id;const timer=setTimeout(()=>{pending.delete(n);reject(Error('Diagnostic command timed out: '+method))},15000);pending.set(n,{done,reject,timer});socket.send(JSON.stringify({id:n,method,params}))})
 const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});assert(!r.error&&!r.result.exceptionDetails,'Isolated renderer evaluation succeeds');return r.result.result.value}
 return {socket,call,evaluate}
}
async function capture(label,bounds,reversed=false){
 const display=screen.getDisplayMatching(bounds),physical=screen.dipToScreenRect(null,bounds),origin=screen.dipToScreenPoint({x:display.bounds.x,y:display.bounds.y})
 const sources=await desktopCapturer.getSources({types:['screen'],thumbnailSize:{width:Math.round(display.size.width*display.scaleFactor),height:Math.round(display.size.height*display.scaleFactor)}})
 const source=sources.find(s=>s.display_id===String(display.id));assert(source)
 const rect={x:physical.x-origin.x,y:physical.y-origin.y,width:physical.width,height:physical.height},size=source.thumbnail.getSize()
 assert(rect.x>=0&&rect.y>=0&&rect.x+rect.width<=size.width&&rect.y+rect.height<=size.height)
 const crop=source.thumbnail.crop(rect),s=crop.getSize(),data=crop.toBitmap(),scale=display.scaleFactor
 const pixel=(x,y)=>[...data.subarray((Math.floor(y)*s.width+Math.floor(x))*4,(Math.floor(y)*s.width+Math.floor(x))*4+4)]
 assert([25*scale,s.width-25*scale].every(x=>{const t=pixel(x,8*scale),b=pixel(x,s.height-8*scale);return t[0]>230&&t[1]<25&&t[2]>230&&b[0]<25&&b[1]>230&&b[2]<25}),'Controlled markers must match; discard unsafe capture')
 const left=pixel(s.width*.28,s.height*.27),right=pixel(s.width*.78,s.height*.27)
 fs.writeFileSync(path.join(output,label+'.png'),crop.toPNG())
 assert(reversed?left[2]-left[0]>35&&right[0]-right[2]>35:left[0]-left[2]>35&&right[2]-right[0]>35,'Native desktop colors remain visible through the actual application')
 report.checks.push({label,left,right})
}
async function main(){
 await app.whenReady()
 const area=screen.getPrimaryDisplay().workArea,bounds={x:area.x+20,y:area.y+20,width:Math.min(1600,area.width-40),height:Math.min(1000,area.height-40)}
 assert(bounds.width>=1280&&bounds.height>=860,'Display fits the production minimum size')
 fs.writeFileSync(path.join(output,'host-bounds.json'),JSON.stringify(bounds))
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.SINGULARITY_PROBE_DISABLE_DCOMP
 host=spawn(process.execPath,[path.join(root,'scripts/backdrop-test-host.cjs'),'--background-host',output],{env,windowsHide:true,stdio:'ignore'})
 await until(()=>fs.existsSync(path.join(output,'host-ready.json')),'controlled background')
 const actual=JSON.parse(fs.readFileSync(path.join(output,'host-ready.json'),'utf8'))
 const data=path.join(output,'data');fs.mkdirSync(path.join(data,'config'),{recursive:true});fs.writeFileSync(path.join(data,'config/chat-appearance.json'),JSON.stringify({background:'transparent'}))
 const port=await new Promise(done=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const n=s.address().port;s.close(()=>done(n))})})
 const log=fs.openSync(path.join(output,'process.log'),'w')
 child=spawn(process.execPath,[path.join(root,'dist-electron/main.js'),'--remote-debugging-port='+port],{env:{...env,SINGULARITY_DATA_ROOT:data},windowsHide:true,stdio:['ignore',log,log]});fs.closeSync(log)
 let targets,target
 await until(async()=>{try{targets=await(await fetch('http://127.0.0.1:'+port+'/json')).json();target=targets.find(t=>t.type==='page'&&t.url.endsWith('/dist/index.html'));return !!target}catch{return false}},'application renderer')
 connection=await connect(target)
 const {call,evaluate}=connection
 await until(()=>evaluate(`Boolean(document.querySelector('.main-content'))`),'shell shown')
 const windows=await desktopCapturer.getSources({types:['window'],thumbnailSize:{width:0,height:0}})
 const owned=windows.find(s=>{if(!s.id.startsWith('window:'))return false;const pid=[0];getPid(BigInt(s.id.split(':')[1]),pid);return pid[0]===child.pid})
 assert(owned,'Find only the test application native window')
 const handle=BigInt(owned.id.split(':')[1])
 const position=(width,height)=>{const r=screen.dipToScreenRect(null,{x:bounds.x+50,y:bounds.y+50,width,height});assert(raise(handle,-1,r.x,r.y,r.width,r.height,0x10))}
 position(bounds.width-100,bounds.height-100)
 await call('Page.bringToFront')
 await until(()=>evaluate(`Boolean(document.querySelector('.main-content[data-chat-theme="transparent"]'))&&!document.querySelector('.startup-splash')`),'transparent shell')
 report.styles=await evaluate(`['html','body','#root','.app-shell','.main-content'].map(s=>{const e=document.querySelector(s),c=getComputedStyle(e);return {selector:s,background:c.backgroundColor,colorScheme:c.colorScheme,theme:e.dataset.theme}})`)
 await wait(500);await capture('native-shell',actual)
 await until(()=>evaluate(`window.singularity.runtime.get().then(s=>s.phase==='ready')`),'runtime ready')
 await until(()=>{const file=path.join(data,'logs/main.log');return fs.existsSync(file)&&fs.readFileSync(file,'utf8').includes('Harness view loaded')},'native assistant view')
 await wait(600);await capture('native-home',actual)
 fs.writeFileSync(path.join(output,'host-flip'),'')
 await until(()=>fs.existsSync(path.join(output,'host-flipped'))&&fs.readFileSync(path.join(output,'host-flipped'),'utf8')==='true','live background change')
 await wait(300);await capture('native-live-background',actual,true)
 fs.rmSync(path.join(output,'host-flip'))
 await until(()=>fs.readFileSync(path.join(output,'host-flipped'),'utf8')==='false','background restored')
 const focus=new BrowserWindow({x:bounds.x+Math.floor(bounds.width/2)-60,y:bounds.y+20,width:120,height:24,frame:false,show:false,webPreferences:{sandbox:true,contextIsolation:true}})
 await focus.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<style>body{margin:0;background:#172034;color:white;font:12px Segoe UI;text-align:center}</style>测试窗口 · 失焦'))
 focus.setAlwaysOnTop(true);focus.show();focus.moveTop();focus.focus();await wait(350)
 try{await capture('native-inactive',actual)}finally{focus.destroy()}
 await call('Page.bringToFront')
 targets=await(await fetch('http://127.0.0.1:'+port+'/json')).json()
 const runtime=await evaluate('window.singularity.runtime.get()')
 assistant=await connect(targets.find(t=>t.type==='page'&&t.url.startsWith(runtime.url)))
 const choose=async value=>{
  await assistant.evaluate(`document.querySelector('.chat-theme-trigger').click();document.querySelector('.chat-theme-option[data-chat-theme="${value}"]').click()`)
  await until(()=>evaluate(`document.querySelector('.main-content').dataset.chatTheme==='${value}'`),'theme '+value)
 }
 await choose('blue');await choose('transparent');await wait(400);await capture('native-theme-restored',actual)
 show(handle,6);await wait(250)
 show(handle,9);await call('Page.bringToFront');await wait(400);await capture('native-after-restore',actual)
 show(handle,3);await wait(300);show(handle,9);position(bounds.width-100,bounds.height-100);await call('Page.bringToFront');await wait(300);await capture('native-after-maximize',actual)
 await evaluate(`document.querySelector('.sidebar-navigation [aria-label="语音对话"]').click()`)
 await until(()=>evaluate(`Boolean(document.querySelector('.voice-minimal'))`),'voice page');await wait(300);await capture('native-voice',actual)
 position(bounds.width-140,bounds.height-120);await wait(300)
 assert(await evaluate(`document.querySelector('.main-content').scrollWidth<=document.querySelector('.main-content').clientWidth+1`),'Resized transparent window keeps a usable layout')
 report.checks.push('Actual home, theme toggle, minimize/restore, voice navigation and resize verified; no real data or paid API used')
 connection.socket.send(JSON.stringify({id:999998,method:'Browser.close'}));await until(()=>child.exitCode!==null,'normal shutdown',15000)
}
main().catch(e=>report.errors.push(String(e.stack||e))).finally(async()=>{
 if(child?.exitCode===null&&connection?.socket.readyState===WebSocket.OPEN){connection.socket.send(JSON.stringify({id:999999,method:'Browser.close'}));for(let i=0;i<50&&child.exitCode===null;i++)await wait(100)}
 if(child?.exitCode===null)child.kill();connection?.socket.close();assistant?.socket.close()
 fs.writeFileSync(path.join(output,'host-stop'),'');if(host){for(let i=0;i<30&&host.exitCode===null;i++)await wait(100);if(host.exitCode===null)host.kill()}
 fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));app.exit(report.errors.length?1:0)
})
