import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { zipSync, unzipSync } from 'fflate'
import { afterEach, describe, expect, it } from 'vitest'
import { LatexStore, latexPath } from '../src/main/latex-store'
import { LatexCompilerService, latexDiagnostics, parseSyncTex } from '../src/main/latex-compiler'

const roots:string[]=[]
function setup(){const root=fs.mkdtempSync(path.join(os.tmpdir(),'singularity-latex-'));roots.push(root);return{root,store:new LatexStore(root)}}
afterEach(()=>{for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true})})
describe('LaTeX projects',()=>{
  it('imports nested source, bibliography and binary assets, detects main and round-trips all bytes',()=>{
    const {root,store}=setup(),entries={'paper/main.tex':Buffer.from('\\documentclass{article}\n\\input{sections/a}'),'paper/sections/a.tex':Buffer.from('中文内容'),'paper/refs.bib':Buffer.from('@article{key,title={Test}}'),'paper/image.png':new Uint8Array([0,1,2,255])}
    const zip=path.join(root,'project.zip');fs.writeFileSync(zip,zipSync(entries));const p=store.importZip(zip)
    expect(p.mainFile).toBe('paper/main.tex');expect(p.files).toHaveLength(4)
    expect(store.read(p.id,'paper/sections/a.tex').text).toBe('中文内容')
    const exported=unzipSync(store.exportZip(p.id));for(const [name,data]of Object.entries(entries))expect([...exported[name]]).toEqual([...data])
    expect(new LatexStore(root).list()[0].id).toBe(p.id)
  })
  it.each(['../outside.tex','/absolute.tex','C:/x.tex','a\\b.tex','a/../b.tex','CON.tex','a/nul','a./b.tex','bad\x00.tex','a//b.tex'])('rejects an escaping or Windows ambiguous path: %s',name=>expect(()=>latexPath(name)).toThrow())
  it('rejects traversal and case collisions inside ZIP before creating a project',()=>{
    const {root,store}=setup(),zip=path.join(root,'bad.zip')
    for(const entries of [{'../outside.tex':Buffer.from('bad')},{'main.tex':Buffer.from('x'),'MAIN.tex':Buffer.from('y')}]){fs.writeFileSync(zip,zipSync(entries));expect(()=>store.importZip(zip)).toThrow()}
    expect(store.list()).toEqual([]);expect(fs.existsSync(path.join(root,'outside.tex'))).toBe(false)
  })
  it('rejects oversized declared uncompressed ZIP entries before inflation',()=>{
    const {root,store}=setup(),zip=path.join(root,'bomb.zip'),bytes=Buffer.from(zipSync({'main.tex':Buffer.from('x')}))
    for(let i=0;i<bytes.length-4;i++)if(bytes.readUInt32LE(i)===0x02014b50){bytes.writeUInt32LE(250*1024*1024,i+24);break}
    fs.writeFileSync(zip,bytes);expect(()=>store.importZip(zip)).toThrow(/超过/);expect(store.list()).toEqual([])
  })
  it('saves with optimistic revisions and restores history without overwriting a concurrent update',()=>{
    const {store}=setup(),p=store.create('History'),first=store.read(p.id,p.mainFile),second=store.save(p.id,p.mainFile,first.text+'\nFirst edit',first.revision)
    expect(()=>store.save(p.id,p.mainFile,'lost update',first.revision)).toThrow(/新版本/)
    const history=store.versions(p.id,p.mainFile);expect(history).toHaveLength(1)
    const restored=store.restore(p.id,p.mainFile,history[0].id,second.revision);expect(restored.text).toBe(first.text);expect(store.versions(p.id,p.mainFile)).toHaveLength(2)
  })
  it('creates and renames nested files and protects the selected main document',()=>{
    const {store}=setup(),p=store.create('Files');store.createFile(p.id,'sections/method.tex');store.renameFile(p.id,'sections/method.tex','sections/approach.tex')
    expect(store.project(p.id).files.some(f=>f.path==='sections/approach.tex')).toBe(true)
    expect(()=>store.removeFile(p.id,'main.tex')).toThrow(/主 TeX/)
    store.configure(p.id,'sections/approach.tex','xelatex');store.removeFile(p.id,'main.tex');expect(store.project(p.id).files).toHaveLength(1)
    expect(()=>store.configure(p.id,'not-present.tex','tectonic')).toThrow()
  })
  it('keeps compile snapshots independent of subsequent source edits',()=>{
    const {root,store}=setup(),p=store.create('Snapshot'),document=store.read(p.id,p.mainFile),snapshot=path.join(root,'snapshot');store.snapshot(p.id,snapshot);store.save(p.id,p.mainFile,'changed',document.revision)
    expect(fs.readFileSync(path.join(snapshot,'main.tex'),'utf8')).toBe(document.text)
  })
  it('rejects non-UTF8 source instead of silently corrupting the imported file',()=>{
    const {store}=setup(),p=store.create('Encoding',{'main.tex':new Uint8Array([255,254,65,0])});expect(()=>store.read(p.id,'main.tex')).toThrow(/UTF-8/)
    expect([...unzipSync(store.exportZip(p.id))['main.tex']]).toEqual([255,254,65,0])
  })
  it('recovers an interrupted compile status after restarting the service',()=>{
    const {root,store}=setup(),p=store.create('Recovery');fs.writeFileSync(path.join(store.directory(p.id),'last-build.json'),JSON.stringify({id:crypto.randomUUID(),projectId:p.id,status:'running',log:'',diagnostics:[],startedAt:new Date().toISOString()}))
    const service=new LatexCompilerService(store,root);expect(service.current(p.id)?.status).toBe('failed');expect(service.current(p.id)?.log).toContain('中断')
  })
  it('reports missing engines without pretending to produce a PDF',async()=>{
    const {root,store}=setup(),p=store.create('Missing engine'),service=new LatexCompilerService(store,root);store.configure(p.id,p.mainFile,'lualatex')
    if(!(await service.compilers()).find(c=>c.engine==='lualatex')?.available)await expect(service.compile(p.id)).rejects.toThrow(/尚未配置/)
    expect(()=>service.pdf(p.id)).toThrow(/先成功编译/)
  })
})
it('maps compile errors to included files and retains warnings',()=>{
  const log='error: sections/method.tex:7: Undefined control sequence\nLaTeX Warning: Reference `fig:a` undefined.'
  expect(latexDiagnostics(log,'main.tex',['main.tex','sections/method.tex'])).toEqual([{file:'sections/method.tex',line:7,message:'Undefined control sequence',severity:'error'},{file:'main.tex',line:1,message:"Reference `fig:a` undefined.",severity:'warning'}])
})
it('locates an included source from the native TeX input stack when the log omits its extension',()=>{
  const log='(amsmath.sty (other.def))\n(main.aux)\n(sections/method\n! Undefined control sequence.\nl.7 \\broken\n'
  expect(latexDiagnostics(log,'paper/main.tex',['paper/main.tex','paper/sections/method.tex'])[0]).toMatchObject({file:'paper/sections/method.tex',line:7,severity:'error'})
})
it('decodes SyncTeX scaled-point coordinates and ignores non-project inputs',()=>{
  const text='SyncTeX Version:1\nInput:1:./main.tex\nInput:2:../outside.tex\nMagnification:1000\nUnit:1\nContent:\n{1\n[1,12:65536,131072:99,99,0\nx2,4:0,0\n}1'
  const points=parseSyncTex(text,path.resolve('project'),['main.tex']);expect(points).toHaveLength(1);expect(points[0]).toMatchObject({file:'main.tex',line:12,page:1});expect(points[0].x).toBeCloseTo(72/72.27)
})
