import { useEffect, useRef, useState } from 'react'
import { Bell, Bookmark, CalendarClock, ChevronDown, Image, Layers, LoaderCircle, Pause, Play, Plus, RefreshCw, Settings2, Sparkles, Trash2, X } from 'lucide-react'
import type { DigestIssue, DigestSubscription } from '../shared/types'
import { beijingDay, messageChannel, normalizeSubscription, subscriptionSchedule, weekdayNames } from '../shared/digest'
import { DigestNewsCards } from './DigestNewsCards'
import { ResearchAction } from './ResearchAction'
import './message-subscriptions.css'

export function MessageSubscriptions() {
  const [configs,setConfigs]=useState<DigestSubscription[]>([]),[issues,setIssues]=useState<DigestIssue[]>([])
  const [channel,setChannel]=useState(()=>{try{return localStorage.getItem('singularity.messages.channel')??'all'}catch{return 'all'}})
  const [view,setView]=useState<'latest'|'saved'>('latest'),[editing,setEditing]=useState<DigestSubscription|null>(null)
  const [busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState('')
  const [readingIssue,setReadingIssue]=useState<string|null>(null)
  const mounted=useRef(true),request=useRef(0)
  const reload=async()=>{
    const serial=++request.current
    const [subscriptions,editions]=await Promise.all([window.singularity.research.subscriptions(),window.singularity.research.list('news')])
    if(mounted.current&&serial===request.current){setConfigs(subscriptions.filter(c=>c.kind==='news').map(c=>({...c,id:c.id??'legacy-news'})));setIssues(editions);setLoading(false)}
  }
  useEffect(()=>{mounted.current=true;void reload().catch(e=>{if(mounted.current){setError(String(e));setLoading(false)}});const timer=setInterval(()=>void reload().catch(()=>{}),3000);return()=>{mounted.current=false;clearInterval(timer)}},[])
  const choose=(id:string)=>{setReadingIssue(null);setChannel(id);setView('latest');try{localStorage.setItem('singularity.messages.channel',id)}catch{/* Selection still works without storage. */}}
  const perform=async(fn:()=>Promise<unknown>)=>{setError('');setNotice('');setBusy(true);try{await fn();await reload();return true}catch(e){setError(String(e));return false}finally{if(mounted.current)setBusy(false)}}
  const options=[...configs]
  for(const issue of issues)if(!options.some(c=>c.id===messageChannel(issue)))options.push(issue.subscription??{id:messageChannel(issue),kind:'news',enabled:false,time:'09:00',topics:['历史 AI 消息']})
  const selected=configs.find(c=>c.id===channel)
  const currentChannel=channel==='all'||options.some(c=>c.id===channel)?channel:'all'
  const filtered=issues.filter(i=>currentChannel==='all'||messageChannel(i)===currentChannel)
  const newest=filtered.filter(i=>!i.archived).filter((i,index,all)=>all.findIndex(other=>messageChannel(other)===messageChannel(i))===index)
  const live=[...newest]
  // A failed replacement must not hide the last successful edition.
  for(const issue of newest)if(issue.status!=='complete'){const previous=filtered.find(i=>!i.archived&&i.status==='complete'&&messageChannel(i)===messageChannel(issue)&&i.id!==issue.id);if(previous&&!live.some(item=>item.id===previous.id))live.push(previous)}
  const remembered=filtered.filter(i=>i.archived&&i.items.some(item=>item.starred))
  const shown=view==='saved'?filtered.filter(i=>i.items.some(item=>item.starred)):[...live,...remembered]
  const refreshable=new Set(newest.map(issue=>issue.id))
  const generating=(id:string)=>issues.some(i=>messageChannel(i)===id&&['collecting','generating'].includes(i.status))
  const today=(id:string)=>issues.some(i=>messageChannel(i)===id&&i.status==='complete'&&beijingDay(new Date(i.createdAt))===beijingDay())
  const canUpdate=(id:string)=>Boolean(id&&(configs.some(c=>c.id===id)||id==='legacy-news'))
  const generate=(id:string)=>perform(()=>window.singularity.research.generate('news',configs.some(c=>c.id===id)?id:undefined))
  return <section className="page digest-page messages-page">
    <header className="page-header messages-header"><div><h1>消息订阅</h1><div className="message-channel-select"><Layers size={16}/><select aria-label="切换订阅主题" value={currentChannel} onChange={e=>choose(e.target.value)}><option value="all">全部主题</option>{options.map(c=><option value={c.id} key={c.id}>{c.topics.join('、')}</option>)}</select><ChevronDown size={14}/></div></div><div className="header-actions">
      {selected&&<><ResearchAction label="编辑主题订阅" disabled={busy||generating(channel)} onClick={()=>setEditing(selected)}><Settings2/></ResearchAction><ResearchAction label={selected.enabled?'暂停自动推送':'恢复自动推送'} disabled={busy||generating(channel)} onClick={()=>void perform(()=>window.singularity.research.subscribe({...selected,enabled:!selected.enabled}))}>{selected.enabled?<Pause/>:<Play/>}</ResearchAction></>}
      <button className="message-new" disabled={busy} onClick={()=>setEditing({id:crypto.randomUUID(),kind:'news',enabled:true,time:'09:00',topics:[''],repeat:'daily',startDate:beijingDay(),weekdays:[1],rangeDays:7,count:6,presentation:'mixed',includeOverview:true})}><Plus size={17}/>新建</button>
    </div></header>
    <div className="message-view-bar"><div role="group" aria-label="消息视图"><button aria-pressed={view==='latest'} onClick={()=>{setReadingIssue(null);setView('latest')}}><Bell size={14}/>最新</button><button aria-pressed={view==='saved'} onClick={()=>{setReadingIssue(null);setView('saved')}}><Bookmark size={14}/>已收藏</button></div><span>{selected?`${subscriptionSchedule(selected)} · 北京时间${selected.enabled?'':' · 已暂停'}`:'按主题发现值得关注的消息'}</span></div>
    {error&&<p className="inline-error" role="alert">{error}</p>}{notice&&<p className="message-notice" role="status">{notice}</p>}
    {loading?<div className="message-empty"><LoaderCircle className="is-spinning" size={25}/><p>正在读取订阅…</p></div>:!options.length?<div className="message-empty"><div className="message-empty-mark"><Bell size={30}/></div><h2>把关心的事，放在一起</h2><p>科技、研究、设计或生活，为每个主题定制一份消息。</p><button className="primary" onClick={()=>setEditing({id:crypto.randomUUID(),kind:'news',enabled:true,time:'09:00',topics:[''],repeat:'daily',startDate:beijingDay(),weekdays:[1]})}><Plus size={16}/>新建第一个主题</button></div>:!shown.length?<div className="message-empty"><Bookmark size={26}/><h2>{view==='saved'?'还没有收藏':'这个主题准备好了'}</h2><p>{view==='saved'?'点击消息右下角的星星，也会保存到「计划」的收藏夹。':'先生成一期，之后按照设置的时间持续更新。'}</p>{selected&&view==='latest'&&<button className="primary" disabled={busy||generating(channel)||today(channel)} onClick={()=>void generate(channel)}><Sparkles size={16}/>生成第一期</button>}</div>:shown.map(issue=>{
      const config=configs.find(c=>c.id===messageChannel(issue))??issue.subscription
      const display={...issue,subscription:config?{...(issue.subscription??config),presentation:config.presentation??'mixed',imageCardStyle:config.imageCardStyle??'auto'}:issue.subscription,...(view==='saved'?{items:issue.items.filter(item=>item.starred),overview:''}:{})}
      return <section className="message-edition" key={issue.id}>
        <div className="message-edition-heading"><div><span className="message-topic-dot"/><h2>{config?.topics.join('、')||'历史 AI 消息'}</h2><time>{new Date(issue.createdAt).toLocaleDateString('zh-CN')}</time>{issue.archived&&<span className="message-kept">已收藏</span>}</div>{view==='latest'&&!issue.archived&&refreshable.has(issue.id)&&canUpdate(messageChannel(issue))&&<ResearchAction className="primary" label={generating(messageChannel(issue))?'此主题正在生成':today(messageChannel(issue))?'今天已更新此主题':'更新这个主题'} disabled={busy||today(messageChannel(issue))||generating(messageChannel(issue))} onClick={()=>void generate(messageChannel(issue))}>{generating(messageChannel(issue))?<LoaderCircle className="is-spinning"/>:<RefreshCw/>}</ResearchAction>}</div>
        {['collecting','generating'].includes(issue.status)&&<div className="message-pending" role="status"><LoaderCircle size={17} className="is-spinning"/>正在收集、筛选并整理这个主题的消息…</div>}
        {issue.error&&<div className="inline-error">{issue.error}</div>}
        {view==='latest'&&issue.overview&&issue.subscription?.includeOverview!==false&&<article className="message-overview"><div><Sparkles size={19}/><span>本期观察</span></div><h3>{config?.topics.join('、')||'消息'} · 近期脉络</h3><p>{issue.overview}</p><footer><span>{issue.items.length} 条消息</span><span>近 {issue.subscription?.rangeDays??7} 天 · 基于本期来源整理</span></footer></article>}
        <DigestNewsCards issue={display} busy={busy} readerActive={readingIssue===issue.id} onReaderChange={active=>setReadingIssue(active?issue.id:null)} onRead={id=>void perform(()=>window.singularity.research.read(issue.id,id))} onSource={url=>void perform(()=>window.singularity.research.openSource(url))} onStar={(id,starred)=>void perform(async()=>{await window.singularity.research.star(issue.id,id,starred);setNotice(starred?'已收藏到「计划」，可在那里调整分类。':'已取消收藏。')})}/>
        {!!issue.warnings.length&&<details className="message-source-notes"><summary>来源说明 · {issue.warnings.length}</summary>{issue.warnings.map((warning,index)=><p key={index}>{warning}</p>)}</details>}
      </section>
    })}
    {editing&&<MessageEditor value={editing} existing={configs.some(c=>c.id===editing.id)} busy={busy} onClose={()=>setEditing(null)} onSave={async(config,generateNow)=>{
      const saved=await perform(()=>window.singularity.research.subscribe(config))
      if(saved){setEditing(null);choose(config.id!);if(generateNow)await generate(config.id!)}
      return saved
    }} onRemove={async()=>{if(await perform(()=>window.singularity.research.removeSubscription(editing.id!))){setEditing(null);choose('all')}}}/>} 
  </section>
}

function MessageEditor({value,existing,busy,onClose,onSave,onRemove}:{value:DigestSubscription;existing:boolean;busy:boolean;onClose:()=>void;onSave:(config:DigestSubscription,generate:boolean)=>Promise<boolean>;onRemove:()=>Promise<void>}) {
  const [draft,setDraft]=useState(value),[error,setError]=useState(''),[removing,setRemoving]=useState(false),[now,setNow]=useState(!existing)
  const dialog=useRef<HTMLDialogElement>(null)
  useEffect(()=>{dialog.current?.showModal()},[])
  const patch=(value:Partial<DigestSubscription>)=>setDraft(previous=>({...previous,...value}))
  return <dialog ref={dialog} className="message-editor" aria-label={existing?'编辑消息订阅':'新建消息订阅'} onCancel={e=>{e.preventDefault();if(!busy)onClose()}}>
    <form onSubmit={e=>{e.preventDefault();setError('');try{const config=normalizeSubscription(draft);void onSave(config,now).then(ok=>{if(!ok)setError('保存或授权未完成，请检查配置并重试。')}).catch(e=>setError(String(e)))}catch(error){setError(String(error))}}}>
      <header><div><small>MESSAGE SUBSCRIPTION</small><h2>{existing?'编辑主题':'新建主题'}</h2></div><button type="button" aria-label="关闭订阅设置" disabled={busy} onClick={onClose}><X size={19}/></button></header>
      <div className="message-editor-body"><label className="message-form-topic">主题 <span>必填</span><input autoFocus required maxLength={120} placeholder="例如：人工智能、建筑设计、医学进展…" value={draft.topics.join('、')} onChange={e=>patch({topics:[e.target.value]})}/></label>
        <div className="message-repeat-box"><div className="message-form-grid"><label>重复 <span>必填</span><select required aria-label="推送重复方式" value={draft.repeat??'daily'} onChange={e=>patch({repeat:e.target.value as DigestSubscription['repeat']})}>{Object.entries({once:'单次',daily:'每天',weekly:'每周',biweekly:'每双周',monthly:'每月',yearly:'每年',interval:'间隔'}).map(([value,name])=><option value={value} key={value}>{name}</option>)}</select></label><label>推送时间 <span>北京时间</span><input type="time" required value={draft.time} onChange={e=>patch({time:e.target.value})}/></label></div>
        {['weekly','biweekly'].includes(draft.repeat??'')&&<div className="message-weekdays" role="group" aria-label="每周推送日期">{[1,2,3,4,5,6,0].map(day=><button type="button" key={day} aria-label={'周'+weekdayNames[day]} aria-pressed={draft.weekdays?.includes(day)??false} onClick={()=>patch({weekdays:draft.weekdays?.includes(day)?draft.weekdays.filter(d=>d!==day):[...(draft.weekdays??[]),day]})}>{weekdayNames[day]}</button>)}</div>}
        {draft.repeat==='interval'&&<label>间隔天数<input type="number" min={1} max={365} value={draft.intervalDays??2} onChange={e=>patch({intervalDays:e.target.valueAsNumber})}/></label>}
        <label className="message-start-date">{['monthly','yearly','once'].includes(draft.repeat??'')?'推送日期 / 起始日':'开始日期'}<input type="date" value={draft.startDate??beijingDay()} required onChange={e=>patch({startDate:e.target.value})}/></label>
        <label className="message-check"><input type="checkbox" checked={draft.enabled} onChange={e=>patch({enabled:e.target.checked})}/>自动推送</label><small className="message-schedule-preview"><CalendarClock size={13}/>{subscriptionSchedule(draft)} · 应用运行时执行</small></div>
        <details className="message-options"><summary>更多偏好 <span>可选</span></summary><label>内容描述<textarea maxLength={2000} rows={3} placeholder="希望关注哪些变化？有哪些不感兴趣的内容？" value={draft.description??''} onChange={e=>patch({description:e.target.value})}/></label><div className="message-form-grid"><label>时间范围<select value={draft.rangeDays??7} onChange={e=>patch({rangeDays:Number(e.target.value)})}>{[1,3,7,14,30,90,180,365].map(days=><option key={days} value={days}>最近 {days} 天</option>)}</select></label><label>消息数量<input type="number" min={1} max={20} value={draft.count??6} onChange={e=>patch({count:e.target.valueAsNumber})}/></label><label>消息类型<select value={draft.newsType??'all'} onChange={e=>patch({newsType:e.target.value as DigestSubscription['newsType']})}>{Object.entries({all:'不限',research:'学术研究',industry:'行业动态',product:'产品与工具',policy:'政策与公共事务',culture:'设计与文化生活'}).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><label>展示形式<select value={draft.presentation??'mixed'} onChange={e=>patch({presentation:e.target.value as DigestSubscription['presentation']})}><option value="mixed">图文混排</option><option value="text">纯文字</option><option value="image">优先图片</option></select></label></div><label className="message-check"><input type="checkbox" checked={draft.includeOverview??true} onChange={e=>patch({includeOverview:e.target.checked})}/><Image size={15}/>显示横向总结卡片</label><small>图片仅取自可用的原始来源，没有配图时使用文字卡片。</small></details>
        {draft.presentation!=='text'&&<label className="message-cover-choice">配图卡片 <span>可选</span><select aria-label="配图卡片样式" value={draft.imageCardStyle??'auto'} onChange={e=>patch({imageCardStyle:e.target.value as DigestSubscription['imageCardStyle']})}><option value="auto">自动混排</option><option value="cover">上方封面 · 下方文字</option><option value="immersive">整图封面 · 叠加文字</option></select></label>}
        <p className="message-form-note">消息和收藏保存在本机。使用当前模型，可能产生 API 费用；关闭应用期间不执行。每个主题每天可成功生成一次；来源不足时如实少给。月末日期自动取当月最后一天。</p>
        {error&&<p className="inline-error" role="alert">{error}</p>}
      </div>
      <footer>{existing?<button className="message-delete" aria-label="移除这个订阅主题" type="button" disabled={busy} onClick={()=>setRemoving(!removing)}><Trash2 size={15}/></button>:<span/>}{removing?<><span>只移除订阅，收藏和已有消息保留。</span><button type="button" disabled={busy} onClick={()=>void onRemove()}>确认移除</button></>:<><label className="message-check"><input type="checkbox" checked={now} onChange={e=>setNow(e.target.checked)}/>保存后生成一期</label><button className="primary" disabled={busy} type="submit">{busy?'处理中…':existing?'保存':'创建订阅'}</button></>}</footer>
    </form>
  </dialog>
}
