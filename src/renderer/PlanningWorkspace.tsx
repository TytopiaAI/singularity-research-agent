import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { ArrowRight, Bookmark as BookmarkIcon, CalendarDays, Check, ExternalLink, Image, Layers, Pencil, Plus, Search, Star, Target, Trash2, X } from 'lucide-react'
import { addDays, artworks, bookmarkPlatform, bookmarkUrl, colorForCategory, dayDate, localDay, monthDays, planningColorChoices, planningColorLabels, planningStats, planWeekdays, priorityLabels, repeatDetail, repeatLabels, resolvePlanningColor, taskIconLabels, weekdayLabels, weekdayOrder, taskToneLabels, type Bookmark, type BookmarkInput, type Plan, type PlanInput, type PlanningCategory, type PlanningSnapshot, type PlanningTask, type PlanningTodo, type TaskInput, type TaskTone } from '../shared/planning'
import type { ChatTheme } from '../shared/chat-theme'
import './planning.css'
import { PlanningCalendar } from './PlanningCalendar'
import { weekDays } from '../shared/planning-calendar'
import './planning-redesign.css'
import './planning-desk.css'
import './planning-tasks.css'
import { TaskIconPicker, TaskSticker } from './TaskSticker'
import { DateField } from './DateField'
import { MonthReview, TaskPanel } from './PlanningPanels'
import { DayScheduleCard } from './DayScheduleCard'
import { DayTodoList } from './DayTodoList'
import { FocusTimer } from './FocusTimer'
import './planning-schedule.css'

export function usePlanning() {
  const [data,setData]=useState<PlanningSnapshot|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false)
  const mounted=useRef(true),running=useRef(false)
  useEffect(()=>{mounted.current=true;void window.singularity.planning.get().then(value=>{if(mounted.current)setData(value)}).catch(e=>{if(mounted.current)setError(String(e.message||e))});return()=>{mounted.current=false}},[])
  const perform=async(task:()=>Promise<PlanningSnapshot>):Promise<boolean>=>{
    if(running.current)return false
    running.current=true;setBusy(true);setError('')
    try {const value=await task();if(mounted.current)setData(value);return true}
    catch(e){if(mounted.current)setError(e instanceof Error?e.message:String(e));return false}
    finally{running.current=false;if(mounted.current)setBusy(false)}
  }
  return {data,error,setError,busy,perform}
}
const categoryLabel=(cat:PlanningCategory,data:PlanningSnapshot)=>cat.parentId?`${data.categories.find(item=>item.id===cat.parentId)?.name} / ${cat.name}`:cat.name
const hueStyle=(color:string)=>({'--plan-color':color}) as CSSProperties

export function PlanningWorkspace({theme,onGallery}:{theme:ChatTheme;onGallery:()=>void}) {
  const {data,error,busy,perform}=usePlanning()
  const [today,setToday]=useState(localDay())
  const [tab,setTab]=useState<'calendar'|'bookmarks'>('calendar'),[selected,setSelected]=useState(today)
  const [editing,setEditing]=useState<Plan|null|undefined>(),[categoryOpen,setCategoryOpen]=useState<'plan'|'bookmark'|null>(null)
  const [createTime,setCreateTime]=useState('')
  const [taskEditing,setTaskEditing]=useState<PlanningTask|null|undefined>(),[taskSeed,setTaskSeed]=useState<{dueDate:string;parentId:string|null}>({dueDate:today,parentId:null})
  const month=selected.slice(0,7)
  const choose=(day:string)=>setSelected(day)
  const openCreate=(day=selected,time='')=>{choose(day);setCreateTime(time);setEditing(null)}
  /* 组件只在挂载时取一次“今天”，应用常驻托盘、窗口几天不关时整页会停在启动那天。
     跨天、重新可见或回到前台时，把仍指向上一天的选中日期顶到今天。 */
  const todayRef=useRef(today)
  useEffect(()=>{
    const sync=()=>{
      const now=localDay(),before=todayRef.current
      if(now===before)return
      todayRef.current=now
      setToday(now)
      setSelected(current=>current===before?now:current)
      setTaskSeed(seed=>seed.dueDate===before?{...seed,dueDate:now}:seed)
    }
    const timer=window.setInterval(sync,30_000)
    document.addEventListener('visibilitychange',sync)
    window.addEventListener('focus',sync)
    return()=>{window.clearInterval(timer);document.removeEventListener('visibilitychange',sync);window.removeEventListener('focus',sync)}
  },[])
  if(!data)return <section className="planning-page planning-workspace"><p role={error?'alert':'status'}>{error||'正在打开计划…'}</p></section>
  const writeTodos=(next:PlanningTodo[])=>void perform(()=>window.singularity.planning.saveTodos(next))
  const openTaskCreate=(day=selected,parentId?:string|null)=>{setTaskSeed({dueDate:day,parentId:parentId??null});setTaskEditing(null)}
  const writeTask=(input:TaskInput)=>perform(()=>window.singularity.planning.saveTask(input))
  const monthList=monthDays(month),daily=planningStats(data,[selected])
  const week=weekDays(selected),weekly=week.map(day=>({day,stats:planningStats(data,[day]),earned:data.earnedDays.includes(day)}))
  const weekDone=weekly.reduce((sum,item)=>sum+item.stats.done,0),weekTotal=weekly.reduce((sum,item)=>sum+item.stats.total,0),weekEarned=weekly.filter(item=>item.earned).length
  let streak=0,cursor=data.earnedDays.includes(today)?today:addDays(today,-1)
  while(data.earnedDays.includes(cursor)){streak++;cursor=addDays(cursor,-1)}
  return <section className="planning-page planning-workspace">
    <header className="planning-header"><div><span className="planning-eyebrow">A LITTLE PROGRESS, EVERY DAY</span><h1>计划<span>让每一天，都有一点积累。</span></h1></div><div className="planning-header-actions"><button className="planning-action-icon" data-tip="管理分类" aria-label="管理分类" onClick={()=>setCategoryOpen('plan')}><Layers size={17}/><span className="planning-action-label">管理分类</span></button><button className="planning-action-icon" data-tip="我的画廊" aria-label="我的画廊" onClick={onGallery}><Image size={17}/><span className="planning-action-label">我的画廊</span></button><button className="planning-action-icon primary" data-tip="新建计划" aria-label="新建计划" onClick={()=>openCreate()}><Plus size={18}/><span className="planning-action-label">新建计划</span></button></div></header>
    <nav className="planning-tabs" aria-label="计划视图"><button className={tab==='calendar'?'active':''} onClick={()=>setTab('calendar')}><CalendarDays size={16}/>日历与待办</button><button className={tab==='bookmarks'?'active':''} onClick={()=>setTab('bookmarks')}><BookmarkIcon size={16}/>收藏夹<span>{data.bookmarks.length}</span></button></nav>
    {error&&<p className="planning-error" role="alert">{error}</p>}
    {tab==='calendar'?<>
      <div className="planning-top-grid">
        <PlanningCalendar data={data} selected={selected} onSelect={choose} onManageCategories={()=>setCategoryOpen('plan')} onCreate={openCreate} onEdit={(plan,day)=>{choose(day);setEditing(plan)}} onComplete={(plan,day)=>void perform(()=>window.singularity.planning.complete(plan.id,day,!plan.done))} onEditTask={task=>setTaskEditing(task)} onCreateTask={day=>openTaskCreate(day)} busy={busy} theme={theme}/>
        <div className="planning-companion" aria-label="日期、进度与待办概览">
          <div className="planning-companion-col">
            <section className="planning-card planning-week-pulse"><header className="planning-card-head"><div><span className="planning-kicker">WEEKLY PULSE</span><h2>这一周的节奏</h2></div><span className="planning-muted">{weekDone} / {weekTotal} 项</span></header><div className="planning-week-bars">{weekly.map((item,index)=><div key={item.day} className={`planning-week-bar ${item.day===selected?'selected':''} ${item.earned?'earned':''}`} title={`${item.day} · 完成 ${item.stats.done}/${item.stats.total} 项`}><div className="planning-week-bar-track"><i style={{height:Math.max(6,item.stats.rate)+'%'}}/></div><span>{'一二三四五六日'[index]}</span></div>)}</div><div className="planning-week-pulse-foot"><span>达标 <b>{weekEarned}</b> 天</span><span>连续 <b>{streak}</b> 天</span><span>今日 <b>{daily.done}</b> 项</span></div></section>
            <DayTodoList data={data} selected={selected} today={today} busy={busy} onWrite={writeTodos}/>
          </div>
          <div className="planning-companion-col">
            <FocusTimer/>
            <TaskPanel data={data} selected={selected} busy={busy} onEdit={task=>setTaskEditing(task)} onCreate={openTaskCreate} onComplete={task=>void perform(()=>window.singularity.planning.completeTask(task.id,!task.done))}/>
          </div>
        </div>
      </div>
      <DayScheduleCard data={data} selected={selected} busy={busy} perform={perform}/>
      <MonthReview data={data} monthList={monthList} today={today} theme={theme}/>
      <ActivityGrid data={data} selected={selected} onSelect={choose}/>
      <section className="planning-gallery-invite"><div className="planning-mini-frames">{artworks.slice(0,3).map(art=><img key={art.id} src={art.image} alt=""/>)}</div><div><span className="planning-kicker">YOUR PERSONAL GALLERY</span><h2>把坚持，挂在墙上。</h2><p>已累计 {data.earnedDays.length} 个达标日 · 解锁 {artworks.filter(art=>art.days<=data.earnedDays.length).length} 幅作品</p></div><button onClick={onGallery}>走进画廊<ArrowRight size={16}/></button></section>
    </>:<BookmarksView data={data} busy={busy} perform={perform} error={error} theme={theme} onManageCategories={kind=>setCategoryOpen(kind)}/>}
    {editing!==undefined&&<PlanDialog data={data} selected={selected} initialTime={createTime} plan={editing} busy={busy} error={error} onClose={()=>setEditing(undefined)} onSave={input=>perform(()=>window.singularity.planning.savePlan(input))} onRemove={(all)=>perform(()=>window.singularity.planning.removePlan(editing!.id,all?undefined:selected))}/>}
    {taskEditing!==undefined&&<TaskDialog data={data} seed={taskSeed} task={taskEditing} busy={busy} error={error} onClose={()=>setTaskEditing(undefined)} onSave={writeTask} onRemove={id=>perform(()=>window.singularity.planning.removeTask(id))} onComplete={task=>void perform(()=>window.singularity.planning.completeTask(task.id,!task.done))} onAddChild={title=>writeTask({title,note:'',dueDate:taskEditing!.dueDate,categoryId:taskEditing!.categoryId,icon:taskEditing!.icon,tone:taskEditing!.tone,done:false,parentId:taskEditing!.id})}/>}
    {categoryOpen&&<CategoryDialog data={data} busy={busy} error={error} perform={perform} theme={theme} initialKind={categoryOpen} onClose={()=>setCategoryOpen(null)}/>}
  </section>
}

function TaskDialog({data,seed,task,busy,error,onClose,onSave,onRemove,onComplete,onAddChild}:{data:PlanningSnapshot;seed:{dueDate:string;parentId:string|null};task:PlanningTask|null;busy:boolean;error:string;onClose:()=>void;onSave:(input:TaskInput)=>Promise<boolean>;onRemove:(id:string)=>Promise<boolean>;onComplete:(task:PlanningTask)=>void;onAddChild:(title:string)=>Promise<boolean>}) {
  const [form,setForm]=useState<TaskInput>(task?{...task}:{title:'',note:'',dueDate:seed.dueDate,categoryId:'',icon:'flag',tone:'a',done:false,parentId:seed.parentId}),[childDraft,setChildDraft]=useState('')
  const roots=data.tasks.filter(item=>!item.parentId&&item.id!==task?.id)
  const children=task?data.tasks.filter(item=>item.parentId===task.id):[]
  const parentName=task?.parentId||form.parentId?data.tasks.find(item=>item.id===(task?.parentId||form.parentId))?.title:''
  return <PlanningDialog title={task?'编辑任务':seed.parentId?'新建子任务':'新建任务'} onClose={onClose}><form onSubmit={event=>{event.preventDefault();void onSave(form).then(ok=>{if(ok)onClose()})}}><fieldset disabled={busy}>
    <label>任务名称<input autoFocus required maxLength={180} value={form.title} onChange={event=>setForm({...form,title:event.target.value})} placeholder="比如：10 号之前完成返修回复"/></label>
    <div className="planning-task-preview"><TaskSticker icon={form.icon} tone={form.tone} size={46} done={form.done}/><div><strong>{form.title||'给这个目标起个名字'}</strong><span>{form.dueDate} 截止 · {taskIconLabels[form.icon]}{parentName?` · ${parentName} 的子任务`:''}</span></div></div>
    <div className="planning-form-block"><span>任务图标 · 矢量贴纸</span><TaskIconPicker value={form.icon} tone={form.tone} onChange={icon=>setForm({...form,icon})}/></div>
    <div className="planning-form-grid"><label>截止日期<DateField ariaLabel="任务截止日期" value={form.dueDate} onChange={dueDate=>setForm({...form,dueDate})}/></label><label>贴纸配色<select value={form.tone} onChange={event=>setForm({...form,tone:event.target.value as TaskTone})}>{Object.entries(taskToneLabels).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label><label>主任务 / 子任务<select value={form.parentId||''} onChange={event=>setForm({...form,parentId:event.target.value||null})}><option value="">作为主任务</option>{roots.map(item=><option key={item.id} value={item.id}>{item.title}</option>)}</select></label><label>关联分类 · 可选<select value={form.categoryId} onChange={event=>setForm({...form,categoryId:event.target.value})}><option value="">不关联</option>{data.categories.filter(cat=>cat.kind==='plan').map(cat=><option key={cat.id} value={cat.id}>{categoryLabel(cat,data)}</option>)}</select></label></div>
    <label>目标说明<textarea rows={3} maxLength={6000} value={form.note} onChange={event=>setForm({...form,note:event.target.value})} placeholder="这件事要做到什么程度？"/></label>
    {task&&<label className="planning-inline-check"><input type="checkbox" checked={form.done} onChange={event=>setForm({...form,done:event.target.checked})}/>标记为已完成</label>}
  </fieldset>
  {task&&!task.parentId&&<div className="planning-task-children"><span className="planning-kicker">SUBTASKS</span>{children.length?children.map(child=><div className="planning-task-child-row" key={child.id}><TaskSticker icon={child.icon} tone={child.tone} size={24} done={child.done}/><span>{child.title}</span><small>{child.dueDate}</small><button type="button" disabled={busy} aria-label={`${child.done?'取消完成':'完成'}子任务：${child.title}`} onClick={()=>onComplete(child)}><Check size={12}/>{child.done?'已完成':'标记完成'}</button></div>):<p>还没有子任务，把目标拆成几个小步骤。</p>}<div className="planning-task-child-add"><input aria-label="新子任务名称" value={childDraft} maxLength={180} onChange={event=>setChildDraft(event.target.value)} placeholder="拆一个小步骤…"/><button type="button" aria-label="确认添加子任务" disabled={busy||!childDraft.trim()} onClick={()=>void onAddChild(childDraft.trim()).then(ok=>{if(ok)setChildDraft('')})}><Plus size={14}/>添加子任务</button></div></div>}
  {error&&<p role="alert" className="planning-error">{error}</p>}
  <footer>{task&&<button type="button" disabled={busy} onClick={()=>void onRemove(task.id).then(ok=>{if(ok)onClose()})}><Trash2 size={14}/>删除任务{task.parentId?'':'（含子任务）'}</button>}<button type="submit" disabled={busy||!form.dueDate} className="primary">{busy?'保存中…':'保存任务'}</button></footer>
  </form></PlanningDialog>
}

function ActivityGrid({data,selected,onSelect}:{data:PlanningSnapshot;selected:string;onSelect:(date:string)=>void}) {
  const scroll=useRef<HTMLDivElement>(null)
  // The newest week (and today's selected outline) lives at the right edge.
  useEffect(()=>{
    const el=scroll.current
    if(!el)return
    let atRight=true
    const stick=()=>{if(atRight)el.scrollLeft=el.scrollWidth-el.clientWidth}
    const observer=new ResizeObserver(stick)
    observer.observe(el)
    const onScroll=()=>{atRight=el.scrollWidth-el.clientWidth-el.scrollLeft<8}
    el.addEventListener('scroll',onScroll,{passive:true})
    const frame=requestAnimationFrame(stick)
    return()=>{cancelAnimationFrame(frame);observer.disconnect();el.removeEventListener('scroll',onScroll)}
  },[])
  const today = localDay()
  const start = addDays(today, -364)
  const aligned = addDays(start, -((dayDate(start).getDay() + 6) % 7))
  const days = Array.from({ length: 371 }, (_, i) => addDays(aligned, i))
  /* 每格只算一次完成情况，统计数字和图上的格子共用这份结果。 */
  const cells = days.map(day => ({ day, stats: planningStats(data, [day]) }))
  const year = cells.filter(cell => cell.day >= start && cell.day <= today && data.earnedDays.includes(cell.day))
  const active = year.length
  let longest = 0, run = 0
  for (const day of days) {
    if (day < start || day > today) { run = 0; continue }
    run = data.earnedDays.includes(day) ? run + 1 : 0
    if (run > longest) longest = run
  }
  const done = cells.reduce((sum, cell) => cell.day >= start && cell.day <= today ? sum + cell.stats.done : sum, 0)
  const perDay = active ? (done / active).toFixed(1) : '0'
  return <section className="planning-card planning-activity">
    <header className="planning-activity-head">
      <div>
        <h2 className="planning-activity-title">节奏</h2>
        <p className="planning-activity-tagline">每一次坚持，都看得见</p>
      </div>
      <span className="planning-activity-date">{dayDate(today).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
    </header>
    <div className="planning-activity-stats">
      <div><strong>{active.toLocaleString('zh-CN')}</strong><span>达标日</span></div>
      <div><strong>{longest}<em>天</em></strong><span>最长连续</span></div>
      <div><strong>{done.toLocaleString('zh-CN')}</strong><span>完成项</span></div>
      <div><strong>{perDay}</strong><span>日均</span></div>
    </div>
    <div className="planning-heat-scroll" ref={scroll}>
      <div className="planning-heat-months">{Array.from({ length: 53 }, (_, i) => { const day = days[i * 7]; return <span key={day}>{i === 0 || day.slice(0, 7) !== days[(i - 1) * 7].slice(0, 7) ? Number(day.slice(5, 7)) + '月' : ''}</span> })}</div>
      <div className="planning-heatmap" aria-label="年度计划完成网格">{cells.map(({ day, stats }) => {
        const future = day > today
        /* 色阶按「当天完成了几项」而不是完成率：一天只有一两件事时，
           率值一完成就是 100%，整片会全是最深色，热力图就废了。
           率值放 aria / title 里，看图看的是当天做了多少。 */
        const level = Math.min(4, stats.done)
        return <button disabled={future} key={day} className={day === selected ? 'selected' : ''} data-level={future ? 0 : level} aria-label={`${day}，完成 ${stats.done}/${stats.total} 项，${stats.rate}%`} title={`${day} · 完成 ${stats.done}/${stats.total} 项 · ${stats.rate}%`} onClick={() => onSelect(day)} />
      })}</div>
    </div>
    <footer>
      <span className="planning-heat-key">少{[0, 1, 2, 3, 4].map(level => <i key={level} data-level={level} />)}多</span>
      <span>近一年</span>
    </footer>
  </section>
}

export function PlanningDialog({title,onClose,children}:{title:string;onClose:()=>void;children:ReactNode}) {
  const ref=useRef<HTMLDialogElement>(null)
  useEffect(()=>{ref.current?.showModal()},[])
  return <dialog ref={ref} className="planning-dialog" aria-label={title} onCancel={e=>{e.preventDefault();onClose()}}><header><div><span className="planning-kicker">MAKE ROOM FOR WHAT MATTERS</span><h2>{title}</h2></div><button type="button" aria-label="关闭弹窗" onClick={onClose}><X size={18}/></button></header>{children}</dialog>
}
function PlanTimeField({label,ariaLabel,value,disabled,floor,clearLabel,onChange}:{label:string;ariaLabel:string;value:string;disabled?:boolean;floor?:string;clearLabel:string;onChange:(value:string)=>void}) {
  const id=`plan-time-${useId().replace(/:/g,'')}`
  const trigger=useRef<HTMLButtonElement>(null)
  const panel=useRef<HTMLDivElement>(null)
  const [open,setOpen]=useState(false)
  const hour=value.slice(0,2),minute=value.slice(3,5)
  const hours=Array.from({length:24},(_,index)=>String(index).padStart(2,'0'))
  const minutes=Array.from(new Set([...Array.from({length:12},(_,index)=>String(index*5).padStart(2,'0')),...(minute? [minute]:[])])).sort()
  const blocked=(nextHour:string,nextMinute:string)=>!!floor&&`${nextHour}:${nextMinute}`<=floor
  const place=()=>{const button=trigger.current,menu=panel.current;if(!button||!menu)return;const rect=button.getBoundingClientRect(),height=228,top=rect.bottom+6+height>window.innerHeight?Math.max(8,rect.top-height-6):rect.bottom+6;menu.style.top=`${top}px`;menu.style.left=`${rect.left}px`;menu.style.width=`${Math.max(rect.width,180)}px`}
  const pick=(nextHour:string,nextMinute:string,close:boolean)=>{if(disabled||blocked(nextHour,nextMinute))return;onChange(`${nextHour}:${nextMinute}`);if(close)panel.current?.hidePopover()}
  useEffect(()=>{if(disabled)panel.current?.hidePopover()},[disabled])
  return <label className="planning-time-field">{label}<button ref={trigger} type="button" className="planning-time-trigger" aria-label={ariaLabel} aria-expanded={open} aria-haspopup="dialog" popoverTarget={id} disabled={disabled}>{value||'--:--'}</button><div ref={panel} id={id} popover="auto" className="planning-time-popover" onToggle={event=>{const next=event.currentTarget.matches(':popover-open');setOpen(next);if(!next)return;place();requestAnimationFrame(()=>event.currentTarget.querySelectorAll('.selected').forEach(node=>(node as HTMLElement).scrollIntoView({block:'center'})))}}><div className="planning-time-col" aria-label="小时">{hours.map(item=><button type="button" key={item} className={`planning-time-option ${item===hour?'selected':''}`} disabled={minutes.every(entry=>blocked(item,entry))} onClick={()=>pick(item,minute&&!blocked(item,minute)?minute:'00',false)}>{item}</button>)}</div><div className="planning-time-col" aria-label="分钟">{minutes.map(item=><button type="button" key={item} className={`planning-time-option ${item===minute?'selected':''}`} disabled={blocked(hour||'00',item)} onClick={()=>pick(hour||'00',item,true)}>{item}</button>)}</div>{value&&<button type="button" className="planning-time-clear" onClick={()=>{onChange('');panel.current?.hidePopover()}}>{clearLabel}</button>}</div></label>
}
function PlanDialog({data,selected,initialTime,plan,busy,error,onClose,onSave,onRemove}:{data:PlanningSnapshot;selected:string;initialTime:string;plan:Plan|null;busy:boolean;error:string;onClose:()=>void;onSave:(input:PlanInput)=>Promise<boolean>;onRemove:(all:boolean)=>Promise<boolean>}) {
  const [form,setForm]=useState<PlanInput>(()=>{const base:PlanInput=plan?{...plan}:{title:'',note:'',date:selected,time:initialTime,endTime:'',categoryId:data.categories.find(cat=>cat.kind==='plan')?.id||'',priority:'ordinary',repeat:'none',until:''};return base.repeat==='weekly'?{...base,weekdays:planWeekdays(base)}:base})
  const weeklyOpen=form.repeat==='weekly'&&!form.weekdays?.length
  return <PlanningDialog title={plan?'编辑计划':'新建计划'} onClose={onClose}><form onSubmit={e=>{e.preventDefault();if(weeklyOpen)return;void onSave(form).then(ok=>{if(ok)onClose()})}}><fieldset disabled={busy}><label>计划名称<input autoFocus required maxLength={180} value={form.title} onChange={e=>setForm({...form,title:e.target.value})} placeholder="比如：读完一篇论文的方法部分"/></label><div className="planning-form-grid"><label>开始日期<DateField ariaLabel="计划开始日期" value={form.date} onChange={date=>setForm({...form,date})}/></label><PlanTimeField label="开始时间 · 留空为全天" ariaLabel="计划开始时间" clearLabel="全天" value={form.time} onChange={time=>setForm({...form,time,endTime:time?form.endTime:''})}/> <PlanTimeField label="结束时间 · 可选" ariaLabel="计划结束时间" clearLabel="清除" value={form.endTime??''} disabled={!form.time} floor={form.time||undefined} onChange={endTime=>setForm({...form,endTime})}/><label>分类<select value={form.categoryId} onChange={e=>setForm({...form,categoryId:e.target.value})}>{data.categories.filter(cat=>cat.kind==='plan').map(cat=><option key={cat.id} value={cat.id}>{categoryLabel(cat,data)}</option>)}</select></label><label>优先级<select value={form.priority} onChange={e=>setForm({...form,priority:e.target.value as PlanInput['priority']})}>{Object.entries(priorityLabels).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label><label>重复<select value={form.repeat} onChange={e=>{const repeat=e.target.value as PlanInput['repeat'];setForm({...form,repeat,weekdays:repeat==='weekly'&&!form.weekdays?.length?planWeekdays({...form,repeat:'weekly',weekdays:undefined}):form.weekdays})}}>{Object.entries(repeatLabels).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>{form.repeat==='weekly'&&<div className="planning-repeat-span"><div className="planning-repeat-days" role="group" aria-label="每周重复的日子">{weekdayOrder.map(day=>{const on=form.weekdays?.includes(day)??false;return <button type="button" className="planning-repeat-day" key={day} aria-label={'周'+weekdayLabels[day]} aria-pressed={on} onClick={()=>setForm({...form,weekdays:on?(form.weekdays??[]).filter(item=>item!==day):[...(form.weekdays??[]),day]})}>{weekdayLabels[day]}</button>})}</div><p className="planning-repeat-hint">{weeklyOpen?'至少选一天，可以同时选周三、周五和周日。':'已选 '+repeatDetail(form)}</p></div>}{form.repeat!=='none'&&<label>结束日期 · 可留空<DateField ariaLabel="重复结束日期" placeholder="可留空" clearable min={form.date} value={form.until} onChange={until=>setForm({...form,until})}/></label>}</div><label>补充说明<textarea rows={3} maxLength={6000} value={form.note} onChange={e=>setForm({...form,note:e.target.value})} placeholder="留下一点行动线索…"/></label>{plan?.repeat!=='none'&&plan&&<p className="planning-muted">编辑会应用到整个重复计划，完成记录按日期独立保存。</p>}</fieldset>{error&&<p role="alert" className="planning-error">{error}</p>}<footer>{plan&&<div className="planning-delete-actions"><button type="button" disabled={busy} onClick={()=>void onRemove(false).then(ok=>{if(ok)onClose()})}><Trash2 size={14}/>{plan.repeat==='none'?'删除计划':'删除本次'}</button>{plan.repeat!=='none'&&<button type="button" disabled={busy} onClick={()=>void onRemove(true).then(ok=>{if(ok)onClose()})}>删除整个重复计划</button>}</div>}<button type="submit" className="primary" disabled={busy||weeklyOpen||!form.date}>{busy?'保存中…':'保存计划'}</button></footer></form></PlanningDialog>
}

function BookmarksView({data,busy,perform,error,onManageCategories,theme='transparent'}:{data:PlanningSnapshot;busy:boolean;perform:(task:()=>Promise<PlanningSnapshot>)=>Promise<boolean>;error:string;onManageCategories:(kind:'bookmark')=>void;theme?:ChatTheme}) {
  const [category,setCategory]=useState(''),[query,setQuery]=useState(''),[pinned,setPinned]=useState(false),[editing,setEditing]=useState<Bookmark|null|undefined>()
  const [visibleLimit,setVisibleLimit]=useState(60)
  useEffect(()=>setVisibleLimit(60),[category,query,pinned])
  const items=data.bookmarks.filter(item=>(!category||item.categoryId===category||data.categories.some(cat=>cat.id===item.categoryId&&cat.parentId===category))&&(!pinned||item.pinned)&&`${item.title} ${item.url} ${item.note} ${item.tags.join(' ')}`.toLowerCase().includes(query.toLowerCase()))
  return <section className="planning-bookmarks"><aside className="planning-card planning-collections"><span className="planning-kicker">COLLECTIONS</span><h2>把灵感留在这里</h2><button className={!category&&!pinned?'active':''} onClick={()=>{setCategory('');setPinned(false)}}><BookmarkIcon size={15}/>全部收藏<b>{data.bookmarks.length}</b></button><button className={pinned?'active':''} onClick={()=>{setCategory('');setPinned(!pinned)}}><Star size={15}/>星标收藏<b>{data.bookmarks.filter(item=>item.pinned).length}</b></button><div className="planning-collection-divider"/>{data.categories.filter(cat=>cat.kind==='bookmark').map(cat=><button key={cat.id} className={`${category===cat.id?'active':''} ${cat.parentId?'child':''}`} onClick={()=>{setCategory(cat.id);setPinned(false)}} style={hueStyle(colorForCategory(cat,theme))}><i/>{cat.name}<b>{data.bookmarks.filter(item=>item.categoryId===cat.id||data.categories.some(child=>child.id===item.categoryId&&child.parentId===cat.id)).length}</b></button>)}<div className="planning-collection-divider"/><button className="planning-collection-manage" aria-label="自定义收藏分类" onClick={()=>onManageCategories('bookmark')}><Plus size={14}/>自定义分类</button></aside><div className="planning-bookmark-main"><header className="planning-bookmark-toolbar"><div className="planning-search"><Search size={16}/><input aria-label="搜索收藏" value={query} onChange={e=>setQuery(e.target.value)} placeholder="搜索标题、链接、标签和笔记"/></div><button className="primary" onClick={()=>setEditing(null)}><Plus size={16}/>添加收藏</button></header><p className="planning-muted">{items.length} 条收藏 · 网站、论文、小红书、微博和抖音的灵感，都可以放在一起。</p>{items.length?<div className="planning-bookmark-grid">{items.slice(0,visibleLimit).map(item=>{const cat=data.categories.find(cat=>cat.id===item.categoryId);return <article className="planning-card planning-bookmark" key={item.id}><header><span style={hueStyle(colorForCategory(cat,theme))}><i/>{cat?.name}</span><button aria-label={`${item.pinned?'取消星标':'星标'}：${item.title}`} aria-pressed={item.pinned} disabled={busy} onClick={()=>void perform(()=>window.singularity.planning.saveBookmark({...item,pinned:!item.pinned}))}><Star size={16} fill={item.pinned?'currentColor':'none'}/></button></header><button className="planning-bookmark-title" onClick={()=>setEditing(item)}><h3>{item.title}</h3></button><p>{item.note||'还没有添加笔记。留下一句为什么收藏，下次会更容易找到。'}</p><div className="planning-bookmark-tags">{item.tags.map(tag=><button key={tag} onClick={()=>setQuery(tag)}>#{tag}</button>)}</div><footer><span>{bookmarkPlatform(item.url)}</span><div><button aria-label={`编辑收藏：${item.title}`} onClick={()=>setEditing(item)}><Pencil size={14}/></button><button aria-label={`打开收藏：${item.title}`} title={item.url} onClick={()=>void window.singularity.planning.openBookmark(item.id).catch(e=>alert(String(e.message||e)))}><ExternalLink size={16}/></button></div></footer></article>})}</div>:<div className="planning-card planning-bookmark-empty"><BookmarkIcon size={32}/><h2>{query?'还没有找到相关收藏':'给每一个好想法，留一个位置。'}</h2><p>粘贴网页链接或整段分享文案，再按自己的方式归类。</p><button onClick={()=>setEditing(null)}><Plus size={16}/>添加第一条收藏</button></div>}{items.length>visibleLimit&&<button className="planning-load-more" onClick={()=>setVisibleLimit(visibleLimit+60)}>再显示 60 条 · 还有 {items.length-visibleLimit} 条</button>}</div>{editing!==undefined&&<BookmarkDialog data={data} item={editing} category={category} busy={busy} error={error} onClose={()=>setEditing(undefined)} perform={perform}/>}</section>
}
function BookmarkDialog({data,item,category,busy,error,onClose,perform}:{data:PlanningSnapshot;item:Bookmark|null;category:string;busy:boolean;error:string;onClose:()=>void;perform:(task:()=>Promise<PlanningSnapshot>)=>Promise<boolean>}) {
  const [form,setForm]=useState<BookmarkInput>(item?{...item}:{title:'',url:'',note:'',tags:[],categoryId:category||data.categories.find(cat=>cat.kind==='bookmark')?.id||'',pinned:false}),[tags,setTags]=useState(item?.tags.join('，')||''),[validation,setValidation]=useState('')
  return <PlanningDialog title={item?'编辑收藏':'添加收藏'} onClose={onClose}><form onSubmit={event=>{event.preventDefault();try{const url=bookmarkUrl(form.url);setValidation('');void perform(()=>window.singularity.planning.saveBookmark({...form,url,tags:tags.split(/[,，\n]/).map(tag=>tag.trim()).filter(Boolean)})).then(ok=>{if(ok)onClose()})}catch(e){setValidation((e as Error).message)}}}><fieldset disabled={busy}><label>链接或分享文案<textarea required rows={3} maxLength={10000} value={form.url} onChange={e=>setForm({...form,url:e.target.value})} placeholder="粘贴网页链接，或小红书 / 微博 / 抖音的整段分享文案…"/></label><label>标题<input maxLength={240} value={form.title} onChange={e=>setForm({...form,title:e.target.value})} placeholder="给这条灵感起个名字"/></label><div className="planning-form-grid"><label>分类<select value={form.categoryId} onChange={e=>setForm({...form,categoryId:e.target.value})}>{data.categories.filter(cat=>cat.kind==='bookmark').map(cat=><option key={cat.id} value={cat.id}>{categoryLabel(cat,data)}</option>)}</select></label><label>标签 · 用逗号分隔<input value={tags} onChange={e=>setTags(e.target.value)} placeholder="配色，参考，待读"/></label></div><label>收藏笔记<textarea rows={4} maxLength={12000} value={form.note} onChange={e=>setForm({...form,note:e.target.value})} placeholder="为什么收藏？有什么值得再看一次？"/></label><label className="planning-inline-check"><input type="checkbox" checked={form.pinned} onChange={e=>setForm({...form,pinned:e.target.checked})}/>加入星标收藏</label></fieldset>{(validation||error)&&<p className="planning-error" role="alert">{validation||error}</p>}<footer>{item&&<button type="button" disabled={busy} onClick={()=>void perform(()=>window.singularity.planning.removeBookmark(item.id)).then(ok=>{if(ok)onClose()})}><Trash2 size={14}/>删除收藏</button>}<button type="submit" disabled={busy} className="primary">保存收藏</button></footer></form></PlanningDialog>
}

function CategoryDialog({data,busy,error,perform,onClose,initialKind='plan',theme='transparent'}:{data:PlanningSnapshot;busy:boolean;error:string;perform:(task:()=>Promise<PlanningSnapshot>)=>Promise<boolean>;onClose:()=>void;initialKind?:'plan'|'bookmark';theme?:ChatTheme}) {
  const [kind,setKind]=useState<'plan'|'bookmark'>(initialKind),[editing,setEditing]=useState<PlanningCategory|null>(null),[name,setName]=useState(''),[parentId,setParentId]=useState(''),[color,setColor]=useState<PlanningCategory['color']>('rose'),[shade,setShade]=useState(1)
  const nameRef=useRef<HTMLInputElement>(null)
  /* 主题色那几族在当前界面主题下会撞色，先让开；正在编辑的老分类如果正好落在让开的族里，
     仍然留在列表最前面并注明本主题下会显示成哪一族，免得一保存就被悄悄改掉。 */
  const colorChoices=planningColorChoices(theme)
  const colorOptions=colorChoices.includes(color)?colorChoices:[color,...colorChoices]
  const roots=data.categories.filter(cat=>cat.kind===kind&&!cat.parentId)
  const parentName=roots.find(cat=>cat.id===parentId)?.name||''
  /* 新建独立分类时避开已经用掉的色系，否则默认色系会跟现有分类撞成同一个点。 */
  const takenColors=new Set(roots.filter(cat=>cat.id!==editing?.id).map(cat=>cat.color))
  const freeColor=()=>colorChoices.find(key=>!takenColors.has(key))??colorChoices[0]
  const reset=()=>{setEditing(null);setName('');setParentId('');setShade(1);setColor(freeColor())}
  const startChild=(cat:PlanningCategory)=>{setEditing(null);setName('');setParentId(cat.id);setColor(cat.color);setShade(2);requestAnimationFrame(()=>nameRef.current?.focus())}
  return <PlanningDialog title="管理分类" onClose={onClose}><div className="planning-tabs"><button className={kind==='plan'?'active':''} onClick={()=>{setKind('plan');reset()}}>计划分类</button><button className={kind==='bookmark'?'active':''} onClick={()=>{setKind('bookmark');reset()}}>收藏分类</button></div><div className="planning-category-toolbar"><span>{kind==='plan'?'计划分类':'收藏分类'} · 可自建类别与子类别</span><button type="button" onClick={()=>{reset();requestAnimationFrame(()=>nameRef.current?.focus())}}><Plus size={13}/>新建类别</button></div><div className="planning-category-list">{data.categories.filter(cat=>cat.kind===kind).map(cat=><div key={cat.id} className={cat.parentId?'child':''} style={hueStyle(colorForCategory(cat,theme))}><i/><span>{cat.name}</span>{!cat.parentId&&<button className="planning-category-add-child" aria-label={`为${cat.name}添加子类别`} title={`在${cat.name}下新建子类别`} onClick={()=>startChild(cat)}><Plus size={13}/></button>}<button aria-label={`编辑分类：${cat.name}`} onClick={()=>{setEditing(cat);setName(cat.name);setParentId(cat.parentId||'');setColor(cat.color);setShade(cat.shade)}}><Pencil size={13}/></button><button disabled={busy} aria-label={`删除分类：${cat.name}`} onClick={()=>void perform(()=>window.singularity.planning.removeCategory(cat.id))}><Trash2 size={13}/></button></div>)}</div><form onSubmit={event=>{event.preventDefault();void perform(()=>window.singularity.planning.saveCategory({id:editing?.id,name,kind,parentId:parentId||null,color,shade:parentId?shade:0})).then(ok=>{if(ok)reset()})}}><fieldset disabled={busy}><label>{editing?'编辑分类名称':parentName?`在「${parentName}」下新建子类别`:'新分类名称'}<input ref={nameRef} value={name} required maxLength={40} onChange={e=>setName(e.target.value)} placeholder="比如：重建方法阅读、设计灵感…"/></label><div className="planning-form-grid"><label>所属分类<select value={parentId} onChange={e=>setParentId(e.target.value)}><option value="">独立分类</option>{data.categories.filter(cat=>cat.kind===kind&&!cat.parentId&&cat.id!==editing?.id).map(cat=><option key={cat.id} value={cat.id}>{cat.name}</option>)}</select></label>{parentId?<label>同色系深浅<select value={shade} onChange={e=>setShade(Number(e.target.value))}>{[0,1,2,3,4].map(n=><option key={n} value={n}>{['主色','浅一档','深一档','最浅','中间'][n]}</option>)}</select></label>:<label>色系<select value={color} onChange={e=>setColor(e.target.value as PlanningCategory['color'])}>{colorOptions.map(key=><option key={key} value={key}>{planningColorLabels[key]}{!colorChoices.includes(key)?`（本主题下显示为${planningColorLabels[resolvePlanningColor(key,theme)]}）`:''}</option>)}</select></label>}</div></fieldset>{error&&<p className="planning-error" role="alert">{error}</p>}<footer>{editing&&<button type="button" onClick={reset}>取消编辑</button>}<button type="submit" disabled={busy} className="primary">{editing?'保存分类':parentName?'添加子类别':'添加分类'}</button></footer></form></PlanningDialog>
}
