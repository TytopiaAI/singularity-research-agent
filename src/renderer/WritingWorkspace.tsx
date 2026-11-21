import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Check, ChevronRight, FilePenLine, FolderPlus, Plus, Save, Sparkles, Star, Trash2, Upload, X } from 'lucide-react'
import type { WritingParagraph, WritingParagraphVersion, WritingProject, WritingRevision, WritingSectionKey } from '../shared/types'
import type { ArgumentReview, ProjectMaterial, ResearchProject } from '../shared/knowledge'
import { ArgumentPanel } from './ArgumentPanel'
import type { ProjectEntry, ProjectWorkflow } from '../shared/project-workflow'
import { experimentStatusLabels, projectStageLabels } from '../shared/project-workflow'
import './project-lifecycle.css'
import { writingSections as sections, type WritingGroup, type ParagraphRequest } from '../shared/writing'
import { WritingTemplatePanel } from './WritingTemplatePanel'
import './writing-workflow.css'

export function WritingWorkspace({ initialProjectId, onResearchProject, onOpenLatex, beforeLatexTransfer }: { initialProjectId?: string | null; onResearchProject?: (id: string) => void;onOpenLatex?:(id:string)=>void;beforeLatexTransfer?:()=>Promise<void> } = {}) {
  const [projects,setProjects] = useState<WritingProject[]>([])
  const [projectId,setProjectId] = useState<string|null>(null)
  const [section,setSection] = useState<WritingSectionKey>('introduction')
  const [paragraphs,setParagraphs] = useState<WritingParagraph[]>([])
  const [groups,setGroups]=useState<WritingGroup[]>([]),[groupParent,setGroupParent]=useState<string|null|undefined>(undefined),[groupTitle,setGroupTitle]=useState('')
  const [revisions,setRevisions] = useState<WritingRevision[]>([])
  const [newOpen,setNewOpen] = useState(false)
  const [editProject,setEditProject] = useState(false)
  const [busy,setBusy] = useState(false)
  const [error,setError] = useState('')
  const [message,setMessage] = useState('')
  const [researchProjects,setResearchProjects] = useState<ResearchProject[]>([])
  const [researchId,setResearchId] = useState<string|null>(null)
  const [materials,setMaterials] = useState<ProjectMaterial[]>([])
  const [argumentReviews,setArgumentReviews] = useState<ArgumentReview[]>([])
  const [researchEntries, setResearchEntries] = useState<ProjectEntry[]>([]), [workflow, setWorkflow] = useState<ProjectWorkflow | null>(null)
  useEffect(() => { let active = true; setResearchEntries([]); setWorkflow(null); if (researchId) void Promise.all([window.singularity.knowledge.projectEntries(researchId), window.singularity.knowledge.workflow(researchId)]).then(([entries, value]) => { if (active) { setResearchEntries(entries); setWorkflow(value) } }).catch(e => { if (active) setError(String(e)) }); return () => { active = false } }, [researchId])
  const flushers = useRef(new Map<string,()=>Promise<void>>())
  const activeTarget=useRef('');activeTarget.current=projectId+':'+section
  const register = useCallback((id:string,save:(()=>Promise<void>)|null)=>{if(save)flushers.current.set(id,save);else flushers.current.delete(id)},[])
  const flush=async()=>{await Promise.all([...flushers.current.values()].map(save=>save()));await beforeLatexTransfer?.()}
  const navigate=async(work:()=>void)=>{try{await flush();setGroupParent(undefined);work()}catch(e){setError(String(e))}}
  useEffect(()=>{void window.singularity.knowledge.projects().then(setResearchProjects).catch((e)=>setError(String(e)))},[])
  useEffect(()=>{let live=true;setResearchId(null);setMaterials([]);if(projectId)void window.singularity.knowledge.writingLink(projectId).then(async(id)=>{const items=id?await window.singularity.knowledge.materials(id):[];if(live){setResearchId(id);setMaterials(items)}}).catch((e)=>{if(live)setError(String(e))});return()=>{live=false}},[projectId])
  const linkResearch=async(id:string)=>{if(!projectId)return;try{await Promise.all([...flushers.current.values()].map((save)=>save()));await window.singularity.knowledge.linkWriting(projectId,id||null);setResearchId(id||null);setMaterials(id?await window.singularity.knowledge.materials(id):[]);setError('')}catch(e){setError(String(e))}}
  const project = projects.find((item) => item.id === projectId)
  const sectionLabel = sections.find((item) => item.key === section)?.label ?? ''

  useEffect(() => { void window.singularity.writing.projects().then((items) => { setProjects(items); setProjectId(items.find(item => item.id === initialProjectId)?.id ?? items[0]?.id ?? null) }).catch((e) => setError(String(e))) }, [initialProjectId])
  const reload = useCallback(async () => {
    if (!projectId) return
    const [cards,reviews,argumentsList,groupList] = await Promise.all([
      window.singularity.writing.paragraphs(projectId,section),
      window.singularity.writing.revisions(projectId,section),
      window.singularity.knowledge.argumentReviews(projectId,section),
      window.singularity.writing.groups(projectId,section),
    ])
    if(activeTarget.current!==projectId+':'+section)return
    setParagraphs(cards)
    setGroups(groupList)
    setRevisions(reviews)
    setArgumentReviews(argumentsList)
  },[projectId,section])
  useEffect(() => {
    if (!projectId) { setParagraphs([]); return }
    setParagraphs([])
    void reload().catch((e) => setError(String(e)))
    const timer = setInterval(() => void reload().catch(() => {}),1800)
    return () => clearInterval(timer)
  },[projectId,section,reload])

  const createProject = async (form: HTMLFormElement) => {
    const data = new FormData(form)
    try {
      await flush()
      const created = await window.singularity.writing.create(String(data.get('title') ?? ''),String(data.get('field') ?? ''),String(data.get('journal') ?? ''))
      setProjects((items) => [created,...items]); setProjectId(created.id); setNewOpen(false); setError('')
    } catch(e) { setError(String(e)) }
  }
  const updateProject = async (form: HTMLFormElement) => {
    if (!project) return
    const data = new FormData(form)
    try {
      const updated = await window.singularity.writing.update(project.id,String(data.get('title') ?? ''),String(data.get('field') ?? ''),String(data.get('journal') ?? ''))
      setProjects((items) => items.map((item) => item.id === updated.id ? updated : item)); setEditProject(false); setError('')
    } catch(e) { setError(String(e)) }
  }
  const addParagraph = async (groupId:string|null=null) => {
    if (!projectId) return
    try { await window.singularity.writing.addParagraph(projectId,section,groupId); await reload(); setMessage('已添加段落卡片') }
    catch(e) { setError(String(e)) }
  }
  const reviewSection = async () => {
    if (!projectId) return
    setBusy(true); setError('')
    try {
      await Promise.all([...flushers.current.values()].map((save)=>save()))
      const fresh=await window.singularity.writing.paragraphs(projectId,section)
      const content = fresh.map((paragraph) => paragraph.draftText.trim()).filter(Boolean).join('\n\n')
      if (!content) throw new Error('请先写入段落内容。')
      await window.singularity.writing.saveDraft(projectId,section,content,true)
      await window.singularity.writing.review(projectId,section,'critique')
      setMessage('正在审阅整章结构'); await reload()
    } catch(e) { setError(String(e)) } finally { setBusy(false) }
  }
  const reviewArgument=async()=>{if(!projectId)return;setBusy(true);setError('');setMessage('正在检查论证与证据');try{await Promise.all([...flushers.current.values()].map((save)=>save()));await window.singularity.knowledge.reviewArgument(projectId,section);setMessage('论证检查已保存');await reload()}catch(e){setError(String(e));setMessage('论证检查未完成')}finally{setBusy(false)}}
  const returnToResearch = async () => { if (!researchId || !onResearchProject) return; setBusy(true); try { await Promise.all([...flushers.current.values()].map(save => save())); onResearchProject(researchId) } catch (e) { setError(String(e)) } finally { setBusy(false) } }
  const groupAction=async(work:()=>Promise<unknown>)=>{try{await flush();await work();await reload();setError('')}catch(e){setError(String(e))}}
  const renderCards=(groupId:string|null)=><div className="paragraph-stack">{paragraphs.filter(p=>(p.groupId??null)===groupId).map(p=><ParagraphCard key={p.id} paragraph={p} materials={materials} register={register} onRefresh={reload} groups={groups} siblings={paragraphs.filter(p=>(p.groupId??null)===groupId)}/>)}</div>
  const renderGroups=(parentId:string|null,depth=0):React.ReactNode=>groups.filter(g=>g.parentId===parentId).map(g=><section className="writing-outline-group" key={g.id}><div className="writing-group-head"><input key={g.title} aria-label="分组标题" defaultValue={g.title} maxLength={120} onBlur={e=>{const title=e.target.value;if(title!==g.title)void groupAction(()=>window.singularity.writing.updateGroup(g.id,title))}}/><button title="添加段落" aria-label={`在${g.title}添加段落`} onClick={()=>void addParagraph(g.id)}><Plus size={15}/></button>{depth<3&&<button title="添加子分组" aria-label={`在${g.title}添加子分组`} onClick={()=>{setGroupParent(g.id);setGroupTitle('')}}><FolderPlus size={15}/></button>}<button title="删除空分组" aria-label={`删除分组${g.title}`} onClick={()=>void groupAction(()=>window.singularity.writing.removeGroup(g.id))}><Trash2 size={14}/></button></div>{groupParent===g.id&&groupForm}{renderCards(g.id)}{renderGroups(g.id,depth+1)}{!paragraphs.some(p=>p.groupId===g.id)&&!groups.some(child=>child.parentId===g.id)&&<div className="writing-group-empty">为这一部分添加段落，或继续划分子分组。</div>}</section>)
  const groupForm=<form className="writing-group-composer" onSubmit={e=>{e.preventDefault();void groupAction(async()=>{await window.singularity.writing.createGroup(projectId!,section,groupTitle,groupParent??null);setGroupParent(undefined);setGroupTitle('')})}}><input autoFocus aria-label="新分组标题" placeholder="例如：第一部分 · 重建方法（英文模板请用英文标题）" value={groupTitle} onChange={e=>setGroupTitle(e.target.value)} required maxLength={120}/><button className="primary" type="submit">创建分组</button><button type="button" aria-label="取消创建分组" onClick={()=>setGroupParent(undefined)}><X size={15}/></button></form>
  const uploadFirst=async()=>{setBusy(true);try{await flush();const template=await window.singularity.latex.importZip();if(!template)return;const created=await window.singularity.writing.create(template.title,'','');await window.singularity.writing.bindTemplate(created.id,template.id,'en');setProjects(items=>[created,...items]);setProjectId(created.id);setError('')}catch(e){setError(String(e))}finally{setBusy(false)}}

  return <section className="page writing-page" style={{'--chapter-color':sections.find(s=>s.key===section)?.color} as React.CSSProperties}>
    <div className="page-header"><div><h1>论文写作</h1></div><div><button disabled={busy} onClick={()=>void uploadFirst()}><Upload size={15}/>从模板开始</button><button className="primary" onClick={() => setNewOpen((open) => !open)}><Plus size={15}/>新建项目</button></div></div>
    {newOpen && <form className="writing-project-form" onSubmit={(event) => { event.preventDefault(); void createProject(event.currentTarget) }}>
      <input name="title" aria-label="论文项目名称" placeholder="论文项目名称" required maxLength={300}/>
      <input name="field" aria-label="研究领域" placeholder="研究领域（可选）" maxLength={120}/>
      <input name="journal" aria-label="目标期刊" placeholder="目标期刊（可选）" maxLength={120}/>
      <button className="primary" type="submit">创建</button>
    </form>}
    {error && <p role="alert" className="inline-error">{error}</p>}
    {!projects.length && !newOpen && <div className="empty-state"><FilePenLine size={28}/><h3>从第一段开始</h3><p>把想法写进卡片，逐段生成、比较和保留版本。</p><button onClick={() => setNewOpen(true)}>新建写作项目</button></div>}
    {projects.length > 0 && <div className="writing-layout">
      <aside className="writing-project-list"><span className="section-label">项目</span>{projects.map((item) => <button key={item.id} className={item.id === projectId ? 'active' : ''} onClick={() => void navigate(()=>setProjectId(item.id))}><FilePenLine size={15}/><span><strong>{item.title}</strong><small>{item.field || '未指定领域'}</small></span></button>)}</aside>
      {project && <div className="writing-main">
        <div className="writing-project-heading"><div><span className="section-label">当前稿件</span><h2>{project.title}</h2><p>{[project.field,project.targetJournal].filter(Boolean).join(' · ') || '本地写作项目'}</p></div><button onClick={() => setEditProject((value) => !value)}>项目信息</button></div>
        <WritingTemplatePanel key={project.id} projectId={project.id} beforeTransfer={flush} onOpenLatex={onOpenLatex}/>
        {researchId && workflow && <details className="project-writing-context"><summary>关联研究进度 · {projectStageLabels[workflow.stage]} · {researchEntries.filter(e => e.kind === 'experiment').length} 次实验</summary><p>{researchProjects.find(p => p.id === researchId)?.question}</p>{researchEntries.filter(e => e.id === workflow.activeMethodId || e.kind === 'experiment').map(entry => <details key={entry.id}><summary>{entry.kind === 'method' ? `当前方法 v${entry.version}` : experimentStatusLabels[entry.status]} · {entry.title}</summary><p>{entry.description}</p>{entry.result && <p>结果：{entry.result}</p>}{entry.conclusion && <p>结论：{entry.conclusion}</p>}{entry.nextStep && <p>待验证：{entry.nextStep}</p>}</details>)}{onResearchProject && <button disabled={busy} onClick={() => void returnToResearch()}>返回研究项目 / 补充实验</button>}<p className="muted">研究记录由作者提供；未运行的实验和待验证假设不会当作已完成结果。段落生成与论证检查会参考这些记录。</p></details>}
        <label className="knowledge-form-row">证据来源项目<select aria-label="稿件关联研究项目" value={researchId??''} onChange={(event)=>void linkResearch(event.target.value)}><option value="">未关联研究项目</option>{researchProjects.map((item)=><option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
        {editProject && <form className="writing-project-form" onSubmit={(event) => { event.preventDefault(); void updateProject(event.currentTarget) }}><input name="title" aria-label="修改项目名称" defaultValue={project.title} required/><input name="field" aria-label="修改研究领域" defaultValue={project.field}/><input name="journal" aria-label="目标期刊" defaultValue={project.targetJournal}/><button className="primary" type="submit">保存</button></form>}
        <div className="writing-section-tabs" role="tablist" aria-label="论文章节">{sections.map((item) => <button key={item.key} style={{'--chapter-color':item.color} as React.CSSProperties} role="tab" aria-selected={section === item.key} className={section === item.key ? 'active' : ''} onClick={() => void navigate(()=>setSection(item.key))}>{item.label}</button>)}</div>
        <div className="paragraph-section-head"><div><span className="section-label">{section.toUpperCase()} · {paragraphs.length} PARAGRAPHS</span><h2>{sectionLabel}</h2></div><div><span role="status" className="muted">{message}</span><button className="primary" onClick={() => void addParagraph()}><Plus size={15}/>添加段落</button></div></div>
        {paragraphs.length === 0 && <div className="paragraph-empty"><h3>这一部分还没有段落</h3><p>每张卡片只处理一个论点。可先用口语写下想法，再生成学术表达。</p><button onClick={() => void addParagraph()}><Plus size={15}/>添加第一段</button></div>}
        <div className="writing-outline-actions"><button onClick={()=>{setGroupParent(null);setGroupTitle('')}}><FolderPlus size={15}/>创建部分 / 分组</button><span className="muted">章节 → 部分 → 段落 · 左上角星星表示定稿</span></div>
        {groupParent===null&&groupForm}
        {groups.length>0&&paragraphs.some(p=>!p.groupId)&&<h3>章节直属段落</h3>}
        {renderCards(null)}
        {renderGroups(null)}
        {paragraphs.length > 0 && <div className="paragraph-add-end"><button onClick={() => void addParagraph()}><Plus size={15}/>继续添加段落</button></div>}
        <section className="argument-review"><div className="paragraph-section-head"><h3>章节论证检查</h3><button className="primary" disabled={busy||!paragraphs.length} onClick={()=>void reviewArgument()}><Sparkles size={14}/>{busy?'检查中…':'检查论证与来源'}</button></div><p className="muted">检查主张是否有依据、段落是否递进，并区分论文事实与自己的推演；建议不会自动覆盖稿件。</p>{argumentReviews.map((item)=><details key={item.id} open={item===argumentReviews[0]}><summary>{new Date(item.createdAt).toLocaleString('zh-CN')} · 论证审阅</summary><p>{item.content}</p></details>)}</section>
        <details className="writing-history section-review"><summary>整章结构审阅 <ChevronRight size={15}/></summary><p className="muted">按当前段落顺序检查整章论证；建议保存在本地，不会覆盖段落卡片。</p><button disabled={busy || !paragraphs.some((item) => item.draftText.trim()) || revisions.some((item) => ['queued','running'].includes(item.status))} onClick={() => void reviewSection()}><Sparkles size={14}/>{busy ? '正在提交' : '检查结构与证据'}</button>
          {revisions.map((item) => <article key={item.id}><strong>{new Date(item.createdAt).toLocaleString('zh-CN')} · {item.status === 'complete' ? '已完成' : item.status === 'failed' ? '失败' : '进行中'}</strong>{item.error && <p role="alert">{item.error}</p>}{item.result && <><p>{item.result.assessment}</p>{item.result.issues.map((issue,index) => <p key={index}><strong>{issue.problem}：</strong>{issue.suggestion}</p>)}</>}</article>)}
        </details>
      </div>}
    </div>}
  </section>
}

function ParagraphCard({paragraph,onRefresh,materials,register,groups,siblings}:{paragraph:WritingParagraph;onRefresh:()=>Promise<void>;materials:ProjectMaterial[];register:(id:string,save:(()=>Promise<void>)|null)=>void;groups:WritingGroup[];siblings:WritingParagraph[]}) {
  const [title,setTitle] = useState(paragraph.title)
  const [text,setText] = useState(paragraph.draftText)
  const [selectedId,setSelectedId] = useState<string|null>(paragraph.versions.at(-1)?.id ?? null)
  const [busy,setBusy] = useState(false)
  const [message,setMessage] = useState('')
  const [error,setError] = useState('')
  const [feedback,setFeedback]=useState(()=>localStorage.getItem('singularity.writing.feedback.'+paragraph.id)??'')
  useEffect(()=>{try{localStorage.setItem('singularity.writing.feedback.'+paragraph.id,feedback)}catch{}},[feedback,paragraph.id])
  const saved = useRef({title:paragraph.title,text:paragraph.draftText})
  const latest = useRef({title,text})
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const saveArgument = useRef<()=>Promise<void>>(async()=>{})
  const registerArgument=useCallback((save:()=>Promise<void>)=>{saveArgument.current=save},[])
  useEffect(() => { latest.current = {title,text} },[title,text])
  useEffect(() => { setTitle(paragraph.title); setText(paragraph.draftText); saved.current = {title:paragraph.title,text:paragraph.draftText} },[paragraph.id,paragraph.currentVersionId])
  useEffect(() => { setSelectedId(paragraph.versions.at(-1)?.id ?? null) },[paragraph.versions.at(-1)?.id])
  useEffect(() => {
    const latestVersion = paragraph.versions.at(-1)
    if (latestVersion?.status === 'complete') setMessage((current) => current === '正在生成双语版本' ? '双语版本已生成，可对照并采纳' : current)
    if (latestVersion?.status === 'failed') setMessage('生成失败，请查看版本记录')
  },[paragraph.versions.at(-1)?.status])
  const save = useCallback(async () => {
    const draft = latest.current
    if (draft.title === saved.current.title && draft.text === saved.current.text) return
    const task = queue.current.then(() => window.singularity.writing.updateParagraph(paragraph.id,draft.title,draft.text))
    queue.current = task.catch(() => undefined)
    await task
    saved.current = draft
    setMessage('已保存到本地')
  },[paragraph.id])
  useEffect(()=>{register(paragraph.id,async()=>{await save();await saveArgument.current()});return()=>register(paragraph.id,null)},[paragraph.id,save,register])
  useEffect(() => { if (title === saved.current.title && text === saved.current.text) return; setMessage('正在编辑'); const timer = setTimeout(() => void save().catch((e) => setError(String(e))),600); return () => clearTimeout(timer) },[title,text,save])
  useEffect(() => () => { const draft = latest.current; if (draft.title !== saved.current.title || draft.text !== saved.current.text) void queue.current.then(() => window.singularity.writing.updateParagraph(paragraph.id,draft.title,draft.text)).catch(() => {}) },[paragraph.id])
  const generate = async (mode:ParagraphRequest['mode']='polish') => {
    setBusy(true); setError('')
    try { await save(); await saveArgument.current(); const version = await window.singularity.writing.generateParagraph(paragraph.id,{mode,feedback,baseVersionId:mode==='revise'?selected?.id:undefined}); setSelectedId(version.id); setMessage('正在生成双语版本'); await onRefresh() }
    catch(e) { setError(String(e)) } finally { setBusy(false) }
  }
  const accept = async (version:WritingParagraphVersion) => {
    setBusy(true); setError('')
    try { await save(); await window.singularity.writing.acceptParagraphVersion(version.id); setMessage('已采纳为当前段落，旧版本仍可对照'); await onRefresh() }
    catch(e) { setError(String(e)) } finally { setBusy(false) }
  }
  const selected = paragraph.versions.find((item) => item.id === selectedId) ?? paragraph.versions.at(-1)
  const before = selected?.parentVersionId ? paragraph.versions.find((item) => item.id === selected.parentVersionId)?.academicZh || selected.inputText : selected?.inputText ?? ''
  const running = paragraph.versions.some((item) => ['queued','running'].includes(item.status))
  const starred=!!paragraph.finalized&&text===paragraph.draftText
  const finalize=async()=>{setBusy(true);setError('');try{await save();if(!starred&&selected?.status==='complete'&&paragraph.currentVersionId!==selected.id)await window.singularity.writing.acceptParagraphVersion(selected.id);await window.singularity.writing.finalizeParagraph(paragraph.id,!starred);await onRefresh();setMessage(starred?'已取消定稿':'已标星定稿，可写入模板')}catch(e){setError(String(e))}finally{setBusy(false)}}
  const move=async(groupId:string|null,position?:number)=>{try{await save();await saveArgument.current();await window.singularity.writing.moveParagraph(paragraph.id,groupId,position);await onRefresh()}catch(e){setError(String(e))}}
  return <article className="paragraph-card" data-section={paragraph.section}>
    <div className="paragraph-card-head"><div><button className="paragraph-star" title={starred?'取消定稿':'采纳选定的中英版本并标星定稿'} aria-label={starred?'取消定稿':'标星定稿'} aria-pressed={starred} disabled={busy||running||(!starred&&selected?.status!=='complete')} onClick={()=>void finalize()}><Star size={19} fill={starred?'currentColor':'none'}/></button><span className="paragraph-number">{String(paragraph.position).padStart(2,'0')}</span><input aria-label={`段落 ${paragraph.position} 标题`} value={title} maxLength={120} onChange={(event) => { latest.current = {...latest.current,title:event.target.value}; setTitle(event.target.value) }} onBlur={() => void save().catch((e) => setError(String(e)))}/></div><span role="status">{message}</span></div>
    <div className="paragraph-placement"><label>所属分组 <select aria-label="段落所属分组" value={paragraph.groupId??''} onChange={e=>void move(e.target.value||null)}><option value="">章节直属 / 未分组</option>{groups.map(g=><option key={g.id} value={g.id}>{g.title}</option>)}</select></label><button title="上移段落" aria-label="上移段落" disabled={siblings[0]?.id===paragraph.id} onClick={()=>void move(paragraph.groupId??null,siblings.findIndex(p=>p.id===paragraph.id))}><ArrowUp size={13}/></button><button title="下移段落" aria-label="下移段落" disabled={siblings.at(-1)?.id===paragraph.id} onClick={()=>void move(paragraph.groupId??null,siblings.findIndex(p=>p.id===paragraph.id)+2)}><ArrowDown size={13}/></button></div>
    <ArgumentPanel paragraphId={paragraph.id} materials={materials} register={registerArgument}/>
    <div className="paragraph-input"><label htmlFor={`paragraph-${paragraph.id}`}>你的想法或当前草稿</label><textarea id={`paragraph-${paragraph.id}`} aria-label={`段落 ${paragraph.position} 草稿`} value={text} onChange={(event) => { latest.current = {...latest.current,text:event.target.value}; setText(event.target.value) }} onBlur={() => void save().catch((e) => setError(String(e)))} placeholder="先用自己的话写一个论点，或在当前版本上继续修改…"/><div><span>{text.length} 字符 · 自动保存</span><button onClick={() => void save().catch((e) => setError(String(e)))}><Save size={14}/>保存</button><button className="primary" disabled={busy || running || !text.trim()} onClick={() => void generate()}><Sparkles size={14}/>{paragraph.currentVersionId ? '生成新版本' : '生成学术表达'}</button></div></div>
    {error && <p role="alert" className="inline-error">{error}</p>}
    <div className="paragraph-feedback"><label htmlFor={`feedback-${paragraph.id}`}>本段目标 / 修改要求</label><textarea id={`feedback-${paragraph.id}`} value={feedback} onChange={e=>setFeedback(e.target.value)} maxLength={8000} placeholder="让助手先拟写：说明这一段要表达什么。继续修改：指出哪里不合适、希望怎样调整。"/><div className="paragraph-feedback-actions"><span className="muted">每次生成保留独立中英版本，供你比较与采纳。</span><button disabled={busy||running||(!text.trim()&&!feedback.trim())} onClick={()=>void generate('draft')}><Sparkles size={14}/>帮我拟写</button><button disabled={busy||running||selected?.status!=='complete'||!feedback.trim()} onClick={()=>void generate('revise')}>按要求修改 V{selected?.number??'—'}</button></div></div>
    {paragraph.versions.length > 0 && <div className="paragraph-versions"><div className="paragraph-versions-label"><span className="section-label">版本记录</span><span>{paragraph.versions.length} 个版本</span></div><div className="paragraph-version-list">{paragraph.versions.map((version) => <button key={version.id} className={`paragraph-version-tile ${selected?.id === version.id ? 'selected' : ''}`} onClick={() => setSelectedId(version.id)}><span>V{version.number}</span><strong>{version.status === 'complete' ? version.changeNote || '学术改写' : version.status === 'failed' ? '生成失败' : '正在生成'}</strong>{paragraph.currentVersionId === version.id && <small>当前稿</small>}</button>)}</div></div>}
    {selected && <div className="paragraph-compare"><div className="paragraph-compare-head"><span className="section-label">V{selected.number} · 修改对照</span><span>{new Date(selected.createdAt).toLocaleString('zh-CN')}</span></div>{selected.feedback&&<p className="paragraph-version-feedback">本轮要求：{selected.feedback}</p>}<div className="paragraph-compare-grid"><section className="paragraph-before"><span>修改前{selected.parentVersionId?' · 基准版本':''}</span><p>{before}</p></section><section className="paragraph-after"><span>修改后 · 中英对照</span>{selected.status === 'complete' ? <><h4>中文</h4><p>{selected.academicZh}</p><h4>English</h4><p>{selected.academicEn || '旧版草稿未生成英文对照'}</p></> : <p>{selected.status === 'failed' ? selected.error : '正在生成，请稍候…'}</p>}</section></div><div className="paragraph-compare-foot"><span>{selected.changeNote}</span>{selected.status === 'complete' && selected.academicEn && paragraph.currentVersionId !== selected.id && <button className="primary" disabled={busy || text.trim() !== selected.inputText.trim()} onClick={() => void accept(selected)}><Check size={14}/>采纳这一版</button>}</div></div>}
  </article>
}
