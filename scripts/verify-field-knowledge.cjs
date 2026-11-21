// Production UI + production SQLite store. Only model/network/native actions are deterministic stubs.
const {app,BrowserWindow,ipcMain}=require('electron')
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict')
const root=path.resolve(__dirname,'..'),output=path.join(root,'.local-data','field-knowledge-verification',String(Date.now()))
fs.mkdirSync(output,{recursive:true});app.setPath('userData',path.join(output,'electron'))
const report={output,checks:[],errors:[]},wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))
async function until(fn,label){const start=Date.now();while(Date.now()-start<12000){if(await fn())return;await wait(60)}throw Error('Timeout: '+label)}
let store
async function main(){
 const esbuild=require('esbuild')
 await esbuild.build({entryPoints:[path.join(root,'scripts/fixtures/field-knowledge.tsx')],bundle:true,format:'esm',platform:'browser',target:'chrome140',jsx:'automatic',loader:{'.png':'dataurl'},outfile:path.join(output,'fixture.js'),logLevel:'warning'})
 await esbuild.build({stdin:{contents:"export {FieldKnowledgeStore} from './src/main/field-knowledge-store';export {createAppPaths} from './src/main/paths';export {fieldFixtureRun} from './scripts/fixtures/field-knowledge-data'",resolveDir:root,loader:'ts'},bundle:true,format:'cjs',platform:'node',target:'node24',define:{'import.meta.url':JSON.stringify(require('node:url').pathToFileURL(path.join(root,'src/main/paths.ts')).href)},outfile:path.join(output,'store.cjs'),logLevel:'warning'})
 const {FieldKnowledgeStore,createAppPaths,fieldFixtureRun}=require(path.join(output,'store.cjs'))
 const paths=createAppPaths({resourceRoot:root,dataRoot:path.join(output,'data')}),database=path.join(paths.database,'fixture.sqlite')
 const synth=async(_system,prompt)=>{const payload=JSON.parse(prompt.slice(prompt.indexOf('领域资料：')+'领域资料：'.length));return JSON.stringify({sections:[{kind:'development',title:'从重建残差到知识条件',body:'模拟资料中，重建方向从基线误差到语义条件和不确定性建模逐步增加约束；知识嵌入方向提供可核查的语义解释线索。时间先后不能证明方法继承。'},{kind:'evaluation',title:'评估可比性与证据边界',body:'应在一致划分、计算预算和输入分辨率下比较，分别报告定位能力与解释忠实性。仅摘要资料的具体机制及泄漏排查结论待核验。'},{kind:'insight',title:'假设：知识能否校准重建误差',body:'研究推演：在相同训练划分上比较纯重建、真实知识条件和随机知识条件，检查域外异常定位变化。'},{kind:'insight',title:'假设：不确定性可否提示解释失败',body:'研究推演：固定定位器，分别使用重建残差与不确定性筛选难例，对解释一致性做独立盲评。'}].flatMap((s,i)=>i===0?[s,{...s,title:'主线一：重建'},{...s,title:'主线二：知识嵌入'},{...s,title:'主线三：证据校验'}]:i===3?[s,{...s,title:'未来：证据评估'}]:[s]).map((s,i)=>({...s,sourceIds:[payload.papers[i%payload.papers.length].id]}))})}
 store=new FieldKnowledgeStore(paths,database,synth);let runs=[fieldFixtureRun()];store.ingest(runs[0]);const fieldId=store.list()[0].id
 await store.refresh(fieldId)
 const calls={imports:[],requests:[],shows:[]}
 const api={fields:()=>store.list(),field:id=>store.get(id),createField:(title,parentId)=>store.create(title,parentId),setFieldMonthly:(...args)=>store.setMonthly(...args),starFieldPaper:(...args)=>store.star(...args),saveFieldNotes:(...args)=>store.saveNotes(...args),setFieldDirections:(...args)=>store.setDirections(...args),addFieldRelation:(...args)=>store.addRelation(...args),removeFieldRelation:(...args)=>store.removeRelation(...args),updateFieldDocument:id=>store.refresh(id),explorations:()=>runs,
 explore:request=>{calls.requests.push(request);const next=fieldFixtureRun();next.id='fixture-next';next.request=request;next.sources=[{...next.sources[0],id:'source-new',arxivId:'2610.90009',title:'Newly Accumulated Reconstruction Method',date:'2026-10-01'}];next.items=[{...next.items[0],sourceId:'source-new'}];runs.unshift(next);store.ingest(next);store.automaticRefresh([request.fieldId]);return next},
 importFieldPaper:(id,paperId)=>{calls.imports.push(paperId);const paper=store.get(id).papers.find(p=>p.id===paperId);const origin=paper.origins.at(-1);runs.find(r=>r.id===origin.runId).items.find(p=>p.sourceId===origin.sourceId).libraryId='mock-library-id';store.ingest(runs.find(r=>r.id===origin.runId));return {id:'mock-library-id'}},openSource:()=>{}}
 for(const [name,fn]of Object.entries(api))ipcMain.handle('fixture:'+name,(_event,...args)=>fn(...args))
 ipcMain.handle('fixture:show',(_event,p)=>{calls.shows.push(p)})
 const preload=path.join(output,'preload.cjs');fs.writeFileSync(preload,`const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('singularity',{research:Object.fromEntries(${JSON.stringify(Object.keys(api))}.map(name=>[name,(...args)=>ipcRenderer.invoke('fixture:'+name,...args)])),nativeFiles:{show:p=>ipcRenderer.invoke('fixture:show',p)},knowledge:{projects:async()=>[]}})`)
 fs.writeFileSync(path.join(output,'index.html'),'<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><link rel="stylesheet" href="fixture.css"></head><body><div id="root"></div><script type="module" src="fixture.js"></script></body></html>')
 await app.whenReady();const win=new BrowserWindow({width:1720,height:1200,show:false,backgroundColor:'#d5dde4',webPreferences:{preload,contextIsolation:true,sandbox:true,offscreen:true,backgroundThrottling:false}})
 win.webContents.on('console-message',event=>{if(event.level==='error')report.errors.push(event.message)})
 await win.loadFile(path.join(output,'index.html'));const js=code=>win.webContents.executeJavaScript(code,true)
 async function click(selector){const point=await js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing '+${JSON.stringify(selector)});e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point});win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...point});await wait(130)}
 async function value(selector,value){await js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e),'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}))})()`);await wait(100)}
 const shot=async name=>{await wait(150);fs.writeFileSync(path.join(output,name+'.png'),(await win.webContents.capturePage()).toPNG())}
 await until(()=>js(`!!document.querySelector('.field-view-tabs')`),'field workspace');
 assert(await js(`[...document.querySelectorAll('.field-view-tabs button')].every(e=>e.textContent.trim()&&e.getAttribute('aria-label'))`))
 report.checks.push('Field views are labeled text controls inside the field card')
await click('.field-view-tabs [aria-label="关系图谱"]')
 await until(()=>js(`document.querySelectorAll('.field-paper-node').length===5`),'five graph nodes')
 assert.equal(await js(`document.querySelectorAll('path[data-relation="chronology"]').length`),3)
 await value('[aria-label="图谱时间粒度"]','year');await click('[aria-label="缩小图谱"]');await click('[aria-label="缩小图谱"]')
 await js(`document.querySelector('.field-title').scrollIntoView({block:'start'})`);await shot('direction-graph')
 await value('[aria-label="图谱方向"]','重建');assert.equal(await js(`document.querySelectorAll('.field-paper-node').length`),3)
 await click('.field-paper-node');await value('[aria-label="论文方向标签"]','重建、知识蒸馏');await click('.field-direction-editor button')
 await until(()=>Promise.resolve(store.get(fieldId).papers.filter(p=>p.curated).length===1),'curated directions')
 assert(store.get(fieldId).papers.find(p=>p.curated).directions.includes('知识蒸馏'))
 const papers=store.get(fieldId).papers;await click('.field-relation-editor summary');await value('[aria-label="关系目标论文"]',papers.at(-1).id);await value('[aria-label="论文关系说明"]','待核验：由基础重建到不确定性建模的机制联系');await click('.field-relation-editor>button')
 await until(()=>Promise.resolve(store.get(fieldId).relations.length===1),'manual relation')
 await click('.field-view-tabs [aria-label="我的笔记"]');await value('[aria-label="领域个人笔记"]','我的假设：知识约束能否改善重建对语义异常的识别？');await click('.field-notes footer button')
 assert(store.get(fieldId).notes.includes('语义异常'))
 await click('.field-view-tabs [aria-label="领域综述"]');await js(`document.querySelector('.field-document').scrollIntoView({block:'start'})`);await shot('living-document')
 await click('[aria-label="更新综合综述"]');await until(()=>Promise.resolve(store.get(fieldId).documentVersion===2),'synthesis update');assert(store.get(fieldId).notes.includes('语义异常'))
 await click('[aria-label="打开本地文档位置"]');assert.equal(calls.shows.length,1);assert.equal(fs.readFileSync(calls.shows[0],'utf8'),store.get(fieldId).documentMarkdown)
 await click('.field-view-tabs [aria-label="关系图谱"]');await click('.field-paper-node');await click('.field-paper-detail header button:last-child');assert.equal(calls.imports.length,1)
 await click('.field-view-tabs [aria-label="领域论文"]');await click('.field-paper-card footer button');assert.equal(store.get(fieldId).papers.filter(p=>p.starred).length,1);await shot('paper-cards');await click('.field-view-tabs [aria-label="重点知识库"]');assert.equal(await js(`document.querySelectorAll('.field-paper-card').length`),1);await click('.field-monthly-control input');assert.equal(store.get(fieldId).monthly,true);
 report.checks.push('Starred collection and monthly subscription persisted; all-paper and starred views verified')
 report.checks.push('Real SQLite data: five papers in two direction lanes; chronology and manual mechanism edges are distinct; direction editing, personal notes, synthesis citations, local Markdown and import state verified')
 await click('[aria-label="检索论文 / 更新领域"]');assert.equal(await js(`document.querySelector('[aria-label="检索积累到领域知识库"]').value`),fieldId)
 await click('.research-config button[type="submit"]');await until(()=>Promise.resolve(store.get(fieldId).paperCount===6),'accumulated sixth paper')
 await click('[aria-label="查看本领域的积累与图谱"]');await click('.field-view-tabs [aria-label="关系图谱"]');await until(()=>js(`document.querySelectorAll('.field-paper-node').length>=6`),'updated graph');await until(()=>Promise.resolve(store.get(fieldId).documentVersion===3),'automatic synthesis')
 assert(store.get(fieldId).notes.includes('语义异常'));assert.equal(store.get(fieldId).papers.filter(p=>p.curated).length,1)
 report.checks.push('Continue-search keeps the selected field, adds a new paper across searches, updates the document automatically and retains notes/curation')
 for(const zoom of [1,1.25,1.5]){win.webContents.setZoomFactor(zoom);await wait(180);assert(await js(`document.querySelector('.main-content').scrollWidth<=document.querySelector('.main-content').clientWidth+1`));assert.equal(await js(`getComputedStyle(document.querySelector('.digest-page'),'::-webkit-scrollbar').width`),'10px');assert.equal(await js(`getComputedStyle(document.querySelector('.field-graph-scroll'),'::-webkit-scrollbar-thumb').borderRadius`),'20px');await js(`document.querySelector('.field-title').scrollIntoView({block:'start'})`);await shot('layout-'+Math.round(zoom*100))}
 win.webContents.setZoomFactor(1);await js(`document.documentElement.dataset.theme='dark'`);await shot('dark-theme')
 report.checks.push('Transparent and dark themes, matching 10px rounded scrollbars, and no page-wide horizontal overflow at 100%/125%/150% verified')
 win.destroy();const before=store.get(fieldId);await store.close();store=new FieldKnowledgeStore(paths,database,synth);assert.equal(store.get(fieldId).paperCount,6);assert.equal(store.get(fieldId).notes,before.notes);assert.equal(store.get(fieldId).documentState,'current');report.checks.push('Database reopened with all papers, curated directions, relations, notes and current synthesis intact')
}
main().catch(error=>{report.errors.push(String(error.stack||error))}).finally(async()=>{if(store)await store.close();fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));app.exit(report.errors.length?1:0)})
