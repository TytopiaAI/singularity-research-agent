// Runs the complete development application. Only native file pickers are redirected
// to isolated fixture files; editor, preload, storage, compiler and PDF viewer are real.
const fs=require('node:fs'),path=require('node:path'),net=require('node:net'),assert=require('node:assert/strict'),{spawn}=require('node:child_process'),{zipSync,unzipSync}=require('fflate')
const root=path.resolve(__dirname,'..'),output=path.join(root,'.local-data/latex-ui',String(Date.now())),data=path.join(output,'data')
fs.mkdirSync(path.join(data,'config'),{recursive:true})
// Reuse verified compiler resources: this is a UI test, not a second cold-network test.
const verificationRoot=path.join(root,'.local-data/latex-verification')
const verified=fs.existsSync(verificationRoot)?fs.readdirSync(verificationRoot).sort().reverse().find(v=>{try{return JSON.parse(fs.readFileSync(path.join(verificationRoot,v,'report.json'),'utf8')).build.status==='success'}catch{return false}}):null
if(verified){const cache=path.join(verificationRoot,verified,'cache/tectonic');if(fs.existsSync(cache))fs.cpSync(cache,path.join(data,'cache/tectonic'),{recursive:true})}
const fixture={
 'paper/main.tex':Buffer.from('\\documentclass{article}\n\\usepackage{amsmath,graphicx}\n\\title{The Research Workspace}\n\\author{Singularity}\n\\begin{document}\n\\maketitle\n\\section{Introduction}\nAn editable manuscript with a local PDF preview.\\cite{example}\n\\input{sections/method}\n\\begin{figure}[h]\n\\centering\\includegraphics[width=2cm]{image.png}\n\\caption{An imported project asset}\\label{fig:asset}\n\\end{figure}\n\\bibliographystyle{plain}\n\\bibliography{refs}\n\\end{document}\n'),
 'paper/sections/method.tex':Buffer.from('\\section{Method}\nWe preserve project structure and edit source directly.\n\\begin{equation}\n E=mc^2\n\\end{equation}\n'),
 'paper/refs.bib':Buffer.from('@article{example,author={Ada Researcher},title={A Reproducible Study},journal={Research},year={2026}}'),
 'paper/image.png':fs.readFileSync(path.join(root,'build/icon.png')),
}
const input=path.join(output,'manuscript.zip');fs.writeFileSync(input,zipSync(fixture))
fs.writeFileSync(path.join(data,'config/latex-compilers.json'),JSON.stringify({tectonic:path.join(root,'.local-data/tools/tectonic/tectonic.exe')}))
const wrapper=path.join(output,'bootstrap.cjs')
fs.writeFileSync(wrapper,`const {dialog}=require('electron');dialog.showOpenDialog=async()=>({canceled:false,filePaths:[${JSON.stringify(input)}]});dialog.showSaveDialog=async(_owner,options)=>({canceled:false,filePath:options.filters[0].extensions.includes('zip')?${JSON.stringify(path.join(output,'exported.zip'))}:${JSON.stringify(path.join(output,'exported.pdf'))}});import(${JSON.stringify(require('node:url').pathToFileURL(path.join(root,'dist-electron/main.js')).href)});`)
const report={output,checks:[],errors:[]},wait=ms=>new Promise(r=>setTimeout(r,ms));let child,socket
async function until(fn,label,timeout=15000){const start=Date.now();while(Date.now()-start<timeout){if(await fn())return;await wait(100)}throw Error('Timeout: '+label)}
async function main(){
 const port=await new Promise(resolve=>{const server=net.createServer();server.listen(0,'127.0.0.1',()=>{const p=server.address().port;server.close(()=>resolve(p))})})
 const env={...process.env,SINGULARITY_DATA_ROOT:data};delete env.ELECTRON_RUN_AS_NODE
 const log=fs.openSync(path.join(output,'process.log'),'w')
 child=spawn(path.join(root,'node_modules/electron/dist/electron.exe'),[wrapper,'--remote-debugging-port='+port],{env,windowsHide:true,stdio:['ignore',log,log]});fs.closeSync(log)
 let target
 await until(async()=>{try{target=(await(await fetch('http://127.0.0.1:'+port+'/json')).json()).find(t=>t.url.endsWith('/dist/index.html'));return!!target}catch{return false}},'renderer',60000)
 socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject})
 let n=0;const pending=new Map()
 socket.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m)}}
 socket.onclose=()=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('Application closed'))}pending.clear()}
 const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++n,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timed out: '+method))},30000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}))})
 const js=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.result.exceptionDetails)throw Error(JSON.stringify(r.result.exceptionDetails));return r.result.result.value}
 const click=async selector=>{await js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing '+${JSON.stringify(selector)});if(e.disabled)throw Error('Disabled '+${JSON.stringify(selector)});e.click()})()`);await wait(100)}
 const shot=async name=>{const result=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(output,name+'.png'),Buffer.from(result.result.data,'base64'))}
 await until(()=>js(`Boolean(window.singularity?.latex)&&Boolean(document.querySelector('.sidebar-navigation [aria-label="论文写作"]'))&&!document.querySelector('.startup-splash')`),'application ready',150000)
 await click('.sidebar-navigation [aria-label="论文写作"]')
 await until(()=>js(`Boolean(document.querySelector('.latex-welcome'))`),'LaTeX welcome')
 await shot('welcome')
 await click('[aria-label="新建 LaTeX 项目"]')
 assert(await js(`document.querySelector('.latex-native-modal').open`))
 await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27})
 await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27})
 await until(()=>js(`!document.querySelector('.latex-native-modal')`),'dismiss creation dialog with Escape')
 await click('[aria-label="导入 ZIP 项目"]')
 await until(()=>js(`Boolean(document.querySelector('.cm-content'))`),'imported editor')
 const projects=await js(`window.singularity.latex.list()`);assert.equal(projects.length,1);const project=projects[0];assert.equal(project.mainFile,'paper/main.tex');assert.equal(project.files.length,4)
 await until(()=>js(`document.querySelector('.latex-compile').disabled===false`),'compiler ready')
 await click('.latex-compile')
 await until(async()=>{const build=await js(`window.singularity.latex.build(${JSON.stringify(project.id)})`);if(build?.status==='failed')throw Error('Compilation failed: '+build.log.slice(-1800));return build?.status==='success'},'real PDF compilation',490000)
 await until(()=>js(`Boolean(document.querySelector('.latex-pdf-page canvas'))&&document.querySelector('.latex-pdf-page canvas').width>10`),'PDF page rendered',25000)
 await until(()=>js(`document.querySelectorAll('.latex-pdf-page .textLayer span').length>0`),'selectable PDF text')
 const sync=await js(`window.singularity.latex.build(${JSON.stringify(project.id)}).then(b=>window.singularity.latex.sync(${JSON.stringify(project.id)},b.id))`);assert(sync.some(p=>p.file==='paper/sections/method.tex'))
 await shot('editor-and-pdf')
 report.checks.push('ZIP with a wrapper folder, nested TeX, PNG and BibTeX imports and compiles through the actual app; selectable PDF and SyncTeX render locally')
 const original=await js(`window.singularity.latex.read(${JSON.stringify(project.id)},'paper/main.tex')`)
 await click('[aria-label="插入公式"]')
 await until(()=>js(`document.querySelector('.cm-content').textContent.includes('E=mc^2')`),'insert equation')
 await click('[aria-label="撤销"]');await wait(100)
 assert(!(await js(`document.querySelector('.cm-content').textContent.includes('E=mc^2')`)))
 await click('[aria-label="重做"]')
 await click('[aria-label="搜索替换"]');assert(await js(`Boolean(document.querySelector('.cm-search'))`))
 await js(`document.querySelector('.cm-search [name="close"]')?.click()`)
 await click('[aria-label="保存 LaTeX 文件"]')
 const changed=await js(`window.singularity.latex.read(${JSON.stringify(project.id)},'paper/main.tex')`);assert.notEqual(changed.text,original.text)
 await click('[aria-label="LaTeX 文件历史"]');await until(()=>js(`Boolean(document.querySelector('[aria-label="文件历史版本"] button:not([aria-label])'))`),'version history')
 await click('[aria-label="文件历史版本"] .latex-modal>button');await until(()=>js(`window.singularity.latex.read(${JSON.stringify(project.id)},'paper/main.tex').then(d=>d.text===${JSON.stringify(original.text)})`),'history restored')
 await click('.latex-file-tree [title="paper/sections/method.tex"]')
 await click('[aria-label="源码定位到 PDF"]')
 await until(()=>js(`Boolean(document.querySelector('.latex-sync-marker'))`),'source to PDF location')
 await click('.latex-file-tree [title="paper/main.tex"]')
 const point=sync.find(p=>p.file==='paper/sections/method.tex'&&p.page===1)
 await js(`(()=>{const page=document.querySelector('[data-pdf-page="1"]'),r=page.getBoundingClientRect(),scale=r.width/612;page.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,clientX:r.left+${point.x}*scale,clientY:r.top+${point.y}*scale}))})()`)
 await until(()=>js(`document.querySelector('.latex-document-bar>div>span').textContent.includes('method.tex')`),'PDF to included source location')
 await click('.latex-file-tree [title="paper/main.tex"]')
 const split=await js(`document.querySelector('.latex-resizer').getAttribute('aria-valuenow')`)
 await js(`document.querySelector('.latex-resizer').focus()`)
 await call('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39})
 await call('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39})
 assert.notEqual(await js(`document.querySelector('.latex-resizer').getAttribute('aria-valuenow')`),split)
 report.checks.push('Native modal supports Escape; source/PDF navigation and keyboard split resizing work')
 report.checks.push('CodeMirror insertion, undo/redo, search/replace, save and version restoration operate on actual project files')
 await click('.latex-file-tree [title="paper/sections/method.tex"]');await click('[aria-label="插入粗体"]')
 await click('.latex-file-tree [title="paper/main.tex"]')
 const method=await js(`window.singularity.latex.read(${JSON.stringify(project.id)},'paper/sections/method.tex')`);assert(method.text.includes('\\textbf{text}'))
 await click('[aria-label="导出 LaTeX ZIP"]');assert(fs.existsSync(path.join(output,'exported.zip')))
 const exported=unzipSync(fs.readFileSync(path.join(output,'exported.zip')));assert.deepEqual(Buffer.from(exported['paper/image.png']),fixture['paper/image.png']);assert(Buffer.from(exported['paper/sections/method.tex']).toString().includes('\\textbf{text}'))
 await click('[aria-label="导出 PDF"]');assert(fs.readFileSync(path.join(output,'exported.pdf')).subarray(0,5).toString()==='%PDF-')
 report.checks.push('File switching flushes edits; exported ZIP retains binary assets and edited nested source; PDF export is a real compiled PDF')
 // Introduce a real compiler error and confirm that the successful preview remains.
 const source=await js(`window.singularity.latex.read(${JSON.stringify(project.id)},'paper/sections/method.tex')`)
 await js(`window.singularity.latex.save(${JSON.stringify(project.id)},'paper/sections/method.tex',${JSON.stringify(source.text+'\n\\undefinedFixtureCommand\n')},${JSON.stringify(source.revision)})`)
 await click('.latex-compile')
 await until(()=>js(`window.singularity.latex.build(${JSON.stringify(project.id)}).then(b=>b?.status==='failed')`),'real compile error',250000)
 await until(()=>js(`Boolean(document.querySelector('.latex-build-log button.error'))`),'clickable source diagnostic')
 assert(await js(`Boolean(document.querySelector('.latex-pdf-page canvas'))`));await click('.latex-build-log button.error')
 assert((await js(`document.querySelector('.latex-document-bar>div>span').textContent`)).includes('method.tex'))
 await shot('error-navigation')
 report.checks.push('Actual TeX error is clickable into the included file; last successful PDF remains visible')
 await js(`document.documentElement.dataset.theme='dark';document.querySelector('.main-content').dataset.chatTheme='blue'`);await shot('dark-theme')
 assert(await js(`document.querySelector('.latex-workspace').scrollWidth<=document.querySelector('.latex-workspace').clientWidth+1`))
 await js(`document.documentElement.dataset.theme='light';document.querySelector('.main-content').dataset.chatTheme='warm'`)
 await click('[role="tab"][aria-selected="false"]')
 await until(()=>js(`Boolean(document.querySelector('.writing-page'))`),'original writing mode')
 report.checks.push('Existing paragraph writing remains available alongside LaTeX; themed layout has no page-wide overflow')
 socket.send(JSON.stringify({id:++n,method:'Browser.close'}));await until(()=>child.exitCode!==null,'normal application shutdown',15000)
}
main().catch(error=>report.errors.push(String(error.stack||error))).finally(async()=>{
 if(child?.exitCode===null&&socket?.readyState===WebSocket.OPEN){socket.send(JSON.stringify({id:999999,method:'Browser.close'}));for(let i=0;i<50&&child.exitCode===null;i++)await wait(100)}
 socket?.close();if(child?.exitCode===null)child.kill()
 fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));if(report.errors.length)process.exitCode=1
})
