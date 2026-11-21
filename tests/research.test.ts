import fs from 'node:fs/promises'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAppPaths } from '../src/main/paths'
import { PaperRepository } from '../src/main/paper-repository'
import { minimalTextPdf } from './helpers/minimal-pdf'
import { isDue, validateDigest, DigestService } from '../src/main/digest-service'
import { parseFeed, sourceKey, boundedFetch } from '../src/main/digest-sources'
import type { DigestSource } from '../src/shared/types'
import { HarnessApi } from '../src/main/harness-api'

const cleanup: Array<()=>Promise<void>>=[]
afterEach(async()=>{ vi.unstubAllGlobals(); for(const fn of cleanup.splice(0).reverse())await fn() })
async function setup() {
 const parent=path.join(process.cwd(),'.local-data','temp');await fs.mkdir(parent,{recursive:true});const root=await fs.mkdtemp(path.join(parent,'research-test-'));cleanup.push(()=>fs.rm(root,{recursive:true,force:true}));const paths=createAppPaths({resourceRoot:root,dataRoot:path.join(root,'data')});const repo=new PaperRepository(paths);cleanup.push(async()=>repo.close());const pdf=path.join(root,'中文论文.pdf');await fs.writeFile(pdf,minimalTextPdf('Research methods provide reproducible evaluation and robust results with transparent scientific analysis and reliable experiments for medical reasoning.'));return {root,paths,repo,pdf}
}
describe('managed library',()=>{
 it('copies once, preserves metadata on duplicate, and survives original removal',async()=>{const {repo,pdf}=await setup();const paper=await repo.import(pdf);expect(paper.sourcePath).not.toBe(pdf);expect(paper.originalPath).toBe(pdf);repo.update(paper.id,{title:'Edited',tags:['medical'],collection:'Lab'});expect((await repo.import(pdf)).title).toBe('Edited');await fs.unlink(pdf);expect((await repo.list())[0].missing).toBe(false);expect(repo.get(paper.id)?.tags).toEqual(['medical'])})
 it('persists code link, affiliation and keywords across reopening',async()=>{const {repo,pdf,paths}=await setup();const paper=await repo.import(pdf);repo.update(paper.id,{codeUrl:'https://github.com/example/research',affiliations:'Korea University',keywords:['medical AI','reasoning']});const reopened=new PaperRepository(paths);cleanup.push(async()=>reopened.close());expect(reopened.get(paper.id)).toMatchObject({codeUrl:'https://github.com/example/research',affiliations:'Korea University',keywords:['medical AI','reasoning']});expect(()=>repo.update(paper.id,{codeUrl:'javascript:alert(1)'})).toThrow('代码链接')})
 it('persists a 1–5 star rating and allows clearing it',async()=>{const {repo,pdf,paths}=await setup();const paper=await repo.import(pdf);expect(paper.rating).toBe(0);repo.update(paper.id,{rating:4});const reopened=new PaperRepository(paths);cleanup.push(async()=>reopened.close());expect(reopened.get(paper.id)?.rating).toBe(4);expect(()=>repo.update(paper.id,{rating:6})).toThrow('评分');expect(()=>repo.update(paper.id,{rating:1.5})).toThrow('评分');repo.update(paper.id,{rating:0});expect(repo.get(paper.id)?.rating).toBe(0)})
 it('adds new metadata columns to an older library without losing its paper',async()=>{const {repo,pdf,paths}=await setup();const paper=await repo.import(pdf);repo.update(paper.id,{venue:'CVPR'});const db=new DatabaseSync(repo.databasePath);db.exec('ALTER TABLE papers DROP COLUMN code_url; ALTER TABLE papers DROP COLUMN affiliations; ALTER TABLE papers DROP COLUMN keywords_json; PRAGMA user_version=8;');db.close();const reopened=new PaperRepository(paths);cleanup.push(async()=>reopened.close());expect(reopened.get(paper.id)).toMatchObject({id:paper.id,venue:'CVPR',codeUrl:'',affiliations:'',keywords:[]});expect((await fs.readdir(paths.database)).some((name)=>name.startsWith('backup-'))).toBe(true)})
 it('adds an unrated star column to a version 9 library and backs it up',async()=>{const {repo,pdf,paths}=await setup();const paper=await repo.import(pdf);const db=new DatabaseSync(repo.databasePath);db.exec('ALTER TABLE papers DROP COLUMN rating; PRAGMA user_version=9;');db.close();const reopened=new PaperRepository(paths);cleanup.push(async()=>reopened.close());expect(reopened.get(paper.id)).toMatchObject({id:paper.id,rating:0});expect((await fs.readdir(paths.database)).some((name)=>name.startsWith('backup-'))).toBe(true)})
 it('keeps records, file, FTS and annotations when moving to trash and restoring',async()=>{const {repo,pdf}=await setup();const p=await repo.import(pdf);const h=repo.highlight({paperId:p.id,pageNumber:1,text:'Research',rects:[{x:.1,y:.1,width:.2,height:.05}]});await repo.remove(p.id);expect(await repo.list()).toHaveLength(0);expect(repo.search('Research')).toHaveLength(0);expect(repo.trash()[0].id).toBe(p.id);await fs.access(p.sourcePath);repo.restore(p.id);expect(repo.highlights(p.id)[0]).toEqual(h);expect(repo.search('Research')).toHaveLength(1);repo.removeHighlight(h.id);expect(repo.highlights(p.id)).toHaveLength(0)})
 it('does not mark partial artifacts complete and preserves translation anchors',async()=>{const {repo,pdf}=await setup();const p=await repo.import(pdf);const a=repo.createArtifact(p.id,'selection-translation');repo.annotateArtifact(a.id,'Research',1);await fs.writeFile(a.markdownPath,'partial');expect(repo.artifacts(p.id)[0]).toMatchObject({status:'queued',selection:'Research',pageNumber:1})})
 it('rejects invalid annotations and keeps queue usable after an invalid import',async()=>{const {repo,pdf,root}=await setup();await expect(repo.import(path.join(root,'missing.pdf'))).rejects.toThrow();const p=await repo.import(pdf);expect(()=>repo.highlight({paperId:p.id,pageNumber:9,text:'x',rects:[]})).toThrow();expect(()=>repo.update(p.id,{year:NaN})).toThrow()})
 it('migrates referenced legacy files without changing identities',async()=>{const {repo,pdf,paths}=await setup();const p=await repo.import(pdf);const db=new DatabaseSync(repo.databasePath);const original=await fs.stat(pdf);db.prepare("UPDATE papers SET source_path=?,original_path='',modified_at=? WHERE id=?").run(pdf,original.mtimeMs,p.id);db.close();await repo.migrateManagedFiles();expect(repo.get(p.id)?.originalPath).toBe(pdf);expect(repo.get(p.id)?.sourcePath).toContain(path.join(paths.data,'library'));expect(repo.pages(p.id,1,1)).toHaveLength(1)})
})
describe('local reading notes and manuscript iterations',()=>{
 it('persists question reference snapshots separately from the question across reopening and migration',async()=>{
  const {repo,pdf,paths}=await setup();const paper=await repo.import(pdf)
  const contexts=[{id:'reference-1',text:'Research',page:1,segments:[{page:1,rects:[{x:.1,y:.2,width:.2,height:.03}]}]}]
  const artifact=repo.createArtifact(paper.id,'question-answer')
  repo.annotateArtifact(artifact.id,'这个词是什么意思？',1,contexts)
  repo.registerArtifactCard(artifact,'这个词是什么意思？',1)
  const reopened=new PaperRepository(paths);cleanup.push(async()=>reopened.close())
  expect(reopened.getArtifact(artifact.id)).toMatchObject({selection:'这个词是什么意思？',questionContexts:contexts})
  expect(reopened.readerCards(paper.id).find(card=>card.id===artifact.id)?.sourceText).toBe('这个词是什么意思？')
  const plain=repo.createArtifact(paper.id,'question-answer');repo.annotateArtifact(plain.id,'主要贡献是什么？',1)
  expect(repo.getArtifact(plain.id)?.questionContexts).toEqual([])
  const db=new DatabaseSync(repo.databasePath);db.exec('ALTER TABLE paper_artifacts DROP COLUMN question_contexts_json; PRAGMA user_version=11;');db.close()
  const migrated=new PaperRepository(paths);cleanup.push(async()=>migrated.close())
  expect(migrated.getArtifact(plain.id)).toMatchObject({selection:'主要贡献是什么？',questionContexts:[]})
  expect((await fs.readdir(paths.database)).some(name=>name.startsWith('backup-'))).toBe(true)
 })
 it('persists multi-page translation anchors across a library restart',async()=>{
  const {repo,pdf,paths}=await setup();const paper=await repo.import(pdf)
  const db=new DatabaseSync(repo.databasePath);db.prepare('UPDATE papers SET page_count=2 WHERE id=?').run(paper.id);db.close()
  const segments=[{page:1,rects:[{x:.1,y:.8,width:.3,height:.04}]},{page:2,rects:[{x:.1,y:.1,width:.3,height:.04}]}]
  const artifact=repo.createArtifact(paper.id,'selection-translation')
  repo.annotateArtifact(artifact.id,'The paragraph continues across pages.',1)
  repo.registerArtifactCard(artifact,'The paragraph continues across pages.',1,segments[0].rects,segments)
  const reopened=new PaperRepository(paths);cleanup.push(async()=>reopened.close())
  expect(reopened.readerCards(paper.id).find((card)=>card.id===artifact.id)?.segments).toEqual(segments)
  expect(()=>reopened.registerArtifactCard(artifact,'text',1,[],[{page:3,rects:segments[0].rects}])).toThrow('区域无效')
 })
 it('allows a budget-exhausted summary to continue only once',async()=>{
  const {repo,pdf}=await setup();const paper=await repo.import(pdf)
  const artifact=repo.createArtifact(paper.id,'summary');repo.attachArtifactSession(artifact.id,'session-test')
  expect(repo.markSummaryContinuation(artifact.id)).toBe(true)
  expect(repo.getArtifact(artifact.id)?.progress).toBe(10)
  expect(repo.markSummaryContinuation(artifact.id)).toBe(false)
 })
 it('persists selectable highlight colors and permits an empty anchored note before editing',async()=>{
  const {repo,pdf,paths}=await setup();const paper=await repo.import(pdf)
  const rects=[{x:.1,y:.2,width:.3,height:.04}]
  const note=repo.saveReaderNote({paperId:paper.id,content:'',pageNumber:1,sourceText:'Research methods',rects,noteColor:'#F7C5CC'})
  expect(note).toMatchObject({kind:'note',noteColor:'#F7C5CC',content:'',rects})
  const updated=repo.saveReaderNote({id:note.id,paperId:paper.id,content:'值得进一步验证。',pageNumber:1,sourceText:'Research methods',rects,noteColor:'#B8D4E3'})
  expect(updated.noteColor).toBe('#B8D4E3')
  const reopened=new PaperRepository(paths);cleanup.push(async()=>reopened.close())
  expect(reopened.readerCards(paper.id).find((card)=>card.id===note.id)?.noteColor).toBe('#B8D4E3')
  expect(()=>repo.saveReaderNote({paperId:paper.id,content:'',pageNumber:1,sourceText:'Research',rects:[],noteColor:'#F7C5CC'})).toThrow('笔记内容无效')
  expect(()=>repo.saveReaderNote({paperId:paper.id,content:'x',pageNumber:1,rects,noteColor:'not-a-color'})).toThrow('笔记内容无效')
 })
 it('erases a PDF mark without deleting its note card and accepts a custom hex color',async()=>{
  const {repo,pdf,paths}=await setup();const paper=await repo.import(pdf)
  const marked=repo.saveReaderNote({paperId:paper.id,content:'',pageNumber:1,sourceText:'Research methods',rects:[{x:.1,y:.2,width:.3,height:.04}],noteColor:'#A4D8C6'})
  const erased=repo.saveReaderNote({id:marked.id,paperId:paper.id,content:'',pageNumber:null,sourceText:marked.sourceText,rects:[],noteColor:marked.noteColor!})
  expect(erased).toMatchObject({id:marked.id,content:'',pageNumber:null,rects:[],noteColor:'#A4D8C6'})
  const reopened=new PaperRepository(paths);cleanup.push(async()=>reopened.close())
  expect(reopened.readerCards(paper.id).find((card)=>card.id===marked.id)).toMatchObject({pageNumber:null,rects:[],noteColor:'#A4D8C6'})
 })
 it('migrates existing data before storing grounded answer evidence and color',async()=>{
  const {repo,pdf,paths}=await setup();const paper=await repo.import(pdf)
  const legacyDb=new DatabaseSync(repo.databasePath)
  legacyDb.exec('ALTER TABLE paper_artifacts DROP COLUMN answer_json; PRAGMA user_version=7;')
  legacyDb.close()
  const upgraded=new PaperRepository(paths);cleanup.push(async()=>upgraded.close())
  const artifact=upgraded.createArtifact(paper.id,'question-answer')
  const answer={version:1,body:'研究方法提供可复现评估。[p.1]',evidence:[{page:1,quote:'Research methods provide reproducible evaluation'}],color:'#C8E6F6'}
  const db=new DatabaseSync(repo.databasePath)
  db.prepare("UPDATE paper_artifacts SET status='complete',answer_json=? WHERE id=?").run(JSON.stringify(answer),artifact.id)
  db.close()
  expect(upgraded.getArtifact(artifact.id)?.answer).toEqual(answer)
  expect((await fs.readdir(paths.database)).some((name)=>name.startsWith('backup-'))).toBe(true)
 })
 it('upgrades old note cards without a color column and keeps their content',async()=>{
  const {repo,pdf,paths}=await setup();const paper=await repo.import(pdf)
  const original=repo.saveReaderNote({paperId:paper.id,content:'旧版笔记内容',pageNumber:1,sourceText:'Research',rects:[{x:.1,y:.2,width:.2,height:.04}]})
  const db=new DatabaseSync(repo.databasePath)
  db.exec('ALTER TABLE paper_reader_cards DROP COLUMN note_color; PRAGMA user_version=6;')
  db.close()
  const upgraded=new PaperRepository(paths);cleanup.push(async()=>upgraded.close())
  expect(upgraded.readerCards(paper.id).find((card)=>card.id===original.id)).toMatchObject({content:'旧版笔记内容',noteColor:'#B8D4E3'})
  expect((await fs.readdir(paths.database)).some((name)=>name.startsWith('backup-'))).toBe(true)
 })
 it('keeps paragraph versions independent and only accepts a matching current input',async()=>{
  const {repo}=await setup();const project=repo.createWritingProject('Card manuscript','medical AI','')
  const first=repo.createWritingParagraph(project.id,'introduction')
  const second=repo.createWritingParagraph(project.id,'introduction')
  repo.updateWritingParagraph(first.id,'研究背景','这个模型在小样本上也许更稳，不过还没有数据。')
  repo.updateWritingParagraph(second.id,'研究缺口','已有研究还没解释外部验证。')
  const firstVersion=repo.createWritingParagraphVersion(first.id)
  const db=new DatabaseSync(repo.databasePath)
  db.prepare("UPDATE writing_paragraph_versions SET status='complete',academic_zh=?,academic_en=?,change_note=? WHERE id=?")
    .run('该模型在小样本条件下可能更稳定【待补证据】。','The model may be more stable under limited samples [evidence needed].','收紧表述',firstVersion.id)
  expect(repo.writingParagraphs(project.id,'introduction')).toHaveLength(2)
  expect(repo.writingParagraph(second.id)?.draftText).toContain('外部验证')
  repo.acceptWritingParagraphVersion(firstVersion.id)
  expect(repo.writingParagraph(first.id)?.currentVersionId).toBe(firstVersion.id)
  repo.updateWritingParagraph(first.id,'研究背景','最新实验还需要外部验证。')
  const secondVersion=repo.createWritingParagraphVersion(first.id)
  expect(secondVersion.parentVersionId).toBe(firstVersion.id)
  db.prepare("UPDATE writing_paragraph_versions SET status='complete',academic_zh=?,academic_en=?,change_note=? WHERE id=?")
    .run('该结果仍需外部验证。','External validation remains necessary.','加入验证边界',secondVersion.id)
  repo.updateWritingParagraph(first.id,'研究背景','作者刚刚又修改了输入。')
  expect(()=>repo.acceptWritingParagraphVersion(secondVersion.id)).toThrow('输入内容已修改')
  expect(repo.writingParagraph(first.id)?.versions.map((item)=>item.number)).toEqual([1,2])
  db.close()
 })
 it('moves an existing whole-section draft into its first local paragraph card on upgrade',async()=>{
  const {repo,paths}=await setup();const project=repo.createWritingProject('Legacy draft','','')
  repo.saveWritingDraft(project.id,'introduction','The original introduction remains intact.',true)
  const db=new DatabaseSync(repo.databasePath)
  db.exec('DROP TABLE writing_paragraph_versions; DROP TABLE writing_paragraphs; PRAGMA user_version=5;')
  db.close()
  const upgraded=new PaperRepository(paths);cleanup.push(async()=>upgraded.close())
  const cards=upgraded.writingParagraphs(project.id,'introduction')
  expect(cards).toHaveLength(1)
  expect(cards[0].draftText).toBe('The original introduction remains intact.')
  expect(cards[0].versions[0].academicZh).toBe(cards[0].draftText)
  expect((await fs.readdir(paths.database)).some((name)=>name.startsWith('backup-'))).toBe(true)
 })
 it('persists paragraph cards, lets readers remove and restore one, and composes only included cards',async()=>{
  const {repo,pdf}=await setup();const paper=await repo.import(pdf)
  const translation=repo.createArtifact(paper.id,'selection-translation')
  repo.annotateArtifact(translation.id,'Research methods provide reproducible evaluation',1)
  repo.registerArtifactCard(translation,'Research methods provide reproducible evaluation',1,[{x:.1,y:.2,width:.4,height:.03}])
  const answer=repo.createArtifact(paper.id,'question-answer')
  repo.annotateArtifact(answer.id,'What are the limitations?',1)
  repo.registerArtifactCard(answer,'What are the limitations?',1)
  const db=new DatabaseSync(repo.databasePath)
  db.prepare("UPDATE paper_artifacts SET status='complete' WHERE id IN (?,?)").run(translation.id,answer.id)
  await fs.writeFile(translation.markdownPath,'研究方法提供可复现的评估。[p.1]')
  await fs.writeFile(answer.markdownPath,'论文尚未报告明确局限。[p.1]')
  expect(repo.readerCards(paper.id)).toEqual(expect.arrayContaining([expect.objectContaining({id:translation.id,kind:'translation',included:false,rects:[{x:.1,y:.2,width:.4,height:.03}]}),expect.objectContaining({id:answer.id,kind:'answer',included:false})]))
  const note=repo.saveReaderNote({paperId:paper.id,content:'需要进一步验证泛化能力。',pageNumber:1,sourceText:'Research methods',rects:[{x:.1,y:.2,width:.2,height:.03}]})
  expect(repo.readerCards(paper.id).find((card)=>card.id===note.id)?.content).toContain('泛化能力')
  repo.setReaderCardState(translation.id,true,true)
  let markdown=repo.finalizeNote(paper.id).markdown
  expect(markdown).toContain('需要进一步验证泛化能力')
  expect(markdown).not.toContain('研究方法提供可复现的评估')
  expect(markdown).not.toContain('论文尚未报告明确局限')
  repo.setReaderCardState(answer.id,false,true)
  repo.setReaderCardState(translation.id,false,true)
  markdown=repo.finalizeNote(paper.id).markdown
  expect(markdown).toContain('研究方法提供可复现的评估')
  expect(markdown).toContain('论文尚未报告明确局限')
  expect(()=>repo.saveReaderNote({paperId:paper.id,content:'Bad',pageNumber:2})).toThrow('关联区域无效')
  db.close()
 })
 it('keeps five independent paragraph translations and hides only the selected card',async()=>{
  const {repo,pdf}=await setup();const paper=await repo.import(pdf)
  const ids:string[]=[]
  for(let index=0;index<5;index++){
   const artifact=repo.createArtifact(paper.id,'selection-translation')
   repo.annotateArtifact(artifact.id,`Paragraph ${index+1}`,1)
   repo.registerArtifactCard(artifact,`Paragraph ${index+1}`,1,[{x:.1,y:.1+index*.05,width:.3,height:.03}])
   ids.push(artifact.id)
  }
  expect(repo.readerCards(paper.id).filter((card)=>!card.hidden&&card.kind==='translation')).toHaveLength(5)
  repo.setReaderCardState(ids[2],true,true)
  expect(repo.readerCards(paper.id).filter((card)=>!card.hidden&&card.kind==='translation')).toHaveLength(4)
  repo.setReaderCardState(ids[2],false,true)
  expect(repo.readerCards(paper.id).filter((card)=>!card.hidden&&card.kind==='translation')).toHaveLength(5)
 })
 it('combines an owned structured review with personal notes and preserves final versions',async()=>{
  const {repo,pdf,root}=await setup();const paper=await repo.import(pdf);const secondPath=path.join(root,'other.pdf');await fs.writeFile(secondPath,minimalTextPdf('Independent paper with different reproducible methods and scientific evaluation.'));const other=await repo.import(secondPath)
  const artifact=repo.createArtifact(paper.id,'summary');const db=new DatabaseSync(repo.databasePath)
  const review={version:1,sections:['problem','innovation','method','dataset','setup','results','explanation','context','future','concepts','action'].map((key)=>({key,body:`${key} insight`,evidence:key==='innovation'?[{page:1,quote:'Research methods provide reproducible evaluation'}]:[]}))}
  db.prepare("UPDATE paper_artifacts SET status='complete',review_json=? WHERE id=?").run(JSON.stringify(review),artifact.id)
  expect(()=>repo.saveNote('missing','text',artifact.id,['innovation'])).toThrow()
  expect(()=>repo.saveNote(paper.id,'My own question',artifact.id,['unknown' as 'innovation'])).toThrow()
  expect(()=>repo.saveNote(other.id,'My own question',artifact.id,['innovation'])).toThrow('不属于此论文')
  repo.saveNote(paper.id,'My own question',artifact.id,['innovation'])
  const first=repo.finalizeNote(paper.id)
  expect(await fs.readFile(first.filePath!,'utf8')).toBe(first.markdown)
  expect(first.markdown).toContain('My own question')
  expect(first.markdown).toContain('### 2. 关键贡献')
  expect(first.markdown).not.toContain('## 核心问题')
  expect(first.markdown).toContain('[p.1] Research methods provide reproducible evaluation')
  repo.saveNote(paper.id,'Second reading insight',artifact.id,['problem'])
  expect(repo.finalizeNote(paper.id).version).toBe(2)
  expect(repo.noteVersions(paper.id)[1].markdown).toBe(first.markdown)
  db.close()
 })
 it('keeps manuscript versions and refuses to overwrite an edited draft with stale AI advice',async()=>{
  const {repo}=await setup();const project=repo.createWritingProject('Study A','medical AI','Nature Communications')
  repo.saveWritingDraft(project.id,'abstract','We evaluated the model.',true)
  const revision=repo.createWritingRevision(project.id,'abstract','polish')
  const db=new DatabaseSync(repo.databasePath)
  const result={assessment:'Claim requires evidence.',issues:[{severity:'high',problem:'No quantitative result',suggestion:'Add the measured score.',evidenceNeeded:'Evaluation metrics'}],proposedText:'We evaluated the model [evidence needed].',claimEvidenceMap:[{claim:'The model works',evidence:'',status:'needs-evidence'}]}
  db.prepare("UPDATE writing_revisions SET status='complete',result_json=? WHERE id=?").run(JSON.stringify(result),revision.id)
  repo.saveWritingDraft(project.id,'abstract','We evaluated the model on two cohorts.')
  expect(()=>repo.acceptWritingRevision(revision.id)).toThrow('草稿已经修改')
  repo.saveWritingDraft(project.id,'abstract',revision.sourceText)
  expect(repo.acceptWritingRevision(revision.id).text).toBe(result.proposedText)
  expect(repo.writingDraftHistory(project.id,'abstract').some((item)=>item.text==='We evaluated the model.')).toBe(true)
  db.close()
 })
})
describe('digest ingestion and scheduler',()=>{
 const source:DigestSource={id:'s1',title:'Source',url:'https://example.org',publishedAt:'2026-09-22',text:'Evidence',official:false}
 it('handles Atom arXiv metadata and RSS CDATA without running source markup',()=>{const atom='<feed><entry><id>http://arxiv.org/abs/2609.12345v2</id><title>New method</title><published>2026-09-22T00:00:00Z</published><summary>Reliable result</summary><author><name>Ada</name></author></entry></feed>';expect(parseFeed(atom,true)[0]).toMatchObject({id:'arxiv:2609.12345',authors:'Ada',pdfUrl:'https://arxiv.org/pdf/2609.12345'});expect(parseFeed('<rss><channel><item><title>A &amp; B</title><link>https://example.org</link><description><![CDATA[<p>Evidence</p>]]></description></item></channel></rss>')[0].text).toBe('Evidence');expect(()=>parseFeed('<!DOCTYPE x [<!ENTITY x SYSTEM "file:///secret">]><rss/>')).toThrow()})
 it('rejects fabricated source ids, empty acknowledgements and duplicate entries',()=>{expect(()=>validateDigest({overview:'done',items:[]},[source])).toThrow();expect(()=>validateDigest({overview:'done',items:[{sourceId:'unknown',title:'title',summary:'summary',why:'reason'}]},[source])).toThrow();const item={sourceId:'s1',title:'title',summary:'summary',why:'reason'};expect(validateDigest({overview:'overview',items:[item]},[source]).items).toHaveLength(1);expect(()=>validateDigest({overview:'overview',items:[item,item]},[source])).toThrow()})
 it('only catches up once after the Beijing scheduled time',()=>{const c={kind:'papers' as const,enabled:true,time:'09:00',topics:['medical']};expect(isDue(c,'',new Date('2026-09-22T00:59:00Z'))).toBe(false);expect(isDue(c,'2026-09-20',new Date('2026-09-22T01:00:00Z'))).toBe(true);expect(isDue(c,'2026-09-22',new Date('2026-09-22T05:00:00Z'))).toBe(false);expect(isDue({...c,enabled:false},'',new Date('2026-09-22T05:00:00Z'))).toBe(false)})
 it('normalizes dedup keys and refuses local-network source requests',async()=>{expect(sourceKey('A: Method!')).toBe(sourceKey('a method'));await expect(boundedFetch('http://127.0.0.1/secret')).rejects.toThrow();await expect(boundedFetch('https://arxiv.org:444/secret')).rejects.toThrow()})
 it('disables scheduling by default and rejects unavailable models',async()=>{const {paths,repo}=await setup();const api=new HarnessApi(()=>null);const service=new DigestService(paths,api,repo,async()=>false);expect(service.subscriptions().every((s)=>!s.enabled)).toBe(true);await expect(service.generate('papers')).rejects.toThrow('配置模型');await service.close()})
 it('reports rate limits and rejects oversized or redirected private sources',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>new Response('',{status:429})))
  await expect(boundedFetch('https://arxiv.org/test')).rejects.toThrow('429')
  vi.stubGlobal('fetch',vi.fn(async()=>new Response('12345')))
  await expect(boundedFetch('https://arxiv.org/test',undefined,3)).rejects.toThrow('大小')
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(null,{status:302,headers:{Location:'http://127.0.0.1/secret'}})))
  await expect(boundedFetch('https://arxiv.org/test')).rejects.toThrow('不允许')
 })
 it('resumes cached sources, accepts a structured mock result, and preserves read state',async()=>{
  const {paths,repo}=await setup();const db=new DatabaseSync(repo.databasePath)
  let calls=0
  const api={createDigestTask:async(_cwd:string,issue:import('../src/shared/types').DigestIssue)=>{calls++;db.prepare('UPDATE research_issues SET result_json=? WHERE id=?').run(JSON.stringify({overview:'本地模拟早报',items:[{sourceId:'s1',title:'透明方法研究',summary:'可复现的科学评估方法',why:'适合医学推理的研究设计'}]}),issue.id);return 'mock-session'}} as unknown as HarnessApi
  const service=new DigestService(paths,api,repo,async()=>true)
  try {
   db.prepare('INSERT INTO research_issues VALUES (?,?,?,NULL)').run('cached','papers',JSON.stringify({id:'cached',kind:'papers',createdAt:new Date().toISOString(),status:'failed',sources:[source],items:[],warnings:[]}))
   const issue=await service.generate('papers');await vi.waitFor(()=>expect(calls).toBe(1));await service.tick()
   const complete=service.list('papers').find((i)=>i.id===issue.id)!
   expect(complete.status).toBe('complete');service.read(issue.id,complete.items[0].id);expect(service.list('papers')[0].items[0].read).toBe(true)
  } finally {await service.close();db.close()}
 })
 it('marks invalid saved output failed without discarding the previous issue',async()=>{
  const {paths,repo}=await setup();const service=new DigestService(paths,new HarnessApi(()=>null),repo,async()=>false);const db=new DatabaseSync(repo.databasePath)
  try {const issue={id:'bad',kind:'news',createdAt:new Date().toISOString(),status:'generating',sources:[source],items:[],warnings:[]};db.prepare('INSERT INTO research_issues VALUES (?,?,?,?)').run('bad','news',JSON.stringify(issue),JSON.stringify({overview:'任务完成',items:[]}));await service.tick();expect(service.list('news')[0].status).toBe('failed');expect(service.list('news')[0].sources).toHaveLength(1)}finally{await service.close();db.close()}
 })
})
