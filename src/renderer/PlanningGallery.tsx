import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import { ArrowLeft, Check, ChevronRight, Frame, LockKeyhole, Maximize2, Move, Plus, Sparkles, Trash2, UsersRound, X } from 'lucide-react'
import { artworks, frameLabels, frameStyles, type GalleryPlacement } from '../shared/planning'
import { PlanningDialog, usePlanning } from './PlanningWorkspace'
import './planning.css'
import { GalleryArchitecture } from './GalleryArchitecture'
import './gallery-museum.css'

const artFor=(id:string)=>artworks.find(art=>art.id===id)!
function clampPlacement(item:GalleryPlacement):GalleryPlacement {const art=artFor(item.artworkId),height=item.width*1.6/art.ratio;return {...item,x:Math.max(0,Math.min(100-item.width,item.x)),y:Math.max(0,Math.min(100-height,item.y))}}

export function PlanningGallery({onBack}:{onBack:()=>void}) {
  const {data,error,setError,busy,perform}=usePlanning(),[editing,setEditing]=useState(true),[selected,setSelected]=useState<string|null>(null),[preview,setPreview]=useState<string|null>(null)
  const [visitors,setVisitors]=useState(true)
  const [layout,setLayout]=useState<GalleryPlacement[]>([]),layoutRef=useRef(layout),wall=useRef<HTMLDivElement>(null),room=useRef<HTMLDivElement>(null)
  const drag=useRef<{id:string;pointer:number;startX:number;startY:number;x:number;y:number;bounds:DOMRect}|null>(null)
  useEffect(()=>{if(data){setLayout(data.gallery);layoutRef.current=data.gallery}},[data])
  const update=(next:GalleryPlacement[])=>{layoutRef.current=next;setLayout(next)}
  const save=async(next:GalleryPlacement[])=>{update(next);const ok=await perform(()=>window.singularity.planning.saveGallery(next));if(!ok&&data)update(data.gallery)}
  if(!data)return <section className="planning-page"><p role={error?'alert':'status'}>{error||'正在打开画廊…'}</p></section>
  const unlocked=artworks.filter(art=>art.days<=data.earnedDays.length),next=artworks.find(art=>art.days>data.earnedDays.length),current=layout.find(item=>item.artworkId===selected)
  const startDrag=(event:PointerEvent<HTMLElement>,item:GalleryPlacement)=>{
    setSelected(item.artworkId)
    if(!editing||busy||!wall.current||event.button!==0)return
    event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId)
    drag.current={id:item.artworkId,pointer:event.pointerId,startX:event.clientX,startY:event.clientY,x:item.x,y:item.y,bounds:wall.current.getBoundingClientRect()}
  }
  const moveDrag=(event:PointerEvent<HTMLElement>)=>{const state=drag.current;if(!state||state.pointer!==event.pointerId)return
    update(layoutRef.current.map(item=>item.artworkId===state.id?clampPlacement({...item,x:state.x+(event.clientX-state.startX)/state.bounds.width*100,y:state.y+(event.clientY-state.startY)/state.bounds.height*100}):item))}
  const endDrag=(event:PointerEvent<HTMLElement>,cancel=false)=>{
    const state=drag.current;if(!state||state.pointer!==event.pointerId)return
    drag.current=null
    if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId)
    if(cancel&&data)update(data.gallery);else void save(layoutRef.current)
  }
  const patch=(input:Partial<GalleryPlacement>)=>{if(current)void save(layout.map(item=>item.artworkId===current.artworkId?clampPlacement({...item,...input}):item))}
  const hang=(artworkId:string)=>{
    const index=layout.length
    const placement=clampPlacement({artworkId,x:8+(index%3)*30,y:8+Math.floor(index/3)*45,width:23,frame:'oak'})
    setSelected(artworkId);setEditing(true);void save([...layout,placement])
  }
  return <section className="planning-page planning-gallery-page">
    <header className="planning-header"><div><button className="planning-back" onClick={onBack}><ArrowLeft size={15}/>返回计划</button><span className="planning-eyebrow">A PLACE FOR YOUR LITTLE WINS</span><h1>我的画廊</h1></div><div className="planning-header-actions">{busy&&<span className="planning-muted" role="status">正在保存布置…</span>}<button className={editing?'primary soft':''} aria-pressed={editing} onClick={()=>{setEditing(!editing);setSelected(null)}}><Move size={16}/>{editing?'完成布置':'布置画廊'}</button></div></header>
    {error&&<p className="planning-error" role="alert">{error}</p>}
    <section className="planning-gallery-progress"><div className="planning-gallery-badge"><Sparkles size={21}/></div><div><strong>累计 {data.earnedDays.length} 个达标日</strong><p>完成当天全部计划，累计 1 天。解锁后的作品会一直陪着你。</p></div><div className="planning-gallery-next">{next?<><span>距离《{next.title}》还有 {next.days-data.earnedDays.length} 天</span><div className="planning-progress"><i style={{width:Math.min(100,data.earnedDays.length/next.days*100)+'%'}}/></div></>:<span>所有作品均已解锁，享受你的私人画廊。</span>}</div></section>
    <div className={`planning-gallery-stage ${editing?'editing':''}`}>
      <div className="planning-gallery-room" ref={room}><div className="museum-scene"><GalleryArchitecture visitors={visitors}/><div className="planning-gallery-wall" ref={wall} aria-label="可交互画廊墙面" onPointerDown={e=>{if(e.target===e.currentTarget)setSelected(null)}}>
        {layout.map(item=>{const art=artFor(item.artworkId);return <div key={item.artworkId} tabIndex={0} role="button" aria-label={`挂画：${art.title}`} aria-pressed={selected===item.artworkId} className={`planning-hanging-art ${selected===item.artworkId&&editing?'selected':''}`} style={{left:item.x+'%',top:item.y+'%',width:item.width+'%','--art-ratio':art.ratio,transform:item.rotation?`rotate(${item.rotation}deg)`:'none'} as CSSProperties} onFocus={()=>setSelected(item.artworkId)} onPointerDown={event=>startDrag(event,item)} onPointerMove={moveDrag} onPointerUp={event=>endDrag(event)} onPointerCancel={event=>endDrag(event,true)} onDoubleClick={()=>setPreview(item.artworkId)} onKeyDown={event=>{
          if(event.key==='Enter'){event.preventDefault();setPreview(item.artworkId);return}
          if(!editing||busy)return
          const directions:Record<string,[number,number]>={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}
          if(directions[event.key]){event.preventDefault();const [x,y]=directions[event.key],step=event.shiftKey?3:.6;void save(layout.map(art=>art.artworkId===item.artworkId?clampPlacement({...art,x:art.x+x*step,y:art.y+y*step}):art))}
        }}><div className={`planning-art-frame frame-${item.frame}`}><img src={art.image} alt={`${art.title}，${art.artist}`} draggable={false}/></div><span className="planning-art-caption">{art.title}<small>{art.artist}</small></span></div>})}
      </div></div></div>
      {editing&&<aside className="planning-gallery-inspector"><span className="planning-kicker">CURATE YOUR SPACE</span><h2>{current?artFor(current.artworkId).title:'布置你的空间'}</h2>{current?<><p className="planning-muted">拖动画作调整位置，也可使用方向键微调。</p><label>画框<select aria-label="选择画框" disabled={busy} value={current.frame} onChange={e=>patch({frame:e.target.value as GalleryPlacement['frame']})}>{frameStyles.map(frame=><option key={frame} value={frame}>{frameLabels[frame]}</option>)}</select></label><div className="planning-frame-swatches">{frameStyles.map(frame=><button disabled={busy} aria-label={frameLabels[frame]} aria-pressed={current.frame===frame} key={frame} onClick={()=>patch({frame})}><i className={`planning-art-frame frame-${frame}`}/></button>)}</div><label>画作大小<span>{Math.round(current.width)}%</span><input type="range" aria-label="画作大小" min={12} max={34} step={1} value={current.width} disabled={busy} onChange={e=>update(layout.map(item=>item.artworkId===current.artworkId?clampPlacement({...item,width:Number(e.target.value)}):item))} onPointerUp={()=>void save(layoutRef.current)} onKeyUp={e=>{if(e.key.startsWith('Arrow')||['Home','End','PageUp','PageDown'].includes(e.key))void save(layoutRef.current)}}/></label><label>倾斜<span>{Math.round(current.rotation??0)}°</span><input type="range" aria-label="画作倾斜角度" min={-10} max={10} step={1} value={current.rotation??0} disabled={busy} onChange={e=>update(layout.map(item=>item.artworkId===current.artworkId?{...item,rotation:Number(e.target.value)}:item))} onPointerUp={()=>void save(layoutRef.current)} onKeyUp={e=>{if(e.key.startsWith('Arrow')||['Home','End','PageUp','PageDown'].includes(e.key))void save(layoutRef.current)}}/></label><button disabled={busy} onClick={()=>void save([...layout.filter(item=>item.artworkId!==current.artworkId),current])}>移到最前面</button><button disabled={busy} onClick={()=>{setSelected(null);void save(layout.filter(item=>item.artworkId!==current.artworkId))}}><Trash2 size={14}/>从墙上取下</button></>:<><div className="planning-gallery-instruction"><Move size={24}/><p>选中墙上的画作，可以更换画框、调整大小和移动位置。</p></div><span className="planning-muted">解锁 {unlocked.length} / {artworks.length} 幅<br/>已挂起 {layout.length} 幅</span></>}</aside>}
    </div>
    <div className="museum-room-actions"><span>{layout.length?`已展出 ${layout.length} 幅 · 双击画作可放大欣赏`:'展墙留白，等待你的第一件馆藏。'}</span><div><button aria-pressed={visitors} onClick={()=>setVisitors(!visitors)}><UsersRound size={14}/>{visitors?'隐藏参观者':'显示参观者'}</button><button onClick={()=>void room.current?.requestFullscreen().catch(e=>setError(String(e)))} title="按 Esc 返回"><Maximize2 size={14}/>全屏观展</button></div></div>
    {!layout.length&&<p className="planning-gallery-empty-hint"><Frame size={15}/>{unlocked.length?'从下方选择作品挂上墙，拖动调整位置。':'完成第一个达标日，解锁梵高的《卧室》。'}</p>}
    <section className="planning-art-catalog"><header className="planning-card-head"><div><span className="planning-kicker">THE COLLECTION</span><h2>每一幅画，都有一段坚持。</h2></div><span className="planning-muted">作品由芝加哥艺术博物馆开放馆藏提供 · 公共领域</span></header><div className="planning-art-grid">{artworks.map(art=>{const open=art.days<=data.earnedDays.length,hung=layout.some(item=>item.artworkId===art.id);return <article key={art.id} className={`planning-card planning-art-card ${open?'unlocked':'locked'}`}><div className="planning-art-thumb"><img src={art.image} alt={art.title} loading="lazy"/>{!open&&<span><LockKeyhole size={15}/>{art.days} 个达标日</span>}{open&&<span className="unlocked"><Check size={13}/>已解锁</span>}</div><div><h3>{art.title}</h3><p>{art.artist} · {art.year}</p><button disabled={!open||hung||busy} onClick={()=>hang(art.id)}>{hung?<><Check size={14}/>已挂在墙上</>:open?<><Plus size={14}/>挂到墙上</>:<>还差 {art.days-data.earnedDays.length} 天<ChevronRight size={13}/></>}</button></div></article>})}</div></section>
    {preview&&<PlanningDialog title={artFor(preview).title} onClose={()=>setPreview(null)}><img className="planning-art-preview" src={artFor(preview).image} alt={artFor(preview).title}/><p className="planning-muted">{artFor(preview).artist} · {artFor(preview).year} · 芝加哥艺术博物馆开放馆藏</p><button onClick={()=>setPreview(null)}><X size={14}/>返回画廊</button></PlanningDialog>}
  </section>
}
