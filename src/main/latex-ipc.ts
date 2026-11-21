import fs from 'node:fs'
import { dialog, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { LatexStore } from './latex-store'
import { LatexCompilerService } from './latex-compiler'
import type { LatexEngine } from '../shared/latex'

type Handle=(name:string,listener:(event:IpcMainInvokeEvent,...args:any[])=>unknown)=>void
export function registerLatexIpc(handle:Handle,store:LatexStore,compiler:LatexCompilerService,window:()=>BrowserWindow|null){
  const owner=()=>{const value=window();if(!value)throw Error('窗口尚未就绪。');return value}
  handle('latex:list',()=>store.list())
  handle('latex:project',(_e,id)=>store.project(id))
  handle('latex:create',(_e,title)=>store.create(title))
  handle('latex:import',async()=>{const result=await dialog.showOpenDialog(owner(),{title:'导入 LaTeX 项目',filters:[{name:'LaTeX ZIP 项目',extensions:['zip']}],properties:['openFile']});return result.canceled?null:store.importZip(result.filePaths[0])})
  handle('latex:read',(_e,id,file)=>store.read(id,file))
  handle('latex:save',(_e,id,file,text,revision)=>store.save(id,file,text,revision))
  handle('latex:configure',(_e,id,file,engine)=>store.configure(id,file,engine))
  handle('latex:create-file',(_e,id,file)=>store.createFile(id,file))
  handle('latex:rename-file',(_e,id,file,next)=>store.renameFile(id,file,next))
  handle('latex:remove-file',async(_e,id,file)=>{const result=await dialog.showMessageBox(owner(),{type:'question',message:`删除 ${file}？`,detail:'此操作只删除当前项目中的文件。',buttons:['取消','删除'],cancelId:0,defaultId:0});return result.response===1?store.removeFile(id,file):store.project(id)})
  handle('latex:upload',async(_e,id)=>{store.meta(id);const result=await dialog.showOpenDialog(owner(),{title:'添加图片、参考文献或源码',properties:['openFile','multiSelections']});return result.canceled?store.project(id):store.upload(id,result.filePaths)})
  handle('latex:compile',(_e,id)=>compiler.compile(id))
  handle('latex:build',(_e,id)=>compiler.current(id))
  handle('latex:cancel',(_e,id)=>compiler.cancel(id))
  handle('latex:versions',(_e,id,file)=>store.versions(id,file))
  handle('latex:restore',(_e,id,file,version,revision)=>store.restore(id,file,version,revision))
  handle('latex:export-zip',async(_e,id)=>{const project=store.project(id),result=await dialog.showSaveDialog(owner(),{title:'导出 LaTeX 项目',defaultPath:project.title.replace(/[<>:"/\\|?*]/g,'_')+'.zip',filters:[{name:'LaTeX ZIP 项目',extensions:['zip']}]});if(result.canceled||!result.filePath)return false;fs.writeFileSync(result.filePath,store.exportZip(id));return true})
  handle('latex:export-pdf',async(_e,id)=>{const file=compiler.pdf(id),result=await dialog.showSaveDialog(owner(),{title:'导出编译 PDF',defaultPath:'paper.pdf',filters:[{name:'PDF',extensions:['pdf']}]});if(result.canceled||!result.filePath)return false;fs.copyFileSync(file,result.filePath);return true})
  handle('latex:compilers',()=>compiler.compilers())
  handle('latex:select-compiler',async(_e,engine:LatexEngine)=>{const result=await dialog.showOpenDialog(owner(),{title:`选择 ${engine} 编译器`,filters:[{name:'TeX 编译器',extensions:process.platform==='win32'?['exe']:['*']}],properties:['openFile']});return result.canceled?compiler.compilers():compiler.configure(engine,result.filePaths[0])})
  handle('latex:install-compiler',()=>compiler.install())
  handle('latex:sync',(_e,id,build)=>compiler.sync(id,build))
}
