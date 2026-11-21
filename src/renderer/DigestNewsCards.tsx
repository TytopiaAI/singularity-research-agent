import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import { ArrowLeft, Check, ChevronLeft, ChevronRight, ExternalLink, Star } from 'lucide-react'
import type { DigestIssue, DigestItem, DigestSource } from '../shared/types'
import './digest-news.css'
import { ResearchAction } from './ResearchAction'
import { STAR_SPARK_RADIUS, starPopKeyframes, starSparkAngles } from './star-pop'

function sourceImage(source?:DigestSource) {
  return source?.imageData&&/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(source.imageData)?source.imageData:undefined
}
export function DigestNewsCards({issue,onRead,onSource,onStar,busy=false,readerActive=true,onReaderChange}:{issue:DigestIssue;onRead:(id:string)=>void;onSource:(url:string)=>void;onStar:(id:string,starred:boolean)=>void;busy?:boolean;readerActive?:boolean;onReaderChange?:(active:boolean)=>void}) {
  const [selected,setSelected]=useState<string|null>(null),[failedImages,setFailedImages]=useState<string[]>([])
  const layout=useRef<HTMLDivElement>(null),detail=useRef<HTMLElement>(null),triggers=useRef(new Map<string,HTMLButtonElement>())
  const scrollPositions=useRef<Array<{element:Element;top:number;left:number}>>([]),restoreFrame=useRef(0),detailId=useId()
  useEffect(()=>{setSelected(null);setFailedImages([])},[issue.id])
  useEffect(()=>{if(!readerActive)setSelected(null)},[readerActive])
  useEffect(()=>()=>cancelAnimationFrame(restoreFrame.current),[])
  const item=issue.items.find(item=>item.id===selected),source=issue.sources.find(source=>source.id===item?.sourceId)
  const image=(source?:DigestSource)=>issue.subscription?.presentation==='text'||failedImages.includes(source?.id??'')?undefined:sourceImage(source)
  const fail=(id:string)=>setFailedImages(previous=>previous.includes(id)?previous:[...previous,id])
  const label=(item:DigestItem)=>item.category||(item.brief?'简讯':({all:'消息',research:'学术研究',industry:'行业动态',product:'产品与工具',policy:'政策与公共事务',culture:'文化生活'}[issue.subscription?.newsType??'all']))
  const entries=issue.subscription?.presentation==='image'?[...issue.items].sort((a,b)=>Number(Boolean(image(issue.sources.find(s=>s.id===b.sourceId))))-Number(Boolean(image(issue.sources.find(s=>s.id===a.sourceId))))):issue.items
  const open=(id:string)=>{
    cancelAnimationFrame(restoreFrame.current)
    if(!selected){scrollPositions.current=[];for(let element:Element|null=layout.current;element;element=element.parentElement)scrollPositions.current.push({element,top:element.scrollTop,left:element.scrollLeft})}
    setSelected(id);onReaderChange?.(true);onRead(id)
  }
  const close=()=>{
    const id=selected;setSelected(null);onReaderChange?.(false)
    restoreFrame.current=requestAnimationFrame(()=>{if(id)triggers.current.get(id)?.focus({preventScroll:true});for(const position of scrollPositions.current)if(position.element.isConnected){position.element.scrollTop=position.top;position.element.scrollLeft=position.left}})
  }
  useEffect(()=>{
    if(!item)return
    detail.current?.focus({preventScroll:true});if(detail.current)detail.current.scrollTop=0
    layout.current?.scrollIntoView({block:'nearest',inline:'nearest'})
  },[item?.id])
  const star=(entry:DigestItem)=><NewsStar starred={Boolean(entry.starred)} disabled={busy} onClick={()=>onStar(entry.id,!entry.starred)}/>
  const at=entries.findIndex(entry=>entry.id===selected)
  return <div ref={layout} className={`news-layout${item?' is-reading':''}`} onKeyDown={event=>{if(event.key==='Escape'&&item){event.preventDefault();close()}}}>
    {item&&<article ref={detail} tabIndex={-1} id={detailId} className="news-detail" aria-labelledby={`${detailId}-title`}>
      <header className="news-detail-toolbar"><ResearchAction label="返回瀑布流" onClick={close}><ArrowLeft/></ResearchAction><span>{at+1} / {entries.length}</span><div><ResearchAction label="上一条消息" disabled={at<=0} onClick={()=>open(entries[at-1].id)}><ChevronLeft/></ResearchAction><ResearchAction label="下一条消息" disabled={at>=entries.length-1} onClick={()=>open(entries[at+1].id)}><ChevronRight/></ResearchAction>{star(item)}</div></header>
      <div className="news-reader-content">
        <div className="news-reader-meta"><span>{label(item)}</span><span>{source?.official?'官方来源':'媒体 / 社区来源'}</span><time>{source?.publishedAt?.slice(0,10)||'日期待确认'}</time></div>
        <h2 id={`${detailId}-title`}>{item.title}</h2>
        {image(source)&&<figure className="news-detail-cover"><img alt={`${item.title} · 来源配图`} src={image(source)} onError={()=>fail(source!.id)}/><figcaption>来源配图 · {source?.title}</figcaption></figure>}
        <p className="news-reader-summary">{item.summary}</p>
        {item.method&&<><h3>相关进展</h3><p>{item.method}</p></>}
        {item.why&&<><h3>为什么重要</h3><p>{item.why}</p></>}
        {source&&<footer><div><small>原始来源</small><span>{source.title}</span></div><ResearchAction label="查看原始来源" onClick={()=>onSource(source.url)}><ExternalLink/></ResearchAction></footer>}
      </div>
    </article>}
    {item?<aside className="news-companions" aria-label="其他消息"><header><span>本期消息</span><span>{entries.length}</span></header><div className="news-companion-list">{entries.map(entry=>{
      const source=issue.sources.find(s=>s.id===entry.sourceId),cover=image(source)
      return <button type="button" className="news-companion" key={entry.id} aria-label={`阅读消息：${entry.title}`} aria-current={entry.id===selected?'true':undefined} onClick={()=>open(entry.id)}>
        {cover&&<img alt="" src={cover} loading="lazy" onError={()=>fail(source!.id)}/>}
        <span><small>{label(entry)}{entry.starred&&<Star size={11} fill="currentColor"/>}</small><strong>{entry.title}</strong><span>{entry.summary}</span></span>
      </button>
    })}</div></aside>:<div className="digest-grid news-grid">{entries.map((entry,index)=>{
      const source=issue.sources.find(s=>s.id===entry.sourceId),cover=image(source)
      const style=issue.subscription?.imageCardStyle??'auto'
      const imageIndex=entries.slice(0,index).filter(i=>image(issue.sources.find(s=>s.id===i.sourceId))).length
      const immersive=cover&&(style==='immersive'||style==='auto'&&imageIndex%2===1)
      return <article className={`digest-card news-card${cover?' news-card-with-image':''}${immersive?' news-card-immersive':''}`} key={entry.id}>
        {immersive&&<img className="news-card-backdrop" alt="" src={cover} loading="lazy" onError={()=>fail(source!.id)}/>}
        <button ref={element=>{if(element)triggers.current.set(entry.id,element);else triggers.current.delete(entry.id)}} type="button" className="news-card-main" aria-label={`展开新闻：${entry.title}`} aria-expanded={false} onClick={()=>open(entry.id)}>
          {cover&&!immersive&&<span className="news-card-media"><img alt="" src={cover} loading="lazy" onError={()=>fail(source!.id)}/></span>}
          <span className="card-kicker"><span>{label(entry)}</span>{entry.read&&<Check size={14} aria-label="已读"/>}</span>
          <span className="news-card-title">{entry.title}</span>
          <span className="news-card-meta">{source?.authors||(source?.official?'官方来源':'媒体 / 社区来源')} · {source?.publishedAt?.slice(0,10)||'日期待确认'}</span>
          <span className="news-card-summary">{entry.summary}</span>
        </button>
        <footer>{source&&<ResearchAction label="查看原始来源" onClick={()=>onSource(source.url)}><ExternalLink/></ResearchAction>}{star(entry)}</footer>
      </article>
    })}</div>}
  </div>
}

/** 收藏星标：点击时星星弹到 1.3 再弹回，收藏成功时再散开 8 个点。取消收藏只回弹、不散点。 */
function NewsStar({ starred, disabled, onClick }: { starred: boolean; disabled?: boolean; onClick: () => void }) {
  const icon = useRef<SVGSVGElement>(null)
  const [burst, setBurst] = useState(0)
  const fire = () => {
    const star = icon.current
    if (star && typeof star.animate === 'function' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const { duration, keyframes } = starPopKeyframes()
      for (const animation of star.getAnimations()) animation.cancel()
      star.animate(keyframes, { duration, easing: 'linear' })
    }
    setBurst(next => (starred ? 0 : next + 1))
    onClick()
  }
  return <ResearchAction className="news-star" disabled={disabled} label={starred ? '取消收藏' : '收藏到计划 · 按主题归类'} aria-pressed={starred} onClick={fire}>
    <Star ref={icon} size={17} fill={starred ? 'currentColor' : 'none'} />
    {burst > 0 && <span key={burst} className="news-star-sparks" aria-hidden="true" style={{ '--spark-radius': `${STAR_SPARK_RADIUS}px` } as CSSProperties}>
      {starSparkAngles().map(angle => <i key={angle} style={{ '--spark-angle': `${angle}deg` } as CSSProperties} />)}
    </span>}
  </ResearchAction>
}