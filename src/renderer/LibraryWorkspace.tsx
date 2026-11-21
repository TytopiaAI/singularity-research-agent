import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, Upload, Trash2, Search, X, Pencil, RotateCcw, ExternalLink, Star } from 'lucide-react'
import type { PaperRecord, PaperPatch } from '../shared/types'
import { renderCoverPage, suggestPipelineCover } from './paper-cover'
import { ContinuousReadingWorkspace } from './ContinuousReadingWorkspace'

GlobalWorkerOptions.workerSrc = workerUrl

const pdfUrl=(id:string)=>`singularity-paper://paper/${id}`
const thumbnailUrl=(id:string)=>`singularity-paper://pipeline-thumbnail/${id}`
let thumbnailQueue: Promise<unknown> = Promise.resolve()
function enqueueThumbnail(work:()=>Promise<void>): void { thumbnailQueue=thumbnailQueue.then(work,work).catch(()=>undefined) }

function Thumbnail({paper,onChoose,version}:{paper:PaperRecord;onChoose:()=>void;version:number}) {
  const [url,setUrl]=useState(`${thumbnailUrl(paper.id)}?v=${version}`); const [generate,setGenerate]=useState(false)
  const holder=useRef<HTMLDivElement>(null)
  useEffect(()=>{setUrl(`${thumbnailUrl(paper.id)}?v=${version}`);setGenerate(false)},[paper.id,version])
  useEffect(()=>{
    if(!generate||paper.missing||paper.deletedAt)return
    let cancelled=false
    const observer=new IntersectionObserver((entries)=>{if(!entries.some((e)=>e.isIntersecting))return;observer.disconnect();enqueueThumbnail(async()=>{
      if(cancelled)return
      try { const image=await suggestPipelineCover(paper.id);if(cancelled||!image)return;await window.singularity.papers.cacheThumbnail(paper.id,image);if(!cancelled)setUrl(image) } catch { /* No verified figure: keep the selection prompt. */ }
    })})
    if(holder.current)observer.observe(holder.current)
    return()=>{cancelled=true;observer.disconnect()}
  },[generate,paper.id,paper.missing,paper.deletedAt])
  return <div ref={holder} className="paper-thumbnail">{!paper.missing&&!paper.deletedAt&&url&&<img src={url} alt="论文方法或流程图" onError={()=>{setGenerate(true);setUrl('')}}/>}{!url&&<span className="paper-cover-empty">尚未选取图示</span>}<button className="paper-cover-pick" type="button" onDoubleClick={(event)=>event.stopPropagation()} onClick={onChoose}>选取图示</button><span className="paper-page-count">PDF · {paper.pageCount} 页</span></div>
}

function LibraryFilter({value,options,onChange}:{value:string;options:string[];onChange:(value:string)=>void}) {
  const [open,setOpen]=useState(false);const holder=useRef<HTMLDivElement>(null)
  useEffect(()=>{if(!open)return;const close=(event:PointerEvent)=>{if(!holder.current?.contains(event.target as Node))setOpen(false)};document.addEventListener('pointerdown',close);return()=>document.removeEventListener('pointerdown',close)},[open])
  return <div ref={holder} className="library-filter" onKeyDown={(event)=>{if(event.key==='Escape')setOpen(false)}}><button type="button" className="library-filter-trigger" aria-label="分类与标签" aria-haspopup="listbox" aria-expanded={open} onClick={()=>setOpen(!open)}><span>{value||'全部论文'}</span><ChevronDown size={16}/></button>{open&&<div className="library-filter-menu" role="listbox" aria-label="分类与标签">{['',...options].map((option)=><button key={option} type="button" role="option" aria-selected={value===option} onClick={()=>{onChange(option);setOpen(false)}}>{option||'全部论文'}</button>)}</div>}</div>
}

function CoverPicker({paper,onClose,onSaved}:{paper:PaperRecord;onClose:()=>void;onSaved:()=>void}) {
  const [pdf,setPdf]=useState<PDFDocumentProxy|null>(null);const [page,setPage]=useState(1);const [rect,setRect]=useState<{x:number;y:number;width:number;height:number}|null>(null);const [error,setError]=useState('')
  const canvas=useRef<HTMLCanvasElement>(null);const dragging=useRef<{x:number;y:number}|null>(null)
  useEffect(()=>{let active=true;const load=getDocument({url:pdfUrl(paper.id),isEvalSupported:false});void load.promise.then((doc)=>{if(active)setPdf(doc)}).catch((e)=>{if(active)setError(String(e))});return()=>{active=false;void load.destroy()}},[paper.id])
  useEffect(()=>{if(!pdf||!canvas.current)return;let active=true;setRect(null);void renderCoverPage(pdf,page,canvas.current).catch((e)=>{if(active)setError(String(e))});return()=>{active=false}},[pdf,page])
  const point=(event:ReactPointerEvent<HTMLDivElement>)=>{const bounds=canvas.current!.getBoundingClientRect();return {x:Math.max(0,Math.min(1,(event.clientX-bounds.left)/bounds.width)),y:Math.max(0,Math.min(1,(event.clientY-bounds.top)/bounds.height))}}
  const save=async()=>{if(!canvas.current||!rect||rect.width<.05||rect.height<.05)return;const image=document.createElement('canvas');image.width=Math.max(1,Math.round(canvas.current.width*rect.width));image.height=Math.max(1,Math.round(canvas.current.height*rect.height));image.getContext('2d')?.drawImage(canvas.current,rect.x*canvas.current.width,rect.y*canvas.current.height,image.width,image.height,0,0,image.width,image.height);try{await window.singularity.papers.cacheThumbnail(paper.id,image.toDataURL('image/png'));onSaved()}catch(e){setError(String(e))}}
  return <div className="editor-scrim" role="dialog" aria-modal="true" aria-label="选取论文图示"><div className="cover-picker"><header><h2>选取论文图示</h2><button aria-label="关闭" onClick={onClose}><X size={18}/></button></header><p className="muted">切换页面，拖出要作为卡片封面的流程图区域。</p><div className="cover-picker-controls"><button disabled={page<=1} onClick={()=>setPage(page-1)}><ChevronLeft size={16}/></button><span>{page} / {pdf?.numPages??paper.pageCount}</span><button disabled={page>=(pdf?.numPages??paper.pageCount)} onClick={()=>setPage(page+1)}><ChevronRight size={16}/></button></div><div className="cover-picker-scroll"><div className="cover-picker-page" onPointerDown={(event)=>{if(!canvas.current)return;event.currentTarget.setPointerCapture(event.pointerId);dragging.current=point(event);setRect({...dragging.current,width:0,height:0})}} onPointerMove={(event)=>{if(!dragging.current)return;const end=point(event);setRect({x:Math.min(end.x,dragging.current.x),y:Math.min(end.y,dragging.current.y),width:Math.abs(end.x-dragging.current.x),height:Math.abs(end.y-dragging.current.y)})}} onPointerUp={(event)=>{dragging.current=null;event.currentTarget.releasePointerCapture(event.pointerId)}}><canvas ref={canvas}/>{rect&&<span className="cover-picker-selection" style={{left:`${rect.x*100}%`,top:`${rect.y*100}%`,width:`${rect.width*100}%`,height:`${rect.height*100}%`}}/>}</div></div>{error&&<p role="alert" className="inline-error">{error}</p>}<footer><button onClick={onClose}>取消</button><button className="primary" disabled={!rect||rect.width<.05||rect.height<.05} onClick={()=>void save()}>保存封面</button></footer></div></div>
}

export function LibraryWorkspace({ request, onCurrentPaper }: { request?: { paperId: string; sourceId?: string; nonce: number } | null; onCurrentPaper?: (paperId: string) => void }) {
  const [papers,setPapers]=useState<PaperRecord[]>([]);const [query,setQuery]=useState('');const [selected,setSelected]=useState<{paper:PaperRecord;note:boolean}|null>(null)
  const [trash,setTrash]=useState(false);const [filter,setFilter]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState('')
  const [editing,setEditing]=useState<PaperRecord|null>(null);const [coverPaper,setCoverPaper]=useState<PaperRecord|null>(null);const [coverVersion,setCoverVersion]=useState(0);const [hits,setHits]=useState<string[]>([])
  const reload=useCallback(async()=>setPapers(await (trash?window.singularity.papers.trash():window.singularity.papers.list())),[trash])
  useEffect(()=>{let live=true;if(request)void window.singularity.papers.list().then((items)=>{const paper=items.find((item)=>item.id===request.paperId);if(!live)return;if(!paper)throw new Error('来源论文已移入回收站或不可用。');setSelected({paper,note:false});onCurrentPaper?.(paper.id)}).catch((e)=>{if(live)setError(String(e))});return()=>{live=false}},[request,onCurrentPaper])
  useEffect(()=>{void reload().catch((e)=>setError(String(e)))},[reload])
  useEffect(()=>{let active=true;const timer=setTimeout(()=>{if(!query.trim()){setHits([]);return}void window.singularity.papers.search(query).then((v)=>{if(active)setHits(v.map((h)=>h.paperId))}).catch(()=>{})},200);return()=>{active=false;clearTimeout(timer)}},[query])
  const perform=async(fn:()=>Promise<unknown>)=>{setError('');try{await fn();await reload()}catch(e){setError(String(e))}}
  const importFiles=async(paths:string[])=>{if(!paths.length)return;setBusy(true);setError('');try{const result=await window.singularity.papers.importBatch(paths);setError(result.errors.join('\n'));await reload()}catch(e){setError(String(e))}finally{setBusy(false)}}
  const visible=papers.filter((p)=>(!filter||p.collection===filter||p.tags?.includes(filter))&&(!query||[p.title,p.authors.join(' '),p.venue,p.affiliations,p.codeUrl,p.collection,...p.keywords??[],...p.tags??[]].join(' ').toLowerCase().includes(query.toLowerCase())||hits.includes(p.id)))
  const months=[...new Set(visible.map((p)=>p.createdAt.slice(0,7)))].sort().reverse()
  if(selected)return <ContinuousReadingWorkspace key={selected.paper.id} paper={selected.paper} initialSourceId={request?.paperId===selected.paper.id?request.sourceId:undefined} initialNoteOpen={selected.note} onClose={()=>{setSelected(null);void reload()}}/>
  return <section className="page library-page" onDragOver={(e)=>e.preventDefault()} onDrop={(e)=>{e.preventDefault();if(!busy)void importFiles(window.singularity.papers.droppedPaths(Array.from(e.dataTransfer.files)))}}>
    <div className="page-header"><div><span className="section-label">LOCAL LIBRARY</span><h1>{trash?'回收站':'论文库'}</h1></div><div className="header-actions"><button onClick={()=>{setTrash(!trash);setFilter('')}}>{trash?<ArrowLeft size={16}/>:<Trash2 size={16}/>} {trash?'返回论文库':'回收站'}</button>{!trash&&<button className="primary" disabled={busy} onClick={()=>void window.singularity.dialogs.selectPdfs().then(importFiles)}><Upload size={16}/>{busy?'正在导入':'导入 PDF'}</button>}</div></div>
    <div className="library-filters"><div className="search-field"><Search size={16}/><input aria-label="搜索论文" placeholder="搜索论文、作者、标签或全文" value={query} onChange={(e)=>setQuery(e.target.value)}/></div><LibraryFilter value={filter} onChange={setFilter} options={[...new Set(papers.flatMap((p)=>[p.collection,...p.tags??[]]).filter((value):value is string=>!!value))]}/></div>
    {error&&<p role="alert" className="inline-error">{error}</p>}
    {!visible.length&&<div className="empty-state"><h3>{trash?'回收站是空的':'把论文放在这里'}</h3><p className="muted">{trash?'移除的论文可以在这里恢复。':'导入或拖入 PDF，独立副本保存在本机。'}</p></div>}
    {months.map((month)=><section className="paper-month" key={month}><h2>{month.replace('-',' 年 ')} 月 <small>{visible.filter((p)=>p.createdAt.startsWith(month)).length}</small></h2><div className="library-card-grid">{visible.filter((p)=>p.createdAt.startsWith(month)).map((paper)=><LibraryCard key={paper.id} paper={paper} trash={trash} coverVersion={coverVersion} onOpen={(note)=>{setSelected({paper,note});onCurrentPaper?.(paper.id)}} onEdit={()=>setEditing(paper)} onCover={()=>setCoverPaper(paper)} onError={setError} perform={perform}/>)}</div></section>)}
    {editing&&<MetadataEditor paper={editing} onClose={()=>setEditing(null)} onSave={async(patch)=>{await window.singularity.papers.update(editing.id,patch);setEditing(null);await reload()}}/>}
    {coverPaper&&<CoverPicker paper={coverPaper} onClose={()=>setCoverPaper(null)} onSaved={()=>{setCoverPaper(null);setCoverVersion((value)=>value+1)}}/>}
  </section>
}
function PaperRating({rating,disabled,onRate}:{rating:number;disabled:boolean;onRate:(value:number)=>void}) {
  const [hover,setHover]=useState<number|null>(null)
  const shown=hover??rating
  return <div className="paper-rating" role="group" aria-label={`论文评分，当前${rating?`${rating}星`:'未评分'}`} onPointerLeave={()=>setHover(null)} onDoubleClick={(event)=>event.stopPropagation()}>
    {Array.from({length:5},(_,index)=>index+1).map((value)=><button key={value} type="button" data-filled={value<=shown} aria-label={rating===value?`取消${value}星评分`:`评为${value}星`} aria-pressed={rating===value} title={rating===value?'点击取消评分':`评为 ${value} 星`} disabled={disabled} onPointerEnter={()=>setHover(value)} onClick={()=>{setHover(null);onRate(rating===value?0:value)}}><Star size={19} strokeWidth={1.8} fill={value<=shown?'currentColor':'none'}/></button>)}
  </div>
}
function LibraryCard({paper,trash,coverVersion,onOpen,onEdit,onCover,onError,perform}:{paper:PaperRecord;trash:boolean;coverVersion:number;onOpen:(note:boolean)=>void;onEdit:()=>void;onCover:()=>void;onError:(s:string)=>void;perform:(fn:()=>Promise<unknown>)=>Promise<void>}) {
  const [text,setText]=useState('');const [running,setRunning]=useState(false);const [noteCount,setNoteCount]=useState(0);const [ratingSaving,setRatingSaving]=useState(false)
  useEffect(()=>{if(trash||paper.missing)return;let active=true;const check=async()=>{const [artifacts,notes]=await Promise.all([window.singularity.papers.artifacts(paper.id),window.singularity.papers.noteVersions(paper.id)]);const summary=artifacts.find((a)=>a.kind==='summary'&&a.status==='complete');if(active){setNoteCount(notes.length);setRunning(artifacts.some((a)=>a.kind==='summary'&&['queued','running'].includes(a.status)))}if(summary){const value=await window.singularity.papers.readArtifact(summary.id);if(active)setText(value.replace(/[#*`]/g,'').slice(0,140))}};void check().catch(()=>{});const timer=setInterval(()=>void check().catch(()=>{}),5000);return()=>{active=false;clearInterval(timer)}},[paper.id,paper.missing,trash])
  const startSummary=()=>{setRunning(true);void window.singularity.papers.startArtifact(paper.id,'summary').catch((e)=>{setRunning(false);onError(String(e))})}
  const rate=(value:number)=>{if(ratingSaving)return;setRatingSaving(true);void perform(()=>window.singularity.papers.update(paper.id,{rating:value})).finally(()=>setRatingSaving(false))}
  return <article className="library-card" tabIndex={0} aria-label={`打开 ${paper.title}`} onDoubleClick={()=>!trash&&!paper.missing&&onOpen(false)} onKeyDown={(event)=>{if(event.target===event.currentTarget&&event.key==='Enter'&&!trash&&!paper.missing)onOpen(false)}}>
    <Thumbnail paper={paper} version={coverVersion} onChoose={onCover}/>
    <div className="library-card-body">
      <h3 title={paper.title}>{paper.title}</h3>
      <div className="paper-venue-row"><button className="paper-venue-line" onDoubleClick={(event)=>event.stopPropagation()} onClick={onEdit} title="编辑论文信息"><span>{paper.venue||'期刊 / 会议待补充'} · {paper.year??'年份待补充'}</span><Pencil size={12}/></button>{paper.codeUrl&&<button className="paper-code-link" aria-label={`打开 ${paper.title} 的代码链接`} title="打开代码链接" onDoubleClick={(event)=>event.stopPropagation()} onClick={()=>void window.singularity.research.openSource(paper.codeUrl!).catch((e)=>onError(String(e)))}><ExternalLink size={13}/></button>}</div>
      <PaperRating rating={paper.rating??0} disabled={trash||ratingSaving} onRate={rate}/>
      {paper.missing?<p className="warning">文件待重新定位</p>:paper.indexStatus==='needs-ocr'?<p className="warning">扫描 PDF · 需要 OCR</p>:null}
      {text&&<p className="paper-summary-teaser" title={text}>{text}</p>}
      {noteCount>0&&<small className="paper-note-badge">阅读笔记 v{noteCount}</small>}
      <footer onDoubleClick={(event)=>event.stopPropagation()}>{trash?<button onClick={()=>void perform(()=>window.singularity.papers.restore(paper.id))}><RotateCcw size={13}/>恢复</button>:<><button disabled={paper.missing||running||!!text} onClick={startSummary}>{text?'已小结':running?'生成中':'生成小结'}</button><button disabled={paper.missing} onClick={()=>onOpen(true)}>笔记</button>{paper.missing?<button onClick={()=>void perform(async()=>{const files=await window.singularity.dialogs.selectPdfs();if(files[0])await window.singularity.papers.relocate(paper.id,files[0])})}>重新定位</button>:<button onClick={()=>onOpen(false)}>阅读</button>}<button onClick={()=>{if(confirm('移入本地回收站？可以恢复，原始 PDF 不会被删除。'))void perform(()=>window.singularity.papers.remove(paper.id))}}>删除</button></>}</footer>
    </div>
  </article>
}
function MetadataEditor({paper,onClose,onSave}:{paper:PaperRecord;onClose:()=>void;onSave:(patch:PaperPatch)=>Promise<void>}) {
  const [error,setError]=useState('')
  return <div className="editor-scrim"><form className="metadata-editor" onSubmit={(e)=>{e.preventDefault();const values=new FormData(e.currentTarget);void onSave({title:String(values.get('title')),authors:String(values.get('authors')).split(/[,，]/).map((s)=>s.trim()).filter(Boolean),year:values.get('year')?Number(values.get('year')):null,venue:String(values.get('venue')),codeUrl:String(values.get('codeUrl')),affiliations:String(values.get('affiliations')),keywords:String(values.get('keywords')).split(/[,，;；]/).map((s)=>s.trim()).filter(Boolean),collection:String(values.get('collection')),tags:String(values.get('tags')).split(/[,，]/).map((s)=>s.trim()).filter(Boolean)}).catch((e)=>setError(String(e)))}}><h2>论文信息</h2>{[['title','标题',paper.title],['authors','作者（逗号分隔）',paper.authors.join(', ')],['year','年份',paper.year?.toString()??''],['venue','期刊 / 会议',paper.venue??''],['codeUrl','代码链接',paper.codeUrl??''],['affiliations','发表单位',paper.affiliations??''],['keywords','关键词（逗号分隔）',paper.keywords?.join(', ')??''],['collection','分类集合',paper.collection??''],['tags','标签（逗号分隔）',paper.tags?.join(', ')??'']].map(([key,label,value])=><label key={key}>{label}<input name={key} defaultValue={value} required={key==='title'} type={key==='year'?'number':key==='codeUrl'?'url':'text'}/></label>)}{error&&<p role="alert">{error}</p>}<footer><button type="button" onClick={onClose}>取消</button><button className="primary" type="submit">保存</button></footer></form></div>
}
