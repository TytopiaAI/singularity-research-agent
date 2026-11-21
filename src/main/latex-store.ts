import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { unzipSync, zipSync } from 'fflate'
import { latexEngines, latexTextExtensions, type LatexDocument, type LatexEngine, type LatexFile, type LatexProject, type LatexVersion } from '../shared/latex'

const MAX_FILE=20*1024*1024,MAX_PROJECT=200*1024*1024,MAX_FILES=4000
const hash=(data:string|Buffer)=>createHash('sha256').update(data).digest('hex')
export function latexPath(value:unknown):string {
  if(typeof value!=='string'||!value||value.length>220||value.includes('\\')||/[\x00-\x1f<>:"|?*]/.test(value)||value.startsWith('/')||value.split('/').some(p=>!p||p==='.'||p==='..'||/[. ]$/.test(p)||/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(p)))throw Error('文件名无效，请使用项目内的相对路径。')
  return value
}
function atomic(file:string,data:string|Uint8Array){fs.mkdirSync(path.dirname(file),{recursive:true});const temp=file+'.'+randomUUID()+'.tmp';try{fs.writeFileSync(temp,data);fs.renameSync(temp,file)}finally{if(fs.existsSync(temp))fs.unlinkSync(temp)}}
type Meta=Omit<LatexProject,'files'>
export class LatexStore {
  readonly root:string
  constructor(dataRoot:string){this.root=path.join(dataRoot,'latex-projects');fs.mkdirSync(this.root,{recursive:true})}
  directory(id:unknown){if(typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id))throw Error('LaTeX 项目无效。');return path.join(this.root,id)}
  source(id:string){const dir=path.join(this.directory(id),'source');this.meta(id);if(fs.lstatSync(dir).isSymbolicLink())throw Error('项目目录不能是链接。');return dir}
  meta(id:string):Meta{const dir=this.directory(id);if(fs.lstatSync(dir).isSymbolicLink())throw Error('项目目录不能是链接。');const value=JSON.parse(fs.readFileSync(path.join(dir,'project.json'),'utf8'));if(value.id!==id)throw Error('项目元信息无效。');return value}
  private put(meta:Meta){atomic(path.join(this.directory(meta.id),'project.json'),JSON.stringify(meta,null,2))}
  touch(id:string){const meta=this.meta(id);meta.updatedAt=new Date().toISOString();this.put(meta)}
  file(id:string,relative:string,mustExist=true){const root=this.source(id),parts=latexPath(relative).split('/');let current=root;for(const part of parts){current=path.join(current,part);if(fs.existsSync(current)&&fs.lstatSync(current).isSymbolicLink())throw Error('不支持符号链接。')}if(mustExist&&!fs.statSync(current).isFile())throw Error('文件不存在。');return current}
  files(id:string):LatexFile[]{const root=this.source(id),result:LatexFile[]=[];let size=0;const walk=(dir:string)=>{for(const item of fs.readdirSync(dir,{withFileTypes:true})){if(item.isSymbolicLink())throw Error('不支持符号链接。');const full=path.join(dir,item.name);if(item.isDirectory())walk(full);else if(item.isFile()){const relative=path.relative(root,full).split(path.sep).join('/');latexPath(relative);const bytes=fs.statSync(full).size;size+=bytes;if(result.length>=MAX_FILES||size>MAX_PROJECT||bytes>MAX_FILE)throw Error('项目超过限制（4000 文件 / 200 MB，单文件 20 MB）。');result.push({path:relative,size:bytes,editable:latexTextExtensions.test(relative)&&bytes<=2*1024*1024})}}};walk(root);return result.sort((a,b)=>a.path.localeCompare(b.path))}
  project(id:string):LatexProject{return {...this.meta(id),files:this.files(id)}}
  list(){return fs.readdirSync(this.root).filter(id=>/^[a-f0-9-]{36}$/.test(id)).flatMap(id=>{try{return[this.project(id)]}catch{return[]}}).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))}
  create(title:string,entries:Record<string,Uint8Array>={'main.tex':Buffer.from('\\documentclass{article}\n\\usepackage{amsmath,graphicx}\n\\title{A new research paper}\n\\author{Author}\n\\date{\\today}\n\\begin{document}\n\\maketitle\n\\begin{abstract}\nWrite your abstract here.\n\\end{abstract}\n\\section{Introduction}\nStart writing your paper here.\n\\begin{equation}\n E = mc^2\n\\end{equation}\n\\end{document}\n')}){
    if(typeof title!=='string'||!title.trim()||title.length>200)throw Error('请输入项目名称（最多 200 字）。')
    const normalized=new Set<string>();let size=0
    for(const [name,data]of Object.entries(entries)){latexPath(name);const lower=name.toLowerCase();if(normalized.has(lower))throw Error('ZIP 中有大小写冲突的文件。');normalized.add(lower);size+=data.byteLength;if(data.byteLength>MAX_FILE||size>MAX_PROJECT||normalized.size>MAX_FILES)throw Error('项目文件过大。')}
    const tex=Object.keys(entries).filter(name=>/\.tex$/i.test(name));if(!tex.length)throw Error('ZIP 中没有 .tex 文件。')
    const roots=tex.filter(name=>/\\documentclass\b/.test(Buffer.from(entries[name]).toString('utf8')))
    const mainFile=roots.find(name=>/(^|\/)(main|paper|manuscript)\.tex$/i.test(name))??roots[0]??tex[0]
    const id=randomUUID(),dir=this.directory(id)
    fs.mkdirSync(path.join(dir,'source'),{recursive:true})
    try{for(const [name,data]of Object.entries(entries))atomic(path.join(dir,'source',name),data);this.put({id,title:title.trim(),mainFile,engine:'tectonic',updatedAt:new Date().toISOString()});return this.project(id)}catch(e){fs.rmSync(dir,{recursive:true,force:true});throw e}
  }
  importZip(filename:string){
    if(fs.statSync(filename).size>100*1024*1024)throw Error('ZIP 最大为 100 MB。')
    let size=0,count=0;const names=new Set<string>()
    const entries=unzipSync(fs.readFileSync(filename),{filter:entry=>{
      if(entry.name.endsWith('/')){latexPath(entry.name.slice(0,-1));return false}
      latexPath(entry.name);if(entry.name.startsWith('__MACOSX/')||entry.name.endsWith('.DS_Store'))return false
      if(names.has(entry.name.toLowerCase()))throw Error('ZIP 中有重复文件名。');names.add(entry.name.toLowerCase())
      size+=entry.originalSize;count++;if(size>MAX_PROJECT||entry.originalSize>MAX_FILE||count>MAX_FILES)throw Error('ZIP 解压后超过项目大小限制。');return true
    }})
    if(!Object.keys(entries).length)throw Error('ZIP 中没有可导入的文件。')
    return this.create(path.basename(filename).replace(/\.zip$/i,''),entries)
  }
  read(id:string,name:string):LatexDocument{const file=this.file(id,name);if(!latexTextExtensions.test(name)||fs.statSync(file).size>2*1024*1024)throw Error('此文件仅作为项目资源保留，不能以文本编辑。');const bytes=fs.readFileSync(file);let text:string;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes)}catch{throw Error('此文本不是 UTF-8 编码，请先转换编码后导入。')}return{path:name,text,revision:hash(bytes)}}
  private historyDir(id:string,name:string){return path.join(this.directory(id),'history',hash(latexPath(name)))}
  applyBatch(id:string,changes:Array<{file:string;before:string|null;after:string}>){
    const files=this.files(id),names=new Set<string>(),pending=changes.map(c=>{
      latexPath(c.file);if(!latexTextExtensions.test(c.file)||typeof c.after!=='string'||Buffer.byteLength(c.after)>2*1024*1024)throw Error('模板写入文件无效。')
      const lower=c.file.toLowerCase();if(names.has(lower)||files.some(f=>f.path.toLowerCase()===lower&&f.path!==c.file))throw Error('文件名冲突。');names.add(lower)
      const exists=fs.existsSync(this.file(id,c.file,false)),prior=exists?this.read(id,c.file).text:null
      if(prior!==c.before)throw Error('模板已被修改，请重新预览，避免覆盖。')
      return {...c,prior}
    })
    if(files.length+pending.filter(c=>c.prior===null).length>MAX_FILES||files.reduce((n,f)=>n+f.size,0)+pending.reduce((n,c)=>n+Buffer.byteLength(c.after)-Buffer.byteLength(c.prior??''),0)>MAX_PROJECT)throw Error('项目超过大小限制。')
    const written:typeof pending=[]
    try{for(const c of pending){if(c.prior!==null)this.checkpoint(id,c.file,c.prior);atomic(this.file(id,c.file,false),c.after);written.push(c)}this.touch(id)}catch(e){for(const c of written.reverse()){const file=this.file(id,c.file,false);if(c.prior===null)fs.unlinkSync(file);else atomic(file,c.prior)}throw e}
  }
  private checkpoint(id:string,name:string,text:string){const dir=this.historyDir(id,name);fs.mkdirSync(dir,{recursive:true});const stamp=Date.now()+'-'+randomUUID()+'.txt';atomic(path.join(dir,stamp),text);for(const old of fs.readdirSync(dir).sort().slice(0,-30))fs.unlinkSync(path.join(dir,old))}
  save(id:string,name:string,text:string,revision:string){if(typeof text!=='string'||Buffer.byteLength(text)>2*1024*1024)throw Error('文本超过 2 MB。');const prior=this.read(id,name);if(prior.revision!==revision)throw Error('文件已有新版本，未覆盖。请重新打开或复制当前修改后重试。');if(prior.text!==text){this.checkpoint(id,name,prior.text);atomic(this.file(id,name),text);this.touch(id)}return this.read(id,name)}
  configure(id:string,mainFile:string,engine:LatexEngine){if(!latexEngines.includes(engine)||!this.files(id).some(f=>f.path===mainFile&&/\.tex$/i.test(mainFile)))throw Error('请选择有效的主 TeX 文件和编译引擎。');this.put({...this.meta(id),mainFile,engine,updatedAt:new Date().toISOString()});return this.project(id)}
  createFile(id:string,name:string){latexPath(name);const files=this.files(id);if(files.length>=MAX_FILES||files.some(f=>f.path.toLowerCase()===name.toLowerCase()))throw Error('同名文件已存在，或文件数已达上限。');if(!latexTextExtensions.test(name))throw Error('请创建 .tex、.bib 或其他文本文件。');atomic(this.file(id,name,false),'');this.touch(id);return this.project(id)}
  renameFile(id:string,name:string,next:string){const old=this.file(id,name),dest=this.file(id,next,false);if(this.files(id).some(f=>f.path.toLowerCase()===next.toLowerCase()))throw Error('目标文件已存在。');fs.mkdirSync(path.dirname(dest),{recursive:true});fs.renameSync(old,dest);const before=this.historyDir(id,name),after=this.historyDir(id,next);if(fs.existsSync(before))fs.renameSync(before,after);const meta=this.meta(id);if(meta.mainFile===name)meta.mainFile=next;meta.updatedAt=new Date().toISOString();this.put(meta);return this.project(id)}
  removeFile(id:string,name:string){if(name===this.meta(id).mainFile)throw Error('请先选择另一个主 TeX 文件，再删除此文件。');const file=this.file(id,name);fs.unlinkSync(file);this.touch(id);return this.project(id)}
  upload(id:string,files:string[]){const existing=this.files(id),names=new Set(existing.map(f=>f.path.toLowerCase()));let total=existing.reduce((n,f)=>n+f.size,0);for(const file of files){const name=latexPath(path.basename(file)),size=fs.statSync(file).size;if(names.has(name.toLowerCase()))throw Error(`文件已存在：${name}`);if(size>MAX_FILE||(total+=size)>MAX_PROJECT||names.size>=MAX_FILES)throw Error('上传文件超过项目限制。');names.add(name.toLowerCase())}for(const file of files)atomic(this.file(id,path.basename(file),false),fs.readFileSync(file));this.touch(id);return this.project(id)}
  versions(id:string,name:string):LatexVersion[]{this.file(id,name);const dir=this.historyDir(id,name);if(!fs.existsSync(dir))return[];return fs.readdirSync(dir).filter(v=>/^\d+-[a-f0-9-]+\.txt$/.test(v)).sort().reverse().map(v=>({id:v,createdAt:new Date(Number(v.split('-')[0])).toISOString(),size:fs.statSync(path.join(dir,v)).size}))}
  restore(id:string,name:string,version:string,revision:string){if(!this.versions(id,name).some(v=>v.id===version))throw Error('历史版本不存在。');return this.save(id,name,fs.readFileSync(path.join(this.historyDir(id,name),version),'utf8'),revision)}
  exportZip(id:string){const files:Record<string,Uint8Array>={};for(const f of this.files(id))files[f.path]=fs.readFileSync(this.file(id,f.path));return zipSync(files,{level:6})}
  snapshot(id:string,destination:string){for(const f of this.files(id)){const file=path.join(destination,f.path);fs.mkdirSync(path.dirname(file),{recursive:true});fs.copyFileSync(this.file(id,f.path),file)}}
  setPdf(id:string,buildId:string){if(!/^[a-f0-9-]{36}$/.test(buildId))throw Error('编译记录无效。');this.put({...this.meta(id),pdfBuild:buildId})}
}
