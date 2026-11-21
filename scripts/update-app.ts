import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { parseArgs } from 'node:util'
import { build as buildRenderer } from 'vite'
import { buildElectron } from './build-electron'
import { adoptLegacy, applyUpdate, LOCK, planUpdate, payload, recoverUpdate, runtimeContract, STATE } from './app-update'

const root=path.resolve(import.meta.dirname,'..')
const {values}=parseArgs({options:{'install-root':{type:'string',default:process.env.SINGULARITY_INSTALL_ROOT??'E:\\Singularity'},'dry-run':{type:'boolean'},apply:{type:'boolean'},adopt:{type:'boolean'},reference:{type:'string'},receipt:{type:'string'},recover:{type:'boolean'}}})
const install=path.resolve(values['install-root']!),started=Date.now()
function windows(script:string){if(process.platform!=='win32')throw Error('安装更新仅支持 Windows。');try{execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(root,'scripts',script),'-InstallRoot',install],{windowsHide:true,stdio:['ignore','pipe','pipe']})}catch(e){throw Error((e as {stderr?:Buffer}).stderr?.toString().trim()||'无法确认应用已退出。')}}
const idle=()=>windows('update-idle.ps1')
function report(value:unknown){const directory=path.join(root,'.local-data/app-updates');fs.mkdirSync(directory,{recursive:true});const file=path.join(directory,Date.now()+'.json');fs.writeFileSync(file,JSON.stringify(value,null,2));console.log(JSON.stringify({...value as object,report:file},null,2))}
try{
  if(values.adopt){
    let receipt=values.receipt
    if(!receipt){const directory=path.join(root,'.local-data/package-verification');receipt=fs.readdirSync(directory).filter(n=>n.startsWith('install-')).sort().reverse().map(n=>path.join(directory,n,'install-result.json')).find(f=>{try{return path.resolve(JSON.parse(fs.readFileSync(f,'utf8')).InstalledPath)===install}catch{return false}})}
    if(!receipt)throw Error('未找到成功的完整安装记录，请通过 --receipt 指定；不会自动重装。')
    report({mode:'adopt',...adoptLegacy(install,path.resolve(values.reference??path.join(root,'release/win-unpacked')),root,path.resolve(receipt),idle,console.log),elapsedMs:Date.now()-started})
  }else if(values.recover){idle();report({mode:'recover',recovered:recoverUpdate(install),elapsedMs:Date.now()-started})}
  else{
    if(!values.apply&&!values['dry-run'])throw Error('请选择 --dry-run 或 --apply。')
    if(values.apply&&values['dry-run'])throw Error('预览和实际更新不能同时使用。')
    const stateFile=path.join(install,'resources/app',STATE)
    if(!fs.existsSync(stateFile))throw Error('现有安装还没有增量基线，请先运行 pnpm update:adopt；无需重新安装。')
    if(fs.existsSync(path.join(install,LOCK))){if(values['dry-run'])throw Error('检测到未完成更新，请先运行 pnpm update:recover。');idle();recoverUpdate(install)}
    const contract=runtimeContract(root),state=JSON.parse(fs.readFileSync(stateFile,'utf8'))
    if(state.contract?.fingerprint!==contract.fingerprint)throw Error('运行环境或依赖已变化，需要 pnpm package:full；没有自动启动完整打包或安装。')
    if(values.apply)idle()
    await buildElectron(root);await buildRenderer({root})
    const files=payload(root),result=values.apply?applyUpdate(install,contract,files,{checkIdle:idle}):{id:null,plan:planUpdate(install,contract,files)}
    if(values.apply)try{windows('update-shortcut.ps1')}catch(error){throw Error('程序文件已完成更新；桌面快捷方式维护失败，可单独重试 update-shortcut.ps1：'+String(error))}
    report({mode:values.apply?'applied':'preview',runtimeReused:true,install,transaction:result.id,changed:result.plan.operations.filter(o=>o.after!==null).length,removed:result.plan.operations.filter(o=>o.after===null).length,reused:result.plan.reused,transferBytes:result.plan.bytes,files:result.plan.operations,elapsedMs:Date.now()-started})
  }
}catch(e){console.error(e instanceof Error?e.message:String(e));process.exitCode=1}
