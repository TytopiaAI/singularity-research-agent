/* Built desktop shell integration, separate data root, no installer or paid requests. */
const fs=require('node:fs'),path=require('node:path'),net=require('node:net'),assert=require('node:assert/strict')
const {spawn}=require('node:child_process')
const root=path.resolve(__dirname,'..'),output=path.join(root,'.local-data','planning-app-verification',String(Date.now()))
fs.mkdirSync(output,{recursive:true});const report={output,checks:[]},wait=ms=>new Promise(r=>setTimeout(r,ms))
let child,socket
async function main(){
  const port=await new Promise(resolve=>{const server=net.createServer();server.listen(0,'127.0.0.1',()=>{const value=server.address().port;server.close(()=>resolve(value))})})
  const env={...process.env,SINGULARITY_DATA_ROOT:path.join(output,'data')};delete env.ELECTRON_RUN_AS_NODE
  const log=fs.openSync(path.join(output,'process.log'),'w')
  // The application deliberately asks before closing. Answer "exit" in this
  // isolated verification process so no native confirmation blocks cleanup.
  fs.writeFileSync(path.join(output,'launch.cjs'),`const{dialog}=require('electron');dialog.showMessageBox=async()=>({response:1,checkboxChecked:false});dialog.showErrorBox=(title,message)=>console.error(title,message);import(${JSON.stringify(require('node:url').pathToFileURL(path.join(root,'dist-electron/main.js')).href)});`)
  child=spawn(require('electron'),[path.join(output,'launch.cjs'),'--remote-debugging-port='+port],{cwd:root,env,windowsHide:true,stdio:['ignore',log,log]});fs.closeSync(log)
  let target
  for(let i=0;i<160;i++){try{target=(await(await fetch('http://127.0.0.1:'+port+'/json')).json()).find(t=>t.type==='page'&&t.url.endsWith('/dist/index.html'));if(target)break}catch{}await wait(200)}
  assert(target,'built desktop renderer loads')
  socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true})})
  let next=0;const pending=new Map()
  socket.addEventListener('message',event=>{const message=JSON.parse(event.data);if(pending.has(message.id)){pending.get(message.id)(message);pending.delete(message.id)}})
  const call=(method,params)=>new Promise(resolve=>{const id=++next;pending.set(id,resolve);socket.send(JSON.stringify({id,method,params}))})
  const js=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.error||r.result?.exceptionDetails)throw Error(JSON.stringify(r));return r.result.result.value}
  const until=async(fn,label,attempts=600)=>{for(let i=0;i<attempts;i++){if(await fn())return;await wait(200)}throw Error('Timeout: '+label)}
  await until(()=>js(`window.singularity?.runtime.get().then(r=>r.phase==='ready')`),'runtime ready')
  await until(()=>fs.existsSync(path.join(output,'data/logs/main.log'))&&fs.readFileSync(path.join(output,'data/logs/main.log'),'utf8').includes('Harness view loaded'),'native assistant load')
  await until(()=>js(`!document.querySelector('.startup-splash')`),'startup completes')
  const labels=await js(`[...document.querySelectorAll('.sidebar-navigation button')].map(b=>b.getAttribute('aria-label'))`)
  assert.equal(labels[labels.indexOf('插件管理')+1],'计划')
  await js(`document.querySelector('.sidebar-navigation [aria-label="计划"]').click()`)
  await until(()=>js(`Boolean(document.querySelector('.planning-calendar'))`),'planning route loads via real IPC')
  const data=await js(`window.singularity.planning.get()`)
  assert.equal(data.plans.length,0);assert(data.categories.length>=10)
  const day=await js(`(()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')})()`)
  const saved=await js(`window.singularity.planning.savePlan({title:'整应用验证计划',note:'隔离验证',date:${JSON.stringify(day)},time:'',categoryId:'plan-reading',priority:'important',repeat:'none',until:''})`)
  await js(`window.singularity.planning.complete(${JSON.stringify(saved.plans[0].id)},${JSON.stringify(day)},true)`)
  await js(`([...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='我的画廊')).click()`)
  await until(()=>js(`document.querySelectorAll('.planning-art-card.unlocked').length===1`),'first art unlock')
  assert.equal(await js(`document.querySelector('.sidebar-navigation [aria-label="计划"]').getAttribute('aria-current')`),'page')
  await js(`document.querySelectorAll('.planning-art-thumb img').forEach(img=>img.loading='eager')`)
  await until(async()=>{report.artworkImages=await js(`[...document.querySelectorAll('.planning-art-thumb img')].map(img=>({src:img.src,complete:img.complete,width:img.naturalWidth}))`);return report.artworkImages.every(img=>img.complete&&img.width>0)},'bundled artwork loads',60)
  const screenshot=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(output,'actual-app-gallery.png'),Buffer.from(screenshot.result.data,'base64'))
  report.checks.push('Actual built App places Plans directly below Plugins, opens the month planner through its secure IPC, persists a task, awards the first day, opens a separate gallery with the Plans rail active, and loads all six bundled paintings')
  socket.send(JSON.stringify({id:++next,method:'Browser.close'}))
  for(let i=0;i<150&&child.exitCode===null;i++)await wait(200)
  assert.notEqual(child.exitCode,null,'app exits normally with its runtime')
  report.checks.push('Built desktop app shuts down normally; all data is confined to the verification directory')
}
main().catch(e=>report.error=String(e.stack||e)).finally(async()=>{
  if(child?.exitCode===null&&socket?.readyState===WebSocket.OPEN){socket.send(JSON.stringify({id:999999,method:'Browser.close'}));for(let i=0;i<100&&child.exitCode===null;i++)await wait(200)}
  socket?.close();if(child?.exitCode===null)child.kill()
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));process.exitCode=report.error?1:0
})
