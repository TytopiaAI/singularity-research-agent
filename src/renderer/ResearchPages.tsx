import { useEffect, useState } from 'react'
import { RefreshCw, ExternalLink, Check, BookOpen, Github, Landmark, Info, LoaderCircle, RotateCcw, Download, Maximize2 } from 'lucide-react'
import type { DigestIssue, DigestKind, DiscoveryFeed, DiscoveryItem } from '../shared/types'
import { ResearchExplorer } from './ResearchExplorer'
import { DigestNewsCards } from './DigestNewsCards'
import { ResearchAction } from './ResearchAction'
import { beijingDay } from '../shared/digest'
import { MessageSubscriptions } from './MessageSubscriptions'

export function DigestPage({ kind, currentProjectId, onProject }: { kind: DigestKind; currentProjectId?: string | null; onProject?: (id: string) => void }) {
  return kind==='news'?<MessageSubscriptions/>:<LegacyDigestPage kind={kind} currentProjectId={currentProjectId} onProject={onProject}/>
}
function LegacyDigestPage({ kind, currentProjectId, onProject }: { kind: DigestKind; currentProjectId?: string | null; onProject?: (id: string) => void }) {
  const [issues,setIssues]=useState<DigestIssue[]>([])
  const [selected,setSelected]=useState('')
  const [error,setError]=useState('')
  const [expanded,setExpanded]=useState<string[]>([])
  const [busy,setBusy]=useState(false)
  const [notice,setNotice]=useState('')
  const [discovery,setDiscovery]=useState<DiscoveryFeed|null>(null)
  const [discoveryBusy,setDiscoveryBusy]=useState(false)
  const reload=async()=>setIssues(await window.singularity.research.list(kind))
  useEffect(()=>{ let active=true; const update=()=>window.singularity.research.list(kind).then((v)=>{if(active)setIssues(v)}).catch((e)=>{if(active)setError(String(e))}); void update(); const timer=setInterval(()=>void update(),2000); return()=>{active=false;clearInterval(timer)} },[kind])
  useEffect(()=>{if(kind!=='papers')return;let active=true;void window.singularity.research.discovery().then((feed)=>{if(active)setDiscovery(feed)}).catch((e)=>{if(active)setError(String(e))});return()=>{active=false}},[kind])
  const issue=issues.find((i)=>i.id===selected) ?? issues[0]
  const running=issues.some((i)=>['collecting','generating'].includes(i.status))
  const generatedToday=kind==='news'&&issues.some(i=>i.status==='complete'&&beijingDay(new Date(i.createdAt))===beijingDay())
  const perform=async(fn:()=>Promise<unknown>)=>{setError('');setBusy(true);try{await fn();await reload()}catch(e){setError(String(e))}finally{setBusy(false)}}
  return <section className="page digest-page">
    <div className="page-header"><div><h1>{kind==='papers'?'科研发现':'AI 新闻'}</h1></div>{kind==='news'&&<div className="header-actions">{(generatedToday||running)&&<span className="digest-day-status" role="status">{generatedToday?'今日已更新':'正在生成'}</span>}<ResearchAction className="primary" disabled={busy||running||generatedToday} label={generatedToday?'今日已生成，每天可生成一次（北京时间）':running?'正在生成每日推荐':'生成每日推荐 · 每天一次（北京时间）'} onClick={()=>void perform(async()=>{const next=await window.singularity.research.generate(kind);setSelected(next.id)})}>{generatedToday?<Check/>:running?<LoaderCircle className="is-spinning"/>:<RefreshCw/>}</ResearchAction></div>}</div>
    {kind==='papers'&&<ResearchExplorer currentProjectId={currentProjectId} onProject={onProject}/>}
    {kind==='papers'&&<div className="discovery-sections">
      <section className="discovery-section"><div className="discovery-heading"><div><span className="section-label">THIS WEEK</span><h2>Hugging Face 每周论文</h2></div><ResearchAction label="刷新每周发现" disabled={discoveryBusy} onClick={()=>{setDiscoveryBusy(true);void window.singularity.research.discovery(true).then(setDiscovery).catch((e)=>setError(String(e))).finally(()=>setDiscoveryBusy(false))}}><RefreshCw className={discoveryBusy?'is-spinning':undefined}/></ResearchAction></div><DiscoveryCards items={discovery?.papers??[]} icon="paper" open={(url)=>void window.singularity.research.openSource(url)} empty={discovery?'本周暂无可显示的论文':'正在获取公开论文…'}/></section>
      <section className="discovery-section"><div className="discovery-heading"><div><span className="section-label">OPEN SOURCE</span><h2>GitHub 每周热门项目</h2></div><ResearchAction label="近 7 天新建，按 Stars，前 10"><Info/></ResearchAction></div><DiscoveryCards items={discovery?.repositories??[]} icon="github" open={(url)=>void window.singularity.research.openSource(url)} empty={discovery?'暂未获取到热门项目':'正在获取公开项目…'}/></section>
      <section className="discovery-section"><div className="discovery-heading"><div><span className="section-label">TOP CONFERENCES</span><h2>顶会入口</h2></div></div>{discovery?.conferences.length?<div className="conference-grid">{discovery.conferences.map(conference=><button className="conference-card" key={conference.id} onClick={()=>void window.singularity.research.openSource(conference.url)}><Landmark size={23}/><strong>{conference.title}</strong><span>{conference.summary}</span><ExternalLink size={15}/></button>)}</div>:<div className="discovery-empty">{discovery?'近期没有新放榜的顶会':'正在查看近期放榜…'}</div>}</section>
      {discovery?.warnings.length? <p className="discovery-note" role="status">{discovery.warnings.join(' · ')}</p>:null}
      {issues.length>0&&<div className="discovery-heading daily-heading"><div><span className="section-label">DAILY RECOMMENDATIONS</span><h2>每日订阅记录</h2></div></div>}
    </div>}
    {error&&<p role="alert" className="inline-error">{error}</p>}{notice&&<p role="status">{notice}</p>}
    {issues.length>0&&<div className="digest-archive"><select aria-label="历史期数" value={issue?.id} onChange={(e)=>setSelected(e.target.value)}>{issues.map((i)=><option key={i.id} value={i.id}>{new Date(i.createdAt).toLocaleString('zh-CN')} · {i.archived?'星标收藏':{collecting:'采集中',generating:'生成中',complete:'已完成',failed:'未完成'}[i.status]}</option>)}</select></div>}
    {!issue&&kind==='news'&&<div className="empty-state"><h3>值得关注的 AI 进展</h3><p className="muted">生成第一期，内容和来源会保存在本机。</p></div>}
    {issue&&<><p className="digest-overview">{issue.overview || (issue.status==='collecting'?'正在收集公开来源…':issue.status==='generating'?'正在筛选、核验并整理内容…':'')}</p>{issue.error&&<div className="inline-error">{issue.error}<ResearchAction label="重试生成" disabled={running||busy} onClick={()=>void perform(async()=>{const next=await window.singularity.research.generate(kind);setSelected(next.id)})}><RotateCcw/></ResearchAction></div>}{issue.warnings.length>0&&<details className="source-warnings"><summary>来源说明 · {issue.warnings.length}</summary>{issue.warnings.map((w,i)=><p key={i}>{w}</p>)}</details>}
    {kind==='news'?<DigestNewsCards issue={issue} onRead={id=>{void window.singularity.research.read(issue.id,id).then(reload).catch(e=>setError(String(e)))}} onSource={url=>void perform(()=>window.singularity.research.openSource(url))} busy={busy} onStar={(id,starred)=>void perform(()=>window.singularity.research.star(issue.id,id,starred))}/>:<div className="digest-grid">{issue.items.map((item)=>{const source=issue.sources.find((s)=>s.id===item.sourceId);const open=expanded.includes(item.id);return <article className={`digest-card ${item.brief?'brief':''}`} key={item.id}><div className="card-kicker"><span>{kind==='papers'?'论文推荐':item.brief?'简讯':'行业动态'}</span>{item.read&&<Check size={14}/>}</div><h2>{item.title}</h2>{kind==='papers'&&<p className="original-title">{source?.title}</p>}<small className="muted">{source?.authors || (source?.official?'官方来源':'媒体 / 社区来源')} · {source?.publishedAt?.slice(0,10) || '日期待确认'}</small>{source?.venue&&<small>{source.venue}</small>}<p>{item.summary}</p><ResearchAction label={open?'收起论文详情':'展开论文详情'} aria-expanded={open} onClick={()=>{setExpanded(open?expanded.filter((id)=>id!==item.id):[...expanded,item.id]);void window.singularity.research.read(issue.id,item.id).then(reload)}}><Maximize2/></ResearchAction>{open&&<div className="digest-detail">{item.method&&<><h4>核心方法</h4><p>{item.method}</p></>}<h4>{kind==='papers'?'研究启发':'为什么重要'}</h4><p>{item.why}</p>{kind==='papers'&&<small className="muted">基于公开摘要的推荐；请阅读原文核验细节。</small>}</div>}<footer>{source&&<ResearchAction label="查看原始来源" onClick={()=>void perform(()=>window.singularity.research.openSource(source.url))}><ExternalLink/></ResearchAction>}{source?.pdfUrl&&<ResearchAction label="下载并加入论文库" disabled={busy} onClick={()=>void perform(async()=>{await window.singularity.research.importPaper(issue.id,item.id);setNotice('已加入本地论文库')})}><Download/></ResearchAction>}</footer></article>})}</div>}</>}
  </section>
}

function DiscoveryCards({items,icon,open,empty}:{items:DiscoveryItem[];icon:'paper'|'github';open:(url:string)=>void;empty:string}) {
  if(!items.length)return <div className="discovery-empty">{empty}</div>
  return <div className="discovery-card-grid">{items.map((item)=><article className="discovery-card" key={item.id}><div className="discovery-card-meta">{icon==='paper'?<BookOpen size={17}/>:<Github size={17}/>}<span>{item.metric||'公开来源'}</span></div><h3>{item.title}</h3><p>{item.summary||'查看来源了解详情。'}</p><footer><span>{item.author||item.publishedAt?.slice(0,10)||'本周更新'}</span><ResearchAction label={`打开 ${item.title}`} onClick={()=>open(item.url)}><ExternalLink/></ResearchAction></footer></article>)}</div>
}
