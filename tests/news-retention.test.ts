import fs from 'node:fs/promises'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, expect, it, vi } from 'vitest'
import { DigestService } from '../src/main/digest-service'
import { createAppPaths } from '../src/main/paths'
import { PaperRepository } from '../src/main/paper-repository'
import { HarnessApi } from '../src/main/harness-api'
import type { DigestIssue, DigestSource } from '../src/shared/types'

const clean:Array<()=>Promise<void>>=[]
afterEach(async()=>{vi.useRealTimers();for(const fn of clean.splice(0).reverse())await fn()})
async function setup(ready:()=>Promise<boolean>=async()=>false){
 const parent=path.join(process.cwd(),'.local-data/temp');await fs.mkdir(parent,{recursive:true});const root=await fs.mkdtemp(path.join(parent,'news-retention-'))
 clean.push(()=>fs.rm(root,{recursive:true,force:true}))
 const paths=createAppPaths({resourceRoot:process.cwd(),dataRoot:path.join(root,'data')}),repo=new PaperRepository(paths);clean.push(async()=>repo.close())
 const service=new DigestService(paths,new HarnessApi(()=>null),repo,ready);clean.push(()=>service.close())
 const db=new DatabaseSync(repo.databasePath);clean.push(async()=>db.close())
 const insert=(issue:DigestIssue,result:unknown=null)=>db.prepare('INSERT INTO research_issues VALUES(?,?,?,?)').run(issue.id,issue.kind,JSON.stringify(issue),result===null?null:JSON.stringify(result))
 return {service,db,insert,paths,repo}
}
const source=(id:string):DigestSource=>({id,title:'来源标题'+id,url:'https://example.org/'+id,publishedAt:'2026-10-31',text:'来源完整内容'+id,official:true})
const item=(id:string,starred=false)=>({id,sourceId:id,title:'新闻标题'+id,summary:'新闻完整摘要'+id,why:'新闻的研究意义'+id,starred})
const edition=(id:string,date:string,status:DigestIssue['status']='complete'):DigestIssue=>({id,kind:'news',createdAt:date,status,sources:[source(id)],items:[item(id)],warnings:[]})
const result=(id:string)=>({overview:'今日进展汇总',items:[{sourceId:id,title:'今天的重要新闻',summary:'这一条新闻的完整摘要',why:'值得关注的具体原因'}]})

it('retains only starred historical news and matching sources after a successful replacement',async()=>{
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-31T09:00:00Z'))
 const {service,db,insert}=await setup()
 insert({...edition('old','2026-10-30T09:00:00Z'),items:[item('keep',true),item('remove')],sources:[source('keep'),source('remove')],overview:'过期概览'},result('remove'))
 insert(edition('fresh',new Date().toISOString(),'generating'),result('fresh'))
 await service.tick()
 expect(service.list('news').find(i=>i.id==='old')).toMatchObject({archived:true,overview:'',items:[{id:'keep',starred:true}],sources:[{id:'keep'}]})
 expect(service.list('news').find(i=>i.id==='fresh')?.seenKeys).toEqual(expect.arrayContaining(['keep','remove']))
 expect(db.prepare('SELECT result_json FROM research_issues WHERE id=?').get('old')?.result_json).toBeNull()
 expect(JSON.stringify(service.list('news'))).not.toContain('新闻完整摘要remove')
 await expect(service.generate('news')).rejects.toThrow('今日消息已生成')
 service.star('old','keep',false)
 expect(service.list('news').find(i=>i.id==='old')).toBeUndefined()
 const current=service.list('news')[0];service.star(current.id,current.items[0].id,true);service.star(current.id,current.items[0].id,false)
 expect(service.list('news')[0].items).toHaveLength(1)
 await expect(service.generate('news')).rejects.toThrow('今日消息已生成')
 vi.setSystemTime(new Date('2026-10-31T16:00:00Z'))
 await expect(service.generate('news')).rejects.toThrow('配置模型')
})
it('keeps the previous complete edition on failure and does not consume a successful daily quota',async()=>{
 const {service,insert}=await setup()
 insert({...edition('previous','2026-10-29T09:00:00Z'),items:[item('a',true),item('b')],sources:[source('a'),source('b')]})
 insert(edition('broken',new Date().toISOString(),'generating'),{overview:'无效正文',items:[]})
 await service.tick()
 expect(service.list('news').find(i=>i.id==='previous')?.items).toHaveLength(2)
 expect(service.list('news').find(i=>i.id==='broken')?.status).toBe('failed')
 await expect(service.generate('news')).rejects.toThrow('配置模型')
})
it('reserves concurrent requests before awaiting model readiness and releases a failed reservation',async()=>{
 let resolve!:(ready:boolean)=>void
 const ready=vi.fn(()=>new Promise<boolean>(done=>{resolve=done}))
 const {service}=await setup(ready)
 const first=service.generate('news');const rejection=expect(first).rejects.toThrow('配置模型')
 await expect(service.generate('news')).rejects.toThrow('任务运行中')
 resolve(false);await rejection
 ready.mockImplementation(async()=>false)
 await expect(service.generate('news')).rejects.toThrow('配置模型')
})
it('does not hide older starred editions at the previous 100-issue list limit',async()=>{
 const {service,insert}=await setup()
 for(let i=0;i<105;i++)insert({...edition('archive-'+i,'2026-01-01T00:00:00Z'),archived:true,items:[item('archive-'+i,true)]})
 expect(service.list('news')).toHaveLength(105)
 expect(()=>service.star('archive-0','archive-0','yes' as unknown as boolean)).toThrow('收藏状态无效')
})

it('reloads favorites and the daily quota from SQLite in a fresh service instance',async()=>{
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-31T09:00:00Z'))
 const {service,insert,paths,repo}=await setup()
 insert(edition('today',new Date().toISOString()))
 service.star('today','today',true)
 const reopened=new DigestService(paths,new HarnessApi(()=>null),repo,async()=>false)
 clean.push(()=>reopened.close())
 expect(reopened.list('news')[0].items[0].starred).toBe(true)
 await expect(reopened.generate('news')).rejects.toThrow('今日消息已生成')
})
