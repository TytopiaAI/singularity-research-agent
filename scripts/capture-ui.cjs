/* Captures every route in light and dark themes with isolated, disposable data.
   Usage after `pnpm build`: electron scripts/capture-ui.cjs [label] */
const {app,BrowserWindow,desktopCapturer}=require('electron')
const fs=require('node:fs')
const path=require('node:path')
const {pathToFileURL}=require('node:url')
const root=path.resolve(__dirname,'..')
const label=process.argv.slice(2).find((arg)=>!arg.startsWith('-'))||'capture'
const output=path.join(root,'.local-data','ui-capture',`${label}-${Date.now()}`)
fs.mkdirSync(output,{recursive:true})
process.env.SINGULARITY_PROJECT_ROOT=root
process.env.SINGULARITY_DATA_ROOT=path.join(output,'data')
const chatThemeArg=process.argv.find((arg)=>arg.startsWith('--chat-theme='))
if(chatThemeArg){fs.mkdirSync(path.join(output,'data','config'),{recursive:true});fs.writeFileSync(path.join(output,'data','config','chat-appearance.json'),JSON.stringify({background:chatThemeArg.split('=')[1]}))}
const wait=(ms)=>new Promise((r)=>setTimeout(r,ms))
async function until(fn,name,timeout=60000){const start=Date.now();while(Date.now()-start<timeout){const value=await fn().catch(()=>false);if(value)return value;await wait(150)}throw new Error(`Timeout: ${name}`)}
const report={output,shots:[],errors:[]}
const routes=[['voice','语音对话'],['discovery','科研发现'],['news','AI 新闻'],['library','论文库'],['projects','研究项目'],['writing','论文写作']]

// A single-page PDF whose lines share one leading, so the reader groups them into one paragraph.
function paragraphTextPdf(title,lines){
  const esc=(t)=>t.replace(/[\\()]/g,(c)=>'\\'+c)
  const stream=`BT\n/F1 11 Tf\n14 TL\n72 700 Td\n${lines.map((line)=>`(${esc(line)}) Tj T*`).join('\n')}\nET\n`
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`,`<< /Title (${esc(title)}) /Author (Singularity Capture) >>`]
  let pdf='%PDF-1.4\n';const offsets=[]
  objects.forEach((object,index)=>{offsets.push(Buffer.byteLength(pdf,'binary'));pdf+=`${index+1} 0 obj\n${object}\nendobj\n`})
  const xref=Buffer.byteLength(pdf,'binary')
  pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.map((o)=>`${String(o).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length+1} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(pdf,'binary')
}

async function main(){
  await import(pathToFileURL(path.join(root,'dist-electron','main.js')).href)
  await app.whenReady()
  const win=await until(async()=>BrowserWindow.getAllWindows()[0],'window')
  win.webContents.on('console-message',(_e,level,message)=>{if(level>=3)report.errors.push(message)})
  const js=(source)=>win.webContents.executeJavaScript(source,true)
  await until(()=>js('Boolean(window.singularity && document.querySelector(".sidebar-navigation"))'),'shell')
  await until(()=>js('window.singularity.runtime.get().then(s=>s.phase==="ready"||s.phase==="error")'),'harness',150000)
  win.setSize(1440,900);win.center();await wait(400)
  const native=()=>win.contentView.children.find((v)=>v.webContents&&v.webContents!==win.webContents)
  await until(async()=>native()&&!native().webContents.isLoading(),'assistant view',30000).catch(()=>{})
  for(const text of ['继续','稍后配置']){await native()?.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)})?.click()`).catch(()=>{});await wait(300)}
  const snapshot=async(name)=>{
    if(process.argv.includes('--page-capture')){win.show();win.focus();await wait(650);fs.writeFileSync(path.join(output,`${name}.png`),(await win.webContents.capturePage()).toPNG());report.shots.push(name);return}
    win.show();win.focus();await wait(650)
    const sources=await desktopCapturer.getSources({types:['window'],thumbnailSize:{width:1440,height:900}})
    const image=sources.find((s)=>s.id===win.getMediaSourceId())?.thumbnail
    if(!image||image.isEmpty())throw new Error('Window screenshot unavailable')
    fs.writeFileSync(path.join(output,`${name}.png`),image.toPNG());report.shots.push(name)
  }
  const nav=async(name)=>{await js(`document.querySelector('.sidebar-navigation [aria-label=${JSON.stringify(name)}]')?.click()`);await wait(900)}

  const ts=require('typescript');const vm=require('node:vm');const exported={}
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,'tests/helpers/minimal-pdf.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:exported,Buffer})
  const pdfPath=path.join(output,'sample-paper.pdf')
  fs.writeFileSync(pdfPath,exported.minimalTextPdf('Research methods provide reliable results. Scientific evaluation uses transparent methods and reproducible experiments.'))
  await js(`window.singularity.papers.importBatch([${JSON.stringify(pdfPath)}])`)
  const paragraphPdf=path.join(output,'paragraph-paper.pdf')
  fs.writeFileSync(paragraphPdf,paragraphTextPdf('Latent Reasoning Sample',[
    'As shown in Figure 1a, several methods remain close to their clean accuracy even after substantial',
    'changes to the latent state. For example, the strongest baseline changes by at most 0.5 percentage',
    'points across all three replacements. These interventions are not strict no-bypass evaluations because',
    'the original multimodal answer context remains available. Instead, they ask whether the standard',
    'inference path actually requires the proposed latent content. Stable predictions under replacement',
    'show that the answer can be sustained without strong dependence on that content.',
  ]))
  await js(`window.singularity.papers.importBatch([${JSON.stringify(paragraphPdf)}])`)
  const manuscript=await js(`window.singularity.writing.create('Reliable evaluation of reasoning models','Machine learning','Nature Machine Intelligence')`)
  const paragraph=await js(`window.singularity.writing.addParagraph(${JSON.stringify(manuscript.id)},'introduction')`)
  await js(`window.singularity.writing.updateParagraph(${JSON.stringify(paragraph.id)},'评估缺口','现有推理模型的评估缺少可复现的流程，我们希望提出透明的协议。')`)
  await js(`window.singularity.knowledge.saveProject({title:'可复现评估',question:'如何在多模态推理任务中建立可复现、透明的评估流程？'})`)
  await js(`window.singularity.research.createField('多模态医学推理')`).catch(()=>{})

  // --pdf <file> --click "<text>" [--click ...]: open a real paper and select the paragraphs containing each text.
  const realPdf=process.argv.includes('--pdf')?process.argv[process.argv.indexOf('--pdf')+1]:null
  if(realPdf){
    const clicks=process.argv.flatMap((arg,index)=>arg==='--click'?[process.argv[index+1]]:[])
    const imported=await js(`window.singularity.papers.importBatch([${JSON.stringify(path.resolve(realPdf))}])`)
    const id=imported.papers[0].id
    await nav('论文库');await until(()=>js(`Boolean(document.querySelector('.library-card'))`),'paper card')
    await js(`Array.from(document.querySelectorAll('.library-card')).find(c=>!c.getAttribute('aria-label').includes('Minimal')&&!c.getAttribute('aria-label').includes('Latent Reasoning Sample')).dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))`)
    await until(()=>js('document.querySelectorAll(".textLayer span").length>20'),'real text layer').catch(async(error)=>{await snapshot('real-open-failed');report.cards=await js(`Array.from(document.querySelectorAll('.library-card')).map(c=>c.getAttribute('aria-label'))`);throw error})
    report.sources=await until(()=>js(`window.singularity.knowledge.sources(${JSON.stringify(id)}).then(s=>s.filter(b=>b.kind==='paragraph').length)`),'sources',120000)
    for(const [index,text] of clicks.entries()){
      // Scroll the page holding the text into view so its text layer renders, then click that span.
      const page=await js(`window.singularity.knowledge.sources(${JSON.stringify(id)}).then(s=>s.find(b=>b.kind==='paragraph'&&b.text.includes(${JSON.stringify(text)}))?.parts[0].page)`)
      await js(`document.querySelector('.continuous-page-frame[data-page="${page}"]')?.scrollIntoView({block:'start'})`);await wait(1500)
      const clicked=await js(`(()=>{const span=Array.from(document.querySelectorAll('.continuous-page-frame[data-page="${page}"] .textLayer span')).find(s=>s.textContent.includes(${JSON.stringify(text)}));if(!span)return false;span.scrollIntoView({block:'center'});const r=span.getBoundingClientRect();span.closest('.continuous-pdf-sheet').dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:r.left+Math.min(20,r.width/2),clientY:r.top+r.height/2}));return true})()`)
      await wait(900)
      report[`click-${index}`]={text,page,clicked,lines:await js('document.querySelectorAll(".paragraph-preview span").length'),pending:await js(`document.querySelector('.pending-translation-source')?.value?.slice(0,400)??null`)}
      await snapshot(`real-click-${index}`)
      await js(`Array.from(document.querySelectorAll('.pending-translation-card button')).find(b=>b.textContent.trim()==='取消')?.click()`);await wait(300)
    }
    return
  }
  for(const theme of ['light','dark']){
    await js(`(()=>{document.querySelector('[aria-label="设置"]').click()})()`);await wait(500)
    await js(`document.querySelectorAll('.segmented button')[${theme==='light'?0:1}].click()`);await wait(500)
    await snapshot(`${theme}-settings`)
    await js(`document.querySelector('.runtime-pill').click()`);await wait(600);await snapshot(`${theme}-status`)
    await nav('首页');await wait(1200);await snapshot(`${theme}-assistant`)
    if(native()){
      for(const text of ['继续','稍后配置']){await native().webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)})?.click()`).catch(()=>{});await wait(400)}
      report[`${theme}-assistant`]=await native().webContents.executeJavaScript(`({visible:document.visibilityState,text:document.body.innerText.slice(0,160),styled:!!document.getElementById('singularity-harness-theme'),font:getComputedStyle(document.body).fontFamily})`).catch((e)=>String(e))
      report[`${theme}-assistant`].bounds=native().getBounds();report[`${theme}-assistant`].shown=native().getVisible()
      fs.writeFileSync(path.join(output,`${theme}-assistant-view.png`),(await native().webContents.capturePage()).toPNG())
    }
    for(const [slug,name] of process.argv.includes('--reader-only')?[]:routes){
      await nav(name);await snapshot(`${theme}-${slug}`)
      if(['discovery','projects','writing'].includes(slug)){await js(`(()=>{const p=document.querySelector('.main-content .page');if(p)p.scrollTop=p.scrollHeight})()`);await snapshot(`${theme}-${slug}-end`);await js(`(()=>{const p=document.querySelector('.main-content .page');if(p)p.scrollTop=0})()`)}
    }
    await nav('论文库');await until(()=>js('Boolean(document.querySelector(".library-card"))'),'paper card')
    await js(`document.querySelector('.library-card').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))`)
    await until(()=>js('document.querySelectorAll(".textLayer span").length>0'),'PDF text layer').catch(()=>{})
    await wait(600);await snapshot(`${theme}-reader`)
    await js(`document.querySelector('[aria-label="返回论文库"]')?.click()`);await wait(300)
    await until(()=>js(`Boolean(document.querySelector('.library-card[aria-label*="Latent Reasoning"]'))`),'paragraph paper card')
    await js(`document.querySelector('.library-card[aria-label*="Latent Reasoning"]').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))`)
    await until(()=>js('document.querySelectorAll(".textLayer span").length>0'),'paragraph text layer').catch(()=>{})
    await wait(800)
    await js(`(()=>{const spans=document.querySelectorAll('.textLayer span');const span=spans[Math.min(2,spans.length-1)];const r=span.getBoundingClientRect();span.closest('.continuous-pdf-sheet').dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:r.left+r.width/2,clientY:r.top+r.height/2}))})()`)
    await until(()=>js('document.querySelectorAll(".paragraph-preview span").length>0'),'paragraph preview').catch(()=>{})
    await wait(500);await snapshot(`${theme}-reader-selected`)
    report[`${theme}-preview`]=await js(`(()=>{const s=document.querySelector('.paragraph-preview span');if(!s)return null;const c=getComputedStyle(s);return {lines:document.querySelectorAll('.paragraph-preview span').length,background:c.backgroundColor,blend:c.mixBlendMode,bar:getComputedStyle(s,'::before').backgroundColor}})()`)
    await js(`document.querySelector('[aria-label="返回论文库"]')?.click()`);await wait(300)
  }
  await js(`document.querySelector('[aria-label="设置"]').click()`);await wait(300)
  await js(`document.querySelectorAll('.segmented button')[0].click()`)
}

main().then(()=>{fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));app.exit(0)}).catch((error)=>{report.failure=String(error?.stack||error);fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));console.error(error);app.exit(1)})
