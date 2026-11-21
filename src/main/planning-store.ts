import { DatabaseSync } from 'node:sqlite'
import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import { z } from 'zod'
import { artworks, bookmarkUrl, frameStyles, localDay, occursOn, planningColorKeys, plansForDay, type Bookmark, type GalleryPlacement, type Plan, type PlanningCategory, type PlanningColor, type PlanningSnapshot, type PlanningTask, type PlanningTodo } from '../shared/planning'

const day=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value=>{const parsed=new Date(value+'T12:00:00Z');return value>='1970-01-01'&&value<='2100-12-31'&&Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===value},'日期无效')
const id=z.string().min(1).max(100)
const categorySchema=z.object({id:id.optional(),name:z.string().trim().min(1).max(40),kind:z.enum(['plan','bookmark']),parentId:id.nullable(),color:z.enum(planningColorKeys as [PlanningColor,...PlanningColor[]]),shade:z.number().int().min(0).max(4)})
const planSchema=z.object({id:id.optional(),title:z.string().trim().min(1).max(180),note:z.string().max(6000),date:day,time:z.union([z.literal(''),z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)]),endTime:z.union([z.literal(''),z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)]).default(''),categoryId:id,priority:z.enum(['urgent-important','important','urgent','ordinary']),repeat:z.enum(['none','daily','weekdays','weekends','weekly']),weekdays:z.array(z.number().int().min(0).max(6)).max(7).optional(),until:z.union([z.literal(''),day])}).refine(value=>!value.until||value.until>=value.date,'结束日期不能早于开始日期').refine(value=>!value.endTime||!!value.time&&value.endTime>value.time,'结束时间须晚于当天开始时间').refine(value=>value.repeat!=='weekly'||value.weekdays===undefined||value.weekdays.length>0,'请至少选择一个星期')
const bookmarkSchema=z.object({id:id.optional(),title:z.string().trim().max(240),url:z.string().max(10000),note:z.string().max(12000),tags:z.array(z.string().trim().min(1).max(40)).max(24),categoryId:id,pinned:z.boolean()})
const placementSchema=z.array(z.object({artworkId:id,x:z.number().finite().min(0).max(100),y:z.number().finite().min(0).max(100),width:z.number().finite().min(10).max(35),frame:z.enum(frameStyles),rotation:z.number().finite().min(-20).max(20).default(0)})).max(artworks.length)
const todoSchema=z.array(z.object({id:id,title:z.string().trim().min(1).max(180),done:z.boolean(),createdAt:z.string().max(40),date:day.optional(),minutes:z.number().int().min(15).max(240).optional(),priority:z.enum(['urgent-important','important','urgent','ordinary']).optional()})).max(200)
const scheduleOverrideSchema=z.record(z.string().min(1).max(160),z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/))
const taskSchema=z.object({id:id.optional(),title:z.string().trim().min(1).max(180),note:z.string().max(6000),dueDate:day,categoryId:z.union([z.literal(''),id]),icon:z.enum(['flag','star','book','coffee','rocket','bulb','clock','heart','leaf','check']),tone:z.enum(['a','b','c']),done:z.boolean(),parentId:id.nullable()})

/** Standalone additive database: no changes to the research or paper databases. */
export class PlanningStore {
  private readonly db:DatabaseSync
  constructor(databaseDirectory:string,private readonly today=()=>localDay()) {
    this.db=new DatabaseSync(path.join(databaseDirectory,'planning.sqlite'))
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000;
      CREATE TABLE IF NOT EXISTS categories(id TEXT PRIMARY KEY,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS plans(id TEXT PRIMARY KEY,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS completions(plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,date TEXT NOT NULL,completed_at TEXT NOT NULL,PRIMARY KEY(plan_id,date));
      CREATE TABLE IF NOT EXISTS bookmarks(id TEXT PRIMARY KEY,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS earned_days(date TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,data TEXT NOT NULL);`)
    if(!this.db.prepare('SELECT 1 FROM settings WHERE key=?').get('initialized')) {
      this.transaction(()=>{
        const defaults:PlanningCategory[]=[
          {id:'plan-study',name:'学习',kind:'plan',parentId:null,color:'rose',shade:0},
          {id:'plan-reading',name:'阅读',kind:'plan',parentId:'plan-study',color:'rose',shade:1},
          {id:'plan-skills',name:'技能练习',kind:'plan',parentId:'plan-study',color:'rose',shade:2},
          {id:'plan-research',name:'科研',kind:'plan',parentId:null,color:'blue',shade:0},
          {id:'plan-papers',name:'读论文',kind:'plan',parentId:'plan-research',color:'blue',shade:1},
          {id:'plan-experiments',name:'实验',kind:'plan',parentId:'plan-research',color:'blue',shade:2},
          {id:'plan-life',name:'生活',kind:'plan',parentId:null,color:'green',shade:0},
          {id:'plan-health',name:'健康运动',kind:'plan',parentId:'plan-life',color:'green',shade:1},
          {id:'bookmark-design',name:'设计网站',kind:'bookmark',parentId:null,color:'violet',shade:0},
          {id:'bookmark-papers',name:'论文收藏',kind:'bookmark',parentId:null,color:'blue',shade:0},
          {id:'bookmark-food',name:'饮食收藏',kind:'bookmark',parentId:null,color:'amber',shade:0},
          {id:'bookmark-inspiration',name:'灵感与生活',kind:'bookmark',parentId:null,color:'green',shade:0},
        ]
        for(const value of defaults)this.put('categories',value)
        this.db.prepare('INSERT INTO settings VALUES(?,?)').run('initialized','true')
      })
    }
  }
  private transaction<T>(task:()=>T):T { this.db.exec('BEGIN IMMEDIATE');try{const result=task();this.db.exec('COMMIT');return result}catch(error){this.db.exec('ROLLBACK');throw error} }
  private rows<T>(table:'plans'|'tasks'|'bookmarks'|'categories'):T[] { return this.db.prepare(`SELECT data FROM ${table} ORDER BY rowid`).all().map(row=>JSON.parse(row.data as string)) }
  private put<T extends {id:string}>(table:'plans'|'tasks'|'bookmarks'|'categories',value:T) { this.db.prepare(`INSERT INTO ${table}(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data`).run(value.id,JSON.stringify(value)) }
  private read<T>(table:'plans'|'tasks'|'bookmarks'|'categories',key:string):T { const row=this.db.prepare(`SELECT data FROM ${table} WHERE id=?`).get(key);if(!row)throw new Error('条目不存在，请刷新后再试。');return JSON.parse(row.data as string) }
  private snapshot():PlanningSnapshot {
    return {categories:this.rows('categories'),plans:this.rows('plans'),tasks:this.rows<PlanningTask>('tasks').sort((a,b)=>a.dueDate.localeCompare(b.dueDate)||a.createdAt.localeCompare(b.createdAt)),bookmarks:this.rows<Bookmark>('bookmarks').sort((a,b)=>Number(b.pinned)-Number(a.pinned)||b.createdAt.localeCompare(a.createdAt)),
      completions:this.db.prepare('SELECT plan_id AS planId,date,completed_at AS completedAt FROM completions').all() as unknown as PlanningSnapshot['completions'],
      earnedDays:this.db.prepare('SELECT date FROM earned_days ORDER BY date').all().map(row=>row.date as string),
      gallery:JSON.parse((this.db.prepare('SELECT data FROM settings WHERE key=?').get('gallery')?.data as string)||'[]'),
      todos:JSON.parse((this.db.prepare('SELECT data FROM settings WHERE key=?').get('todos')?.data as string)||'[]') as PlanningTodo[],
      scheduleOverrides:JSON.parse((this.db.prepare('SELECT data FROM settings WHERE key=?').get('schedule_overrides')?.data as string)||'{}')}
  }
  get():PlanningSnapshot {
    const snapshot=this.snapshot(),today=this.today()
    // Once a day earns an artwork credit, subsequent edits never take it away.
    for(const date of new Set(snapshot.completions.filter(item=>item.date<=today).map(item=>item.date))) {
      const plans=plansForDay(snapshot,date)
      if(plans.length&&plans.every(plan=>plan.done))this.db.prepare('INSERT OR IGNORE INTO earned_days(date) VALUES(?)').run(date)
    }
    return this.snapshot()
  }
  private category(key:string,kind:'plan'|'bookmark') { const category=this.read<PlanningCategory>('categories',key);if(category.kind!==kind)throw new Error('分类类型不匹配。');return category }
  saveCategory(raw:unknown) {
    const input=categorySchema.parse(raw),previous=input.id?this.read<PlanningCategory>('categories',input.id):undefined
    if(previous&&previous.kind!==input.kind)throw new Error('分类类型不能修改。')
    let color=input.color
    if(input.parentId) {
      const parent=this.category(input.parentId,input.kind)
      if(parent.id===input.id||parent.parentId||this.rows<PlanningCategory>('categories').some(cat=>cat.parentId===input.id))throw new Error('分类最多两级，不能循环嵌套。')
      color=parent.color
    }
    const saved={...input,id:input.id||randomUUID(),color}
    this.transaction(()=>{this.put('categories',saved);for(const child of this.rows<PlanningCategory>('categories').filter(cat=>cat.parentId===saved.id))this.put('categories',{...child,color})})
    return this.get()
  }
  removeCategory(key:string) {
    id.parse(key);this.read('categories',key)
    if(this.rows<Plan>('plans').some(plan=>plan.categoryId===key)||this.rows<Bookmark>('bookmarks').some(item=>item.categoryId===key)||this.rows<PlanningTask>('tasks').some(task=>task.categoryId===key)||this.rows<PlanningCategory>('categories').some(cat=>cat.parentId===key))throw new Error('这个分类仍有内容或子分类，请先移动内容再删除。')
    this.db.prepare('DELETE FROM categories WHERE id=?').run(key);return this.get()
  }
  savePlan(raw:unknown) {
    const input=planSchema.parse(raw),previous=input.id?this.read<Plan>('plans',input.id):undefined
    this.category(input.categoryId,'plan')
    const saved={...input,id:input.id||randomUUID(),excludedDates:previous?.excludedDates||[],createdAt:previous?.createdAt||new Date().toISOString(),weekdays:input.repeat==='weekly'&&input.weekdays?[...new Set(input.weekdays)].sort((a,b)=>a-b):undefined}
    if(!saved.weekdays)delete saved.weekdays
    this.put('plans',saved)
    return this.get()
  }
  removePlan(key:string,date?:string) {
    id.parse(key);const plan=this.read<Plan>('plans',key)
    if(date&&plan.repeat!=='none') {
      day.parse(date)
      if(!occursOn(plan,date))throw new Error('这一天没有这项计划。')
      this.transaction(()=>{this.put('plans',{...plan,excludedDates:[...plan.excludedDates,date]});this.db.prepare('DELETE FROM completions WHERE plan_id=? AND date=?').run(key,date)})
    } else this.db.prepare('DELETE FROM plans WHERE id=?').run(key)
    return this.get()
  }
  complete(key:string,date:string,done:boolean) {
    id.parse(key);day.parse(date);z.boolean().parse(done)
    const plan=this.read<Plan>('plans',key)
    if(!occursOn(plan,date))throw new Error('这一天没有这项计划，不能修改完成状态。')
    if(done)this.db.prepare('INSERT OR IGNORE INTO completions VALUES(?,?,?)').run(key,date,new Date().toISOString())
    else this.db.prepare('DELETE FROM completions WHERE plan_id=? AND date=?').run(key,date)
    return this.get()
  }
  saveBookmark(raw:unknown) {
    const input=bookmarkSchema.parse(raw),previous=input.id?this.read<Bookmark>('bookmarks',input.id):undefined
    this.category(input.categoryId,'bookmark')
    const url=bookmarkUrl(input.url)
    this.put('bookmarks',{...input,url,title:input.title||new URL(url).hostname,id:input.id||randomUUID(),tags:[...new Set(input.tags)],createdAt:previous?.createdAt||new Date().toISOString()})
    return this.get()
  }
  messageBookmarkIds():string[] { return this.rows<Bookmark>('bookmarks').map(item=>item.id) }
  collectMessage(input:{topic:string;category?:string;title:string;url:string;note:string}):string {
    const url=bookmarkUrl(input.url),existing=this.rows<Bookmark>('bookmarks').find(item=>item.url===url)
    // Re-starring must not overwrite a person's edits or their chosen category.
    if(existing)return existing.id
    const hash=(value:string)=>createHash('sha256').update(value).digest('hex').slice(0,24)
    const topic=input.topic.trim().slice(0,40)||'消息收藏',parentId='message-topic-'+hash(input.topic)
    let categoryId=parentId
    this.transaction(()=>{
      const categories=this.rows<PlanningCategory>('categories')
      const parent=categories.find(c=>c.id===parentId)??categories.find(c=>c.kind==='bookmark'&&!c.parentId&&c.name===topic)
      categoryId=parent?.id??parentId
      if(!parent)this.put('categories',{id:categoryId,name:topic,kind:'bookmark',parentId:null,color:'blue',shade:0} satisfies PlanningCategory)
      const category=input.category?.trim().slice(0,40)
      if(category&&category!==topic){
        const child=categories.find(c=>c.kind==='bookmark'&&c.parentId===categoryId&&c.name===category)
        const childId=child?.id??'message-class-'+hash(categoryId+'\n'+category)
        if(!child)this.put('categories',{id:childId,name:category,kind:'bookmark',parentId:categoryId,color:parent?.color??'blue',shade:1} satisfies PlanningCategory)
        categoryId=childId
      }
      this.put('bookmarks',{id:'message-'+hash(url),title:input.title.slice(0,240),url,note:input.note.slice(0,12000),tags:['消息订阅',topic],categoryId,pinned:false,createdAt:new Date().toISOString()} satisfies Bookmark)
    })
    return 'message-'+hash(url)
  }
  removeBookmark(key:string) {id.parse(key);this.read('bookmarks',key);this.db.prepare('DELETE FROM bookmarks WHERE id=?').run(key);return this.get()}
  bookmarkTarget(key:string):string {id.parse(key);return bookmarkUrl(this.read<Bookmark>('bookmarks',key).url)}
  saveGallery(raw:unknown) {
    const input=placementSchema.parse(raw),earned=this.get().earnedDays.length
    if(new Set(input.map(item=>item.artworkId)).size!==input.length)throw new Error('同一作品只能挂一次。')
    const layout:GalleryPlacement[]=input.map(item=>{
      const art=artworks.find(art=>art.id===item.artworkId)
      if(!art||art.days>earned)throw new Error('作品尚未解锁，完成当天全部计划可累计达标天数。')
      const height=item.width*1.6/art.ratio
      return {...item,x:Math.min(item.x,100-item.width),y:Math.min(item.y,Math.max(0,100-height))}
    })
    this.db.prepare('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data').run('gallery',JSON.stringify(layout));return this.get()
  }
  saveTodos(raw:unknown) {
    const todos=todoSchema.parse(raw)
    this.db.prepare('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data').run('todos',JSON.stringify(todos))
    return this.get()
  }
  /** Manual start times for one day's auto-scheduled items. Empty object resets the day. */
  saveScheduleOverrides(dateKey:string,raw:unknown) {
    day.parse(dateKey)
    const overrides=scheduleOverrideSchema.parse(raw)
    const current=JSON.parse((this.db.prepare('SELECT data FROM settings WHERE key=?').get('schedule_overrides')?.data as string)||'{}') as Record<string,unknown>
    if(Object.keys(overrides).length)current[dateKey]=overrides
    else delete current[dateKey]
    this.db.prepare('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data').run('schedule_overrides',JSON.stringify(current))
    return this.get()
  }
  saveTask(raw:unknown) {
    const input=taskSchema.parse(raw),previous=input.id?this.read<PlanningTask>('tasks',input.id):undefined
    if(input.categoryId)this.category(input.categoryId,'plan')
    if(input.parentId) {
      const parent=this.read<PlanningTask>('tasks',input.parentId)
      if(parent.id===input.id||parent.parentId)throw new Error('任务最多两级，父任务只能是主任务。')
      if(this.rows<PlanningTask>('tasks').some(task=>task.parentId===input.id))throw new Error('已有子任务的主任务不能改为子任务。')
    }
    this.put('tasks',{...input,id:input.id||randomUUID(),createdAt:previous?.createdAt||new Date().toISOString()} satisfies PlanningTask)
    return this.get()
  }
  removeTask(key:string) {
    id.parse(key);this.read<PlanningTask>('tasks',key)
    this.transaction(()=>{
      for(const child of this.rows<PlanningTask>('tasks').filter(task=>task.parentId===key))this.db.prepare('DELETE FROM tasks WHERE id=?').run(child.id)
      this.db.prepare('DELETE FROM tasks WHERE id=?').run(key)
    })
    return this.get()
  }
  completeTask(key:string,done:boolean) {
    id.parse(key);z.boolean().parse(done)
    const task=this.read<PlanningTask>('tasks',key)
    this.put('tasks',{...task,done})
    return this.get()
  }
  close(){this.db.close()}
}
