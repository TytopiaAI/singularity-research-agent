import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'

export const STATE='singularity-update.json',LOCK='.singularity-update.lock'
const sha=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex')
const digest=(file:string)=>sha(fs.readFileSync(file))
const json=(file:string)=>JSON.parse(fs.readFileSync(file,'utf8'))
const stable=(value:unknown):string=>JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v)
export interface RuntimeContract { fingerprint:string; appVersion:string; electron:string; dependencies:Record<string,string>; lockHash:string; primaryHash:string; iconHash:string; identity:string; metadataHash:string; toolsHash:string; officeHash:string }
export interface UpdateState { schema:1; contract:RuntimeContract; files:Record<string,string>; buildId:string }
export interface UpdateOperation { file:string; before:string|null; after:string|null }
export interface UpdatePlan { contract:RuntimeContract; operations:UpdateOperation[]; files:Record<string,string>; bytes:number; reused:number }
interface Journal { schema:1; id:string; status:'prepared'|'applying'|'committed'|'rolled-back'; operations:UpdateOperation[]; oldState:string; nextState:UpdateState }

export function managedPath(file:string){
  if(typeof file!=='string'||!file||file.includes('\\')||file.startsWith('/')||/[\x00-\x1f<>:"|?*]/.test(file)||file.split('/').some(p=>!p||p==='.'||p==='..'||/[. ]$/.test(p)||/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(p)))throw Error('更新文件路径无效。')
  const allowed=/^dist\//.test(file)||/^dist-electron\/(main\.js|harness-launcher\.js|preload\.cjs|chat-appearance\.cjs)$/.test(file)||/^build\/(icon\.png|icon-ui\.png|icon\.ico)$/.test(file)||/^packages\/harness-extension\/(package\.json|index\.js|review\.js|answer-colors\.js|client\.js)$/.test(file)||/^skills\//.test(file)
  if(!allowed||file.endsWith('.map'))throw Error('更新不能修改运行环境、依赖或用户数据：'+file)
  return file
}
function inside(root:string,relative:string){const target=path.resolve(root,relative),r=path.relative(path.resolve(root),target);if(!r||r.startsWith('..')||path.isAbsolute(r))throw Error('路径超出更新目录。');let current=path.resolve(root);if(fs.existsSync(current)&&fs.lstatSync(current).isSymbolicLink())throw Error('更新目录不能是链接。');for(const part of r.split(path.sep)){current=path.join(current,part);if(fs.existsSync(current)&&fs.lstatSync(current).isSymbolicLink())throw Error('更新目录不能包含链接。')}return target}
function appRoot(install:string){if(path.resolve(install)===path.parse(path.resolve(install)).root)throw Error('不能更新磁盘根目录。');const app=inside(install,'resources/app');if(json(inside(app,'package.json')).name!=='singularity'||!fs.statSync(inside(install,'Singularity.exe')).isFile())throw Error('这不是有效的 Singularity 安装目录。');return app}
function atomic(file:string,value:string|Buffer){fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=file+'.'+randomUUID()+'.tmp';try{fs.writeFileSync(tmp,value);fs.renameSync(tmp,file)}finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp)}}
function walk(root:string):string[]{const result:string[]=[];const visit=(directory:string)=>{if(fs.lstatSync(directory).isSymbolicLink())throw Error('文件树中不能包含链接。');for(const entry of fs.readdirSync(directory,{withFileTypes:true})){const full=path.join(directory,entry.name);if(entry.isSymbolicLink())throw Error('文件树中不能包含链接。');if(entry.isDirectory())visit(full);else if(entry.isFile())result.push(path.relative(root,full).split(path.sep).join('/'))}};visit(root);return result.sort()}
export function packagedMetadata(root:string){const value=json(path.join(root,'package.json'));for(const key of ['scripts','devDependencies','build','workspaces'])delete value[key];return JSON.stringify(value,null,2)+'\n'}
export function runtimeContract(root:string):RuntimeContract{
  const pkg=json(path.join(root,'package.json')),config=fs.readFileSync(path.join(root,'electron-builder.yml'),'utf8')
  const treeHash=(folder:string)=>sha(stable(walk(path.join(root,folder)).map(f=>[f,digest(inside(path.join(root,folder),f))])))
  const inputs={appVersion:pkg.version,electron:pkg.devDependencies.electron,dependencies:{...pkg.dependencies,...pkg.optionalDependencies},lockHash:digest(path.join(root,'pnpm-lock.yaml')),primaryHash:digest(path.join(root,'runtime/primary-runtime/runtime.json')),iconHash:digest(path.join(root,'build/icon.ico')),identity:config.split(/\r?\n/).filter(l=>/^\s*(appId|productName|executableName):/.test(l)).join('\n'),metadataHash:sha(stable(JSON.parse(packagedMetadata(root)))),toolsHash:treeHash('scripts/primary-runtime'),officeHash:treeHash('runtime/office-skills')}
  return {...inputs,fingerprint:sha(stable(inputs))}
}
export function payload(root:string):Map<string,Buffer>{
  const result=new Map<string,Buffer>()
  for(const folder of ['dist','dist-electron','skills'])for(const file of walk(path.join(root,folder))){const name=folder+'/'+file;if(name.endsWith('.map'))continue;managedPath(name);result.set(name,fs.readFileSync(inside(root,name)))}
  for(const file of ['build/icon.png','build/icon-ui.png','build/icon.ico','packages/harness-extension/package.json','packages/harness-extension/index.js','packages/harness-extension/review.js','packages/harness-extension/answer-colors.js','packages/harness-extension/client.js'])result.set(file,fs.readFileSync(inside(root,managedPath(file))))
  if(!result.has('dist/index.html')||!result.has('dist-electron/main.js')||result.size>10000||[...result.values()].reduce((n,b)=>n+b.length,0)>200*1024*1024)throw Error('程序构建不完整或超过日常更新范围。')
  return result
}
export function makeState(contract:RuntimeContract,files:Map<string,Buffer>):UpdateState{return{schema:1,contract,files:Object.fromEntries([...files].map(([name,bytes])=>[name,sha(bytes)])),buildId:new Date().toISOString()}}
function validateState(value:UpdateState){if(value?.schema!==1||!value.contract||typeof value.contract.fingerprint!=='string'||!value.files||typeof value.files!=='object'||Array.isArray(value.files)||Object.keys(value.files).length>10000)throw Error('更新基线无效，需要重新核验安装。');for(const [file,hash]of Object.entries(value.files)){managedPath(file);if(!/^[a-f0-9]{64}$/.test(hash))throw Error('文件校验值无效。')}return value}
export function planUpdate(install:string,contract:RuntimeContract,files:Map<string,Buffer>):UpdatePlan{
  const root=appRoot(install),state=validateState(json(inside(root,STATE)))
  if(!files.has('dist/index.html')||!files.has('dist-electron/main.js'))throw Error('缺少程序入口，拒绝不完整更新。')
  if(state.contract.fingerprint!==contract.fingerprint)throw Error('运行环境、依赖锁定、应用版本或 EXE 图标已变化，需要生成完整安装器；未修改现有安装。')
  if(sha(stable(json(inside(root,'package.json'))))!==contract.metadataHash||digest(inside(root,'runtime/primary-runtime/runtime.json'))!==contract.primaryHash||digest(inside(root,'build/icon.ico'))!==contract.iconHash)throw Error('已安装的运行环境标识已被修改，需要重新核验。')
  const operations:UpdateOperation[]=[],next:Record<string,string>={},names=new Set([...Object.keys(state.files),...files.keys()]);let bytes=0,reused=0
  for(const name of names){managedPath(name);const file=inside(root,name),before=fs.existsSync(file)?digest(file):null,after=files.has(name)?sha(files.get(name)!):null,expected=state.files[name]??null
    if(before!==expected&&before!==after)throw Error('程序文件已被其他工具修改，请先合并：'+name)
    if(after)next[name]=after
    if(before===after){reused++;continue}
    operations.push({file:name,before,after});if(after)bytes+=files.get(name)!.length
  }
  // Entrypoints switch only after new referenced assets exist. Old assets are removed last.
  operations.sort((a,b)=>{const rank=(o:UpdateOperation)=>o.after===null?3:o.file==='dist-electron/main.js'?2:o.file==='dist/index.html'?1:0;return rank(a)-rank(b)||a.file.localeCompare(b.file)})
  return{contract,operations,files:next,bytes,reused}
}
function transactionRoot(install:string,id:string){if(!/^\d+-[a-f0-9-]{36}$/.test(id))throw Error('更新记录标识无效。');return inside(install,'.singularity-updates/'+id)}
function ownLock(install:string){const file=inside(install,LOCK);return fs.existsSync(file)?json(file):null}
function alive(pid:number){try{process.kill(pid,0);return true}catch(e){return (e as NodeJS.ErrnoException).code==='EPERM'}}
function readJournal(install:string,id:string){const dir=transactionRoot(install,id),j=json(inside(dir,'journal.json')) as Journal;if(j.schema!==1||j.id!==id||!['prepared','applying','committed','rolled-back'].includes(j.status)||!Array.isArray(j.operations))throw Error('更新恢复记录无效。');validateState(j.nextState);validateState(JSON.parse(j.oldState));for(const o of j.operations){managedPath(o.file);for(const hash of [o.before,o.after])if(hash!==null&&!/^[a-f0-9]{64}$/.test(hash))throw Error('更新恢复校验值无效。')}return{dir,j}}
function rollback(install:string,id:string){const root=appRoot(install),{dir,j}=readJournal(install,id);if(j.status==='committed'||j.status==='rolled-back')return
  for(const o of [...j.operations].reverse()){const target=inside(root,o.file),actual=fs.existsSync(target)?digest(target):null;if(actual!==o.before&&actual!==o.after)throw Error('恢复时发现外部修改，已保留备份：'+o.file);if(actual===o.before)continue;if(o.before===null){if(actual!==null)fs.unlinkSync(target)}else{const backup=inside(dir,'backup/'+o.file);if(digest(backup)!==o.before)throw Error('更新备份校验失败。');atomic(target,fs.readFileSync(backup))}}
  atomic(inside(root,STATE),j.oldState);j.status='rolled-back';atomic(inside(dir,'journal.json'),JSON.stringify(j,null,2))
}
export function recoverUpdate(install:string){appRoot(install);const lock=ownLock(install);if(!lock)return false;if(!Number.isInteger(lock.pid)||lock.pid<=0)throw Error('更新锁无效，请检查更新记录。');if(alive(lock.pid))throw Error('另一个更新进程仍在运行。');const {j}=readJournal(install,lock.id);if(j.status!=='committed'&&j.status!=='rolled-back')rollback(install,lock.id);fs.unlinkSync(inside(install,LOCK));return true}
export function applyUpdate(install:string,contract:RuntimeContract,files:Map<string,Buffer>,options:{checkIdle:()=>void;onStep?:(file:string)=>void}):{id:string|null;plan:UpdatePlan}{
  options.checkIdle();if(ownLock(install))recoverUpdate(install)
  const plan=planUpdate(install,contract,files);if(!plan.operations.length)return{id:null,plan}
  const root=appRoot(install),id=Date.now()+'-'+randomUUID(),dir=transactionRoot(install,id),lock=inside(install,LOCK)
  fs.mkdirSync(dir,{recursive:true});const handle=fs.openSync(lock,'wx');fs.writeFileSync(handle,JSON.stringify({pid:process.pid,id}));fs.closeSync(handle)
  let ready=false
  try{
    options.checkIdle()
    for(const o of plan.operations){if(o.before){const backup=inside(dir,'backup/'+o.file);fs.mkdirSync(path.dirname(backup),{recursive:true});fs.copyFileSync(inside(root,o.file),backup);if(digest(backup)!==o.before)throw Error('备份期间程序文件发生变化。')}if(o.after){const data=files.get(o.file)!;if(sha(data)!==o.after)throw Error('构建内容在更新期间发生变化。');atomic(inside(dir,'stage/'+o.file),data)}}
    const j:Journal={schema:1,id,status:'prepared',operations:plan.operations,oldState:fs.readFileSync(inside(root,STATE),'utf8'),nextState:{schema:1,contract,files:plan.files,buildId:new Date().toISOString()}}
    atomic(inside(dir,'journal.json'),JSON.stringify(j,null,2));ready=true;j.status='applying';atomic(inside(dir,'journal.json'),JSON.stringify(j,null,2))
    for(const o of plan.operations){const target=inside(root,o.file),before=fs.existsSync(target)?digest(target):null;if(before!==o.before)throw Error('写入前程序文件发生变化：'+o.file);if(o.after)atomic(target,fs.readFileSync(inside(dir,'stage/'+o.file)));else if(before!==null)fs.unlinkSync(target);options.onStep?.(o.file)}
    for(const [file,hash]of Object.entries(plan.files))if(digest(inside(root,file))!==hash)throw Error('更新后文件校验失败：'+file)
    atomic(inside(root,STATE),JSON.stringify(j.nextState,null,2));j.status='committed';atomic(inside(dir,'journal.json'),JSON.stringify(j,null,2));fs.unlinkSync(lock);return{id,plan}
  }catch(e){try{if(ready)rollback(install,id);fs.unlinkSync(lock)}catch(recovery){throw Error(String(e)+'；自动恢复未完成，已保留更新锁和备份：'+String(recovery))}throw e}
}

/** One-time bridge for the already verified legacy full installation. Never copies dependencies. */
export function adoptLegacy(install:string,reference:string,root:string,receiptFile:string,checkIdle:()=>void,progress:(message:string)=>void=()=>{}){
  checkIdle();const target=appRoot(install),ref=appRoot(reference),receipt=json(receiptFile),artifact=json(path.join(path.dirname(receiptFile),'artifact.json'))
  if(fs.existsSync(inside(target,STATE)))throw Error('安装已有更新基线，不需要重新建立。')
  if(receipt.InstallerExitCode!==0||path.resolve(receipt.InstalledPath)!==path.resolve(install)||receipt.ChangedProtectedFiles?.length!==0)throw Error('缺少该安装目录的成功安装记录。')
  if(digest(artifact.Path).toUpperCase()!==artifact.SHA256)throw Error('完整安装器与安装记录不一致。')
  const built=fs.statSync(artifact.Path).mtimeMs
  if(fs.statSync(path.join(root,'pnpm-lock.yaml')).mtimeMs>built)throw Error('上次完整安装后依赖锁已变化，不能直接沿用旧运行环境。')
  if(walk(path.join(root,'scripts/primary-runtime')).some(f=>fs.statSync(inside(path.join(root,'scripts/primary-runtime'),f)).mtimeMs>built))throw Error('运行环境构建脚本已变化，需要完整安装。')
  const pkg=json(path.join(root,'package.json')),installed=json(inside(target,'package.json'))
  if(stable(pkg.dependencies)!==stable(installed.dependencies)||pkg.version!==installed.version||stable(pkg.optionalDependencies)!==stable(installed.optionalDependencies))throw Error('依赖或版本与已安装程序不一致。')
  const contract=runtimeContract(root)
  if(sha(stable(installed))!==contract.metadataHash)throw Error('应用元数据与完整安装不一致。')
  if(digest(inside(target,'runtime/primary-runtime/runtime.json'))!==contract.primaryHash||digest(inside(target,'build/icon.ico'))!==contract.iconHash||digest(inside(ref,'package.json'))!==digest(inside(target,'package.json'))||digest(inside(install,'Singularity.exe'))!==digest(inside(reference,'Singularity.exe')))throw Error('安装与已验证的完整包不一致。')
  let audited=0
  for(const folder of ['runtime','node_modules']){progress('首次只读核验：正在枚举 '+folder);const a=inside(target,folder),b=inside(ref,folder),names=walk(b),actual=walk(a);if(stable(names)!==stable(actual))throw Error('运行环境文件列表不同：'+folder);progress(folder+' 共 '+names.length+' 个文件，开始校验');let checked=0;for(const file of names){if(digest(inside(a,file))!==digest(inside(b,file)))throw Error('运行环境文件不同：'+folder+'/'+file);audited++;checked++;if(checked%2000===0||checked===names.length)progress(folder+' 已核验 '+checked+'/'+names.length)}}
  const office=path.join(root,'runtime/office-skills');for(const f of walk(office))if(digest(inside(office,f))!==digest(inside(target,'runtime/office-skills/'+f)))throw Error('Office 运行资源与当前源码不一致。')
  const sourceFiles=payload(ref),state:UpdateState=makeState(contract,sourceFiles)
  for(const [file,hash]of Object.entries(state.files))if(digest(inside(target,file))!==hash)throw Error('程序文件与参考安装不同：'+file)
  checkIdle();atomic(inside(target,STATE),JSON.stringify(state,null,2));return{audited,managed:Object.keys(state.files).length}
}
