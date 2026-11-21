import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, NotebookPen, Save } from 'lucide-react'
import type { PaperArtifact, PaperNote, PaperNoteVersion, PaperRecord, ReviewSectionKey } from '../shared/types'
import { reviewLabels } from './review-evidence'

const allKeys: ReviewSectionKey[] = ['problem','innovation','method','dataset','setup','results','explanation','context','future','concepts','action']
type QuoteInsertion = { id: number; page: number; text: string } | null

export function PaperNotesPanel({ paper, summaries, insertion, onInserted }: {
  paper: PaperRecord
  summaries: PaperArtifact[]
  insertion: QuoteInsertion
  onInserted: () => void
}) {
  const [loaded,setLoaded] = useState(false)
  const [personalText,setPersonalText] = useState('')
  const [summaryId,setSummaryId] = useState<string | null>(null)
  const [included,setIncluded] = useState<ReviewSectionKey[]>(allKeys)
  const [versions,setVersions] = useState<PaperNoteVersion[]>([])
  const [selectedVersion,setSelectedVersion] = useState<string | null>(null)
  const [message,setMessage] = useState('')
  const [error,setError] = useState('')
  const lastInsertion = useRef(0)
  const savedState = useRef('')
  const latestState = useRef({ personalText:'', summaryId:null as string|null, included:allKeys })
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve())
  const signature = (text:string,id:string|null,keys:ReviewSectionKey[]) => JSON.stringify([text,id,keys])

  useEffect(() => {
    let active = true
    void Promise.all([window.singularity.papers.note(paper.id),window.singularity.papers.noteVersions(paper.id)]).then(([note,history]) => {
      if(!active)return
      const id = note.summaryArtifactId ?? (summaries[0]?.id ?? null)
      const keys = note.updatedAt ? note.includedSections : id ? allKeys : []
      setPersonalText(note.personalText);setSummaryId(id);setIncluded(keys);setVersions(history)
      savedState.current=signature(note.personalText,note.summaryArtifactId,note.includedSections)
      latestState.current={personalText:note.personalText,summaryId:id,included:keys}
      setLoaded(true)
    }).catch((e)=>setError(String(e)))
    return () => {
      active=false
      const {personalText:text,summaryId:id,included:keys}=latestState.current
      if(savedState.current && savedState.current!==signature(text,id,keys)) void saveQueue.current.then(()=>window.singularity.papers.saveNote(paper.id,text,id,keys)).catch(()=>{})
    }
  },[paper.id])

  useEffect(()=>{latestState.current={personalText,summaryId,included}},[personalText,summaryId,included])
  useEffect(()=>{if(!loaded||!insertion||lastInsertion.current===insertion.id)return;lastInsertion.current=insertion.id;setPersonalText((text)=>`${text.trimEnd()}${text.trim()?'\n\n':''}> [p.${insertion.page}] ${insertion.text}\n`);onInserted()},[loaded,insertion,onInserted])

  const persist = useCallback(async (quiet=false):Promise<PaperNote> => {
    const {personalText:text,summaryId:id,included:keys}=latestState.current
    const marker=signature(text,id,keys)
    if(marker===savedState.current)return window.singularity.papers.note(paper.id)
    const task=saveQueue.current.then(()=>window.singularity.papers.saveNote(paper.id,text,id,keys))
    saveQueue.current=task.catch(()=>undefined)
    const value=await task
    savedState.current=marker
    if(!quiet)setMessage('已保存到本地')
    setError('')
    return value
  },[paper.id])

  useEffect(()=>{if(!loaded)return;const {personalText:text,summaryId:id,included:keys}=latestState.current;if(signature(text,id,keys)===savedState.current)return;setMessage('未保存的修改');const timer=setTimeout(()=>void persist(true).then(()=>setMessage('已自动保存')).catch((e)=>setError(String(e))),900);return()=>clearTimeout(timer)},[loaded,personalText,summaryId,included,persist])

  const finalize=async()=>{try{await persist(true);const version=await window.singularity.papers.finalizeNote(paper.id);setVersions((items)=>[version,...items]);setSelectedVersion(version.id);setMessage(`最终笔记 v${version.version} 已保存`);setError('')}catch(e){setError(String(e))}}
  const selectedSummary=summaries.find((item)=>item.id===summaryId)
  const selected=versions.find((item)=>item.id===selectedVersion)??versions[0]
  if(!loaded)return <p className="muted reader-empty">正在打开本地笔记…</p>
  return <div className="paper-notes-panel">
    <div className="reader-note-card personal-note-card"><div className="reader-note-heading"><NotebookPen size={16}/><h3>我的想法</h3></div><textarea aria-label="我的论文笔记" value={personalText} onChange={(event)=>setPersonalText(event.target.value)} onBlur={()=>void persist(true).catch((e)=>setError(String(e)))} onKeyDown={(event)=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();void persist().catch((e)=>setError(String(e)))}}} placeholder="写下自己的判断、疑问、重要实验和下一步想法…" rows={11}/><div className="note-save-row"><span className="muted" role="status">{message}</span><button onClick={()=>void persist().catch((e)=>setError(String(e)))}><Save size={14}/>保存</button></div></div>
    <div className="reader-note-card"><div className="reader-note-heading"><h3>结合 AI 总结</h3></div>{summaries.length?<><select aria-label="用于笔记的总结" value={summaryId??''} onChange={(event)=>{const id=event.target.value||null;setSummaryId(id);setIncluded(id?allKeys:[])}}><option value="">仅保存我的笔记</option>{summaries.map((item)=><option value={item.id} key={item.id}>{new Date(item.createdAt).toLocaleString('zh-CN')} 的总结</option>)}</select>{selectedSummary?.review&&<div className="note-section-picker">{selectedSummary.review.sections.map((section)=><label key={section.key}><input type="checkbox" checked={included.includes(section.key)} onChange={(event)=>setIncluded((keys)=>event.target.checked?allKeys.filter((key)=>keys.includes(key)||key===section.key):keys.filter((key)=>key!==section.key))}/><span>{reviewLabels[section.key]}</span></label>)}</div>}</>:<p className="muted">先生成论文总结，再选取需要放进最终笔记的内容。</p>}</div>
    {error&&<p role="alert" className="inline-error">{error}</p>}
    <button className="primary note-finalize" onClick={()=>void finalize()}><Check size={15}/>生成并保存最终笔记</button>
    {versions.length>0&&<div className="reader-note-card note-history"><div className="reader-note-heading"><h3>笔记版本</h3><span className="muted">{versions.length}</span></div><select aria-label="笔记版本" value={selected?.id??''} onChange={(event)=>setSelectedVersion(event.target.value)}>{versions.map((item)=><option key={item.id} value={item.id}>v{item.version} · {new Date(item.createdAt).toLocaleString('zh-CN')}</option>)}</select><pre>{selected?.markdown}</pre>{selected?.filePath&&<button onClick={()=>void window.singularity.nativeFiles.show(selected.filePath!).catch((e)=>setError(String(e)))}>在资源管理器中显示 Markdown</button>}</div>}
  </div>
}
