import { useCallback, useEffect, useState } from 'react'
import { AudioLines, FlaskConical, PanelLeft, Plus, Trash2 } from 'lucide-react'
import { natureLabels, type ProjectMaterial, type ResearchProject, type SourceBlock } from '../shared/knowledge'
import type { PaperRecord } from '../shared/types'
import './knowledge.css'
import { ProjectLifecycle } from './ProjectLifecycle'
import { ProjectChat } from './ProjectChat'

const categories = { related: '相关工作', method: '方法依据', experiment: '实验依据', note: '研究笔记' }
const tabs = [
  { id: 'chat', label: '项目对话' },
  { id: 'process', label: '研究过程' },
  { id: 'papers', label: '关联论文' },
  { id: 'materials', label: '项目材料' },
] as const
type ProjectTab = (typeof tabs)[number]['id']

export function ResearchProjects({ currentId, onSelect, onOpen, onVoice, onDiscover, onWriting, onAssistant }: { currentId: string | null; onSelect: (id: string) => void; onOpen: (paperId: string, sourceId?: string) => void; onVoice: () => void; onDiscover: () => void; onWriting: (id: string) => void; onAssistant: () => void }) {
  const [projects, setProjects] = useState<ResearchProject[]>([]), [papers, setPapers] = useState<PaperRecord[]>([])
  const [materials, setMaterials] = useState<ProjectMaterial[]>([]), [editing, setEditing] = useState(false), [creating, setCreating] = useState(false)
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [category, setCategory] = useState('')
  const [paperId, setPaperId] = useState(''), [sources, setSources] = useState<SourceBlock[]>([]), [sourceId, setSourceId] = useState(''), [materialCategory, setMaterialCategory] = useState<ProjectMaterial['category']>('related')
  const [selectedPapers, setSelectedPapers] = useState<string[]>([]), [tab, setTab] = useState<ProjectTab>('chat'), [listOpen, setListOpen] = useState(true)
  const project = projects.find((item) => item.id === currentId)
  const reload = useCallback(async () => { const [items, library] = await Promise.all([window.singularity.knowledge.projects(), window.singularity.papers.list()]); setProjects(items); setPapers(library); if (!currentId && items[0]) onSelect(items[0].id) }, [currentId, onSelect])
  useEffect(() => { void reload().catch((e) => setError(String(e))) }, [reload])
  useEffect(() => { setMaterials([]); setEditing(false); setSourceId(''); setPaperId(''); setTab('chat'); if (currentId) void window.singularity.knowledge.materials(currentId).then(setMaterials).catch((e) => setError(String(e))) }, [currentId])
  useEffect(() => { let live = true; setSources([]); setSourceId(''); if (paperId) void window.singularity.knowledge.sources(paperId).then((items) => { if (live) setSources(items) }).catch((e) => { if (live) setError(String(e)) }); return () => { live = false } }, [paperId])
  const perform = async (operation: () => Promise<unknown>) => { setBusy(true); setError(''); try { await operation(); await reload(); if (currentId) setMaterials(await window.singularity.knowledge.materials(currentId)) } catch (e) { setError(String(e)) } finally { setBusy(false) } }
  const save = async (form: HTMLFormElement, id?: string) => {
    const data = new FormData(form)
    await perform(async () => {
      const value = await window.singularity.knowledge.saveProject({
        id,
        title: String(data.get('title')),
        topic: String(data.get('topic') ?? ''),
        direction: String(data.get('direction') ?? ''),
        question: String(data.get('question')),
        paperIds: id ? undefined : selectedPapers,
      })
      onSelect(value.id); setCreating(false); setEditing(false); setSelectedPapers([])
    })
  }
  const form = (id?: string) => <form className="research-project-form" key={id ?? 'new'} onSubmit={(event) => { event.preventDefault(); void save(event.currentTarget, id) }}>
    <label>项目名称<input name="title" aria-label="研究项目名称" defaultValue={id ? project?.title : ''} required maxLength={300} placeholder="例如：让多模态推理真正利用视觉信息" /></label>
    <label>研究主题<input name="topic" aria-label="研究主题" defaultValue={id ? project?.topic : ''} maxLength={300} placeholder="所属领域，例如：异常检测 / 医学图像异常检测" /></label>
    <label>研究方向<textarea name="direction" aria-label="研究方向" defaultValue={id ? project?.direction : ''} rows={2} maxLength={2000} placeholder="进一步具体推进的子方向或技术路线，例如：零样本设定下的细粒度异常定位、视觉-语言对齐与可解释性" /></label>
    <label>研究重点 · 想解决什么问题<textarea name="question" aria-label="研究重点" defaultValue={id ? project?.question : ''} rows={3} maxLength={6000} placeholder="例如：现有方法对局部微小异常定位不稳，且缺少可核查的像素级证据；希望找到能稳定泛化到新类别的方案。" /></label>
    {!id && <div className="research-project-picker"><small>关联论文</small>{papers.length ? <div className="research-project-picker-list">{papers.map((paper) => <label key={paper.id}><input type="checkbox" checked={selectedPapers.includes(paper.id)} onChange={(event) => setSelectedPapers(event.target.checked ? [...selectedPapers, paper.id] : selectedPapers.filter((value) => value !== paper.id))} /><span title={paper.title}>{paper.title}</span></label>)}</div> : <small>论文库还是空的，创建后再关联。</small>}<small className="muted">已选 {selectedPapers.length} 篇。对话可以查阅原文，之后也能改。</small></div>}
    <small className="project-form-hint">保存后，在对话里点「同步设定」，助手才会按新的主题、方向和重点继续。</small>
    <div><button className="primary" disabled={busy}>保存项目</button> <button type="button" onClick={() => { setCreating(false); setEditing(false); setSelectedPapers([]) }}>取消</button></div>
  </form>
  return <section className="page research-project-page"><div className="page-header"><div><h1>研究项目</h1><p className="research-project-purpose">用来想创新点：缺口、最小实验、为什么现在值得做。</p></div><div className="header-actions"><button className="primary" onClick={() => { setSelectedPapers([]); setCreating(!creating) }}><Plus size={15} />新建研究项目</button></div></div>
    {error && <p role="alert" className="inline-error">{error}</p>}{creating && form()}
    {!projects.length && !creating && <div className="empty-state"><FlaskConical size={28} /><h3>从一个问题里长出创新点</h3><p>和 DeepSeek 对着关联论文，找还没被做完、而且能被实验证伪的点。</p><button onClick={() => setCreating(true)}>创建研究项目</button></div>}
    <div className={`research-project-layout${listOpen ? '' : ' projects-hidden'}`}><div className="research-project-rail"><button type="button" className="project-list-toggle" aria-pressed={listOpen} aria-label={listOpen ? '隐藏项目列表' : '显示项目列表'} onClick={() => setListOpen(open => !open)}><PanelLeft size={15} /></button><aside className="research-project-list">{projects.map((item) => <button className={currentId === item.id ? 'active' : ''} key={item.id} onClick={() => onSelect(item.id)}>{item.title}</button>)}</aside></div>{project && <div className="research-project-main">
      <div className="writing-project-heading"><div><h2>{project.title}</h2><dl className="project-brief" aria-label="项目设定"><div><dt>研究主题</dt><dd className={project.topic ? '' : 'muted'}>{project.topic || '尚未设定'}</dd></div><div><dt>研究方向</dt><dd className={project.direction ? '' : 'muted'}>{project.direction || '尚未设定'}</dd></div><div><dt>研究重点</dt><dd className={project.question ? '' : 'muted'}>{project.question || '尚未设定'}</dd></div></dl></div><div><button onClick={() => setEditing(!editing)}>编辑项目设定</button> <button onClick={onVoice}><AudioLines size={15} />语音讨论</button></div></div>{editing && form(project.id)}
      <div className="project-tab-bar" role="tablist" aria-label="项目内容">{tabs.map((item) => <button key={item.id} role="tab" aria-selected={tab === item.id} className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)}>{item.label}{item.id === 'papers' ? ` ${project.paperIds.length}` : item.id === 'materials' ? ` ${materials.length}` : ''}</button>)}</div>
      <div className="research-project-stage">
      {tab === 'chat' && <ProjectChat project={project} library={papers.filter((paper) => !paper.missing).map((paper) => ({ id: paper.id, title: paper.title }))} linkedPapers={papers.filter((paper) => project.paperIds.includes(paper.id)).map((paper) => ({ id: paper.id, title: paper.title }))} onTogglePaper={(paperId, included) => perform(() => window.singularity.knowledge.setProjectPaper(project.id, paperId, included))} />}
      {tab === 'process' && <ProjectLifecycle key={project.id} project={project} onVoice={onVoice} onDiscover={onDiscover} onWriting={onWriting} onAssistant={onAssistant}/>}
      {tab === 'papers' && <div className="project-paper-list">{papers.map((paper) => <div className="project-paper-row" key={paper.id}><label><input type="checkbox" disabled={busy} checked={project.paperIds.includes(paper.id)} onChange={(event) => void perform(() => window.singularity.knowledge.setProjectPaper(project.id, paper.id, event.target.checked))} /> {paper.title}</label><button disabled={paper.missing} onClick={() => onOpen(paper.id)}>阅读</button></div>)}{!papers.length && <p className="muted">论文库还是空的。</p>}</div>}
      {tab === 'materials' && <>
      <p className="muted">材料记下当时的原文，之后改论文不会覆盖这里。</p><select aria-label="项目材料来源论文" value={paperId} onChange={(event) => setPaperId(event.target.value)}><option value="">选择论文…</option>{papers.filter((item) => !item.missing).map((paper) => <option key={paper.id} value={paper.id}>{paper.title}</option>)}</select><select aria-label="项目材料来源块" value={sourceId} onChange={(event) => setSourceId(event.target.value)}><option value="">选择原文段落 / 图表 / 引用…</option>{sources.map((source) => <option key={source.id} value={source.id}>{source.label} · p.{source.parts[0].page} · {source.text.slice(0, 65)}</option>)}</select><div className="knowledge-form-row"><select aria-label="项目材料分类" value={materialCategory} onChange={(event) => setMaterialCategory(event.target.value as ProjectMaterial['category'])}>{Object.entries(categories).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><button className="primary" disabled={!sourceId || busy} onClick={() => void perform(() => window.singularity.knowledge.addMaterial({ projectId: project.id, paperId, sourceId, category: materialCategory }))}>加入材料</button></div>
      <div className="source-filter"><button className={!category ? 'active' : ''} onClick={() => setCategory('')}>全部材料 · {materials.length}</button>{Object.entries(categories).map(([key, label]) => <button key={key} className={category === key ? 'active' : ''} onClick={() => setCategory(key)}>{label}</button>)}</div>
      <div className="project-material-grid">{materials.filter((item) => !category || item.category === category).map((item) => <article className="project-material" key={item.id}><small>{categories[item.category]} · {natureLabels[item.nature]}</small><h3>{item.title}</h3><small>{papers.find((paper) => paper.id === item.paperId)?.title ?? '来源论文暂不可用'}</small><p>{item.content.replace(/\[src:[^\]]+\]/g, '')}</p><div className="card-provenance">{item.sourceIds.map((id, index) => <button key={id} title={id} onClick={() => onOpen(item.paperId, id)}>原文 {index + 1}</button>)}{!item.sourceIds.length && <small>未关联原文：不作为已核实的论文依据。</small>}<button disabled={busy} aria-label="移除项目材料" onClick={() => void perform(() => window.singularity.knowledge.removeMaterial(item.id))}><Trash2 size={12} /></button></div></article>)}</div>
      {!materials.length && <p className="muted">从关联论文里收第一条证据，或在阅读页写下自己的推演。</p>}
      </>}
      </div>
    </div>}</div>
  </section>
}
