import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, Code2, FilePenLine } from 'lucide-react'
import './latex.css'
const LatexWorkspace=lazy(()=>import('./LatexWorkspace').then(m=>({default:m.LatexWorkspace})))
const WritingWorkspace=lazy(()=>import('./WritingWorkspace').then(m=>({default:m.WritingWorkspace})))
export function WritingStudio(props:{initialProjectId?:string|null;onResearchProject?:(id:string)=>void}){
  const [mode,setMode]=useState<'latex'|'paragraphs'>(()=>props.initialProjectId?'paragraphs':localStorage.getItem('singularity.writing.mode')==='paragraphs'?'paragraphs':'latex')
  const [visited,setVisited]=useState({latex:mode==='latex',paragraphs:mode==='paragraphs'})
  const [request,setRequest]=useState<{id:string;nonce:number}|null>(null)
  const latexFlush=useRef<()=>Promise<void>>(async()=>{})
  const registerFlush=useCallback((save:(()=>Promise<void>)|null)=>{latexFlush.current=save??(async()=>{})},[])
  const beforeLatexTransfer=useCallback(()=>latexFlush.current(),[])
  const openLatex=(id:string)=>{setRequest({id,nonce:Date.now()});select('latex')}
  const select=(value:'latex'|'paragraphs')=>{setMode(value);setVisited(v=>({...v,[value]:true}));localStorage.setItem('singularity.writing.mode',value)}
  useEffect(()=>{if(props.initialProjectId)select('paragraphs')},[props.initialProjectId])
  return <section className="writing-studio"><header className="writing-studio-modes">{mode==='latex'&&<button type="button" className="writing-studio-back" onClick={()=>select('paragraphs')}><ArrowLeft size={15}/>返回段落写作</button>}<span>论文写作</span><div role="tablist" aria-label="写作模式"><button role="tab" aria-selected={mode==='paragraphs'} onClick={()=>select('paragraphs')}><FilePenLine size={15}/>段落写作</button><button role="tab" aria-selected={mode==='latex'} onClick={()=>select('latex')}><Code2 size={15}/>LaTeX</button></div></header><Suspense fallback={<div className="connection-state">正在打开编辑器…</div>}>{visited.latex&&<div className="writing-studio-view" hidden={mode!=='latex'}><LatexWorkspace active={mode==='latex'} request={request} registerFlush={registerFlush}/></div>}{visited.paragraphs&&<div className="writing-studio-view" hidden={mode!=='paragraphs'}><WritingWorkspace {...props} onOpenLatex={openLatex} beforeLatexTransfer={beforeLatexTransfer}/></div>}</Suspense></section>
}
