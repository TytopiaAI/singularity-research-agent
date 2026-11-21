import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { gunzipSync } from 'node:zlib'
import { unzipSync } from 'fflate'
import { LatexStore } from './latex-store'
import { latexEngines, type LatexBuild, type LatexCompiler, type LatexDiagnostic, type LatexEngine, type LatexSyncPoint } from '../shared/latex'

const RELEASE='https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic%400.17.0/tectonic-0.17.0-x86_64-pc-windows-msvc.zip'
const SHA256='f61ce51f0b0ade1015b7de7ef368541c5424e9756ecbd0d7af97d6d48030845f'
export function latexDiagnostics(log:string,mainFile:string,files:string[]):LatexDiagnostic[]{
  const result:LatexDiagnostic[]=[]
  for(const match of log.matchAll(/(?:^|\n)([^\r\n]+?):(\d+):\s*([^\r\n]+)/g)){
    const raw=match[1].replace(/^(?:error|warning):\s*/,'').replaceAll('\\','/').replace(/^\.\//,''),file=files.find(f=>[raw,raw+'.tex'].some(candidate=>candidate===f||candidate.endsWith('/'+f)||f.endsWith('/'+candidate)))
    if(file)result.push({file,line:Math.max(1,Number(match[2])),message:match[3],severity:/warning/i.test(match[1]+' '+match[3])?'warning':'error'})
  }
  if(!result.some(d=>d.severity==='error')){
    const err=log.match(/!\s*([^\r\n]+)[\s\S]{0,1200}?\nl\.(\d+)/)
    if(err){
      // TeX's native log may omit the .tex suffix and only identify the open input
      // through its parenthesis stack, e.g. "(sections/method\n! Undefined...".
      const stack:Array<string|null>=[],prefix=log.slice(0,err.index)
      for(let i=0;i<prefix.length;i++)if(prefix[i]==='('){const token=prefix.slice(i+1).match(/^([^\s()]+)/)?.[1]?.replaceAll('\\','/').replace(/^\.\//,'');stack.push(token?files.find(f=>[token,token+'.tex'].some(t=>f===t||f.endsWith('/'+t)))??null:null)}else if(prefix[i]===')')stack.pop()
      result.push({file:stack.filter((f):f is string=>!!f).at(-1)??mainFile,line:Number(err[2]),message:err[1],severity:'error'})
    }
  }
  for(const match of log.matchAll(/(?:LaTeX|Package \S+) Warning: ([^\r\n]+)/g))result.push({file:mainFile,line:1,message:match[1],severity:'warning'})
  return result.filter((d,i)=>result.findIndex(other=>other.file===d.file&&other.line===d.line&&other.message===d.message&&other.severity===d.severity)===i).slice(0,100)
}
export function parseSyncTex(text:string,sourceRoot:string,files:string[],workingDirectory=sourceRoot):LatexSyncPoint[]{
  const inputs=new Map<number,string>(),points:LatexSyncPoint[]=[];let page=0
  const unit=Number(text.match(/^Unit:(\d+)/m)?.[1]??1),mag=Number(text.match(/^Magnification:(\d+)/m)?.[1]??1000)
  const factor=unit*mag/1000/65536*72/72.27
  for(const line of text.split(/\r?\n/)){
    const input=line.match(/^Input:(\d+):(.+)$/);if(input){const raw=input[2].replaceAll('\\','/'),relative=path.relative(sourceRoot,path.resolve(workingDirectory,input[2])).split(path.sep).join('/');const file=files.find(f=>f===relative||raw==='./'+f||raw===f||raw.endsWith('/'+f));if(file)inputs.set(Number(input[1]),file);continue}
    const sheet=line.match(/^\{(\d+)/);if(sheet){page=Number(sheet[1]);continue}
    const node=line.match(/^[\[\(hvx\$rk](\d+),(\d+)(?:,-?\d+)?:([+-]?\d+),([+-]?\d+)/)
    if(node&&page&&inputs.has(Number(node[1])))points.push({file:inputs.get(Number(node[1]))!,line:Number(node[2]),page,x:Number(node[3])*factor,y:Number(node[4])*factor})
  }
  return points.slice(0,100000)
}
export class LatexCompilerService {
  private jobs=new Map<string,LatexBuild>()
  private children=new Map<string,ChildProcess>()
  private tasks=new Set<Promise<void>>()
  private installing:Promise<LatexCompiler[]>|null=null
  readonly tools:string
  private configFile:string
  constructor(readonly store:LatexStore,readonly dataRoot:string,private fetcher:typeof fetch=fetch){this.tools=path.join(dataRoot,'tools','tectonic');this.configFile=path.join(dataRoot,'config','latex-compilers.json')}
  private config():Partial<Record<LatexEngine,string>>{try{return JSON.parse(fs.readFileSync(this.configFile,'utf8'))}catch{return{}}}
  async compilers():Promise<LatexCompiler[]>{
    const configured=this.config()
    return Promise.all(latexEngines.map(async engine=>{
      const candidates=[configured[engine],engine==='tectonic'?path.join(this.tools,'tectonic.exe'):undefined,...(process.env.PATH??'').split(path.delimiter).map(dir=>path.join(dir,engine+(process.platform==='win32'?'.exe':'')))]
      const executable=candidates.find((file):file is string=>!!file&&path.isAbsolute(file)&&fs.existsSync(file)&&fs.statSync(file).isFile())
      return{engine,available:!!executable,path:executable}
    }))
  }
  async configure(engine:LatexEngine,executable:string){if(!latexEngines.includes(engine)||path.basename(executable).toLowerCase()!==engine+(process.platform==='win32'?'.exe':''))throw Error(`请选择 ${engine} 编译器。`);await new Promise<void>((resolve,reject)=>execFile(executable,['--version'],{windowsHide:true,timeout:10000},err=>err?reject(Error('无法运行选中的编译器。')):resolve()));fs.mkdirSync(path.dirname(this.configFile),{recursive:true});fs.writeFileSync(this.configFile,JSON.stringify({...this.config(),[engine]:executable}));return this.compilers()}
  install(){if(this.installing)return this.installing;this.installing=this.download().finally(()=>{this.installing=null});return this.installing}
  private async download(){
    if(process.platform!=='win32'||process.arch!=='x64')throw Error('请在编译设置中选择本机 TeX 编译器。')
    const response=await this.fetcher(RELEASE,{signal:AbortSignal.timeout(180000)})
    if(!response.ok)throw Error(`编译器下载失败（HTTP ${response.status}）。`)
    const archive=Buffer.from(await response.arrayBuffer());if(archive.length>70*1024*1024||createHash('sha256').update(archive).digest('hex')!==SHA256)throw Error('编译器下载校验失败，请重试。')
    const entries=unzipSync(archive),temp=path.join(this.dataRoot,'tools','tectonic-'+randomUUID());fs.mkdirSync(temp,{recursive:true})
    try{for(const [name,data]of Object.entries(entries)){if(name.endsWith('/'))continue;const base=path.basename(name);if(!/^[a-zA-Z0-9_.-]+$/.test(base))continue;fs.writeFileSync(path.join(temp,base),data)}if(!fs.existsSync(path.join(temp,'tectonic.exe')))throw Error('下载包中缺少编译器。');fs.mkdirSync(this.tools,{recursive:true});for(const name of fs.readdirSync(temp))fs.copyFileSync(path.join(temp,name),path.join(this.tools,name))}finally{fs.rmSync(temp,{recursive:true,force:true})}
    return this.configure('tectonic',path.join(this.tools,'tectonic.exe'))
  }
  private buildDir(id:string,buildId:string){this.store.meta(id);if(!/^[a-f0-9-]{36}$/.test(buildId))throw Error('编译记录无效。');return path.join(this.store.directory(id),'builds',buildId)}
  current(id:string):LatexBuild|null{this.store.meta(id);const job=this.jobs.get(id);if(job)return job;try{const value:LatexBuild=JSON.parse(fs.readFileSync(path.join(this.store.directory(id),'last-build.json'),'utf8'));if(value.status==='running'){value.status='failed';value.log+='\n上次编译已中断，请重新编译。';this.persist(value)}return value}catch{return null}}
  private persist(job:LatexBuild){fs.writeFileSync(path.join(this.store.directory(job.projectId),'last-build.json'),JSON.stringify(job))}
  async compile(id:string){
    const prior=this.jobs.get(id);if(prior?.status==='running')return prior
    const project=this.store.project(id),engine=(await this.compilers()).find(e=>e.engine===project.engine)
    if(!engine?.path)throw Error('尚未配置此编译器。请打开编译设置，准备便携 Tectonic 或选择已有 TeX 引擎。')
    const active=this.jobs.get(id);if(active?.status==='running')return active
    const job:LatexBuild={id:randomUUID(),projectId:id,status:'running',log:'',diagnostics:[],startedAt:new Date().toISOString()}
    this.jobs.set(id,job);this.persist(job)
    const task=this.run(job,engine.path).catch(error=>{job.status='failed';job.log+='\n'+String(error);this.persist(job)}).finally(()=>{this.tasks.delete(task)})
    this.tasks.add(task);return{...job}
  }
  private async run(job:LatexBuild,executable:string){
    const began=Date.now(),id=job.projectId,project=this.store.project(id),dir=this.buildDir(id,job.id),source=path.join(dir,'source'),out=path.join(dir,'output')
    fs.mkdirSync(out,{recursive:true});this.store.snapshot(id,source)
    const append=(data:Buffer|string)=>{job.log=(job.log+data.toString()).slice(-500000)}
    let timedOut=false
    const env:NodeJS.ProcessEnv={...process.env,TECTONIC_UNTRUSTED_MODE:'1',TECTONIC_CACHE_DIR:path.join(this.dataRoot,'cache','tectonic'),openin_any:'p',openout_any:'p',shell_escape:'f',TEXMFOUTPUT:out}
    const workingDirectory=path.dirname(path.join(source,project.mainFile)),input='./'+path.basename(project.mainFile)
    // Tectonic 首次编译要按需下载宏包、还要现场生成格式（慢网下几分钟到十几分钟都正常），
    // 固定总时限会把正常下载判成超时。改成「连续 5 分钟没有任何输出」才算卡死，
    // 另设 45 分钟硬上限兜底。
    const IDLE_LIMIT=5*60000,HARD_LIMIT=45*60000
    const execute=(file:string,args:string[],cwd=workingDirectory)=>new Promise<number>(resolve=>{
      if(job.status==='cancelled')return resolve(-1)
      const child=spawn(file,args,{cwd,env,windowsHide:true,shell:false,stdio:['ignore','pipe','pipe']});this.children.set(id,child)
      let idle:NodeJS.Timeout|undefined,hard:NodeJS.Timeout|undefined
      const abort=(reason:string)=>{if(timedOut)return;timedOut=true;append(reason);this.stopChild(id)}
      const arm=()=>{if(hard===undefined)hard=setTimeout(()=>abort('\n编译超时：超过 45 分钟仍未完成，已停止。已下载的宏包会保留，重新编译会接着用。'),HARD_LIMIT);clearTimeout(idle);idle=setTimeout(()=>abort('\n编译停滞：超过 5 分钟没有任何输出，已停止。已下载的宏包会保留，重新编译会接着用。'),IDLE_LIMIT)}
      child.stdout.on('data',data=>{append(data);arm()});child.stderr.on('data',data=>{append(data);arm()})
      arm()
      child.on('error',e=>append('\n'+e.message));child.once('close',code=>{clearTimeout(idle);clearTimeout(hard);this.children.delete(id);resolve(code??-1)})
    })
    let code:number
    if(project.engine==='tectonic')code=await execute(executable,['-X','compile','--untrusted','--keep-logs','--keep-intermediates','--synctex','--outdir',out,input])
    else{
      const args=['-no-shell-escape','-interaction=nonstopmode','-halt-on-error','-file-line-error','-synctex=1','-output-directory='+out,input]
      code=await execute(executable,args)
      const stem=path.basename(project.mainFile,'.tex'),aux=path.join(out,stem+'.aux'),bcf=path.join(out,stem+'.bcf')
      if(code===0&&fs.existsSync(bcf)){const biber=path.join(path.dirname(executable),'biber'+(process.platform==='win32'?'.exe':''));code=await execute(biber,['--input-directory',out,'--output-directory',out,stem])}
      else if(code===0&&fs.existsSync(aux)&&/\\bibdata/.test(fs.readFileSync(aux,'utf8'))){const bibtex=path.join(path.dirname(executable),'bibtex'+(process.platform==='win32'?'.exe':''));env.BIBINPUTS=workingDirectory+path.delimiter;env.BSTINPUTS=workingDirectory+path.delimiter;code=await execute(bibtex,[stem],out)}
      if(code===0)code=await execute(executable,args)
      if(code===0)code=await execute(executable,args)
    }
    const stem=path.basename(project.mainFile,path.extname(project.mainFile)),log=path.join(out,stem+'.log'),pdf=path.join(out,stem+'.pdf')
    if(fs.existsSync(log))append('\n'+fs.readFileSync(log,'utf8'))
    job.diagnostics=latexDiagnostics(job.log,project.mainFile,project.files.map(f=>f.path));job.duration=Date.now()-began
    if(job.status!=='cancelled')job.status=code===0&&!timedOut&&fs.existsSync(pdf)?'success':'failed'
    if(job.status==='success'){fs.copyFileSync(pdf,path.join(dir,'preview.pdf'));job.pdfUrl=`singularity-latex://pdf/${id}/${job.id}`;this.store.setPdf(id,job.id)}
    this.persist(job)
    // Keep the successful preview plus the newest 8 snapshots. Other jobs are local generated files.
    const builds=path.dirname(dir),keep=new Set([job.id,this.store.meta(id).pdfBuild]);const old=fs.readdirSync(builds).filter(v=>/^[a-f0-9-]{36}$/.test(v)).sort((a,b)=>fs.statSync(path.join(builds,b)).mtimeMs-fs.statSync(path.join(builds,a)).mtimeMs).slice(8)
    for(const item of old)if(!keep.has(item))fs.rmSync(path.join(builds,item),{recursive:true,force:true})
  }
  private stopChild(id:string){const child=this.children.get(id);if(!child)return;if(process.platform==='win32'&&child.pid){const killer=spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});killer.on('error',()=>child.kill())}else child.kill()}
  cancel(id:string){this.store.meta(id);const job=this.jobs.get(id);if(job?.status==='running'){job.status='cancelled';job.log+='\n用户取消编译。';this.stopChild(id);this.persist(job)}}
  pdf(id:string,buildId?:string){const build=buildId??this.store.meta(id).pdfBuild;if(!build)throw Error('请先成功编译。');const file=path.join(this.buildDir(id,build),'preview.pdf');if(!fs.existsSync(file))throw Error('PDF 尚未生成。');return file}
  sync(id:string,buildId:string){const dir=this.buildDir(id,buildId),project=this.store.project(id),out=path.join(dir,'output');const sync=fs.readdirSync(out).find(f=>f.endsWith('.synctex.gz')||f.endsWith('.synctex'));if(!sync)return[];const bytes=fs.readFileSync(path.join(out,sync));return parseSyncTex(sync.endsWith('.gz')?gunzipSync(bytes).toString('utf8'):bytes.toString('utf8'),path.join(dir,'source'),project.files.map(f=>f.path),path.dirname(path.join(dir,'source',project.mainFile)))}
  async close(){for(const id of this.jobs.keys())this.cancel(id);await Promise.allSettled([...this.tasks])}
}
