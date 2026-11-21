import { DatabaseSync } from 'node:sqlite'
import type { AppPaths } from './paths'
import type { HarnessApi } from './harness-api'
import type { PaperRepository } from './paper-repository'
import type { DigestKind, DigestIssue, DigestSubscription, DigestItem, DigestSource } from '../shared/types'
import { collectSources, sourceKey, boundedFetch } from './digest-sources'
import fs from 'node:fs/promises'
import path from 'node:path'
import { redact } from './redaction'
import { beijingDay, digestIsDue, messageChannel, normalizeSubscription, subscriptionKey } from '../shared/digest'
import type { PlanningStore } from './planning-store'
export { beijingDay } from '../shared/digest'

export const isDue = digestIsDue
export function validateDigest(value: unknown, sources: DigestSource[], limit=8): { overview: string; items: DigestItem[] } {
  const input = value as { overview?: unknown; items?: unknown }
  if (!input || typeof input.overview !== 'string' || !Array.isArray(input.items) || input.items.length < 1 || input.items.length > Math.min(20,limit)) throw new Error('模型未返回有效消息正文，或条数超过订阅设置')
  const seen = new Set<string>()
  const items = input.items.map((entry: unknown) => {
    const item = entry as DigestItem
    if (!item || !sources.some((s) => s.id === item.sourceId) || seen.has(item.sourceId) || [item.title,item.summary,item.why].some((s) => typeof s !== 'string' || s.trim().length < 4 || s.length > 6000)) throw new Error('早报条目或来源校验失败')
    seen.add(item.sourceId)
    return { id: crypto.randomUUID(), sourceId: item.sourceId, title:item.title, summary:item.summary, why:item.why, method: typeof item.method === 'string' ? item.method.slice(0,6000) : undefined, category:typeof item.category==='string'?item.category.trim().slice(0,40):undefined, brief:Boolean(item.brief), read:false }
  })
  return { overview: input.overview.slice(0,2000), items }
}
export class DigestService {
  private db: DatabaseSync
  private active = new Set<string>()
  private controller = new AbortController()
  private ticking = false
  private pending = new Set<Promise<void>>()
  constructor(private paths: AppPaths, private api: HarnessApi, private papers: PaperRepository, private ready: () => Promise<boolean>, private planning?:PlanningStore) {
    this.db = new DatabaseSync(papers.databasePath)
    this.db.exec(`PRAGMA busy_timeout=3000;
      CREATE TABLE IF NOT EXISTS research_issues (id TEXT PRIMARY KEY, kind TEXT NOT NULL, body TEXT NOT NULL, result_json TEXT);
      CREATE TABLE IF NOT EXISTS research_subscriptions (kind TEXT PRIMARY KEY, body TEXT NOT NULL, last_day TEXT NOT NULL DEFAULT '');`)
    for (const issue of [...this.list('papers'),...this.list('news')]) if (issue.status === 'collecting' || issue.status === 'generating') {
      const row = this.db.prepare('SELECT result_json FROM research_issues WHERE id=?').get(issue.id)
      if(!row)continue
      try {
        if (!row?.result_json) throw new Error('No saved result')
        this.complete({...issue,...validateDigest(JSON.parse(String(row.result_json)),issue.sources,issue.subscription?.count??8),status:'complete'})
      } catch { this.save({ ...issue, status:'failed', error:'上次运行中断，可重试；已保留来源。' }) }
    }
    // One-time bridge for old stars. Existing bookmark links are never re-created after a manual deletion.
    if(this.planning)for(const row of this.db.prepare("SELECT body FROM research_issues WHERE kind='news'").all()) {
      const issue=JSON.parse(String(row.body)) as DigestIssue
      for(const item of issue.items)if(item.starred&&!item.bookmarkId){const source=issue.sources.find(s=>s.id===item.sourceId);if(source){item.bookmarkId=this.planning.collectMessage({topic:issue.subscription?.topics.join('、')||'AI',category:item.category,title:item.title,url:source.url,note:item.summary+'\n\n'+item.why});this.save(issue)}}
    }
  }
  async close(): Promise<void> {
    this.controller.abort()
    await Promise.allSettled([...this.pending])
    while(this.ticking) await new Promise((resolve)=>setTimeout(resolve,20))
    this.db.close()
  }
  list(kind: DigestKind): DigestIssue[] {
    if(!['papers','news'].includes(kind))throw Error('栏目不存在')
    const bookmarks=this.planning&&kind==='news'?new Set(this.planning.messageBookmarkIds()):null
    return this.db.prepare(`SELECT body FROM research_issues WHERE kind=? ORDER BY rowid DESC${kind==='news'?'':' LIMIT 100'}`).all(kind).map((r) => {const issue=JSON.parse(String(r.body)) as DigestIssue;if(bookmarks)for(const item of issue.items)if(item.bookmarkId)item.starred=bookmarks.has(item.bookmarkId);return issue})
  }
  private save(issue: DigestIssue): void { this.db.prepare('INSERT INTO research_issues(id,kind,body) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(issue.id,issue.kind,JSON.stringify(issue)) }
  private completedToday(kind: DigestKind, channel='legacy-news'): boolean { return kind==='news' && this.list('news').some(issue=>messageChannel(issue)===channel&&issue.status==='complete'&&beijingDay(new Date(issue.createdAt))===beijingDay()) }
  private issueKeys(issue: DigestIssue): string[] {
    return [...new Set([...(issue.seenKeys??[]), ...issue.items.flatMap(item=>{const source=issue.sources.find(entry=>entry.id===item.sourceId);return source?[source.id,sourceKey(source.title)]:[item.sourceId]})])]
  }
  private complete(issue: DigestIssue): void {
    if(issue.kind!=='news'){this.save(issue);return}
    // Only prune after the replacement has valid, durable output. Failed updates keep the old edition.
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const previousIssues=this.list('news').filter(previous=>previous.id!==issue.id&&messageChannel(previous)===messageChannel(issue))
      const carried=new Set<string>(this.issueKeys(issue))
      for(const previous of previousIssues)for(const key of this.issueKeys(previous))carried.add(key)
      issue.seenKeys=[...carried]
      this.save(issue)
      for(const previous of previousIssues) {
        const remembered=this.issueKeys(previous)
        const items=previous.items.filter(item=>item.starred)
        if(!items.length){this.db.prepare('DELETE FROM research_issues WHERE id=?').run(previous.id);continue}
        const sourceIds=new Set(items.map(item=>item.sourceId))
        this.save({...previous,items,sources:previous.sources.filter(source=>sourceIds.has(source.id)),seenKeys:remembered,overview:'',warnings:[],error:undefined,sessionId:undefined,status:'complete',archived:true})
        this.db.prepare('UPDATE research_issues SET result_json=NULL WHERE id=?').run(previous.id)
      }
      this.db.exec('COMMIT')
    } catch(error){this.db.exec('ROLLBACK');throw error}
  }
  subscriptions(): DigestSubscription[] {
    const configs=this.db.prepare('SELECT body FROM research_subscriptions ORDER BY rowid').all().map(r=>JSON.parse(String(r.body)) as DigestSubscription).map(c=>c.kind==='news'?{...c,id:c.id??'legacy-news',repeat:c.repeat??'daily'}:c)
    if(!configs.some(c=>c.kind==='papers'))configs.unshift({kind:'papers',enabled:false,time:'09:00',topics:['医学诊断','推理模型','多模态大模型']})
    return configs
  }
  subscribe(input: DigestSubscription): void {
    const config=normalizeSubscription(input),key=subscriptionKey(config)
    if(this.active.has(key))throw Error('请等待这个主题生成完成后再修改')
    if(config.kind==='news'&&!this.subscriptions().some(c=>c.id===config.id)&&this.subscriptions().filter(c=>c.kind==='news').length>=30)throw Error('最多创建 30 个主题')
    this.db.prepare('INSERT INTO research_subscriptions(kind,body) VALUES (?,?) ON CONFLICT(kind) DO UPDATE SET body=excluded.body').run(key,JSON.stringify(config))
  }
  removeSubscription(id:string):void {
    const config=this.subscriptions().find(c=>c.kind==='news'&&c.id===id)
    if(!config)throw Error('主题不存在')
    if(this.active.has(subscriptionKey(config))||this.list('news').some(i=>messageChannel(i)===id&&['collecting','generating'].includes(i.status)))throw Error('请等待主题生成完成')
    this.db.prepare('DELETE FROM research_subscriptions WHERE kind=?').run(subscriptionKey(config))
  }
  async generate(kind: DigestKind, subscriptionId?:string): Promise<DigestIssue> {
    if (!['papers','news'].includes(kind) || this.controller.signal.aborted) throw new Error('任务不可用')
    const config=this.subscriptions().find(c=>c.kind===kind&&(kind==='papers'||c.id===(subscriptionId??'legacy-news'))) ?? (!subscriptionId?{kind,enabled:false,time:'09:00',topics:['人工智能'],id:kind==='news'?'legacy-news':undefined}:undefined)
    if(!config)throw Error('订阅主题不存在，请刷新后再试')
    const channel=config.id??'legacy-news',key=subscriptionKey(config)
    if (this.active.has(key) || this.list(kind).some((i) => (kind!=='news'||messageChannel(i)===channel)&&(i.status === 'collecting'||i.status === 'generating'))) throw new Error('该主题已有任务运行中')
    if (this.completedToday(kind,channel)) throw new Error('今日消息已生成，这个主题每天可成功生成一次（北京时间）。')
    this.active.add(key)
    try { if (!await this.ready()) throw new Error('请先配置模型并等待连接就绪') }
    catch(error){this.active.delete(key);throw error}
    const previous = this.list(kind).find(i=>kind!=='news'||messageChannel(i)===channel)
    const issue: DigestIssue = { id:crypto.randomUUID(),kind,createdAt:new Date().toISOString(),status:'collecting',sources:[],items:[],warnings:[],...(kind==='news'?{subscriptionId:channel,subscription:config}:{}) }
    this.save(issue)
    this.db.prepare('UPDATE research_subscriptions SET last_day=? WHERE kind=?').run(beijingDay(),key)
    const task = (async () => {
      try {
        const collected = previous?.status === 'failed' && previous.sources.length && JSON.stringify(previous.subscription)===JSON.stringify(issue.subscription) && beijingDay(new Date(previous.createdAt)) === beijingDay() ? { sources:previous.sources,warnings:previous.warnings } : await collectSources(kind,config.topics,this.controller.signal,kind==='news'?config:undefined)
        const history = this.db.prepare('SELECT body FROM research_issues WHERE kind=?').all(kind).map((r)=>JSON.parse(String(r.body)) as DigestIssue).filter((i) => i.status === 'complete'&&(kind!=='news'||messageChannel(i)===channel))
        const seen = new Set(history.flatMap((i) => this.issueKeys(i)))
        const library = kind === 'papers' ? new Set((await this.papers.list()).map((p) => sourceKey(p.title))) : new Set<string>()
        issue.sources = collected.sources.filter((s) => !seen.has(s.id) && !seen.has(sourceKey(s.title)) && !library.has(sourceKey(s.title)))
        issue.warnings = collected.warnings
        if (!issue.sources.length) throw new Error('没有可用的新内容；上一期仍然保留。')
        this.save(issue)
        if (this.controller.signal.aborted) return
        issue.sessionId = await this.api.createDigestTask(this.paths.workspace, issue)
        if (!this.controller.signal.aborted) { issue.status = 'generating'; this.save(issue) }
      } catch (e) { if (!this.controller.signal.aborted) this.save({ ...issue,status:'failed',error:redact(e) }) }
      finally { this.active.delete(key) }
    })()
    this.pending.add(task)
    void task.finally(()=>this.pending.delete(task))
    return issue
  }
  async tick(): Promise<void> {
    if (this.ticking || this.controller.signal.aborted) return
    this.ticking = true
    try {
      for (const kind of ['papers','news'] as const) for (const issue of this.list(kind).filter((i) => i.status === 'generating')) {
        const row = this.db.prepare('SELECT result_json FROM research_issues WHERE id=?').get(issue.id)
        if(!row)continue
        if (row?.result_json) {
          try { Object.assign(issue, validateDigest(JSON.parse(String(row.result_json)), issue.sources,issue.subscription?.count??8), { status:'complete' }) }
          catch (e) { issue.status='failed'; issue.error=redact(e) }
          if(issue.status==='complete')this.complete(issue);else this.save(issue)
        } else if (issue.sessionId && Date.now()-Date.parse(issue.createdAt)>10_000 && await this.api.taskEnded(issue.sessionId).catch(()=>false)) {
          // A model acknowledgement or an API error is not a completed digest.
          const latest=this.db.prepare('SELECT result_json FROM research_issues WHERE id=?').get(issue.id)
          if(!latest?.result_json){issue.status='failed';issue.error='模型会话已结束，但未保存有效正文。请重试或在助手中查看该任务。';this.save(issue)}
        } else if (Date.now() - Date.parse(issue.createdAt) > 20*60_000) { issue.status='failed'; issue.error='生成超时，已保留采集内容，可重试。'; this.save(issue) }
      }
      if (await this.ready()) for (const config of this.subscriptions()) {
        if (config.kind === 'papers') continue
        const key=subscriptionKey(config),row = this.db.prepare('SELECT last_day FROM research_subscriptions WHERE kind=?').get(key)
        if (isDue(config,String(row?.last_day ?? '')) && !this.completedToday(config.kind,config.id) && !this.active.has(key) && !this.list(config.kind).some((i) => (config.kind!=='news'||messageChannel(i)===(config.id??'legacy-news'))&&(i.status === 'collecting'||i.status === 'generating'))) await this.generate(config.kind,config.id)
      }
    } finally { this.ticking=false }
  }
  read(id: string, itemId: string): void { const issue=this.get(id); const item=issue.items.find((i)=>i.id===itemId); if(item) { item.read=true; this.save(issue) } }
  star(id: string,itemId: string,starred: boolean): void {
    if(typeof starred!=='boolean')throw new Error('收藏状态无效')
    const issue=this.get(id),item=issue.items.find(item=>item.id===itemId)
    if(issue.kind!=='news'||!item)throw new Error('新闻不存在')
    const source=issue.sources.find(s=>s.id===item.sourceId)
    if(this.planning&&source) {
      if(starred)item.bookmarkId=this.planning.collectMessage({topic:issue.subscription?.topics.join('、')||'AI',category:item.category,title:item.title,url:source.url,note:item.summary+'\n\n'+item.why})
      else if(item.bookmarkId&&this.planning.messageBookmarkIds().includes(item.bookmarkId))this.planning.removeBookmark(item.bookmarkId)
    }
    item.starred=starred
    if(issue.archived){issue.items=issue.items.filter(item=>item.starred);const ids=new Set(issue.items.map(item=>item.sourceId));issue.sources=issue.sources.filter(source=>ids.has(source.id))}
    if(issue.archived&&!issue.items.length)this.db.prepare('DELETE FROM research_issues WHERE id=?').run(id)
    else this.save(issue)
  }
  private get(id: string): DigestIssue { const row=this.db.prepare('SELECT body FROM research_issues WHERE id=?').get(id); if(!row) throw new Error('早报不存在'); return JSON.parse(String(row.body)) }
  async importPaper(id: string,itemId: string) {
    const issue=this.get(id); const item=issue.items.find((i)=>i.id===itemId); const source=issue.sources.find((s)=>s.id===item?.sourceId)
    if(!source?.pdfUrl || !/^https:\/\/arxiv\.org\/pdf\/[\d.]+$/.test(source.pdfUrl)) throw new Error('没有可下载的公开 PDF')
    const bytes=await boundedFetch(source.pdfUrl,this.controller.signal,50_000_000)
    if (!Buffer.from(bytes.slice(0,1024)).includes(Buffer.from('%PDF-'))) throw new Error('下载内容不是 PDF')
    const temporary=path.join(this.paths.temp,`${crypto.randomUUID()}.pdf`)
    try { await fs.writeFile(temporary,bytes); return await this.papers.import(temporary) } finally { await fs.rm(temporary,{force:true}) }
  }
}
