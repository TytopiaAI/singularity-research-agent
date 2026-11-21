/* electron scripts/verify-bilingual-reading.cjs --pdf <paper.pdf> --cache <translation.json>
   Original files are read only. Model calls are prohibited; UI uses labeled offline samples. */
const { app, BrowserWindow, protocol } = require('electron')
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const { pathToFileURL } = require('node:url'), { createHash } = require('node:crypto')
const root = path.resolve(__dirname, '..'), output = path.join(root, '.local-data', 'bilingual-reading-verification', String(Date.now()))
fs.mkdirSync(output, { recursive: true }); app.setPath('userData', path.join(output, 'electron-data'))
protocol.registerSchemesAsPrivileged([{ scheme: 'singularity-paper', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }])
const argument = (name) => process.argv[process.argv.indexOf(name) + 1]
const report = { output, checks: [], errors: [], translationMode: 'offline UI samples; no model called' }
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function until(fn, label) { for (let i=0;i<300;i++) { if (await fn()) return; await wait(50) } throw Error('Timeout: '+label) }
const hash = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
async function main() {
  assert(process.argv.includes('--pdf') && process.argv.includes('--cache'))
  const pdfFile = argument('--pdf'), cacheFile = argument('--cache'), before = [hash(pdfFile), hash(cacheFile)]
  const old = JSON.parse(fs.readFileSync(cacheFile, 'utf8')), directory = path.join(output, 'artifacts')
  fs.mkdirSync(path.join(directory, 'paper'), { recursive: true }); fs.copyFileSync(cacheFile, path.join(directory, 'paper', `translation-v1-${old.checksum}.json`))
  const esbuild = require('esbuild')
  await esbuild.build({ entryPoints: [path.join(root,'src/main/document-translation.ts')], bundle: true, platform:'node', packages:'external', format:'esm', outfile:path.join(output,'extractor.mjs'), logLevel:'silent' })
  const { DocumentTranslationService } = await import(pathToFileURL(path.join(output,'extractor.mjs')).href)
  const document = await new DocumentTranslationService(directory, () => ({ id:'paper', checksum:old.checksum, sourcePath:pdfFile, indexStatus:'ready' }), async () => { throw Error('Unexpected model request') }).get('paper')
  for (const n of [2,3]) {
    const blocks = document.blocks.filter(b => b.parts[0].page===n)
    assert(!blocks.some(b => b.kind==='paragraph' && /^(?:[\d.\s]+|answer|standing|is|Token|no bypass Backbone|\(a\)|\(b\))$/.test(b.text)))
    assert(blocks.some(b => b.kind==='figure' && b.imageRect?.width>.6))
  }
  assert(document.blocks.find(b=>b.parts[0].page===2&&b.kind==='figure').text.includes('before CVRR adaptation'))
  const page4=document.blocks.filter(b=>b.parts[0].page===4)
  assert.equal(page4.filter(b=>b.kind==='formula' && b.math).length,3)
  assert(page4.find(b=>b.math?.label==='1').math.tex.includes('{m_{i} (0)}'))
  assert(page4.some(b=>b.text.includes('$f_{0} = L_{21}$')))
  report.checks.push('Real pages 2/3 retain complete charts and diagrams; chart values and diagram words never become translation paragraphs; page 4 reconstructs fractions/scripts and preserves denominator m_i(0)')
  report.reusedTranslations=Object.keys(document.translations).length
  const reopened=await new DocumentTranslationService(directory,()=>({id:'paper',checksum:old.checksum}),async()=>{throw Error('Unexpected request')}).get('paper')
  assert.deepEqual(reopened.translations,document.translations)
  report.checks.push('Existing cache is backed up and migrated; unchanged translations survive reopening without requests')
  const preview=structuredClone(document)
  const headings={'3 METHOD':'3 方法','3.1 CAUSAL VISUAL-READ BOUNDARY':'3.1 因果视觉读取边界','3.2 PERSISTENT VISUAL RECURRENCE':'3.2 持续视觉循环','2 PRELIMINARY EXPERIMENTS':'2 预备实验'}
  for (const b of preview.blocks) if(b.kind!=='formula' && b.text.trim()) {
    if(headings[b.text]) preview.translations[b.id]=headings[b.text]
    else if(b.text.startsWith('The recurrent path')) preview.translations[b.id]=String.raw`循环路径不应从任意隐藏状态开始。它应在大量视觉信息已经进入问题表示之后开始，同时视觉状态仍保留下游影响，使循环能够重新读取。我们在冻结的基础 VLM 上使用逐层激活修补来定位这一转变。我们构造对比样本 $x=(I,q,y)$ 与 $x^{\prime}=(I^{\prime},q,y^{\prime})$，它们共享相同的问题，但包含不同图像并产生不同答案。令 $M_x$ 表示原答案的对数概率边际，$M_{x^{\prime}}$ 定义为相反方向；$P_{\ell}(x\leftarrow x^{\prime})$ 表示在第 $\ell$ 层用另一幅图像的视觉激活进行修补。双向效应定义如下。`
    else if(b.text.startsWith('For Qwen2.5')) preview.translations[b.id]=String.raw`对于 Qwen2.5-VL-7B，这一过程得到 $\ell^{*}=20$，随后的 $f_0=L_{21}$ 层用于初始化循环。在这个边界，冻结的下层主干产生如下状态。`
    else if(!preview.translations[b.id]) preview.translations[b.id]='离线排版验证段落：正文与译文逐段对应。'+(b.text.match(/\$[^$]+\$/g)??[]).join('，')
  }
  await esbuild.build({entryPoints:[path.join(root,'scripts/fixtures/bilingual-reading.tsx')],bundle:true,format:'esm',platform:'browser',target:'chrome140',jsx:'automatic',outfile:path.join(output,'fixture.js'),loader:{'.woff2':'file','.woff':'file','.ttf':'file'},assetNames:'fonts/[name]-[hash]',logLevel:'warning'})
  fs.writeFileSync(path.join(output,'index.html'),`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><link rel="stylesheet" href="fixture.css"></head><body><div id="root"></div><script>window.bilingualTest=${JSON.stringify({document:preview,worker:pathToFileURL(require.resolve('pdfjs-dist/build/pdf.worker.mjs')).href,pageCount:19}).replaceAll('<','\\u003c')}</script><script type="module" src="fixture.js"></script></body></html>`)
  await app.whenReady(); protocol.handle('singularity-paper',()=>new Response(fs.readFileSync(pdfFile),{headers:{'Content-Type':'application/pdf','Access-Control-Allow-Origin':'*'}}))
  const win=new BrowserWindow({width:1640,height:1150,show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,offscreen:true}})
  win.webContents.on('console-message',event=>{if(event.level==='error')report.errors.push(event.message)})
  await win.loadFile(path.join(output,'index.html'))
  const js=code=>win.webContents.executeJavaScript(code,true),click=selector=>js(`document.querySelector(${JSON.stringify(selector)}).click()`)
  await until(()=>js(`document.querySelectorAll('[data-page="4"] .textLayer span').length>10`),'actual PDF page 4')
  await click('.reader-full-translation'); await until(()=>js(`Boolean(document.querySelector('.document-translation-result .katex'))`),'typeset inline mathematics')
  const mathBlock=page4.find(b=>b.text.startsWith('The recurrent path'))
  const formula=page4.find(b=>b.math?.label==='1')
  await js(`document.querySelector('[data-block-id="${mathBlock.id}"]').scrollIntoView({block:'start'})`)
  await wait(200)
  assert.equal(await js(`document.querySelectorAll('[data-block-id="${formula.id}"] img').length`),0)
  assert(await js(`Boolean(document.querySelector('[data-block-id="${formula.id}"] .katex .mfrac'))`))
  const resultSelector=`[data-block-id="${mathBlock.id}"] .document-translation-result`
  await click(resultSelector)
  await until(()=>js(`document.querySelectorAll('[data-page="4"] .stable-source-target span').length>0`),'paragraph source highlight')
  await until(()=>js(`(()=>{const root=document.querySelector('.continuous-pdf-scroll').getBoundingClientRect();const mark=document.querySelector('[data-page="4"] .stable-source-target span').getBoundingClientRect();return Math.abs(mark.top-root.top-70)<8})()`),'precise paragraph scroll')
  assert(await js(`document.querySelector('[data-block-id="${mathBlock.id}"]').dataset.current==='true'`))
  await wait(150);fs.writeFileSync(path.join(output,'bilingual-math-reading.png'),(await win.webContents.capturePage()).toPNG())
  report.checks.push('Chinese paragraphs and display equations use locally bundled KaTeX, with fractions/primes/scripts; clicking a translation keeps the bilingual panel open and highlights/scrolls to its exact PDF paragraph')
  const size=await js(`getComputedStyle(document.querySelector(${JSON.stringify(resultSelector)})).fontSize`)
  await click('[aria-label="增大阅读字号"]');assert.notEqual(await js(`getComputedStyle(document.querySelector(${JSON.stringify(resultSelector)})).fontSize`),size)
  await click('[aria-label="减小阅读字号"]')
  const figure=document.blocks.find(b=>b.parts[0].page===2&&b.kind==='figure')
  await js(`document.querySelector('[data-block-id="${figure.id}"]').scrollIntoView({block:'center'})`)
  await until(()=>js(`Boolean(document.querySelector('[data-block-id="${figure.id}"] .translation-figure img'))`),'whole chart preview')
  await click(`[data-block-id="${figure.id}"] .translation-source-page`)
  await until(()=>js(`(()=>{const root=document.querySelector('.continuous-pdf-scroll').getBoundingClientRect();const mark=document.querySelector('[data-page="2"] .stable-source-target span')?.getBoundingClientRect();return mark&&Math.abs(mark.top-root.top-70)<8})()`),'figure caption source location')
  fs.writeFileSync(path.join(output,'whole-chart-reading.png'),(await win.webContents.capturePage()).toPNG())
  for (const mode of ['light','dark']) for (const theme of ['warm','blue','purple','green','transparent']) {
    await js(`document.documentElement.dataset.theme=${JSON.stringify(mode)};document.querySelector('.main-content').dataset.chatTheme=${JSON.stringify(theme)}`)
    const colors=await js(`(() => { const main=document.querySelector('.main-content');return { main:getComputedStyle(main).backgroundColor, ink:getComputedStyle(main).color, panelInk:getComputedStyle(document.querySelector('.document-translation-panel')).color, backgrounds:['.document-translation-panel','.document-translation-panel > header','.document-translation-controls','.document-translation-scroll'].map(s=>getComputedStyle(document.querySelector(s)).backgroundColor) } })()`)
    assert(colors.backgrounds.every(value=>value==='rgba(0, 0, 0, 0)'),`${mode}/${theme}: translation layers expose the shared theme background`)
    assert.equal(colors.panelInk,colors.ink,`${mode}/${theme}: reading text follows theme contrast`)
    if(mode==='light'&&theme==='blue') {
      await wait(100);fs.writeFileSync(path.join(output,'blue-theme-reading.png'),(await win.webContents.capturePage()).toPNG())
    }
  }
  report.checks.push('All five homepage background themes update the translation header, controls and reading area without a fixed paper overlay; text follows light/dark theme contrast')
  await js(`document.documentElement.dataset.theme='dark';document.querySelector('[data-block-id="${mathBlock.id}"]').scrollIntoView({block:'start'})`)
  await wait(150);fs.writeFileSync(path.join(output,'dark-reading.png'),(await win.webContents.capturePage()).toPNG())
  win.setSize(1100,900);await wait(250)
  assert(await js(`(()=>{const p=document.querySelector('.document-translation-panel');return p.scrollWidth<=p.clientWidth+1})()`))
  report.checks.push('Font-size controls, whole-figure previews, dark paper colors and narrow bilingual panels remain usable without panel overflow')
  assert.deepEqual([hash(pdfFile),hash(cacheFile)],before);report.checks.push('Original installed PDF and translation-cache hashes unchanged')
  win.close()
}
main().catch(error=>{report.errors.push(String(error.stack||error));console.error(error)}).finally(()=>{fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));app.exit(report.errors.length?1:0)})
