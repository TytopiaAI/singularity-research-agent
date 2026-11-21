import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { createAppPaths } from '../src/main/paths'
import { FieldKnowledgeStore, nextFieldMonth } from '../src/main/field-knowledge-store'
import { ResearchExplorer } from '../src/main/research-explorer'
import type { PaperRepository } from '../src/main/paper-repository'
import { layoutFieldGraph, fieldDate, type FieldKnowledge } from '../src/shared/field-knowledge'
import type { ResearchRun } from '../src/shared/research-explorer'

const roots:string[]=[], stores:{close:()=>Promise<void>}[]=[]
afterEach(async()=>{await Promise.all(stores.splice(0).map(s=>s.close()));for(const root of roots.splice(0)) fs.rmSync(root,{recursive:true,force:true})})
function run(id='run',n=5):ResearchRun { return {id,createdAt:'2026-10-15T00:00:00Z',request:{mode:'survey',topics:['异常检测'],inspirations:[],count:5,publicationYears:2,preprintMonths:6},status:'complete',progress:'已完成',overview:'',insights:[],warnings:[],sources:Array.from({length:n},(_,i)=>({id:`s${i}`,arxivId:`2601.${String(i).padStart(5,'0')}`,title:`Synthetic method ${i}`,date:`2026-0${i%9+1}-01`,authors:'Fixture',venue:'arXiv',url:`https://arxiv.org/abs/2601.${String(i).padStart(5,'0')}`,abstract:'Synthetic material',evidenceKind:'full-text',roles:['core'],topics:['异常检测'],group:'preprint'})),items:Array.from({length:n},(_,i)=>({sourceId:`s${i}`,summary:'测试用摘要',method:i<3?'通过重建误差判断异常':'通过知识嵌入提供条件',directions:[i<3?'重建':'知识嵌入'],datasets:'独立划分',evaluation:'相同预算与基线比较',risks:'预训练重叠待核验',transfer:'推演：测试域外迁移',contribution:'uncertain',contributionReason:'测试资料',evidence:[]}))} }
const response=(ids:string[])=>JSON.stringify({sections:['development','development','development','development','evaluation','insight','insight','insight'].map((kind,i)=>({kind,title:`综述 ${i}`,body:'测试用综合段落，不代表真实论文结论。',sourceIds:[ids[i%ids.length]]}))})
function attach(store: FieldKnowledgeStore, input: ResearchRun, backfill = false) {
  const field = store.list().find(item => item.title === '异常检测') ?? store.create('异常检测')
  input.request.fieldId = field.id
  store.ingest(input, backfill)
  return field
}
function setup(reply:ConstructorParameters<typeof FieldKnowledgeStore>[2]=async()=>{throw Error('离线测试')}) {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'field-knowledge-'));roots.push(root)
 const paths=createAppPaths({resourceRoot:root,dataRoot:path.join(root,'data')}),database=path.join(paths.database,'research.sqlite')
 const store=new FieldKnowledgeStore(paths,database,reply);stores.push(store);return {root,paths,database,store}
}
describe('persistent field knowledge and direction graph',()=>{
 it('accumulates across searches, deduplicates arXiv revisions, preserves curation/notes and survives reopening',async()=>{
  const {store,paths,database}=setup();const field=attach(store,run()), initial=store.get(field.id)
  expect(initial.paperCount).toBe(5);expect(initial.directionCount).toBe(2)
  const paper=initial.papers[0];store.setDirections(field.id,paper.id,['重建','知识蒸馏']);store.saveNotes(field.id,'验证重建误差与语义异常的联系','')
  const repeated=run('second');repeated.sources[0].arxivId+='v2';repeated.sources[0].title='Revised synthetic title';attach(store,repeated)
  expect(store.get(field.id).paperCount).toBe(5);expect(store.get(field.id).papers.find(p=>p.id===paper.id)?.directions).toEqual(['重建','知识蒸馏'])
  expect(store.get(field.id).papers[0].origins).toHaveLength(2)
  const revision=store.get(field.id).revision;attach(store,run(),true);attach(store,repeated,true);expect(store.get(field.id).revision).toBe(revision)
  expect(()=>store.saveNotes(field.id,'覆盖','错误的旧笔记')).toThrow(/其他窗口/)
  await store.close();const reopened=new FieldKnowledgeStore(paths,database,async()=>'' );stores.push(reopened)
  const persisted=reopened.get(field.id);expect(persisted.notes).toContain('语义异常');expect(persisted.paperCount).toBe(5)
  expect(fs.readFileSync(persisted.documentPath,'utf8')).toBe(persisted.documentMarkdown)
  expect(persisted.documentMarkdown).toContain('知识蒸馏')
 })
 it('links directions through publication time and keeps manually asserted mechanisms separate',()=>{
  const {store}=setup();const field=store.get(attach(store,run()).id)
  const graph=layoutFieldGraph(field.papers,[])
  expect(graph.lanes.map(l=>l.title).sort()).toEqual(['知识嵌入','重建']);expect(graph.edges).toHaveLength(3)
  expect(graph.edges.every(e=>!e.relation)).toBe(true)
  const reconstruction=field.papers.filter(p=>p.directions.includes('重建'));expect(reconstruction).toHaveLength(3)
  expect(graph.nodes.find(n=>n.paper.id===reconstruction[0].id)!.x).toBeLessThan(graph.nodes.find(n=>n.paper.id===reconstruction[2].id)!.x)
  const next=store.addRelation(field.id,{from:reconstruction[0].id,to:reconstruction[2].id,kind:'inspires',reason:'待核验：共享重建机制'})
  expect(layoutFieldGraph(next.papers,next.relations).edges.filter(e=>e.relation)).toHaveLength(1)
  expect(()=>store.addRelation(field.id,{from:reconstruction[2].id,to:reconstruction[0].id,kind:'improves',reason:'时间反向'})).toThrow(/较早/)
  expect(()=>store.addRelation(field.id,{from:'foreign-field-paper',to:reconstruction[0].id,kind:'combines',reason:'跨库'})).toThrow()
  expect(fieldDate('2026-02-30')).toBe('');const filtered=layoutFieldGraph(field.papers,[],'重建','year');expect(filtered.shown).toBe(3);expect(filtered.dates).toEqual(['2026'])
 })
 it('keeps every paper in storage and the document even when the graph is bounded',()=>{
  const {store}=setup();const field=store.get(attach(store,run('large',105)).id)
  expect(field.paperCount).toBe(105);expect(layoutFieldGraph(field.papers,[]).shown).toBe(100)
  expect(field.documentMarkdown).toContain('Synthetic method 104')
 })
 it('does not downgrade original-text analysis with a subsequent abstract-only search',()=>{
  const {store}=setup();attach(store,run());const later=run('abstract');later.sources[0].evidenceKind='abstract';later.items[0].method='信息不足';attach(store,later)
  const field=store.get(store.list()[0].id);expect(field.papers[0].source.evidenceKind).toBe('full-text');expect(field.papers[0].analysis.method).toContain('重建')
 })
 it('updates source-cited synthesis without overwriting concurrent notes or hiding newer papers',async()=>{
  let release!:(value:string)=>void;let snapshot!:FieldKnowledge
  const {store}=setup(async()=>new Promise(resolve=>{release=resolve}));snapshot=store.get(attach(store,run()).id)
  const pending=store.refresh(snapshot.id);expect(store.get(snapshot.id).documentState).toBe('updating')
  store.saveNotes(snapshot.id,'独立维护的研究假设','');const next=run('new');next.sources[0]={...next.sources[0],id:'new-source',arxivId:'2610.12345',title:'New synthetic paper',date:'2026-10-01'};next.items=[{...next.items[0],sourceId:'new-source'}];attach(store,next)
  release(response(snapshot.papers.map(p=>p.id)));const saved=await pending
  expect(saved.documentState).toBe('outdated');expect(saved.paperCount).toBe(6);expect(saved.notes).toBe('独立维护的研究假设');expect(saved.documentVersion).toBe(1);expect(saved.synthesisCoverage).toBe(5)
  expect(fs.readFileSync(saved.documentPath,'utf8')).toContain('New synthetic paper')
 })
 it('rejects invented synthesis citations, retains the last valid document and permits retry',async()=>{
  let ids:string[]=[],bad=false
  const {store}=setup(async()=>response(bad?['fabricated']:ids));const field=store.get(attach(store,run()).id);ids=field.papers.map(p=>p.id)
  expect((await store.refresh(field.id)).documentState).toBe('current');bad=true
  await expect(store.refresh(field.id)).rejects.toThrow(/未收录/)
  expect(store.get(field.id)).toMatchObject({documentVersion:1,documentState:'failed',sections:expect.arrayContaining([expect.objectContaining({kind:'development'})])})
  bad=false;expect((await store.refresh(field.id)).documentVersion).toBe(2)
 })
 it('backfills retained search history only into a field the user already created',async()=>{
  const {store,paths,database}=setup();const field=store.create('异常检测');await store.close();const db=new DatabaseSync(database);db.exec('CREATE TABLE research_explorations(id TEXT PRIMARY KEY,body TEXT NOT NULL)')
  for(let i=0;i<53;i++){const entry=run(`history-${i}`,1);entry.request.fieldId=field.id;entry.sources[0].arxivId=`2601.${String(i).padStart(5,'0')}`;entry.sources[0].title=`Historic paper ${i}`;db.prepare('INSERT INTO research_explorations VALUES(?,?)').run(entry.id,JSON.stringify(entry))}db.close()
  const service=new ResearchExplorer(paths,{databasePath:database} as PaperRepository,async()=>'' );stores.push(service)
  expect(service.list()).toHaveLength(50);expect(service.fields.list()[0].paperCount).toBe(53)
 })
 it('does not create a field from search history',async()=>{
  const {store,paths,database}=setup();await store.close();const db=new DatabaseSync(database);db.exec('CREATE TABLE research_explorations(id TEXT PRIMARY KEY,body TEXT NOT NULL)')
  const entry=run('history-only',1);db.prepare('INSERT INTO research_explorations VALUES(?,?)').run(entry.id,JSON.stringify(entry));db.close()
  const service=new ResearchExplorer(paths,{databasePath:database} as PaperRepository,async()=>'' );stores.push(service)
  expect(service.fields.list()).toHaveLength(0)
 })
})

it('persists hierarchy, stars, monthly reports and handles short calendar months',async()=>{
 const {store,paths,database}=setup();const parent=store.create('异常检测'),child=store.create('重建异常检测',parent.id)
 expect(child.parentId).toBe(parent.id)
 const input=run();input.request.fieldId=child.id;store.ingest(input)
 const paper=store.get(child.id).papers[0];store.star(child.id,paper.id,true);store.ingest({...input,id:'later'})
 expect(store.get(child.id).papers.find(p=>p.id===paper.id)?.starred).toBe(true)
 expect(store.setMonthly(child.id,true).monthly).toBe(true)
 expect(nextFieldMonth(new Date('2026-01-31T12:00:00Z')).toISOString()).toBe('2026-02-28T12:00:00.000Z')
 store.monthlyResult(child.id,{...input,status:'complete',overview:'本期新进展',insights:['证据边界']})
 store.monthlyResult(child.id,{...input,status:'complete',overview:'本期新进展',insights:['证据边界']})
 expect(store.get(child.id).reports).toHaveLength(1)
 expect(store.get(child.id).documentMarkdown).toContain('本期新进展')
 await store.close();const reopened=new FieldKnowledgeStore(paths,database,async()=>'' );stores.push(reopened)
 expect(reopened.get(child.id).papers.find(p=>p.id===paper.id)?.starred).toBe(true)
 expect(reopened.get(child.id).monthly).toBe(true)
 expect(reopened.get(child.id).parentId).toBe(parent.id)
 reopened.monthlyResult(child.id,{...input,status:'failed',error:'网络暂不可用'})
 expect(reopened.get(child.id).reports).toHaveLength(1)
 expect(reopened.get(child.id).monthlyError).toContain('网络')
 expect(reopened.setMonthly(child.id,false).monthly).toBe(false)
})

it('runs a due monthly report once and persists an honest empty result',async()=>{
 const {paths,database,store}=setup();const f=store.create('异常检测');store.setMonthly(f.id,true)
 const db=new DatabaseSync(database);const row=db.prepare('SELECT body FROM field_bases WHERE id=?').get(f.id)!
 const body=JSON.parse(String(row.body));body.nextUpdateAt='2020-01-01T00:00:00Z';db.prepare('UPDATE field_bases SET body=? WHERE id=?').run(JSON.stringify(body),f.id);db.close()
 let calls=0
 const explorer=new ResearchExplorer(paths,{databasePath:database,list:async()=>[]} as unknown as PaperRepository,async()=>'',async()=>{calls++;return {sources:[],warnings:[]}})
 stores.push(explorer);explorer.tickMonthly();explorer.tickMonthly()
 for(let i=0;i<100 && explorer.list()[0]?.status!=='complete';i++) await new Promise(r=>setTimeout(r,10))
 expect(calls).toBe(1);expect(explorer.fields.get(f.id).reports).toHaveLength(1)
 expect(explorer.fields.get(f.id).reports![0].overview).toContain('未发现')
 explorer.tickMonthly();expect(calls).toBe(1)
})
