import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { basicSetup } from 'codemirror'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { indentWithTab, undo, redo, toggleComment } from '@codemirror/commands'
import { HighlightStyle, StreamLanguage, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { stex } from '@codemirror/legacy-modes/mode/stex'
import { autocompletion, snippetCompletion, type CompletionContext } from '@codemirror/autocomplete'
import { setDiagnostics } from '@codemirror/lint'
import { openSearchPanel } from '@codemirror/search'
import type { LatexDiagnostic } from '../shared/latex'

export interface LatexEditorHandle { line():number; go(line:number):void; insert(text:string):void; command(command:'undo'|'redo'|'search'|'comment'):void }
const snippets=[
  ['section','\\section{${Title}}'],['subsection','\\subsection{${Title}}'],['textbf','\\textbf{${text}}'],['textit','\\textit{${text}}'],
  ['equation','\\begin{equation}\n  ${formula}\n  \\label{eq:${name}}\n\\end{equation}'],
  ['figure','\\begin{figure}[htbp]\n  \\centering\n  \\includegraphics[width=0.8\\linewidth]{${image}}\n  \\caption{${Caption}}\n  \\label{fig:${name}}\n\\end{figure}'],
  ['table','\\begin{table}[htbp]\n  \\centering\n  \\begin{tabular}{ll}\n    \\hline\n    ${Column 1} & ${Column 2} \\\\\n    \\hline\n  \\end{tabular}\n  \\caption{${Caption}}\n\\end{table}'],
  ['itemize','\\begin{itemize}\n  \\item ${Item}\n\\end{itemize}'],['enumerate','\\begin{enumerate}\n  \\item ${Item}\n\\end{enumerate}'],
  ['frac','\\frac{${numerator}}{${denominator}}'],['cite','\\cite{${key}}'],['ref','\\ref{${label}}'],['input','\\input{${file}}'],['includegraphics','\\includegraphics[width=\\linewidth]{${file}}'],
]
const texHighlight=syntaxHighlighting(HighlightStyle.define([
  {tag:tags.keyword,color:'var(--latex-command)'},
  {tag:[tags.atom,tags.number],color:'var(--latex-atom)'},
  {tag:tags.string,color:'var(--latex-string)'},
  {tag:tags.comment,color:'var(--muted)'},
  {tag:tags.meta,color:'var(--latex-atom)'},
]))
export const LatexEditor=forwardRef<LatexEditorHandle,{value:string;onChange:(value:string)=>void;onSave:()=>void;diagnostics:LatexDiagnostic[];file:string;references:string}>(function LatexEditor({value,onChange,onSave,diagnostics,file,references},ref){
  const host=useRef<HTMLDivElement>(null),editor=useRef<EditorView|null>(null),callbacks=useRef({onChange,onSave,references})
  callbacks.current={onChange,onSave,references}
  useEffect(()=>{
    const complete=(context:CompletionContext)=>{
      const citation=context.matchBefore(/\\(?:cite\w*|ref|eqref)\{[^}]*$/)
      if(citation){const isCite=/^\\cite/.test(citation.text),prefix=Math.max(citation.text.lastIndexOf('{'),citation.text.lastIndexOf(','))+1;const matches=[...callbacks.current.references.matchAll(isCite?/@\w+\s*\{\s*([^,\s]+)/g:/\\label\{([^}]+)\}/g)];return{from:citation.from+prefix,options:[...new Set(matches.map(m=>m[1]))].map(label=>({label,type:isCite?'constant':'variable'}))}}
      const word=context.matchBefore(/\\[a-zA-Z]*/);if(!word)return null
      return{from:word.from,options:snippets.map(([label,template])=>snippetCompletion(template,{label:'\\'+label,type:'keyword'}))}
    }
    const view=new EditorView({parent:host.current!,state:EditorState.create({doc:value,extensions:[basicSetup,StreamLanguage.define(stex),texHighlight,EditorView.lineWrapping,keymap.of([indentWithTab,{key:'Mod-s',run:()=>{callbacks.current.onSave();return true}}]),autocompletion({override:[complete]}),EditorView.contentAttributes.of({'aria-label':'LaTeX 源码编辑器',spellcheck:'false'}),EditorView.updateListener.of(update=>{if(update.docChanged)callbacks.current.onChange(update.state.doc.toString())}),EditorView.theme({'&':{height:'100%',fontSize:'13px',backgroundColor:'transparent',color:'var(--text)'},'.cm-scroller':{fontFamily:'Cascadia Code, Consolas, monospace',lineHeight:'1.8',overflow:'auto'},'.cm-content':{padding:'18px 0'},'.cm-gutters':{backgroundColor:'transparent',color:'var(--muted)',border:'none',minWidth:'45px'},'.cm-activeLine,.cm-activeLineGutter':{backgroundColor:'rgba(130,145,160,.07)'},'.cm-cursor':{borderLeftColor:'var(--text)'},'.cm-selectionBackground':{backgroundColor:'rgba(241,145,107,.23)!important'},'.cm-panels,.cm-tooltip':{backgroundColor:'var(--glass-menu,var(--panel))',color:'var(--text)',borderColor:'var(--line)'},'&.cm-focused':{outline:'none'}})]})})
    editor.current=view
    return()=>{view.destroy();editor.current=null}
  },[])
  useEffect(()=>{const view=editor.current;if(view&&value!==view.state.doc.toString())view.dispatch({changes:{from:0,to:view.state.doc.length,insert:value}})},[value])
  useEffect(()=>{const view=editor.current;if(!view)return;view.dispatch(setDiagnostics(view.state,diagnostics.filter(d=>d.file===file).map(d=>{const line=view.state.doc.line(Math.min(Math.max(1,d.line),view.state.doc.lines));return{from:line.from,to:line.to,severity:d.severity,message:d.message}})))},[diagnostics,file])
  useImperativeHandle(ref,()=>({line:()=>{const view=editor.current;return view?view.state.doc.lineAt(view.state.selection.main.head).number:1},go:number=>{const view=editor.current;if(view){const line=view.state.doc.line(Math.min(Math.max(1,number),view.state.doc.lines));view.dispatch({selection:{anchor:line.from},effects:EditorView.scrollIntoView(line.from,{y:'center'})});view.focus()}},insert:text=>{const view=editor.current;if(view){const selection=view.state.selection.main;view.dispatch({changes:{from:selection.from,to:selection.to,insert:text},selection:{anchor:selection.from+text.length}});view.focus()}},command:command=>{const view=editor.current;if(view){({undo,redo,search:openSearchPanel,comment:toggleComment})[command](view);view.focus()}}}),[])
  return <div ref={host} className="latex-code-editor"/>
})
