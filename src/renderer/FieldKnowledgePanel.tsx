import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, BookOpen, ExternalLink, Plus, Save, Trash2, Star, X, LocateFixed, LoaderCircle, GitCompareArrows } from 'lucide-react'
import { deltaVerdictLabels, fieldRelationLabels, type DeltaVerdict, type FieldDeltaReport, type FieldKnowledge, type FieldPaper, type FieldRelationKind, type FieldSummary } from '../shared/field-knowledge'
import { researchYearOptions, type ResearchRequest } from '../shared/research-explorer'
import { FieldKnowledgeGraph } from './FieldKnowledgeGraph'
import { FieldMindMap } from './FieldMindMap'
import './field-knowledge.css'
import { ResearchAction } from './ResearchAction'

const stateLabels: Record<FieldSummary['documentState'], string> = { draft: '综述待生成', current: '文档已更新', outdated: '有新资料 · 待更新综述', updating: '正在更新综述', failed: '综述更新待重试' }
export function FieldKnowledgePanel({ onBack, onSearch, projectId, initialId='', initialTab }: { onBack: () => void; onSearch: (field: FieldSummary, options?: { dateFrom?: string; dateTo?: string; count?: ResearchRequest['count']; publicationYears?: number; delta?: boolean }) => void; projectId?: string | null; initialId?: string; initialTab?: 'document' | 'delta' }) {
  const [fields,setFields] = useState<FieldSummary[]>([]), [id,setId] = useState(initialId), [field,setField] = useState<FieldKnowledge|null>(null)
  const [tab,setTab] = useState<'graph'|'document'|'delta'|'notes'|'papers'|'stars'|'reports'|'mindmap'>(initialTab ?? 'document'), [title,setTitle] = useState(''), [parentId,setParentId] = useState(''), [runs,setRuns] = useState<import('../shared/research-explorer').ResearchRun[]>([]), [selected,setSelected] = useState('')
  const [note,setNote] = useState(''), [error,setError] = useState(''), [busy,setBusy] = useState(''), [linked,setLinked] = useState<string[]>([]), [years,setYears] = useState(2), [count,setCount] = useState<ResearchRequest['count']>(10)
  const current = useRef<FieldKnowledge|null>(null), noteRef = useRef(''), savedNote = useRef('')
  const drafts=useRef(new Map<string,{note:string;saved:string}>())
  const apply = (value: FieldKnowledge) => {
    if(current.current && current.current.id!==value.id) drafts.current.set(current.current.id,{note:noteRef.current,saved:savedNote.current})
    if (current.current?.id !== value.id) { const draft=drafts.current.get(value.id); noteRef.current=draft?.note??value.notes; savedNote.current=draft?.saved??value.notes; setNote(noteRef.current) }
    else if (noteRef.current === savedNote.current) { noteRef.current=value.notes; savedNote.current=value.notes; setNote(value.notes) }
    current.current=value;setField(value)
  }
  useEffect(() => {
    let active=true,loading=false
    const reload = async () => {
      if (loading) return; loading=true
      try {
        const history=await window.singularity.research.explorations(); if(active)setRuns(history);
        const values=await window.singularity.research.fields(); if (!active) return; setFields(values)
        const target=values.some(f=>f.id===id)?id:values[0]?.id
        if (!target) { if (id) setId(''); if (current.current) { current.current=null; setField(null) }; return }
        if (target!==id) { setId(target);return }
        const summary=values.find(f=>f.id===target), prior=current.current
        if (summary && (!prior || prior.id!==target || prior.revision!==summary.revision || prior.documentVersion!==summary.documentVersion || prior.documentState!==summary.documentState || prior.lastSurveyAt!==summary.lastSurveyAt)) {
          const value=await window.singularity.research.field(target);if(active)apply(value)
        }
      } catch(e) { if(active)setError(String(e)) } finally { loading=false }
    }
    void reload();const timer=setInterval(()=>void reload(),4000)
    return()=>{active=false;clearInterval(timer)}
  },[id])
  useEffect(()=>{setSelected('');setTab(initialTab??'document')},[id,initialTab])
  useEffect(()=>{if(!projectId||!window.singularity.knowledge?.projects)return;let active=true;void window.singularity.knowledge.projects().then(values=>{if(active)setLinked(values.find(p=>p.id===projectId)?.paperIds??[])}).catch(()=>{});return()=>{active=false}},[projectId])
  const action=async(name:string, work:()=>Promise<FieldKnowledge>)=>{setError('');setBusy(name);try{const value=await work();if(current.current?.id===value.id)apply(value);setFields(await window.singularity.research.fields())}catch(e){setError(String(e))}finally{setBusy('')}}
  const create=async()=>{setError('');setBusy('create');try{const value=await window.singularity.research.createField(title,parentId||undefined);setTitle('');setId(value.id);apply(value);setFields(await window.singularity.research.fields())}catch(e){setError(String(e))}finally{setBusy('')}}
  const paper=field?.papers.find(p=>p.id===selected)??field?.papers.at(-1)
  const followUp = () => { if(!field) return; onSearch(field, { dateFrom: field.lastSurveyAt ? field.lastSurveyAt.slice(0,10) : undefined, dateTo: new Date().toISOString().slice(0,10), count, publicationYears: years, delta: true }) }
  const saveNotes=()=>{if(!field)return;const target=field.id,draft=note,previous=savedNote.current;void action('notes',async()=>{const value=await window.singularity.research.saveFieldNotes(target,draft,previous);if(current.current?.id===target){savedNote.current=value.notes; if(noteRef.current===draft){noteRef.current=value.notes;setNote(value.notes)}}else drafts.current.set(target,{note:value.notes,saved:value.notes});return value})}
  const selectPaper=(paperId:string)=>{setSelected(paperId);setTab('graph')}
  const importPaper=async(paper:FieldPaper)=>{
    if(!field)return;setBusy('import');setError('')
    try{const value=await window.singularity.research.importFieldPaper(field.id,paper.id,projectId||undefined);if(projectId)setLinked(ids=>[...new Set([...ids,value.id])]);const next=await window.singularity.research.field(field.id);if(current.current?.id===next.id)apply(next)}catch(e){setError(String(e))}finally{setBusy('')}
  }
  return <section className="field-workspace" aria-label="领域知识库">
    <header className="field-workspace-heading"><ResearchAction label="独立论文检索" onClick={onBack}><ArrowLeft/></ResearchAction></header>
    {error&&<p role="alert" className="inline-error">{error}</p>}
    <div className="field-workspace-columns"><aside className="field-catalog"><div>{fields.map(f=><button className={f.id===id?'selected':''} aria-pressed={f.id===id} key={f.id} onClick={()=>setId(f.id)}><strong>{f.parentId ? "↳ " : ""}{f.title}</strong><small>{f.paperCount} 篇</small></button>)}</div><form className="field-create-form" onSubmit={e=>{e.preventDefault();void create()}}><input id="new-field-title" aria-label="新领域名称" maxLength={120} placeholder="新领域" value={title} onChange={e=>setTitle(e.target.value)}/><select aria-label="所属领域" value={parentId} onChange={e=>setParentId(e.target.value)}><option value="">独立领域</option>{fields.map(f=><option value={f.id} key={f.id}>{f.title}</option>)}</select><button type="submit" className="field-create" aria-label="建立领域" disabled={!title.trim()||!!busy}>{busy==='create'?<LoaderCircle className="is-spinning" size={14}/>:'建立'}</button></form></aside>
      <div className="field-main field-stage">{!field?<div className="field-empty"><BookOpen size={30}/><h3>还没有领域</h3></div>:<>
        <header className="field-title"><div><h2>{field.title}</h2><p>{field.paperCount} 篇</p></div><div className="field-study"><label>时间<select aria-label="梳理时间范围" value={years} onChange={e=>setYears(Number(e.target.value))}>{researchYearOptions.map(value=><option key={value} value={value}>近 {value} 年</option>)}</select></label><label>推荐<select aria-label="推荐论文数量" value={count} onChange={e=>setCount(Number(e.target.value) as ResearchRequest['count'])}>{([5,10,15,20] as const).map(value=><option key={value} value={value}>{value} 篇</option>)}</select></label><button type="button" className="primary" disabled={!!busy} onClick={()=>onSearch(field,{count,publicationYears:years})}>梳理</button><button type="button" disabled={!!busy} aria-label="Delta 跟进：增量拉新并逐篇对比上次结论" onClick={followUp}>跟进</button><button type="button" aria-label="更新综合综述" title={stateLabels[field.documentState]} disabled={!field.paperCount||!!busy||field.documentState==='updating'} onClick={()=>void action('synthesis',()=>window.singularity.research.updateFieldDocument(field.id))}>{busy==='synthesis'?'更新中':'更新'}</button><button type="button" aria-label="打开本地文档位置" onClick={()=>void window.singularity.nativeFiles.show(field.documentPath).catch(e=>setError(String(e)))}>文档</button><label className="field-monthly-inline field-monthly-control"><input type="checkbox" aria-label="每月自动跟进" checked={!!field.monthly} disabled={!!busy} onChange={e=>void action('monthly',()=>window.singularity.research.setFieldMonthly(field.id,e.target.checked))}/>每月</label></div></header>
        {field.monthlyError&&<p role="alert">{field.monthlyError}</p>}
        {runs.filter(r=>r.request.fieldId===field.id&&['planning','collecting','reading','analysing','failed'].includes(r.status)).slice(0,1).map(r=><div className="field-document-status" key={r.id}><span>{r.progress}</span>{r.error&&<small role="alert">{r.error}</small>}{['planning','collecting','reading','analysing'].includes(r.status)&&<ResearchAction label="取消检索" onClick={()=>void window.singularity.research.cancelExploration(r.id).catch(e=>setError(String(e)))}><X/></ResearchAction>}</div>)}
        {field.error&&<p className="field-warning">{field.error}</p>}
        <nav className="field-view-tabs" role="tablist" aria-label="领域知识库视图">{([['document','综述','领域综述'],['delta','跟进','Delta 跟进'],['papers','论文','领域论文'],['stars','重点','重点知识库'],['mindmap','导图','思维导图'],['graph','图谱','关系图谱'],['reports','月报','每月进展'],['notes','笔记','我的笔记']] as const).map(([value,label,name])=><button key={value} type="button" role="tab" aria-label={name} aria-selected={tab===value} className={tab===value?'active':''} onClick={()=>setTab(value)}>{label}</button>)}</nav>
        {tab==='delta'&&(!field.deltas?.length?<div className="field-empty"><GitCompareArrows size={28}/><h3>还没有 Delta 跟进</h3><p>点「跟进」，只看上次综述之后的新论文。</p></div>:<div className="field-delta-list">{field.deltas.map((delta,index)=>index===0?<DeltaReport key={delta.id} delta={delta} field={field} onLocate={selectPaper}/>:<details key={delta.id} className="field-delta-history"><summary>{new Date(delta.createdAt).toLocaleString('zh-CN')} · {delta.items.length} 篇 · 对比综述 v{delta.baselineVersion}</summary><DeltaReport delta={delta} field={field} onLocate={selectPaper}/></details>)}</div>)}
        {(tab==='papers'||tab==='stars')&&<section className="field-paper-grid">{!field.papers.filter(p=>tab!=='stars'||p.starred).length&&<p>{tab==='stars'?'还没有重点论文':'还没有论文'}</p>}{field.papers.filter(p=>tab!=='stars'||p.starred).map(p=><article key={p.id} className="field-paper-card"><small>{p.source.date.slice(0,10)} · {p.source.venue}</small><h3>{p.source.title}</h3><p>{p.analysis.summary}</p><footer><ResearchAction label={p.starred?'取消重点':'标星并入库'} aria-pressed={!!p.starred} disabled={!!busy} onClick={()=>void action('star',()=>window.singularity.research.starFieldPaper(field.id,p.id,!p.starred))}><Star fill={p.starred?'currentColor':'none'}/></ResearchAction><ResearchAction label="在关系图谱中定位" onClick={()=>selectPaper(p.id)}><LocateFixed/></ResearchAction></footer></article>)}</section>}
        {tab==='reports'&&<article className="field-document">{!field.reports?.length&&<p>还没有月报</p>}{[...(field.reports??[])].reverse().map(r=><section key={r.runId}><h3>{new Date(r.createdAt).toLocaleDateString('zh-CN')}</h3><p>{r.overview}</p>{r.warnings?.map((v,i)=><p className="field-warning" key={i}>{v}</p>)}{r.insights.map((v,i)=><p key={i}>{v}</p>)}<div className="field-document-citations">{r.paperIds.map(pid=><button key={pid} onClick={()=>selectPaper(pid)}>{field.papers.find(p=>p.id===pid)?.source.title}</button>)}</div></section>)}</article>}
        {tab==='mindmap'&&<FieldMindMap field={field} selected={paper?.id??''} onSelect={selectPaper}/>}
        {tab==='graph'&&<><FieldKnowledgeGraph key={field.id} field={field} selected={paper?.id??''} onSelect={setSelected}/>{paper&&<FieldPaperDetails key={paper.id} paper={paper} field={field} busy={!!busy} linked={!!paper.analysis.libraryId&&linked.includes(paper.analysis.libraryId)} projectId={projectId} onImport={()=>void importPaper(paper)} onOpen={()=>void window.singularity.research.openSource(paper.source.url).catch(e=>setError(String(e)))} onDirections={directions=>action('directions',()=>window.singularity.research.setFieldDirections(field.id,paper.id,directions))} onRelation={input=>action('relation',()=>window.singularity.research.addFieldRelation(field.id,input))} onRemoveRelation={relationId=>action('relation',()=>window.singularity.research.removeFieldRelation(field.id,relationId))}/>}</>}
        {tab==='document'&&(field.sections.length>0||field.papers.length>0)&&<article className="field-document">{field.sections.map((s,i)=><section key={i}>{s.kind==='insight'&&<span className="field-inference">推演</span>}<h3>{s.title}</h3><p>{s.body}</p><div className="field-document-citations">{s.sourceIds.map(sourceId=>{const p=field.papers.find(p=>p.id===sourceId);return p&&<button key={sourceId} onClick={()=>selectPaper(p.id)}>{p.source.title}</button>})}</div></section>)}{[...new Set(field.papers.flatMap(p=>p.directions))].sort().map(direction=><div className="field-document-direction" key={direction}><h4>{direction}</h4>{field.papers.filter(p=>p.directions.includes(direction)).map(p=><div key={p.id}><button onClick={()=>selectPaper(p.id)}>{p.source.date.slice(0,10)} · {p.source.title}</button></div>)}</div>)}</article>}
        {tab==='notes'&&<section className="field-notes"><textarea aria-label="领域个人笔记" value={note} maxLength={30000} rows={12} onChange={e=>{noteRef.current=e.target.value;setNote(e.target.value)}}/><footer><small>{note!==savedNote.current?'未保存':'已保存'}</small><ResearchAction label="保存笔记" disabled={!!busy||note===savedNote.current} className="primary" onClick={saveNotes}><Save/></ResearchAction></footer></section>}
      </>}</div>
    </div>
  </section>
}

const deltaVerdicts: DeltaVerdict[] = ['supports','refutes','extends','irrelevant','unverified']
function DeltaReport({delta,field,onLocate}:{delta:FieldDeltaReport;field:FieldKnowledge;onLocate:(paperId:string)=>void}) {
  return <article className="field-delta-report">
    <header><div><h3>{new Date(delta.createdAt).toLocaleDateString('zh-CN')} · 对比综述 v{delta.baselineVersion}</h3><small>{delta.dateFrom&&delta.dateTo?`新论文范围 ${delta.dateFrom} 至 ${delta.dateTo}`:'按预设时间范围'} · 结论快照 {new Date(delta.baselineAt).toLocaleString('zh-CN')} · {delta.items.length} 篇</small></div>
      <div className="field-delta-counts">{deltaVerdicts.map(verdict=>{const count=delta.items.filter(item=>item.verdict===verdict).length;return count?<span key={verdict} className={`field-delta-chip ${verdict}`}>{deltaVerdictLabels[verdict]} {count}</span>:null})}</div></header>
    <div className="field-delta-summary"><h4>结论变化</h4><p>{delta.summary}</p>{delta.shifts.map((shift,index)=><p key={index}>· {shift}</p>)}<p className="field-delta-action">建议：{delta.action}</p></div>
    {delta.warnings.map((warning,index)=><p key={index} className="field-warning">{warning}</p>)}
    <div className="field-delta-items">{delta.items.map(item=>{
      const linked=field.papers.find(p=>p.origins.some(origin=>origin.runId===delta.runId&&origin.sourceId===item.sourceId))
      return <article className="field-delta-item" key={item.sourceId}>
        <header><span className={`field-delta-verdict ${item.verdict}`}>{deltaVerdictLabels[item.verdict]}</span><h4>{item.title}</h4><small>{item.evidenceKind==='full-text'?'已采集原文':'仅摘要 · 待核验'}</small></header>
        <dl><dt>影响的结论</dt><dd>{item.claim}{item.section&&<span className="field-delta-section"> · {item.section}</span>}</dd><dt>判断依据</dt><dd>{item.reason}</dd></dl>
        {item.quote&&<blockquote><q>{item.quote}</q></blockquote>}
        {linked&&<div className="field-document-citations"><button onClick={()=>onLocate(linked.id)}>在关系图谱中定位</button></div>}
      </article>
    })}</div>
  </article>
}

function FieldPaperDetails({paper,field,busy,projectId,linked,onImport,onOpen,onDirections,onRelation,onRemoveRelation}:{paper:FieldPaper;field:FieldKnowledge;busy:boolean;projectId?:string|null;linked:boolean;onImport:()=>void;onOpen:()=>void;onDirections:(directions:string[])=>Promise<void>;onRelation:(input:{from:string;to:string;kind:FieldRelationKind;reason:string})=>Promise<void>;onRemoveRelation:(id:string)=>Promise<void>}) {
  const [directions,setDirections]=useState(paper.directions.join('、')), [target,setTarget]=useState(''), [kind,setKind]=useState<FieldRelationKind>('improves'), [reason,setReason]=useState('')
  const related=field.relations.filter(r=>r.from===paper.id||r.to===paper.id)
  return <article className="field-paper-detail" aria-label="图谱论文详情"><header><div><small>{paper.source.date.slice(0,10)} · {paper.source.venue} · {paper.source.evidenceKind==='full-text'?'已采集原文':'仅摘要 · 待核验'}</small><h3>{paper.source.title}</h3></div><button onClick={onOpen}><ExternalLink size={15}/>原文</button><button disabled={busy||!!paper.analysis.libraryId&&(!projectId||linked)} onClick={onImport}><Plus size={15}/>{paper.analysis.libraryId?(projectId?linked?'已在项目':'加入当前项目':'已在论文库'):projectId?'下载并加入项目':'加入论文库'}</button></header><p>{paper.analysis.summary}</p><dl><dt>方法机制</dt><dd>{paper.analysis.method}</dd><dt>数据与评估</dt><dd>{paper.analysis.datasets} {paper.analysis.evaluation}</dd><dt>复现与评估边界</dt><dd>{paper.analysis.risks}</dd><dt>启发（推演）</dt><dd>{paper.analysis.transfer}</dd></dl>
    <div className="field-direction-editor"><label>归入方向<input aria-label="论文方向标签" value={directions} maxLength={155} onChange={e=>setDirections(e.target.value)}/></label><button disabled={busy||!directions.trim()} onClick={()=>void onDirections(directions.split(/[、,，]/).map(s=>s.trim()).filter(Boolean))}>保存归类</button><small>可用顿号分隔 1–3 个方向；手动归类会在后续检索中保留。</small></div>
    <details className="field-relation-editor"><summary>维护方法之间的联系 · {related.length} 条</summary><p>当前论文作为关系起点。请给出自己的依据或待核验解释，不能仅因日期先后认定继承。</p><div><select aria-label="关系目标论文" value={target} onChange={e=>setTarget(e.target.value)}><option value="">选择另一篇论文</option>{field.papers.filter(p=>p.id!==paper.id).map(p=><option key={p.id} value={p.id}>{p.source.title}</option>)}</select><select aria-label="论文关系类型" value={kind} onChange={e=>setKind(e.target.value as FieldRelationKind)}>{Object.entries(fieldRelationLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></div><input aria-label="论文关系说明" placeholder="说明借鉴或改进了什么，以及仍需核验的地方" maxLength={1200} value={reason} onChange={e=>setReason(e.target.value)}/><button disabled={busy||!target||!reason.trim()} onClick={()=>void onRelation({from:paper.id,to:target,kind,reason})}>保存关系</button>{related.map(r=><div className="field-relation-row" key={r.id}><p>{field.papers.find(p=>p.id===r.from)?.source.title} → {field.papers.find(p=>p.id===r.to)?.source.title}<br/><strong>{fieldRelationLabels[r.kind]}</strong> · {r.reason}</p><button aria-label="移除论文关系" disabled={busy} onClick={()=>void onRemoveRelation(r.id)}><Trash2 size={14}/></button></div>)}</details>
  </article>
}
