import fs from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createAppPaths } from '../src/main/paths'
import { PaperRepository } from '../src/main/paper-repository'
import { KnowledgeStore } from '../src/main/knowledge-store'
import { minimalTextPdf } from './helpers/minimal-pdf'
import { findSource, type FigureInsight, type SourceSeed } from '../src/shared/knowledge'
import { DatabaseSync } from 'node:sqlite'
import { buildSourceSeeds } from '../src/renderer/source-map'
import type { PdfPageText } from '../src/renderer/pdf-document-paragraphs'

const cleanup: Array<()=>Promise<void>>=[]
afterEach(async()=>{for(const fn of cleanup.splice(0).reverse())await fn()})
async function setup(){
 const parent=path.join(process.cwd(),'.local-data','temp');await fs.mkdir(parent,{recursive:true});const root=await fs.mkdtemp(path.join(parent,'knowledge-test-'));cleanup.push(()=>fs.rm(root,{recursive:true,force:true}))
 const paths=createAppPaths({resourceRoot:root,dataRoot:path.join(root,'data')}),repo=new PaperRepository(paths),store=new KnowledgeStore(paths,repo);cleanup.push(async()=>repo.close());cleanup.push(async()=>store.close())
 const pdf=path.join(root,'paper.pdf');await fs.writeFile(pdf,minimalTextPdf('Research methods provide reproducible evaluation and reliable results.'))
 const paper=await repo.import(pdf)
 return{root,paths,repo,store,paper}
}
const seed=(kind:SourceSeed['kind']='paragraph',label='S001',text='Research methods provide reproducible evaluation.'):SourceSeed=>({kind,label,text,parts:[{page:1,rects:[{x:.1,y:.2,width:.4,height:.03}]}]})

describe('stable evidence and research workflows',()=>{
 it('stores topic/direction/focus and keeps projects created before those fields readable',async()=>{const{paths,repo,store}=await setup();const created=store.saveProject({title:'异常检测',topic:'医学图像异常检测',direction:'零样本细粒度异常定位',question:'局部微小异常定位不稳'});expect(created).toMatchObject({topic:'医学图像异常检测',direction:'零样本细粒度异常定位',question:'局部微小异常定位不稳'});const reopened=new KnowledgeStore(paths,repo);cleanup.push(async()=>reopened.close());expect(reopened.project(created.id)).toMatchObject({topic:'医学图像异常检测',direction:'零样本细粒度异常定位'});expect(store.projectContext(created.id)).toContain('零样本细粒度异常定位');expect(store.saveProject({id:created.id,title:'异常检测 v2',question:'新的重点'}).topic).toBe('医学图像异常检测');const db=new DatabaseSync(path.join(paths.database,'research.sqlite'));const row=db.prepare('SELECT data FROM research_projects WHERE id=?').get(created.id) as {data:string};const legacy=JSON.parse(row.data);delete legacy.topic;delete legacy.direction;db.prepare('UPDATE research_projects SET data=? WHERE id=?').run(JSON.stringify(legacy),created.id);db.close();expect(store.project(created.id)).toMatchObject({topic:'',direction:''})})
 it('freezes checksum-bound IDs and normalized geometry across reopening and re-indexing',async()=>{const{paths,repo,store,paper}=await setup();const sources=store.seedSources(paper.id,[seed(),seed('figure','Fig. 1','Pipeline')]);expect(store.seedSources(paper.id,[seed('paragraph','S999','different')])).toEqual(sources);const reopened=new KnowledgeStore(paths,repo);cleanup.push(async()=>reopened.close());expect(await reopened.ensureSources(paper.id)).toEqual(sources);for(const scale of [.4,.7,1,1.1,1.3,1.6,2,2.5]){const r=sources[0].parts[0].rects[0];expect(r.x*612*scale/(612*scale)).toBeCloseTo(r.x,12)}})
 it('re-indexes an outdated source map while old block IDs keep resolving to their successor',async()=>{const{paths,store,paper}=await setup();const old=store.seedSources(paper.id,[seed('paragraph','S001','Research methods provide reproducible evaluation and reliable results, stale split.')])[0];const db=new DatabaseSync(path.join(paths.database,'research.sqlite'));db.prepare('UPDATE source_maps SET version=1 WHERE paper_id=?').run(paper.id);db.close();const current=await store.ensureSources(paper.id);expect(current.some((block)=>block.id===old.id)).toBe(false);const successor=findSource(current,old.id)!;expect(successor.text).toContain('Research methods');expect(successor.replaces).toContain(old.id);expect(store.source(old.id)).toMatchObject({retired:true,supersededBy:successor.id});expect(await store.ensureSources(paper.id)).toEqual(current)})
 it('automatically indexes a real PDF and validates all seed geometry before writing',async()=>{const{store,paper}=await setup();expect(()=>store.seedSources(paper.id,[seed(),{...seed(),parts:[{page:2,rects:[]}]}])).toThrow('坐标');expect(store.sources(paper.id)).toEqual([]);const [first,second]=await Promise.all([store.ensureSources(paper.id),store.ensureSources(paper.id)]);expect(first).toEqual(second);expect(first[0].text).toContain('Research methods');expect(first[0].parts[0].rects[0].width).toBeLessThanOrEqual(1)})
 it('ties numeric ranges and author-year references to source blocks',async()=>{const{store,paper}=await setup();const sources=store.seedSources(paper.id,[seed('paragraph','S001','See Figure 1 and prior evidence [1–3] with Smith et al. (2024).'),seed('figure','Fig. 1','Pipeline'),seed('reference','R1','One'),seed('reference','R2','Two'),seed('reference','R3','Three'),seed('reference','R4','Smith, A. 2024. Paper.')]);expect(sources[0].relatedIds).toHaveLength(5)})
 it('persists card nature, rejects foreign evidence and snapshots materials without changing the original card',async()=>{const{root,repo,store,paper}=await setup();const source=store.seedSources(paper.id,[seed()])[0];const card=repo.saveReaderNote({paperId:paper.id,content:'可能需要外部验证。',pageNumber:1,sourceText:source.text,rects:source.parts[0].rects});expect(store.annotations(paper.id)[0].nature).toBe('personal');store.annotate(card.id,'inference',[source.id]);const file=path.join(root,'other.pdf');await fs.writeFile(file,minimalTextPdf('Other distinct scientific evidence and experiments.'));const other=await repo.import(file),foreign=store.seedSources(other.id,[seed()])[0];expect(()=>store.annotate(card.id,'fact',[foreign.id])).toThrow('来源');const project=store.saveProject({title:'Evidence project',question:'What remains unproven?'});const material=store.addMaterial({projectId:project.id,paperId:paper.id,cardId:card.id,category:'experiment'});repo.saveReaderNote({id:card.id,paperId:paper.id,content:'修改后笔记',pageNumber:1,sourceText:source.text,rects:card.rects});expect(store.materials(project.id)[0]).toMatchObject({content:'可能需要外部验证。',nature:'inference',sourceIds:[source.id]});expect(store.saveProject({id:project.id,title:'Renamed',question:'new question'}).paperIds).toEqual([paper.id]);expect(store.materials(project.id)[0].id).toBe(material.id)})
 it('protects project/writing associations and includes exact material IDs in argument context',async()=>{const{repo,store,paper}=await setup();const source=store.seedSources(paper.id,[seed()])[0];const project=store.saveProject({title:'First',question:'Which mechanism is causal?'}),second=store.saveProject({title:'Second',question:''});const material=store.addMaterial({projectId:project.id,paperId:paper.id,sourceId:source.id,category:'method'});const writing=repo.createWritingProject('Manuscript','',''),paragraph=repo.createWritingParagraph(writing.id,'introduction');store.linkWriting(writing.id,project.id);store.saveArgument({...store.argument(paragraph.id),job:'gap',claim:'An unanswered question',boundary:'Not established',materialIds:[material.id]});const context=JSON.parse(store.argumentContext(paragraph.id));expect(context.researchQuestion).toBe(project.question);expect(context.sources[0].id).toBe(source.id);expect(context.materials[0].nature).toBe('fact');expect(()=>store.removeMaterial(material.id)).toThrow('论证');expect(()=>store.linkWriting(writing.id,second.id)).toThrow('解除');expect(()=>store.setProjectPaper(project.id,paper.id,false)).toThrow('材料');store.saveArgument({...store.argument(paragraph.id),materialIds:[]});store.removeMaterial(material.id);store.linkWriting(writing.id,second.id);expect(store.writingLink(writing.id)).toBe(second.id)})
 it('exports selected figure insight with nature and source IDs and recovers interrupted interpretation',async()=>{const{paths,repo,store,paper}=await setup();const source=store.seedSources(paper.id,[seed(),seed('figure','Fig. 1','A reported pipeline')])[1];const insight:FigureInsight={id:'insight-test',paperId:paper.id,sourceId:source.id,title:'Figure 1',status:'complete',content:'图注描述了步骤；因果解释仍需验证。',evidenceIds:[source.id],scope:'caption',hidden:false,included:true,error:null,createdAt:new Date().toISOString()};store.saveInsight(insight);const note=repo.finalizeNote(paper.id,[],store.insights(paper.id));expect(await fs.readFile(note.filePath!,'utf8')).toContain(source.id);store.saveInsight({...insight,status:'running'});const reopened=new KnowledgeStore(paths,repo);cleanup.push(async()=>reopened.close());expect(reopened.insights(paper.id)[0]).toMatchObject({status:'failed',error:'上次图表解读已中断，可重试。'})})
 it('keeps voice retrieval inside the selected project or paper and blocks incompatible scopes',async()=>{const{root,repo,store,paper}=await setup();store.seedSources(paper.id,[seed()]);const pdf=path.join(root,'second.pdf');await fs.writeFile(pdf,minimalTextPdf('Independent medical evaluation with external cohorts.'));const second=await repo.import(pdf);store.seedSources(second.id,[seed('paragraph','S001','External cohort evaluation')]);const project=store.saveProject({title:'Compare evaluation',question:'Is external validation performed?'});store.setProjectPaper(project.id,paper.id,true);store.setProjectPaper(project.id,second.id,true);const selected=await store.voiceSources({projectId:project.id},'external evaluation');expect(new Set(selected.blocks.map((block)=>block.paperId))).toEqual(new Set([paper.id,second.id]));expect((await store.voiceSources({paperId:second.id},'external')).blocks.every((block)=>block.paperId===second.id)).toBe(true);const empty=store.saveProject({title:'Empty',question:''});await expect(store.voiceSources({paperId:paper.id,projectId:empty.id},'q')).rejects.toThrow('不属于')})
})

describe('project lifecycle',()=>{
 it('preserves method versions and experimental evidence when returning to methods and reopening',async()=>{
   const {paths,repo,store}=await setup()
   const project=store.saveProject({title:'A complete research journey',question:'Can the model use visual evidence reliably?'})
   expect(store.workflow(project.id)).toMatchObject({stage:'method',completed:false,activeMethodId:null})
   const method=store.saveEntry({projectId:project.id,kind:'method',title:'Alignment baseline',description:'Compare image and report embeddings.',nextStep:'Test independent hospitals.'})
   store.setStage(project.id,'experiment','Validate version 1')
   const experiment=store.saveEntry({projectId:project.id,kind:'experiment',title:'External cohort',description:'Test a hospital excluded from training.',dataset:'Hospital B held out',setup:'Five seeds, unchanged baseline',command:'python evaluate.py',methodId:method.id})
   const completed=store.saveEntry({...experiment,status:'failed',result:'External accuracy decreased.',conclusion:'Domain shift remains unresolved.'})
   store.setStage(project.id,'method','External evaluation failed; revise alignment')
   const upgraded=store.saveEntry({projectId:project.id,kind:'method',title:'Grounded alignment',description:'Add an independent image verifier.'})
   expect(upgraded.version).toBe(2); expect(store.projectEntries(project.id).find(e=>e.id===completed.id)?.methodId).toBe(method.id)
   expect(()=>store.saveEntry({...method,description:'Silently rewrite historical method'})).toThrow('覆盖')
   const reopened=new KnowledgeStore(paths,repo);cleanup.push(async()=>reopened.close())
   expect(reopened.workflow(project.id)).toMatchObject({stage:'method',activeMethodId:upgraded.id,history:[{stage:'experiment',reason:'Validate version 1'},{stage:'method',reason:'External evaluation failed; revise alignment'}]})
   expect(reopened.projectEntries(project.id).find(e=>e.id===experiment.id)).toMatchObject({status:'failed',result:'External accuracy decreased.',methodId:method.id})
 })
 it('shares project context with discussions and writing, reuses the same manuscript and supports completion/reopening',async()=>{
   const {store,repo}=await setup();const project=store.saveProject({title:'Unified project',question:'What needs to be validated?'})
   const method=store.saveEntry({projectId:project.id,kind:'method',title:'Verification',description:'Use image evidence.'})
   store.saveEntry({projectId:project.id,kind:'discussion',title:'Control experiment',description:'Add a shuffled image control.',origin:'voice'})
   store.saveEntry({projectId:project.id,kind:'experiment',title:'Ablation',description:'Shuffle images.',result:'Performance remained stable.',status:'complete',methodId:method.id})
   const voice=await store.voiceSources({projectId:project.id},'Next experiment?');expect(voice.description).toContain('Performance remained stable.');expect(voice.description).toContain('Add a shuffled image control.')
   const writingId=store.openWriting(project.id);expect(store.openWriting(project.id)).toBe(writingId);expect(repo.writingProjects()).toHaveLength(1)
   const paragraph=repo.createWritingParagraph(writingId,'results');expect(JSON.parse(store.argumentContext(paragraph.id)).researchProgress).toContain('Ablation')
   store.setStage(project.id,'writing','Evidence collected');store.setCompleted(project.id,true)
   expect(()=>store.saveEntry({projectId:project.id,kind:'method',title:'new',description:'new'})).toThrow('重新打开')
   expect(()=>store.setStage(project.id,'experiment','retry')).toThrow('重新打开')
   store.setCompleted(project.id,false);expect(store.setStage(project.id,'experiment','Add reviewer-requested experiments').stage).toBe('experiment')
 })
 it('rejects foreign method versions, invalid status and unrelated citations before saving',async()=>{
   const {store,paper}=await setup();const first=store.saveProject({title:'A',question:''}),second=store.saveProject({title:'B',question:''})
   const method=store.saveEntry({projectId:first.id,kind:'method',title:'A method',description:'A method description'})
   const source=store.seedSources(paper.id,[seed()])[0]
   expect(()=>store.saveEntry({projectId:second.id,kind:'experiment',title:'B test',description:'B test description',methodId:method.id})).toThrow('不属于')
   expect(()=>store.saveEntry({projectId:second.id,kind:'discussion',title:'Claim',description:'Claim description',sourceIds:[source.id]})).toThrow('来源')
   expect(()=>store.saveEntry({projectId:first.id,kind:'experiment',title:'Invalid',description:'Invalid',status:'wrong' as never})).toThrow('状态')
   expect(store.projectEntries(second.id)).toHaveLength(0)
 })
})

describe('source parser',()=>{
 const page=(number:number,rows:Array<[string,number,number?]>):PdfPageText=>({pageNumber:number,viewport:{width:600,height:800,convertToViewportPoint:(x,y)=>[x,800-y]},items:rows.map(([str,top,x=60])=>({str,width:400,height:10,transform:[10,0,0,10,x,800-top]}))})
 it('collects paragraph, figure/table captions and whole reference entries without mixing the next reference',()=>{const blocks=buildSourceSeeds([page(1,[['TITLE',100],['ABSTRACT',150],['A sufficiently long natural abstract paragraph.',170],['1 INTRODUCTION',230],['We compare earlier research [1].',250],['Fig. 1: A two-stage pipeline.',320],['Details of the pipeline.',330],['Table 1: Evaluation.',390]]),page(2,[['REFERENCES',100],['[1] Smith et al. A study.',120],['Journal 2024. DOI 123.',130],['[2] Jones et al. Next study.',160],['Journal 2025.',170]])]);expect(blocks.filter((block)=>block.kind==='reference')[0].text).toBe('[1] Smith et al. A study. Journal 2024. DOI 123.');expect(blocks.some((block)=>block.kind==='figure')).toBe(true);expect(blocks.some((block)=>block.kind==='table')).toBe(true);expect(blocks.filter((block)=>block.kind==='paragraph').every((block)=>!block.text.includes('TITLE'))).toBe(true)})
})
