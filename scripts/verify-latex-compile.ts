import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { LatexStore } from '../src/main/latex-store'
import { LatexCompilerService } from '../src/main/latex-compiler'
const root=path.resolve(process.env.LATEX_VERIFY_ROOT??'.local-data/latex-verification/'+Date.now()),store=new LatexStore(root),compiler=new LatexCompilerService(store,root)
const engine=path.resolve('.local-data/tools/tectonic/tectonic.exe')
fs.mkdirSync(root,{recursive:true})
await compiler.configure('tectonic',engine)
const project=store.create('LaTeX real compilation',{
  'main.tex':Buffer.from('\\documentclass{article}\n\\usepackage{amsmath,graphicx}\n\\begin{document}\n\\section{Research workspace}\n\\input{sections/method}\nSee Figure~\\ref{fig:test} and the work of~\\cite{example}.\n\\begin{figure}[h]\\centering\\includegraphics[width=1cm]{pixel.png}\\caption{Embedded asset}\\label{fig:test}\\end{figure}\n\\bibliographystyle{plain}\n\\bibliography{refs}\n\\end{document}'),
  'sections/method.tex':Buffer.from('A compiled manuscript with an equation.\n\\begin{equation} E=mc^2 \\label{eq:energy}\\end{equation}\n'),
  'refs.bib':Buffer.from('@article{example,author={Ada Researcher},title={A Verifiable Example},journal={Research},year={2026}}'),
  'pixel.png':fs.readFileSync(path.resolve('build/icon.png')),
})
await compiler.compile(project.id)
const start=Date.now()
while(compiler.current(project.id)?.status==='running'&&Date.now()-start<250000)await new Promise(r=>setTimeout(r,500))
const build=compiler.current(project.id)!
fs.writeFileSync(path.join(root,'report.json'),JSON.stringify({root,project,build},null,2))
console.log(JSON.stringify({root,status:build.status,diagnostics:build.diagnostics,logTail:build.log.slice(-1800)}))
await compiler.close()
assert.equal(build.status,'success')
assert(fs.readFileSync(compiler.pdf(project.id)).subarray(0,5).toString()==='%PDF-')
const points=compiler.sync(project.id,build.id);assert(points.some(p=>p.file==='sections/method.tex'));console.log('SyncTeX points:',points.length)
if(process.argv.includes('--chinese')){
  const chinese=store.create('中文论文编译',{'main.tex':Buffer.from('\\documentclass[fontset=fandol]{ctexart}\n\\usepackage{amsmath}\n\\begin{document}\n\\section{中文论文编辑}\n支持中文与 English 混排，以及公式 $E=mc^2$。\n\\end{document}\n')})
  await compiler.compile(chinese.id);const began=Date.now()
  while(compiler.current(chinese.id)?.status==='running'&&Date.now()-began<250000)await new Promise(r=>setTimeout(r,500))
  const result=compiler.current(chinese.id)!;fs.writeFileSync(path.join(root,'chinese-report.json'),JSON.stringify({project:chinese,build:result},null,2));console.log(JSON.stringify({chinese:result.status,logTail:result.log.slice(-1300)}));await compiler.close();assert.equal(result.status,'success')
}
