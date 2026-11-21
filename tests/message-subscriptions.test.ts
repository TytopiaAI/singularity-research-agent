import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, expect, it, vi } from 'vitest'
import { beijingDay, digestIsDue, normalizeSubscription } from '../src/shared/digest'
import { DigestService, validateDigest } from '../src/main/digest-service'
import { PlanningStore } from '../src/main/planning-store'
import { PaperRepository } from '../src/main/paper-repository'
import { createAppPaths } from '../src/main/paths'
import { HarnessApi } from '../src/main/harness-api'
import type { DigestIssue, DigestSource, DigestSubscription } from '../src/shared/types'
import { collectSources, messageImages, parseFeed } from '../src/main/digest-sources'

const cleanup:Array<()=>unknown>=[]
afterEach(async()=>{vi.unstubAllGlobals();for(const fn of cleanup.splice(0).reverse())await fn()})
const config=(id='medicine'):DigestSubscription=>normalizeSubscription({id,kind:'news',enabled:true,time:'09:00',topics:[id],repeat:'weekly',weekdays:[1,3,5],startDate:'2026-11-02'})
const source:DigestSource={id:'source',title:'公开来源',url:'https://example.org/medicine',publishedAt:new Date().toISOString(),text:'公开来源内容',official:false}
async function setup(){
 const parent=path.join(process.cwd(),'.local-data/temp');fs.mkdirSync(parent,{recursive:true});const root=fs.mkdtempSync(path.join(parent,'message-subscriptions-'));cleanup.push(()=>fs.rmSync(root,{recursive:true,force:true}))
 const paths=createAppPaths({resourceRoot:process.cwd(),dataRoot:path.join(root,'data')}),repo=new PaperRepository(paths),planning=new PlanningStore(paths.database)
 cleanup.push(()=>repo.close());cleanup.push(()=>planning.close())
 const service=new DigestService(paths,new HarnessApi(()=>null),repo,async()=>false,planning);cleanup.push(()=>service.close())
 const db=new DatabaseSync(repo.databasePath);cleanup.push(()=>db.close())
 const insert=(id:string,channel:string,status:DigestIssue['status']='complete',result=false)=>{
  const issue:DigestIssue={id,kind:'news',subscriptionId:channel,subscription:config(channel),createdAt:new Date().toISOString(),status,sources:[source],items:status==='complete'?[{id:'item-'+id,sourceId:source.id,title:'一条消息的标题',summary:'来源里的真实消息内容',why:'这条消息的重要影响',category:'临床研究'}]:[],warnings:[]}
  db.prepare('INSERT INTO research_issues VALUES(?,?,?,?)').run(id,'news',JSON.stringify(issue),result?JSON.stringify({overview:'当前领域的变化趋势',items:[{sourceId:source.id,title:'最新消息的标题',summary:'基于来源真实整理的内容',why:'这条消息的重要影响'}]}):null);return issue
 }
 return {service,db,planning,insert,paths,repo}
}
it('requires a topic and weekly days, normalizes optional settings, and rejects unbounded or invalid inputs',()=>{
 expect(config()).toMatchObject({count:6,rangeDays:7,presentation:'mixed',includeOverview:true})
 for(const patch of [{topics:[' ']},{weekdays:[]},{weekdays:[9]},{time:'25:00'},{count:21},{rangeDays:0},{startDate:'2026-02-30'},{presentation:'script'},{imageCardStyle:'script'},{repeat:'unknown'}])expect(()=>normalizeSubscription({...config(),...patch} as DigestSubscription)).toThrow()
 expect(normalizeSubscription({...config(),imageCardStyle:'immersive'}).imageCardStyle).toBe('immersive')
})
it('schedules selected weekdays in Beijing time and never runs the same subscription twice in one day',()=>{
 const c=config();expect(digestIsDue(c,'',new Date('2026-11-02T00:59:00Z'))).toBe(false)
 expect(digestIsDue(c,'',new Date('2026-11-02T01:00:00Z'))).toBe(true)
 expect(digestIsDue(c,'',new Date('2026-11-03T01:00:00Z'))).toBe(false)
 expect(digestIsDue(c,'2026-11-04',new Date('2026-11-04T12:00:00Z'))).toBe(false)
 expect(digestIsDue({...c,enabled:false},'',new Date('2026-11-04T01:00:00Z'))).toBe(false)
})
it('supports alternating weeks, intervals, month-end, leap-year, once and future starts',()=>{
 const c=config();expect(digestIsDue({...c,repeat:'biweekly'},'',new Date('2026-11-09T01:00:00Z'))).toBe(false)
 expect(digestIsDue({...c,repeat:'biweekly'},'',new Date('2026-11-16T01:00:00Z'))).toBe(true)
 expect(digestIsDue({...c,repeat:'interval',intervalDays:3},'',new Date('2026-11-05T01:00:00Z'))).toBe(true)
 expect(digestIsDue({...c,repeat:'monthly',startDate:'2026-01-31'},'',new Date('2026-02-28T01:00:00Z'))).toBe(true)
 expect(digestIsDue({...c,repeat:'yearly',startDate:'2024-02-29'},'',new Date('2027-02-28T01:00:00Z'))).toBe(true)
 expect(digestIsDue({...c,repeat:'once'},'2026-11-02',new Date('2026-11-03T01:00:00Z'))).toBe(false)
 expect(digestIsDue({...c,repeat:'daily',startDate:'2026-12-01'},'',new Date('2026-11-03T01:00:00Z'))).toBe(false)
})
it('persists multiple independent subscriptions, imports the old news configuration and preserves history when removing a subscription',async()=>{
 const {service,db,insert,paths,repo,planning}=await setup()
 expect(service.subscriptions().filter(c=>c.kind==='news')).toEqual([])
 db.prepare('INSERT INTO research_subscriptions(kind,body) VALUES(?,?)').run('news',JSON.stringify({kind:'news',enabled:false,time:'09:00',topics:['人工智能']}))
 service.subscribe(config());service.subscribe(config('design'));insert('old','medicine')
 const reopened=new DigestService(paths,new HarnessApi(()=>null),repo,async()=>false,planning);cleanup.push(()=>reopened.close())
 expect(reopened.subscriptions().filter(c=>c.kind==='news').map(c=>c.id)).toEqual(['legacy-news','medicine','design'])
 service.removeSubscription('medicine');expect(service.list('news')).toHaveLength(1);expect(service.subscriptions().some(c=>c.id==='design')).toBe(true)
})
it('keeps other themes intact when replacing an edition and applies the successful daily quota per theme',async()=>{
 const {service,insert}=await setup();service.subscribe(config());service.subscribe(config('design'))
 insert('previous','medicine');insert('other','design');insert('next','medicine','generating',true)
 await service.tick();expect(service.list('news').map(i=>i.id).sort()).toEqual(['next','other'])
 await expect(service.generate('news','medicine')).rejects.toThrow('今日消息已生成')
 service.subscribe(config('culture'));await expect(service.generate('news','culture')).rejects.toThrow('配置模型')
})
it('syncs a star into Planning by theme and AI subcategory, deduplicates links, preserves manual moves and reflects deletion',async()=>{
 const {service,planning,insert}=await setup();insert('first','medicine')
 service.star('first','item-first',true)
 const bookmark=planning.get().bookmarks[0],categories=planning.get().categories
 expect(categories.find(c=>c.id===bookmark.categoryId)?.name).toBe('临床研究')
 expect(categories.find(c=>c.name==='临床研究')?.parentId).toBe(categories.find(c=>c.name==='medicine')?.id)
 planning.saveBookmark({...bookmark,categoryId:'bookmark-design',note:'我的人工笔记'})
 service.star('first','item-first',true);expect(planning.get().bookmarks).toHaveLength(1)
 expect(planning.get().bookmarks[0]).toMatchObject({categoryId:'bookmark-design',note:'我的人工笔记'})
 planning.removeBookmark(bookmark.id);expect(service.list('news')[0].items[0].starred).toBe(false)
 service.star('first','item-first',true);service.star('first','item-first',false);expect(planning.get().bookmarks).toHaveLength(0)
})
it('enforces requested item limits and accepts short AI category labels only with verified sources',()=>{
 const items=Array.from({length:10},(_,i)=>({sourceId:'s'+i,title:'消息标题'+i,summary:'消息摘要内容',why:'消息影响内容',category:'研究进展'})),sources=items.map(i=>({...source,id:i.sourceId}))
 expect(validateDigest({overview:'概览',items},sources,10).items).toHaveLength(10)
 expect(()=>validateDigest({overview:'概览',items},sources,6)).toThrow()
 expect(beijingDay(new Date('2026-11-04T16:01:00Z'))).toBe('2026-11-05')
})
it('queries non-AI topics with the selected range and ignores remote or executable artwork outside trusted feed hosts',async()=>{
 const fetcher=vi.fn(async()=>new Response(`<rss><channel><item><title>博物馆新展览</title><link>https://example.org/exhibition</link><pubDate>${new Date().toUTCString()}</pubDate><description>来源中的展览信息与公开日期</description><media:thumbnail xmlns:media="http://search.yahoo.com/mrss/" url="https://127.0.0.1/private.png"/></item></channel></rss>`))
 vi.stubGlobal('fetch',fetcher)
 const collected=await collectSources('news',['博物馆'],new AbortController().signal,{...config(),topics:['博物馆'],rangeDays:30,presentation:'text'})
 expect(collected.sources).toHaveLength(1);expect(new URL(String(fetcher.mock.calls[0]?.[0])).searchParams.get('q')).toBe('博物馆 when:30d')
 expect(collected.sources[0].imageUrl).toBeUndefined()
 const sources=parseFeed('<rss><channel><item><title>图片消息</title><link>https://example.org/a</link><media:thumbnail xmlns:media="http://search.yahoo.com/mrss/" url="https://www.qbitai.com/picture.svg"/></item></channel></rss>')
 expect(sources[0].imageUrl).toBe('https://www.qbitai.com/picture.svg')
 vi.stubGlobal('fetch',vi.fn(async()=>new Response('<svg onload="evil()"></svg>')))
 await messageImages(sources,new AbortController().signal);expect(sources[0].imageData).toBeUndefined()
})
