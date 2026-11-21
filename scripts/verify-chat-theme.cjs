/* Actual native assistant + shell check, isolated data, no model calls or installed data. */
const {app, BrowserWindow, dialog} = require('electron')
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const {pathToFileURL} = require('node:url')
const root = path.resolve(__dirname, '..')
const output = path.join(root, '.local-data', 'chat-theme-verification', String(Date.now()))
fs.mkdirSync(output, {recursive:true})
process.env.SINGULARITY_PROJECT_ROOT = root
process.env.SINGULARITY_DATA_ROOT = path.join(output, 'data')
const report = {output, checks:[], errors:[]}
dialog.showErrorBox = (title,message) => report.errors.push(`${title}: ${message}`)
const wait = ms => new Promise(resolve => setTimeout(resolve,ms))
async function until(fn, label, timeout=90000) {
  const start=Date.now()
  while(Date.now()-start<timeout) { if(await fn()) return; await wait(100) }
  throw Error(`Timeout: ${label}`)
}
async function main() {
  await import(pathToFileURL(path.join(root,'dist-electron/main.js')).href)
  let win
  await until(()=>{win=BrowserWindow.getAllWindows()[0];return !!win},'window')
  const js = code => win.webContents.executeJavaScript(code,true)
  await until(()=>js('Boolean(window.singularity && document.querySelector(".main-content"))').catch(()=>false),'shell')
  await until(()=>js('window.singularity.runtime.get().then(s=>s.phase==="ready")'),'runtime')
  const native=()=>win.contentView.children.find(view=>view.webContents&&view.webContents!==win.webContents)
  await until(()=>native()&&!native().webContents.isLoading(),'assistant')
  const njs = code => native().webContents.executeJavaScript(code,true)
  const mouseClick = async selector => {
    const point = await njs(`(()=>{const element=document.querySelector(${JSON.stringify(selector)});const r=element.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()`)
    const contents = native().webContents
    contents.sendInputEvent({type:'mouseMove',...point})
    contents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point})
    await wait(50)
    contents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...point})
  }
  await until(()=>njs('Boolean(document.querySelector(".pXSMma_headline"))'),'assistant content')
  await wait(500)
  assert.equal(await njs(`Array.from(document.querySelectorAll('[role="dialog"]')).some(d=>/预览版说明|Preview Notice/.test(d.textContent))`),false,'Fresh startup must not show the upstream preview notice')
  report.checks.push('Fresh isolated profile opens without the upstream preview notice')
  for(let i=0;i<8;i++) {
    const clicked=await njs(`(() => { const buttons=Array.from(document.querySelectorAll('[role="dialog"] button')); const button=buttons.find(b=>['稍后配置','Configure later'].includes(b.textContent.trim())) ?? buttons.find(b=>['添加 API Key','Add API key'].includes(b.textContent.trim())); if(!button)return false;button.click();return true })()`)
    await wait(200)
    if(!clicked&&i>2)break
  }
  await until(()=>njs('Boolean(document.querySelector("#singularity-chat-appearance"))'),'native picker')
  await until(()=>njs('getComputedStyle(document.querySelector(".chat-theme-trigger")).width==="38px"'),'picker styles')
  native().webContents.setBackgroundThrottling(false)
  fs.writeFileSync(path.join(output,'startup-before-picker.png'),(await native().webContents.capturePage()).toPNG())
  report.initialDialogs=await njs(`Array.from(document.querySelectorAll('[role="dialog"],[role="alertdialog"]')).map(d=>d.textContent)`)
  fs.writeFileSync(path.join(output,'startup-dialogs.json'),JSON.stringify(report.initialDialogs,null,2))
  assert.equal(await njs('typeof window.singularity'),'undefined','Native view must not gain desktop APIs')
  const baseline=await js(`JSON.stringify(['.app-sidebar','.titlebar'].map(s=>getComputedStyle(document.querySelector(s)).backgroundColor))`)
  assert.equal(await js('document.querySelector(".main-content").dataset.chatTheme'),'warm')
  assert.equal(await njs('document.querySelector(\'[data-chat-theme="warm"]\').getAttribute("aria-label")'),'浅黄')
  assert.equal(await js('getComputedStyle(document.querySelector(".main-content")).backgroundColor'),'rgba(250, 247, 238, 0.98)')
  await njs(`window.__pickerEvents=[];for(const type of ['pointerdown','mousedown','focusin','focusout','pointerup','mouseup','click'])document.addEventListener(type,event=>{window.__pickerEvents.push({type,target:event.target.className||event.target.tagName,active:document.activeElement?.className,hidden:document.querySelector('.chat-theme-panel').hidden});},true)`)
  await mouseClick('.chat-theme-trigger')
  await until(()=>njs('!document.querySelector(".chat-theme-panel").hidden'),'picker opened by mouse',5000)
  assert.equal(await njs('document.querySelector(".chat-theme-panel").hidden'),false)
  for(const value of ['blue','purple','green','transparent','warm']) {
    await mouseClick(`[data-chat-theme="${value}"]`)
    try { await until(()=>js(`document.querySelector('.main-content').dataset.chatTheme===${JSON.stringify(value)}`),`mouse theme ${value}`,5000) }
    catch(error) { report.diagnostics=await njs(`({events:window.__pickerEvents,error:document.querySelector('.chat-theme-error').textContent,hidden:document.querySelector('.chat-theme-panel').hidden,theme:document.documentElement.dataset.singularityChatTheme})`); throw error }
    assert.equal(await njs(`document.querySelector('[data-chat-theme="${value}"]').getAttribute('aria-checked')`),'true')
    assert.equal(await js(`JSON.stringify(['.app-sidebar','.titlebar'].map(s=>getComputedStyle(document.querySelector(s)).backgroundColor))`),baseline)
    if(value==='transparent') assert.equal(await js('getComputedStyle(document.querySelector(".main-content")).backgroundColor'),await js('getComputedStyle(document.querySelector(".app-sidebar")).backgroundColor'))
    assert.equal(JSON.parse(fs.readFileSync(path.join(output,'data/config/chat-appearance.json'),'utf8')).background,value)
    report.checks.push(`${value}: real mouse click, live shell update, native selection, persistence, navigation unchanged`)
    if(value==='warm') {
      await wait(150)
      fs.writeFileSync(path.join(output,'pale-yellow-picker.png'),(await native().webContents.capturePage()).toPNG())
      fs.writeFileSync(path.join(output,'pale-yellow-window.png'),(await win.webContents.capturePage()).toPNG())
    }
  }
  await njs(`document.querySelector('[data-chat-theme="blue"]').click()`)
  await until(()=>js(`document.querySelector('.main-content').dataset.chatTheme==='blue'`),'blue')
  await njs(`document.querySelector('[data-chat-theme="blue"]').focus(); document.querySelector('[data-chat-theme="blue"]').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}))`)
  await until(()=>js(`document.querySelector('.main-content').dataset.chatTheme==='purple'`),'keyboard selection')
  await njs(`document.querySelector('[data-chat-theme="purple"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`)
  assert.equal(await njs('document.querySelector(".chat-theme-panel").hidden'),true)
  assert.equal(await njs('document.activeElement===document.querySelector(".chat-theme-trigger")'),true)
  report.checks.push('Arrow keys select backgrounds; Escape closes and restores focus')
  await njs('document.querySelector(".chat-theme-trigger").click()')
  await njs(`document.body.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))`)
  assert.equal(await njs('document.querySelector(".chat-theme-panel").hidden'),true)
  await js(`document.querySelector('[aria-label="论文库"]').click()`)
  assert.equal(await js('document.querySelector(".main-content").dataset.chatTheme'),'purple')
  const shellGeometry = () => js(`JSON.stringify(['.app-sidebar','.titlebar','.main-content'].map(s=>{const r=document.querySelector(s).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}}))`)
  const layout = await shellGeometry()
  await js(`(()=>{const main=document.querySelector('.main-content');const probe=document.createElement('div');probe.id='scroll-probe';probe.style.cssText='position:absolute;top:2000px;height:20px';main.append(probe);probe.scrollIntoView({block:'start'});probe.remove()})()`)
  assert.equal(await shellGeometry(),layout,'scrollIntoView must not move the outer shell')
  assert.equal(await js('document.querySelector(".app-shell").scrollTop'),0)
  report.checks.push('Reader-style source location cannot scroll outer panes or erase shell inset')
  for (const value of ['blue','purple','green','transparent','warm']) {
    await njs(`document.querySelector('[data-chat-theme="${value}"]').click()`)
    for (const route of ['语音对话','科研发现','消息订阅','论文库','研究项目','论文写作','插件管理','设置']) {
      await js(`document.querySelector('[aria-label="${route}"]').click()`)
      assert.equal(await js('document.querySelector(".main-content").dataset.chatTheme'),value)
      assert.equal(await shellGeometry(),layout,'route changes retain shell spacing')
      if(value==='warm') assert.equal(await js('getComputedStyle(document.querySelector(".main-content")).backgroundColor'),'rgba(250, 247, 238, 0.98)')
    }
  }
  fs.writeFileSync(path.join(output,'pale-yellow-page.png'),(await win.webContents.capturePage()).toPNG())
  await njs(`document.querySelector('[data-chat-theme="purple"]').click()`)
  await js(`document.querySelector('[aria-label="首页"]').click()`)
  await until(()=>js('document.querySelector(".main-content").dataset.chatTheme==="purple"'),'return home')
  await js('window.singularity.runtime.setTheme("dark");document.documentElement.dataset.theme="dark"')
  await njs('document.querySelector(".chat-theme-trigger").click()')
  const darkPurple=await js('getComputedStyle(document.querySelector(".main-content")).backgroundColor')
  const channels=darkPurple.match(/[\d.]+/g).map(Number)
  assert(channels[0]<80&&channels[1]<80&&channels[2]<80&&channels[2]>channels[0],'Purple theme remains dark with a purple hue')
  report.checks.push('All five background themes follow every route; dark appearance retains contrast')
  await js('window.singularity.runtime.setTheme("light");document.documentElement.dataset.theme="light"')
  await wait(250)
  fs.writeFileSync(path.join(output,'native-picker.png'),(await native().webContents.capturePage()).toPNG())
  // Capture only the application renderer; avoid accessing the user's desktop.
  fs.writeFileSync(path.join(output,'chat-theme-window.png'),(await win.webContents.capturePage()).toPNG())
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2))
  let prompts=0, response=2
  dialog.showMessageBox=async (_window, options)=>{prompts++;assert.deepEqual(options.buttons,['最小化到任务栏','完全退出应用','取消']);fs.writeFileSync(path.join(output,'close-options.json'),JSON.stringify({prompts,response}));return {response,checkboxChecked:false}}
  win.close(); await until(()=>prompts===1,'close dialog cancel'); await wait(100)
  assert.equal(win.isDestroyed(),false); assert.equal(win.isMinimized(),false)
  response=0; win.close(); await until(()=>win.isMinimized(),'close dialog minimize')
  assert.equal(win.isDestroyed(),false);win.restore();await wait(100)
  report.checks.push('Close prompt cancels safely or minimizes to the taskbar while retaining the application')
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2))
  let quitRequested=false
  app.once('before-quit',()=>{quitRequested=true;report.checks.push('Complete exit option requests normal app shutdown');fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2))})
  response=1;win.close();await until(()=>quitRequested,'close dialog complete exit')
  assert.deepEqual(report.errors,[])
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2))
  console.log(JSON.stringify(report,null,2))
}
main().catch(error=>{report.errors.push(String(error.stack||error));fs.writeFileSync(path.join(output,'failed.json'),JSON.stringify(report,null,2));console.error(error)}).finally(()=>{app.once('will-quit',()=>app.exit(report.errors.length?1:0));app.quit()})
