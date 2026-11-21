/* Actual Chromium/PDF.js zoom regression. Isolated fixture; no installed app, API or user data. */
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const { pathToFileURL } = require('node:url')
const root = path.resolve(__dirname, '..')
const output = path.join(root, '.local-data', 'pdf-highlight-verification', String(Date.now()))
fs.mkdirSync(output, { recursive: true })
app.setPath('userData', path.join(output, 'electron-data'))
const report = { output, checks: [], scales: [], errors: [] }
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function until(fn, label) {
  const start = Date.now()
  while (Date.now() - start < 30000) { if (await fn()) return; await wait(30) }
  throw new Error('Timeout: ' + label)
}

function testPdf() {
  const lines = [
    [['Research methods provide reliable results.', 72, 700, 12],
     ['Scientific evaluation uses transparent methods and reproducible experiments.', 72, 670, 12],
     ['We compare controlled experiments against independent baselines.', 72, 640, 12],
     ['A larger heading uses different font metrics.', 72, 590, 17]],
    [['External validation needs independent evidence.', 72, 700, 11]],
  ]
  const streams = lines.map((page) => page.map(([text, x, y, size]) => `BT /F1 ${size} Tf 1 0 0 1 ${x} ${y} Tm (${text}) Tj ET`).join('\n'))
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /UserUnit 1.25 /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ...streams.map((stream) => `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`),
  ]
  let data = '%PDF-1.7\n', offsets = [0]
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(data)); data += `${index + 1} 0 obj\n${object}\nendobj\n` })
  const xref = Buffer.byteLength(data)
  data += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  offsets.slice(1).forEach((offset) => { data += `${String(offset).padStart(10, '0')} 00000 n \n` })
  return Buffer.from(data + `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`)
}

async function main() {
  await require('esbuild').build({ entryPoints: [path.join(root, 'scripts/fixtures/pdf-highlights.tsx')],
    bundle: true, format: 'esm', platform: 'browser', target: 'chrome140', jsx: 'automatic',
    outfile: path.join(output, 'fixture.js'), logLevel: 'warning' })
  fs.writeFileSync(path.join(output, 'index.html'), `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="fixture.css"></head><body><div id="root"></div><script>window.pdfHighlightTest=${JSON.stringify({ data: [...testPdf()], worker: pathToFileURL(require.resolve('pdfjs-dist/build/pdf.worker.mjs')).href, errors: [] })}</script><script type="module" src="fixture.js"></script></body></html>`)
  await app.whenReady()
  const win = new BrowserWindow({ width: 1600, height: 1020, show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
  await win.loadFile(path.join(output, 'index.html'))
  const js = (code) => win.webContents.executeJavaScript(code)
  const ready = () => js(`document.querySelectorAll('.review-highlights span').length===4 && document.querySelectorAll('.answer-highlights span').length===1 && [...document.querySelectorAll('.pdf-text-layer-host')].every(el=>getComputedStyle(el).visibility==='visible')`)
  await until(ready, 'initial render')
  const measure = () => js(`(() => {
    const norm=(r,s)=>({x:(r.x-s.x)/s.width,y:(r.y-s.y)/s.height,width:r.width/s.width,height:r.height/s.height});
    return {
      text: window.pdfHighlightTest.expected.map(expected=>{
        const sheet=document.querySelector('[data-page="'+expected.page+'"] .pdf-sheet');
        const span=[...sheet.querySelectorAll('.textLayer span')].find(s=>s.textContent===expected.text);
        const r=document.createRange();r.selectNodeContents(span);
        return {...norm(r.getBoundingClientRect(),sheet.getBoundingClientRect()),expected,fontSize:parseFloat(getComputedStyle(span).fontSize)};
      }),
      highlights:[...document.querySelectorAll('.review-highlights span,.answer-highlights span')].map(el=>{
        const sheet=el.closest('.pdf-sheet');return {key:el.dataset.reviewKey||el.dataset.answerId,...norm(el.getBoundingClientRect(),sheet.getBoundingClientRect())};
      }),errors:window.pdfHighlightTest.errors
    };
  })()`)
  const baseline = await measure()
  fs.writeFileSync(path.join(output, 'baseline.json'), JSON.stringify(baseline, null, 2))
  // Reproduce the old missing variable, proving that the checks detect the bug.
  const regressionStyle = await win.webContents.insertCSS('.textLayer { --total-scale-factor:initial !important; }')
  const broken = await measure()
  assert(broken.text.some((row) => Math.abs(row.width - row.expected.width) > .02), 'Fixture must detect the original font/geometry defect')
  await win.webContents.removeInsertedCSS(regressionStyle)
  report.checks.push('Original missing PDF.js scale variable reproduces text-width drift and is caught')

  async function check(scale, label = String(scale)) {
    await js(`window.pdfHighlightTest.setScale(${scale})`)
    await until(() => js(`Math.abs(parseFloat(document.querySelector('.pdf-sheet').style.width)-612*${scale})<.01`).then(async (sized) => sized && await ready()), 'render ' + label)
    const result = await measure()
    assert.deepEqual(result.errors, [], 'PDF rendering errors')
    for (const row of result.text) {
      assert(row.fontSize > 0, `Canonical text metrics ${label}: ${row.fontSize}`)
      assert(Math.abs(row.width - row.expected.width) < .0004, `PDF item vs text-layer width ${label}: ${row.width} vs ${row.expected.width} (${row.expected.text})`)
      assert(Math.abs(row.x - row.expected.x) < .0002, `PDF item vs text-layer position ${label}`)
    }
    for (let i = 0; i < result.highlights.length; i++) for (const key of ['x', 'y', 'width', 'height']) {
      assert(Math.abs(result.highlights[i][key] - baseline.highlights[i][key]) < .0004, `Highlight ${result.highlights[i].key} ${key} drift at ${label}`)
    }
    // Full-line summary geometry must match the PDF's own text-item width, not only the DOM.
    assert(Math.abs(result.highlights[0].width - result.text[0].expected.width) < .0004, 'Summary overshoots PDF text at ' + label)
    report.scales.push(label)
  }
  for (let step = 4; step <= 25; step++) await check(step / 10)
  for (const scale of [1.37, .83, 1.205, 1.999, 1.4, 1.3, 1.2, 1]) await check(scale)
  report.checks.push('Summary and answer highlights follow actual PDF text at all 22 supported zoom steps (40–250%) and fractional scales')
  for (let i = 0; i < 30; i++) { await js(`window.pdfHighlightTest.setScale(${i % 2 ? 1.2 : 1.4})`); await wait(4) }
  await check(1.3, 'rapid-zoom-final')
  report.checks.push('Rapid alternating zoom does not commit cancelled text layers or stale highlights')
  win.webContents.setZoomFactor(1.25)
  await check(1.4, 'DPI/browser-zoom-125%')
  await check(1.3, 'DPI/browser-zoom-125%-130%')
  report.checks.push('Correct geometry with 125% Chromium zoom/device-pixel-ratio and a PDF with UserUnit 1.25')
  win.webContents.setZoomFactor(1)
  await check(1)
  win.show()
  await wait(250)
  report.paint = await js(`Array.from(document.querySelectorAll('.review-highlights span')).map(el=>({color:getComputedStyle(el).backgroundColor,blend:getComputedStyle(el).mixBlendMode}))`)
  fs.writeFileSync(path.join(output, 'highlights-100.png'), (await win.webContents.capturePage()).toPNG())
  await check(1.3)
  await wait(250)
  fs.writeFileSync(path.join(output, 'highlights-130.png'), (await win.webContents.capturePage()).toPNG())
  win.close()
}
main().catch((error) => { report.errors.push(String(error)); console.error(error); process.exitCode = 1 }).finally(() => {
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2)); app.exit(report.errors.length ? 1 : 0)
})
