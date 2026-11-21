/* Screenshots of the full-translation panel for a real paper, in an isolated cache.
   No AI requests; the original PDF and translation cache are only read.
   electron scripts/capture-translation.cjs --pdf <source.pdf> --cache <translation.json> */
const { app, BrowserWindow, protocol } = require('electron')
const fs = require('node:fs'), path = require('node:path')
const { pathToFileURL } = require('node:url')
const root = path.resolve(__dirname, '..'), output = path.join(root, '.local-data', 'translation-capture', String(Date.now()))
fs.mkdirSync(output, { recursive: true }); app.setPath('userData', path.join(output, 'electron-data'))
protocol.registerSchemesAsPrivileged([{ scheme: 'singularity-layout', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }])
const argument = (name) => process.argv[process.argv.indexOf(name) + 1]
const pdfFile = argument('--pdf'), cacheFile = argument('--cache')
const report = { output, shots: [], errors: [] }, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function main() {
  const old = JSON.parse(fs.readFileSync(cacheFile, 'utf8')), artifacts = path.join(output, 'artifacts'), cacheDir = path.join(artifacts, 'paper')
  fs.mkdirSync(cacheDir, { recursive: true }); fs.copyFileSync(cacheFile, path.join(cacheDir, `translation-v1-${old.checksum}.json`))
  const esbuild = require('esbuild')
  await esbuild.build({ entryPoints: [path.join(root, 'src/main/document-translation.ts')], bundle: true, platform: 'node', packages: 'external', format: 'esm', outfile: path.join(output, 'extractor.mjs'), logLevel: 'silent' })
  const { DocumentTranslationService } = await import(pathToFileURL(path.join(output, 'extractor.mjs')).href)
  const service = new DocumentTranslationService(artifacts, () => ({ id: 'paper', checksum: old.checksum, sourcePath: pdfFile, indexStatus: 'ready' }), async () => { throw Error('Unexpected AI request') })
  const document = await service.get('paper')
  report.blocks = document.blocks.length
  report.reused = Object.keys(document.translations).length
  report.tables = document.blocks.filter((block) => block.kind === 'table').map((block) => ({ page: block.parts[0].page, image: Boolean(block.imageRect), text: block.text.slice(0, 60) }))
  await esbuild.build({ entryPoints: [path.join(root, 'scripts/fixtures/translation-capture.tsx')], bundle: true, format: 'esm', platform: 'browser', loader: { '.woff2': 'file', '.woff': 'file', '.ttf': 'file' }, target: 'chrome140', jsx: 'automatic', outfile: path.join(output, 'fixture.js'), logLevel: 'silent' })
  fs.writeFileSync(path.join(output, 'index.html'), `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><link rel="stylesheet" href="fixture.css"><style>body{margin:0;background:#c9cdd4}</style></head><body><div id="root"></div><script>window.captureTest=${JSON.stringify({ document, worker: pathToFileURL(require.resolve('pdfjs-dist/build/pdf.worker.mjs')).href }).replaceAll('<', '\\u003c')}</script><script type="module" src="fixture.js"></script></body></html>`)
  await app.whenReady()
  protocol.handle('singularity-layout', () => new Response(fs.readFileSync(pdfFile), { headers: { 'Content-Type': 'application/pdf', 'Access-Control-Allow-Origin': '*' } }))
  const win = new BrowserWindow({ width: 820, height: 1000, show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, offscreen: true } })
  win.webContents.on('console-message', (event) => { if (event.level === 'error') report.errors.push(event.message) })
  await win.loadFile(path.join(output, 'index.html'))
  const js = (code) => win.webContents.executeJavaScript(code, true)
  for (let i = 0; i < 100 && !(await js(`Boolean(document.querySelector('.document-translation-block'))`)); i++) await wait(100)
  const shot = async (name, selector) => {
    await js(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(el)el.scrollIntoView({block:'start'});const s=document.querySelector('.document-translation-scroll');if(s)s.scrollTop-=40})()`)
    await wait(900)
    fs.writeFileSync(path.join(output, `${name}.png`), (await win.webContents.capturePage()).toPNG()); report.shots.push(name)
  }
  const pageBlock = (page, kind = 'paragraph') => `[data-block-id^="block-${page}-"].block-${kind}`
  await shot('warm-page2', pageBlock(2))
  await shot('warm-formula', '.block-formula')
  await shot('warm-table', '.block-table')
  await shot('warm-page8', pageBlock(8))
  for (const theme of ['blue', 'green']) { await js(`window.setChatTheme(${JSON.stringify(theme)})`); await shot(`${theme}-page2`, pageBlock(2)) }
  await js(`window.setChatTheme('warm');document.documentElement.dataset.theme='dark'`); await shot('dark-page2', pageBlock(2))
  report.wash = await js(`(()=>{const r=document.querySelector('.document-translation-result:not(.waiting)');const p=document.querySelector('.document-translation-scroll');return r&&{wash:getComputedStyle(r).backgroundColor,paper:getComputedStyle(p).backgroundColor}})()`)
  win.close()
}
main().catch((error) => { report.errors.push(String(error?.stack || error)); console.error(error) }).finally(() => {
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2)); app.exit(report.errors.length ? 1 : 0)
})
