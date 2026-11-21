import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { BookOpen, Plus, Check, Search, LoaderCircle, ExternalLink, X, ChevronDown, Network, Download, GitCompareArrows, MoreHorizontal, RefreshCw } from 'lucide-react'
import { researchDirections, researchMonthOptions, researchYearOptions, describeResearchWindow, type ResearchRequest, type ResearchRun, type ResearchCandidate, type ResearchRecommendation, type ResearchMode, type ResearchUpdateOptions } from '../shared/research-explorer'
import './research-explorer.css'
import { ResearchAction } from './ResearchAction'
import { springTo } from './spring'
import type { ResearchProject } from '../shared/knowledge'
import type { FieldSummary } from '../shared/field-knowledge'
import { FieldKnowledgePanel } from './FieldKnowledgePanel'

const working = (run?: ResearchRun) => !!run && ['planning', 'collecting', 'reading', 'analysing'].includes(run.status)
/* 系统开了「减少动态效果」时不跑放大/缩小，直接开合。 */
const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
const isoDay = (date: Date) => date.toISOString().slice(0, 10)
const todayIso = () => isoDay(new Date())
const monthsAgoIso = (months: number) => { const date = new Date(); date.setMonth(date.getMonth() - months); return isoDay(date) }
const monthLabel = (months: number) => months < 12 ? `近 ${months} 个月` : `近 ${months / 12} 年`
const defaults = (mode: ResearchMode): ResearchRequest => ({ mode: mode === 'recommend' ? mode : 'survey', topics: [], inspirations: [], publicationYears: 2, preprintMonths: 24, count: mode === 'recommend' ? 5 : 10 })
function TopicPicker({ label, hint, values, onChange, required = false }: { label: string; hint: string; values: string[]; onChange: (value: string[]) => void; required?: boolean }) {
  const [custom, setCustom] = useState(''), [error, setError] = useState('')
  const add = (value: string) => { const topic = value.trim(); if (!topic || values.includes(topic)) return; if (values.length >= 3 || topic.length > 120) { setError('最多 3 个主题，每项不超过 120 字'); return }; onChange([...values, topic]); setCustom(''); setError('') }
  return <fieldset className="research-topics"><legend>{label}{required && <span> · 必选</span>}</legend>{hint && <p>{hint}</p>}
    <div className="research-selected-topics">{values.map(topic => <button key={topic} type="button" onClick={() => onChange(values.filter(t => t !== topic))} aria-label={`移除 ${topic}`}>{topic}<X size={12}/></button>)}</div>
    <div className="research-topic-presets">{researchDirections.filter(t => !values.includes(t)).map(topic => <button key={topic} type="button" disabled={values.length >= 3} onClick={() => add(topic)}><Plus size={12}/>{topic}</button>)}</div>
    <div className="research-custom-topic"><input aria-label={`自定义${label}`} placeholder="输入更具体的方向，例如：视觉语言模型的异常解释" maxLength={120} value={custom} onChange={e => setCustom(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(custom) } }}/><ResearchAction label="添加自定义主题" disabled={!custom.trim() || values.length >= 3} onClick={() => add(custom)}><Plus/></ResearchAction></div>{error && <small role="alert">{error}</small>}
  </fieldset>
}
export function ResearchExplorer(_props: { currentProjectId?: string | null; onProject?: (id: string) => void } = {}) {
  const [view,setView] = useState<'search'|'knowledge'>('search'), [fields,setFields] = useState<FieldSummary[]>([]), [fieldId,setFieldId] = useState(''), [fieldTab,setFieldTab] = useState<'document'|'delta'>('document')
  const [projects, setProjects] = useState<ResearchProject[]>([])
  const [mode, setMode] = useState<ResearchMode>('recommend'), [draft, setDraft] = useState(defaults('recommend'))
  const [customWindow, setCustomWindow] = useState(false)
  const [runs, setRuns] = useState<ResearchRun[]>([]), [selected, setSelected] = useState(''), [configuring, setConfiguring] = useState(false)
  const [error, setError] = useState(''), [starting, setStarting] = useState(false), [filter, setFilter] = useState('all')
  const [importing, setImporting] = useState<string[]>([]), [importErrors, setImportErrors] = useState<Record<string, string>>({}), [bulkImporting, setBulkImporting] = useState(false)
  const [historyMenu, setHistoryMenu] = useState(false), [deletingRun, setDeletingRun] = useState(false)
  const [updateOpen, setUpdateOpen] = useState(false), [updateSpan, setUpdateSpan] = useState<'1' | '3' | '6' | '12' | '24' | 'custom'>('1')
  const [updateFrom, setUpdateFrom] = useState(''), [updateTo, setUpdateTo] = useState(todayIso()), [updateCount, setUpdateCount] = useState<ResearchUpdateOptions['count']>(5), [updating, setUpdating] = useState(false)
  const configRef = useRef<HTMLFormElement>(null), historyRef = useRef<HTMLDivElement>(null), updateRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!updateOpen) return
    const close = (event: PointerEvent) => { if (!updateRef.current?.contains(event.target as Node)) setUpdateOpen(false) }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [updateOpen])
  useEffect(() => {
    if (!historyMenu) return
    const close = (event: PointerEvent) => { if (!historyRef.current?.contains(event.target as Node)) setHistoryMenu(false) }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [historyMenu])
  useEffect(() => { let active = true; if (window.singularity.knowledge?.projects) void window.singularity.knowledge.projects().then(items => { if (active) setProjects(items) }).catch(e => { if (active) setError(String(e)) }); return () => { active = false } }, [])
  useEffect(() => { let active = true; const reload = async () => { try { const next = await window.singularity.research.explorations(); if (active) setRuns(next) } catch (e) { if (active) setError(String(e)) } }; void reload(); const timer = setInterval(() => void reload(), 2000); return () => { active = false; clearInterval(timer) } }, [])
  useEffect(() => { if (!window.singularity.research.fields) return; let active=true; const reload=async()=>{try{const next=await window.singularity.research.fields();if(active)setFields(next)}catch(e){if(active)setError(String(e))}};void reload();const timer=setInterval(()=>void reload(),4000);return()=>{active=false;clearInterval(timer)} },[view])
  const history = runs, run = history.find(item => item.id === selected) ?? history[0]
  const running = runs.some(working)
  const deleteRun = async () => {
    if (!run) return
    setHistoryMenu(false)
    const label = `${new Date(run.createdAt).toLocaleString('zh-CN')} · ${run.request.topics.join(' / ')} · ${run.items.length} 篇`
    if (!window.confirm(`删除这条梳理记录？\n\n${label}\n\n已加入论文库的论文和已积累的领域知识会保留。`)) return
    setDeletingRun(true); setError('')
    try {
      await window.singularity.research.deleteExploration(run.id)
      const next = await window.singularity.research.explorations()
      setRuns(next); setSelected(''); setFilter('all')
    } catch (e) { setError(String(e)) } finally { setDeletingRun(false) }
  }
  const submitUpdate = async () => {
    if (!run) return
    const dateTo = updateSpan === 'custom' ? updateTo : todayIso()
    const dateFrom = updateSpan === 'custom' ? updateFrom : monthsAgoIso(Number(updateSpan))
    if (!dateFrom || !dateTo) { setError('请选择完整的开始与结束日期'); return }
    if (dateFrom > dateTo) { setError('更新时间范围的开始日期不能晚于结束日期'); return }
    setUpdating(true); setError('')
    try {
      const next = await window.singularity.research.updateExploration(run.id, { dateFrom, dateTo, count: updateCount })
      setRuns(previous => previous.map(item => item.id === next.id ? next : item)); setSelected(next.id); setUpdateOpen(false)
    } catch (e) { setError(String(e)) } finally { setUpdating(false) }
  }
  const configure = (next: ResearchMode) => { const previous = defaults(next); setMode(next); setSelected(''); setFilter('all'); setDraft(previous); setCustomWindow(false); setConfiguring(true); setError('') }
  // One explicit window governs both indexes, so choosing 自定义 in either select flips both.
  const useCustomWindow = () => { setCustomWindow(true); setDraft(draft => ({ ...draft, dateFrom: draft.dateFrom ?? monthsAgoIso(24), dateTo: draft.dateTo ?? todayIso() })) }
  const usePresetWindow = (key: 'publicationYears' | 'preprintMonths', value: number) => { setCustomWindow(false); setDraft(draft => ({ ...draft, [key]: value, dateFrom: undefined, dateTo: undefined })) }
  const start = async (request: ResearchRequest = draft) => { setStarting(true); setError(''); setDraft(request); try { const next = await window.singularity.research.explore({ ...request, projectId: undefined }); setRuns(previous => [next, ...previous]); setSelected(next.id); setConfiguring(false) } catch (e) { setError(String(e)) } finally { setStarting(false) } }
  const importPaper = async (sourceId: string) => { if (!run) return; const id = run.id, key = `${id}:${sourceId}`; setImporting(v => [...v, key]); setImportErrors(v => ({ ...v, [key]: '' })); try { const paper = await window.singularity.research.importExploration(id, sourceId); if (run.request.projectId) setProjects(v => v.map(project => project.id !== run.request.projectId ? project : { ...project, paperIds: [...new Set([...(project.paperIds ?? []), paper.id])] })); setRuns(v => v.map(r => r.id !== id ? r : { ...r, items: r.items.map(item => item.sourceId !== sourceId ? item : { ...item, libraryId: paper.id }) })) } catch (e) { setImportErrors(v => ({ ...v, [key]: String(e) })) } finally { setImporting(v => v.filter(k => k !== key)) } }
  const importAll = async () => { if (!run || bulkImporting) return; setBulkImporting(true); try { for (const item of run.items.filter(item => !item.libraryId)) await importPaper(item.sourceId) } finally { setBulkImporting(false) } }
  const shown = run?.items.filter(item => { const s = run.sources.find(s => s.id === item.sourceId); return filter === 'all' || s?.roles.includes(filter as 'core' | 'inspiration') }) ?? []
  if (view==='knowledge') return <FieldKnowledgePanel initialId={fieldId} initialTab={fieldTab} onBack={()=>setView('search')} onSearch={(field, options)=>{const years=options?.publicationYears??2; const request: ResearchRequest={mode:'survey',topics:[field.title],inspirations:[],publicationYears:years,preprintMonths:years<=1?12:years<=2?24:60,count:options?.count??10,fieldId:field.id,...(options?.dateFrom&&options.dateTo?{dateFrom:options.dateFrom,dateTo:options.dateTo}:{}),...(options?.delta?{delta:true}:{})};setFieldId(field.id);setFieldTab(options?.delta?'delta':'document');setView('search');setMode('survey');setSelected('');setFilter('all');setCustomWindow(!!request.dateFrom);void start(request)}}/>
  return <section className="research-explorer" aria-label="主题论文研究">
    <div className="research-entry-grid">
      <button title="按时间梳理发展，再推荐论文并提取局限" className={mode === 'survey' ? 'research-entry selected' : 'research-entry'} onClick={() => configure('survey')}><BookOpen size={23}/><span><strong>梳理领域</strong></span><Plus size={17}/></button>
    </div>
    {configuring && <form ref={configRef} className="research-config" onSubmit={e => { e.preventDefault(); void start() }}>
      <div className="research-section-heading"><h2>领域、时间、推荐篇数</h2><ResearchAction label="收起研究设置" onClick={() => setConfiguring(false)}><X/></ResearchAction></div>
      <TopicPicker label="核心领域" hint="" required values={draft.topics} onChange={topics => setDraft({ ...draft, topics })}/>
      <div className="research-options"><label>顶会顶刊时间<select value={customWindow ? 'custom' : draft.publicationYears} onChange={e => { const value = e.target.value; if (value === 'custom') useCustomWindow(); else usePresetWindow('publicationYears', Number(value)) }}>{researchYearOptions.map(years => <option key={years} value={years}>近 {years} 年</option>)}<option value="custom">自定义</option></select></label><label>arXiv 时间<select value={customWindow ? 'custom' : draft.preprintMonths} onChange={e => { const value = e.target.value; if (value === 'custom') useCustomWindow(); else usePresetWindow('preprintMonths', Number(value)) }}>{researchMonthOptions.map(months => <option key={months} value={months}>{monthLabel(months)}</option>)}<option value="custom">自定义</option></select></label>{customWindow && <><label>开始日期<input type="date" aria-label="自定义时间范围开始日期" value={draft.dateFrom ?? ''} max={draft.dateTo || todayIso()} onChange={e => setDraft({ ...draft, dateFrom: e.target.value })}/></label><label>结束日期<input type="date" aria-label="自定义时间范围结束日期" value={draft.dateTo ?? ''} min={draft.dateFrom} max={todayIso()} onChange={e => setDraft({ ...draft, dateTo: e.target.value })}/></label></>}<label>推荐<select aria-label="推荐论文数量" value={draft.count} onChange={e => setDraft({ ...draft, count: Number(e.target.value) as ResearchRequest['count'] })}>{[5, 10, 15, 20].map(count => <option key={count} value={count}>{count} 篇</option>)}</select></label></div>
      <label className="research-field-target">写入领域<select aria-label="检索积累到领域知识库" value={draft.fieldId??''} onChange={e=>setDraft({...draft,fieldId:e.target.value||undefined})}><option value="">不写入领域</option>{fields.map(f=><option key={f.id} value={f.id}>{f.title}</option>)}</select></label>
      <footer><button className="primary" type="submit" disabled={starting || running || !draft.topics.length || customWindow && (!draft.dateFrom || !draft.dateTo)}><Search size={16}/>{starting ? '正在创建…' : '开始梳理'}</button></footer>
    </form>}
    {error && <p className="inline-error" role="alert">{error}</p>}
    {history.length > 0 && <div className="research-history"><div className="research-history-control" ref={historyRef}>
      <select aria-label="研究历史" value={run?.id ?? ''} onChange={e => { setSelected(e.target.value); setMode(history.find(item => item.id === e.target.value)?.request.mode ?? 'survey'); setFilter('all') }}>{history.map(r => <option key={r.id} value={r.id}>{new Date(r.createdAt).toLocaleString('zh-CN')} · {r.request.topics.join(' / ')} · {r.items.length} 篇</option>)}</select>
      <button type="button" className="research-history-more" aria-label="梳理记录操作" aria-haspopup="menu" aria-expanded={historyMenu} disabled={deletingRun} onClick={() => setHistoryMenu(open => !open)}><MoreHorizontal size={17}/></button>
      {historyMenu && <div className="research-history-menu" role="menu"><button type="button" role="menuitem" disabled={deletingRun || working(run)} title={working(run) ? '任务进行中，请先取消' : undefined} onClick={() => void deleteRun()}>{deletingRun ? '正在删除…' : '删除这条梳理记录'}</button></div>}
    </div></div>}
    {run && <div className="research-results">
      <div className="research-run-toolbar">
        {run.items.length>0&&<ResearchAction label="查看本领域的积累与图谱" onClick={()=>{setFieldId(run.request.fieldId??fields.find(f=>f.title===run.request.topics[0])?.id??'');setView('knowledge')}}><Network/></ResearchAction>}
        {run.request.delta&&!working(run)&&<ResearchAction label="查看 Delta 对比" onClick={()=>{setFieldId(run.request.fieldId??fields.find(f=>f.title===run.request.topics[0])?.id??'');setFieldTab('delta');setView('knowledge')}}><GitCompareArrows/></ResearchAction>}
        <div className="research-update" ref={updateRef}>
          <button type="button" className="research-update-trigger" aria-haspopup="true" aria-expanded={updateOpen} disabled={working(run) || updating} onClick={() => setUpdateOpen(open => !open)}><RefreshCw size={14}/>{updating ? '正在更新…' : '更新领域'}</button>
          {updateOpen && <form className="research-update-panel" onSubmit={e => { e.preventDefault(); void submitUpdate() }}>
            <label>时间范围<select aria-label="更新时间范围" value={updateSpan} onChange={e => setUpdateSpan(e.target.value as typeof updateSpan)}><option value="1">近 1 个月</option><option value="3">近 3 个月</option><option value="6">近 6 个月</option><option value="12">近 1 年</option><option value="24">近 2 年</option><option value="custom">自定义</option></select></label>
            {updateSpan === 'custom' && <div className="research-update-dates"><label>开始<input type="date" aria-label="更新开始日期" value={updateFrom} max={updateTo || todayIso()} onChange={e => setUpdateFrom(e.target.value)}/></label><label>结束<input type="date" aria-label="更新结束日期" value={updateTo} min={updateFrom} max={todayIso()} onChange={e => setUpdateTo(e.target.value)}/></label></div>}
            <label>新增论文<select aria-label="更新论文数量" value={updateCount} onChange={e => setUpdateCount(Number(e.target.value) as ResearchUpdateOptions['count'])}>{[5, 10, 15, 20].map(count => <option key={count} value={count}>{count} 篇</option>)}</select></label>
            <footer><button className="primary" type="submit" disabled={updating || updateSpan === 'custom' && (!updateFrom || !updateTo)}>{updating ? '正在更新…' : '开始更新'}</button></footer>
          </form>}
        </div>
      </div>
      <div className="research-run-heading"><div><h2>{run.request.topics.join(' · ')}</h2><small>{run.request.inspirations.length ? `思路来源：${run.request.inspirations.join(' · ')} · ` : ''}{describeResearchWindow(run.request)}</small></div><span className={`research-run-status ${working(run) ? 'working' : ''}`} role="status">{working(run) && <LoaderCircle size={15}/>}{run.progress}</span>{!working(run) && run.items.some(item => !item.libraryId) && <button type="button" className="research-import-all" disabled={bulkImporting} onClick={() => void importAll()}>{bulkImporting ? <LoaderCircle size={14} className="is-spinning"/> : <Download size={14}/>}{bulkImporting ? '正在加入论文库…' : `全部加入论文库 · ${run.items.filter(item => !item.libraryId).length}`}</button>}{working(run) && <ResearchAction label="取消任务" onClick={() => void window.singularity.research.cancelExploration(run.id).catch(e => setError(String(e)))}><X/></ResearchAction>}</div>
      {run.error && <p className="inline-error" role="alert">{run.error}<button disabled={running} onClick={() => { setDraft(run.request); setConfiguring(true); requestAnimationFrame(() => configRef.current?.scrollIntoView({ block: 'start' })) }}>调整后重试</button></p>}
      {run.overview && <section className="research-overview"><h3>发展</h3><p>{run.overview}</p></section>}
      {run.warnings.length > 0 && <details className="research-source-notes"><summary>来源与覆盖说明 · {run.warnings.length}<ChevronDown size={13}/></summary>{run.warnings.map((warning, i) => <p key={i}>{warning}</p>)}</details>}
      {run.request.inspirations.length > 0 && <div className="research-filter" aria-label="筛选研究关联">{[['all', '全部'], ['core', '核心领域'], ['inspiration', '思路来源']].map(([value, label]) => <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}</div>}
      {(run.request.mode === 'survey' ? ['published', 'preprint'] : ['all']).map(group => {
        const items = shown.filter(item => group === 'all' || run.sources.find(s => s.id === item.sourceId)?.group === group)
        return <section key={group} className="research-paper-group"><div className="research-section-heading"><h3>{group === 'published' ? '顶会顶刊' : group === 'preprint' ? 'arXiv 最新研究' : '推荐'} <span>{items.length} 篇</span></h3></div>{!items.length ? <p className="research-group-empty">{working(run) ? '正在采集、阅读和核验，论文卡片会陆续显示。' : '当前范围没有可核验的匹配论文，可调整主题或时间窗口。'}</p> : <div className="research-paper-grid">{items.map(item => { const source = run.sources.find(s => s.id === item.sourceId)!; const key = `${run.id}:${item.sourceId}`; return <ResearchPaper key={item.sourceId} source={source} item={item} projectLinked={run.request.projectId ? !!projects.find(p => p.id === run.request.projectId)?.paperIds?.includes(item.libraryId ?? "") : undefined} busy={importing.includes(key)} error={importErrors[key]} onImport={() => void importPaper(item.sourceId)} onOpen={url => void window.singularity.research.openSource(url).catch(e => setError(String(e)))}/> })}</div>}</section>
      })}
      {run.bottlenecks && <section className="research-overview"><h3>局限</h3><p>{run.bottlenecks}</p></section>}
      {!run.bottlenecks && run.insights.length > 0 && <section className="research-insights"><h3>局限</h3><ol>{run.insights.map((insight, i) => <li key={i}>{insight}</li>)}</ol></section>}
    </div>}
  </section>
}
/* 卡片在网格里原地展开：宽度撑满整行（等于原来那几列的合计），高度随内容变长，
   同组的其它卡片顺次排到底下去。动效走 FLIP：展开前量一遍矩形，状态换完再量一遍，
   把自己反向摆回旧矩形，再交给刚度 200 / 阻尼 14 的弹簧弹回 1:1（会冲过一点再回来）；
   其它卡片按各自的位移差跟着弹，整组一起落定。 */
function ResearchPaper({ source, item, busy, error, projectLinked, onImport, onOpen }: { source: ResearchCandidate; item: ResearchRecommendation; busy: boolean; error?: string; projectLinked?: boolean; onImport: () => void; onOpen: (url: string) => void }) {
  const label = { substantive: '实质性贡献', incremental: '增量工作', uncertain: '贡献待核验' }[item.contribution]
  const card = useRef<HTMLElement>(null)
  const frames = useRef<{ own: DOMRect; others: { el: HTMLElement; rect: DOMRect }[] } | null>(null)
  const stops = useRef(new Set<() => void>())
  const touched = useRef<HTMLElement[]>([])
  const ghost = useRef<HTMLElement | null>(null)
  const [open, setOpen] = useState(false)
  const measure = () => {
    const node = card.current
    if (!node || reducedMotion()) return null
    const grid = node.parentElement
    const others = grid ? Array.from(grid.querySelectorAll<HTMLElement>('.research-paper-card')).filter(el => el !== node).map(el => ({ el, rect: el.getBoundingClientRect() })) : []
    return { own: node.getBoundingClientRect(), others }
  }
  /* 清场：停掉在弹的通道、把残留样式收干净、丢掉收起用的克隆层。 */
  const interrupt = () => {
    const node = card.current
    const saved = measure()
    stops.current.forEach(stop => stop())
    stops.current.clear()
    touched.current.forEach(el => {
      el.style.transform = ''
      el.style.transformOrigin = ''
      el.style.transition = ''
      el.style.opacity = ''
      el.style.zIndex = ''
    })
    touched.current = []
    ghost.current?.remove()
    ghost.current = null
    if (node) { node.style.transform = ''; node.style.transition = ''; node.style.opacity = '' }
    return saved
  }
  /* 收起：把展开态整张卡片克隆一份钉在原位，弹簧缩到小卡片的位置再化掉，小卡片自己先透明等着。
     直接把小卡片放大到整行会变成一片巨大的字，所以这一步只能拿旧的展开态去缩。 */
  const collapse = () => {
    const node = card.current
    if (!node) return
    frames.current = stops.current.size > 0 ? interrupt() : measure()
    if (!reducedMotion()) {
      const rect = node.getBoundingClientRect()
      const clone = node.cloneNode(true) as HTMLElement
      clone.classList.add('is-ghost')
      clone.setAttribute('aria-hidden', 'true')
      clone.setAttribute('inert', '')
      Object.assign(clone.style, {
        position: 'fixed',
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
        margin: '0',
        boxSizing: 'border-box',
        transform: 'none',
        transformOrigin: 'top left',
        zIndex: '900',
        pointerEvents: 'none',
        overflow: 'hidden',
        willChange: 'transform',
      })
      document.body.appendChild(clone)
      ghost.current = clone
    }
    setOpen(false)
  }
  const toggle = (next: boolean) => {
    if (next === open) return
    if (next && document.activeElement instanceof HTMLElement) document.activeElement.blur()
    if (!next) { collapse(); return }
    frames.current = stops.current.size > 0 ? interrupt() : measure()
    setOpen(true)
  }
  useLayoutEffect(() => {
    const node = card.current
    const saved = frames.current
    frames.current = null
    if (!node || !saved) return
    const clone = ghost.current
    if (clone) {
      ghost.current = null
      const from = clone.getBoundingClientRect()
      const to = node.getBoundingClientRect()
      if (!from.width || !to.width) clone.remove()
      else {
        node.style.opacity = '0'
        const dx = to.left - from.left
        const dy = to.top - from.top
        const sx = to.width / from.width - 1
        const sy = to.height / from.height - 1
        let cancel: (() => void) | null = null
        let finished = false
        /* 缩到目标尺寸后还有一段微小的回弹，此时克隆层和小卡片几乎重合，
           提前交接掉，别让它顶着一团糊掉的文字在那儿弹。 */
        const finish = () => {
          if (finished || !clone.isConnected) return
          finished = true
          if (cancel) { cancel(); stops.current.delete(cancel) }
          /* 克隆层淡出、真实卡片同时淡入，中间不留空档。 */
          clone.style.transition = 'opacity 150ms ease'
          clone.style.opacity = '0'
          window.setTimeout(() => clone.remove(), 170)
          node.style.transition = 'opacity 150ms ease'
          node.style.opacity = '1'
          window.setTimeout(() => { node.style.transition = ''; node.style.opacity = '' }, 190)
        }
        cancel = springTo([0, 0, 0, 0], [dx, dy, sx, sy], [.4, .4, .0015, .0015], value => {
          clone.style.transform = `translate(${value[0]}px, ${value[1]}px) scale(${1 + value[2]}, ${1 + value[3]})`
        }, finish)
        stops.current.add(cancel)
        window.setTimeout(finish, 620)
      }
    } else {
      /* 展开：内容跟着卡片一起长大，像整张卡片本身被拉开。 */
      const own = node.getBoundingClientRect()
      if (own.width && own.height) {
        const dx = saved.own.left - own.left
        const dy = saved.own.top - own.top
        const sx = saved.own.width / own.width - 1
        const sy = saved.own.height / own.height - 1
        if (Math.abs(dx) > .5 || Math.abs(dy) > .5 || Math.abs(sx) > .004 || Math.abs(sy) > .004) {
          node.style.transformOrigin = 'top left'
          node.style.zIndex = '2'
          touched.current.push(node)
          let cancel: (() => void) | null = null
          cancel = springTo([dx, dy, sx, sy], [0, 0, 0, 0], [.4, .4, .0015, .0015], value => {
            node.style.transform = `translate(${value[0]}px, ${value[1]}px) scale(${1 + value[2]}, ${1 + value[3]})`
          }, () => {
            node.style.transform = ''
            node.style.transformOrigin = ''
            node.style.zIndex = ''
            touched.current = touched.current.filter(el => el !== node)
            if (cancel) stops.current.delete(cancel)
          })
          stops.current.add(cancel)
        }
      }
    }
    saved.others.forEach(({ el, rect }) => {
      const now = el.getBoundingClientRect()
      const dx = rect.left - now.left
      const dy = rect.top - now.top
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return
      touched.current.push(el)
      let cancel: (() => void) | null = null
      cancel = springTo([dx, dy], [0, 0], [.4, .4], value => {
        el.style.transform = `translate(${value[0]}px, ${value[1]}px)`
      }, () => {
        el.style.transform = ''
        touched.current = touched.current.filter(item => item !== el)
        if (cancel) stops.current.delete(cancel)
      })
      stops.current.add(cancel)
    })
  }, [open])
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') toggle(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])
  useEffect(() => () => {
    stops.current.forEach(stop => stop())
    stops.current.clear()
    ghost.current?.remove()
    ghost.current = null
  }, [])
  const meta = <div className="research-paper-meta"><BookOpen size={16}/><span>{source.venue}</span><time>{source.date.slice(0, 10)}</time></div>
  const tags = <div className="research-paper-tags"><span className={item.contribution}>{label}</span>{source.roles.includes('inspiration') && <span>思路来源</span>}<span>{source.evidenceKind === 'full-text' ? '已采集原文' : '仅摘要 · 待核验'}</span></div>
  const intro = <><h3>{source.title}</h3><p className="research-paper-summary">{item.summary}</p></>
  const detail = <><dl><dt>核心方法</dt><dd>{item.method}</dd><dt>数据集</dt><dd>{item.datasets}</dd><dt>基准与评估变化</dt><dd>{item.evaluation}</dd><dt>贡献判断</dt><dd>{item.contributionReason}</dd><dt>泄漏、复现与评估风险</dt><dd>{item.risks}</dd><dt>可借鉴思路</dt><dd>{item.transfer}</dd></dl>{item.evidence.length > 0 && <div className="research-paper-evidence"><strong>原文依据</strong>{item.evidence.map((e, i) => <blockquote key={i}><q>{e.quote}</q><p>{e.claim}</p></blockquote>)}</div>}{source.links?.map(url => <button className="text-action" key={url} onClick={() => onOpen(url)}><ExternalLink size={13}/>{url}</button>)}</>
  const actions = <footer><small title={source.authors}>{source.authors || '作者详见原文'}</small><ResearchAction label={`打开 ${source.title}`} onClick={() => onOpen(source.url)}><ExternalLink/></ResearchAction><ResearchAction disabled={busy || !!item.libraryId && projectLinked !== false} onClick={onImport} label={busy ? '下载中…' : item.libraryId ? projectLinked === false ? '加入此项目' : projectLinked ? '已在项目' : '已在论文库' : '下载并加入论文库'}>{busy ? <LoaderCircle className="is-spinning"/> : item.libraryId ? <Check/> : <Download/>}</ResearchAction></footer>
  return <article className={`research-paper-card${open ? ' expanded' : ''}`} ref={card}>
    {meta}{intro}{tags}
    <div className="research-paper-detail-row">
      <span className="research-paper-detail-label">方法、数据与评估</span>
      <button type="button" className={`research-paper-toggle${open ? ' open' : ''}`} aria-expanded={open} aria-label={open ? '收起方法与评估' : '展开方法与评估'} onClick={() => toggle(!open)}><ChevronDown size={15}/></button>
    </div>
    {open && <div className="research-paper-detail">{detail}</div>}
    {actions}
    {error && <p className="research-import-error" role="alert">{error}</p>}
  </article>
}
