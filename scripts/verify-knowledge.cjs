/* Isolated development check: actual Electron/SQLite/PDF/UI, local mock model, no installed data. */
const { app, BrowserWindow, dialog } = require('electron')
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict')
const { pathToFileURL } = require('node:url')
const root = path.resolve(__dirname, '..'), output = path.join(root, '.local-data', 'knowledge-verification', String(Date.now()))
fs.mkdirSync(output, { recursive: true })
process.env.SINGULARITY_PROJECT_ROOT = root
process.env.SINGULARITY_DATA_ROOT = path.join(output, 'data')
const report = { output, checks: [], errors: [], requests: [] }
dialog.showErrorBox = (title, message) => report.errors.push(`${title}: ${message}`)
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function until(fn, label, timeout = 45000) { const start = Date.now(); while (Date.now() - start < timeout) { if (await fn()) return; await wait(100) } throw new Error('Timeout: ' + label) }

function pdf(title, first) {
  const rows = first ? [[title,72,720,17],['ABSTRACT',72,660,12],['We investigate grounded multimodal reasoning using controlled experiments.',72,636,12],['The reported pipeline routes visual information through a required bottleneck.',72,620,12],['Evidence supports the evaluated setting, not broad causal generalization.',72,604,12],['1 INTRODUCTION',72,560,12],['Prior studies [1] motivate an independent evaluation of the proposed method.',72,534,12],['Figure 1 describes an encoder followed by recurrent computation.',72,518,12],['Fig. 1: A two-stage visual reasoning pipeline.',72,330,12]] : [[title,72,720,17],['ABSTRACT',72,660,12],['External evaluation reveals an unresolved generalization gap.',72,634,12],['A second cohort is needed to test the reliability of this reasoning method.',72,618,12]]
  const stream = rows.map(([text,x,y,size]) => `BT /F1 ${size} Tf 1 0 0 1 ${x} ${y} Tm (${text.replace(/[()\\]/g,'\\$&')}) Tj ET`).join('\n') + '\n0.7 0.85 0.9 rg 90 390 160 80 re f 0.95 0.85 0.65 rg 350 390 160 80 re f 0 0 0 RG 250 430 m 350 430 l S\n'
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`,`<< /Title (${title}) /Author (Test Researcher) >>`]
  let data='%PDF-1.4\n',offsets=[0];objects.forEach((object,i)=>{offsets.push(Buffer.byteLength(data));data+=`${i+1} 0 obj\n${object}\nendobj\n`});const xref=Buffer.byteLength(data);data+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;offsets.slice(1).forEach((offset)=>data+=`${String(offset).padStart(10,'0')} 00000 n \n`);data+=`trailer\n<< /Size ${objects.length+1} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`;return Buffer.from(data)
}
let server
async function main() {
  server=http.createServer((req,res)=>{let raw='';req.on('data',(chunk)=>raw+=chunk);req.on('end',()=>{try{const body=JSON.parse(raw),system=body.messages[0].content;report.requests.push({model:body.model,maxTokens:body.max_tokens,type:system.includes('图表阅读助手')?'figure':system.includes('稿件论证')?'argument':'voice'});let content
    if(system.includes('图表阅读助手')){const input=JSON.parse(typeof body.messages[1].content==='string'?body.messages[1].content:body.messages[1].content[0].text);assert(system.includes('没有收到图像'));content=JSON.stringify({body:`论文依据：图注报告了两阶段流程。[src:${input.figure.id}]\n解读：该流程可能限制旁路，但仅凭图注不能证明因果关系。`,sourceIds:[input.figure.id]})}
    else if(system.includes('稿件论证')){const input=JSON.parse(body.messages[1].content);assert.equal(input.paragraphs[0].argument.plan.job,'gap');assert(input.paragraphs[0].argument.materials.length);content='段落一明确提出研究缺口。论文事实只覆盖既有实验场景；项目材料中的外部验证推演不能当作已完成结果。建议补充独立队列，之后再形成结果段。'}
    else{const json=JSON.parse(system.slice(system.lastIndexOf('\n')+1));assert(json.sources.length>0);assert(system.includes('个人推演不是论文事实'));content=`论文材料支持当前实验场景，外部泛化还需要进一步验证。[src:${json.sources[0].id}]`}
    res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{message:{content},finish_reason:'stop'}]}))
  }catch(error){report.errors.push('Mock model assertion: '+String(error));res.writeHead(500);res.end('Mock assertion failed')}})})
  await new Promise((resolve)=>server.listen(0,'127.0.0.1',resolve))
  await import(pathToFileURL(path.join(root,'dist-electron','main.js')).href)
  let win;await until(()=>{win=BrowserWindow.getAllWindows()[0];return !!win},'window');win.setSize(1500,1000);win.webContents.setAudioMuted(true)
  win.webContents.on('console-message',(_event,level,message)=>{if(level>=3)report.errors.push(message)})
  const js=(code)=>win.webContents.executeJavaScript(code,true), call=(method,...args)=>js(`window.singularity.${method}(...${JSON.stringify(args)})`)
  const click=async(label)=>{await js(`document.querySelector(${JSON.stringify(`[aria-label="${label}"]`)})?.click()`);await wait(200)}
  const capture=async(name)=>{await wait(250);fs.writeFileSync(path.join(output,name+'.png'),(await win.webContents.capturePage()).toPNG())}
  const value=async(selector,text,tag='input')=>{await js(`(()=>{const element=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(${tag==='textarea'?'HTMLTextAreaElement':tag==='select'?'HTMLSelectElement':'HTMLInputElement'}.prototype,'value').set.call(element,${JSON.stringify(text)});element.dispatchEvent(new Event(${JSON.stringify(tag==='select'?'change':'input')},{bubbles:true}))})()`);await wait(80)}
  await until(()=>js('Boolean(window.singularity && document.querySelector(".sidebar-navigation"))').catch(()=>false),'shell')
  await until(()=>js('!document.querySelector(".startup-active")'),'startup',90000)
  await until(()=>{const view=win.contentView.children.find((item)=>item.webContents&&item.webContents!==win.webContents);return view&&view.webContents.getURL().startsWith('http://127.0.0.1:')&&!view.webContents.isLoading()},'native assistant initial navigation')
  await call('providers.save',{kind:'openai-compatible',displayName:'Isolated research test',baseUrl:`http://127.0.0.1:${server.address().port}/v1`,modelId:'research-test',maxOutputTokens:65536,apiKey:'local-test-only'})
  const pdfPaths=[path.join(output,'Grounded Reasoning.pdf'),path.join(output,'External Evaluation.pdf')];pdfPaths.forEach((file,index)=>fs.writeFileSync(file,pdf(index?'EXTERNAL EVALUATION':'GROUNDED REASONING',!index)))
  const imported=await call('papers.importBatch',pdfPaths);assert.equal(imported.papers.length,2);const [paper,second]=imported.papers
  const sources=await call('knowledge.sources',paper.id),otherSources=await call('knowledge.sources',second.id)
  const paragraph=sources.find((item)=>item.kind==='paragraph'),figure=sources.find((item)=>item.kind==='figure');assert(paragraph&&figure);report.checks.push('Real PDFs indexed into checksum-bound paragraph/figure sources')
  const project=await call('knowledge.saveProject',{title:'视觉推理的可信依据',question:'哪些结论是已有证据，哪些需要外部验证？'});await call('knowledge.setProjectPaper',project.id,paper.id,true);await call('knowledge.setProjectPaper',project.id,second.id,true)
  const fact=await call('knowledge.addMaterial',{projectId:project.id,paperId:paper.id,sourceId:paragraph.id,category:'method'})
  const note=await call('papers.saveReaderNote',{paperId:second.id,content:'我的推演：应该增加独立外部队列，以验证泛化能力。',pageNumber:1,sourceText:otherSources[0].text,rects:otherSources[0].parts[0].rects,noteColor:'#FFF5E1'})
  await call('knowledge.annotate',note.id,'personal',[otherSources[0].id]);await call('knowledge.addMaterial',{projectId:project.id,paperId:second.id,cardId:note.id,category:'experiment'})
  await click('研究项目');await until(()=>js('document.querySelector(".research-project-main")?.textContent.includes("视觉推理")'),'project UI');assert.equal(await js('document.querySelectorAll(".project-material").length'),2);await capture('research-project');report.checks.push('Multi-paper project displays fact and personal-inference material snapshots')
  await js(`document.querySelector('.project-material .card-provenance button').click()`);await until(()=>js('document.querySelectorAll(".paragraph-underlines line").length>0 && document.querySelectorAll(".stable-source-target span").length>0'),'source jump from project')
  for(let step=4;step<=25;step++){const scale=step/10
    await until(async()=>{const current=await js('Number(document.querySelector(".reader-toolbar-zoom span").textContent.replace("%",""))');if(current===Math.round(scale*100))return true;await js(`document.querySelectorAll('.reader-toolbar-zoom button')[${0} + (${Math.round(scale*100)} > Number(document.querySelector('.reader-toolbar-zoom span').textContent.replace('%','')) ? 1 : 0)].click()`);return false},'zoom '+scale)
    await until(()=>js('document.querySelectorAll(".stable-source-target span").length>0'),'render '+scale)
    const geometry=await js(`(()=>{const sheet=document.querySelector('.continuous-pdf-sheet').getBoundingClientRect(),target=document.querySelector('.stable-source-target span').getBoundingClientRect();return{x:(target.x-sheet.x)/sheet.width,y:(target.y-sheet.y)/sheet.height,width:target.width/sheet.width,height:target.height/sheet.height}})()`),expected=paragraph.parts[0].rects[0]
    for(const key of ['x','y','width','height'])assert(Math.abs(geometry[key]-expected[key])<.002,'Stable source geometry at '+scale+' '+key)
  }
  report.checks.push('Source overlays stay normalized at every supported PDF zoom step (40–250%)')
  await capture('reader-source-map')
  // Restore 100% one state update at a time.
  for(let i=0;i<15;i++){await click('缩小');await wait(40)}
  const image=await js(`(()=>{const canvas=document.querySelector('.continuous-pdf-sheet canvas'),crop=document.createElement('canvas');crop.width=420;crop.height=130;crop.getContext('2d').drawImage(canvas,72/612*canvas.width,310/792*canvas.height,456/612*canvas.width,130/792*canvas.height,0,0,420,130);return crop.toDataURL('image/png')})()`)
  await call('knowledge.saveFigure',{paperId:paper.id,sourceId:figure.id,kind:'figure',label:figure.label,text:figure.text,parts:[{page:1,rects:[{x:72/612,y:310/792,width:456/612,height:130/792}]}],image})
  await click('研究项目');await js(`document.querySelector('.project-material .card-provenance button').click()`);await until(()=>js('document.querySelectorAll(".stable-source-target span").length>0'),'source map refreshed')
  const insight=await call('knowledge.interpret',figure.id,'不要将流程描述当作因果证明。',false);assert.equal(insight.status,'complete');await call('knowledge.addMaterial',{projectId:project.id,paperId:paper.id,insightId:insight.id,category:'method'})
  await until(()=>js('Boolean(document.querySelector(".figure-insight-card"))'),'figure card');await capture('figure-insight');report.checks.push('Figure crop reuses source ID; caption-only interpretation persists and joins project')
  const writing=await call('writing.create','可信视觉推理稿件','多模态推理',''),writingParagraph=await call('writing.addParagraph',writing.id,'introduction');await call('writing.updateParagraph',writingParagraph.id,'研究缺口','已有实验并不等于外部泛化已得到证明。')
  await call('knowledge.linkWriting',writing.id,project.id);const plan=await call('knowledge.argument',writingParagraph.id);await call('knowledge.saveArgument',{...plan,job:'gap',claim:'外部泛化尚未得到充分验证。',evidence:'已有材料仅覆盖论文报告的场景。',boundary:'这是研究缺口，不是已经完成的负面实验。',materialIds:[fact.id]})
  await click('论文写作');await until(()=>js('document.querySelector("[aria-label=核心主张]")?.value.includes("外部泛化")'),'argument editor');await capture('argument-writing')
  await js(`Array.from(document.querySelectorAll('.argument-review button')).find(b=>b.textContent.includes('检查论证')).click()`);await until(()=>js('document.querySelector(".argument-review")?.textContent.includes("独立队列")'),'argument review');report.checks.push('Writing loads argument roles/evidence; local mock reviews argument against linked materials')
  const session=await call('voice.start');const answer=await call('knowledge.contextReply',session,[{role:'user',content:'这个项目还有哪些验证缺口？'}],{projectId:project.id});assert(answer.citations.length>0);assert(!answer.text.includes('[src:'));await call('voice.stop',session);report.checks.push('Project voice retrieves both papers, separates spoken reply from stable citations')
  await click('语音对话');await until(()=>js('Boolean(document.querySelector(".voice-start:not(:disabled)"))'),'voice UI');await value('.voice-input input','当前论文有哪些证据？');await js('document.querySelector(".voice-input").requestSubmit()');await until(()=>js('Boolean(document.querySelector(".voice-source-list button"))'),'voice citation UI');await capture('context-voice');await js('document.querySelector(".voice-source-list button").click()');await until(()=>js('document.querySelectorAll(".stable-source-target span").length>0'),'voice citation returns to PDF');report.checks.push('Voice UI uses current paper and citation action returns to original PDF')
  const final=await call('papers.finalizeNote',paper.id);assert(final.markdown.includes(figure.id));assert(final.markdown.includes('图注与上下文'));const persisted=await call('knowledge.sources',paper.id);assert.equal(persisted.find((item)=>item.id===figure.id).id,figure.id);report.checks.push('Reading note export includes source IDs and interpretation scope')
  assert(report.requests.every((item)=>item.maxTokens===65536),'Provider output budget altered');assert.deepEqual(report.errors,[]);fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))
}
main().catch((error)=>{report.errors.push(String(error));fs.writeFileSync(path.join(output,'failed.json'),JSON.stringify(report,null,2));console.error(error);process.exitCode=1}).finally(()=>{server?.close();app.quit()})
