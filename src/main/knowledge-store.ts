import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import type { AppPaths } from './paths'
import type { PaperRepository } from './paper-repository'
import { buildSourceSeeds } from '../renderer/source-map'
import { loadPdfPages } from './pdf-page-model'
import { defaultNature, paragraphJobs, type ArgumentPlan, type ArgumentReview, type CardAnnotation, type ContentNature, type FigureInsight, type ProjectMaterial, type ResearchProject, type SourceBlock, type SourceSeed, type VoiceContext } from '../shared/knowledge'
import { projectStageLabels, type ProjectWorkflow, type ProjectEntry, type ProjectEntryInput, type ProjectStage } from '../shared/project-workflow'

const normalize = (value: string): string => value.normalize('NFKC').replace(/[-\s]/g, '').toLowerCase()
const bounded = (value: unknown, max: number, required = false): string => {
  if (typeof value !== 'string' || value.length > max || required && !value.trim()) throw new Error('内容为空或超过长度限制。')
  return value.trim()
}
const validNature = (value: unknown): value is ContentNature => ['fact', 'inference', 'personal'].includes(String(value))
/**
 * Version of the automatic source map. Raising it re-indexes every paper on its next
 * open; earlier blocks stay readable (retired, pointing at their successor) so cards,
 * project materials and links that cite them keep resolving.
 * 2: figure/table-aware prose layer, column gutters, captions and equations excluded.
 */
export const SOURCE_MAP_VERSION = 3
const words = (value: string): Set<string> => new Set(value.normalize('NFKC').toLowerCase().match(/[a-z0-9]{3,}|[㐀-鿿]/g) ?? [])

/** Separate additive database; existing paper/manuscript data is never rewritten. */
export class KnowledgeStore {
  private readonly db: DatabaseSync
  private readonly indexing = new Map<string, Promise<SourceBlock[]>>()
  constructor(paths: AppPaths, private readonly papers: PaperRepository) {
    this.db = new DatabaseSync(path.join(paths.database, 'research.sqlite'))
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000;
      CREATE TABLE IF NOT EXISTS source_blocks (id TEXT PRIMARY KEY,paper_id TEXT NOT NULL,checksum TEXT NOT NULL,data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS source_paper ON source_blocks(paper_id);
      CREATE TABLE IF NOT EXISTS source_maps (paper_id TEXT PRIMARY KEY,checksum TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS card_annotations (id TEXT PRIMARY KEY,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS figure_insights (id TEXT PRIMARY KEY,paper_id TEXT NOT NULL,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS research_projects (id TEXT PRIMARY KEY,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS project_workflows (project_id TEXT PRIMARY KEY REFERENCES research_projects(id),data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS project_entries (id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES research_projects(id),data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS project_materials (id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES research_projects(id),data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS writing_links (id TEXT PRIMARY KEY,project_id TEXT REFERENCES research_projects(id));
      CREATE TABLE IF NOT EXISTS argument_plans (id TEXT PRIMARY KEY,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS argument_reviews (id TEXT PRIMARY KEY,writing_project_id TEXT NOT NULL,section TEXT NOT NULL,data TEXT NOT NULL);
      PRAGMA user_version=1;`)
    if (!this.db.prepare('PRAGMA table_info(source_maps)').all().some((column) => column.name === 'version')) this.db.exec('ALTER TABLE source_maps ADD COLUMN version INTEGER NOT NULL DEFAULT 1')
    for (const insight of this.db.prepare('SELECT data FROM figure_insights').all()) {
      const value = JSON.parse(String(insight.data)) as FigureInsight
      if (value.status === 'running') this.saveInsight({ ...value, status: 'failed', error: '上次图表解读已中断，可重试。' })
    }
  }
  close(): void { this.db.close() }
  private paper(id: string) {
    const paper = this.papers.get(id)
    if (!paper || paper.deletedAt) throw new Error('论文不存在或已移入回收站。')
    return paper
  }
  sources(paperId: string): SourceBlock[] {
    const paper = this.paper(paperId)
    return this.db.prepare('SELECT data FROM source_blocks WHERE paper_id=? AND checksum=? ORDER BY rowid').all(paperId, paper.checksum)
      .map((row) => JSON.parse(String(row.data)) as SourceBlock).filter((block) => !block.retired)
  }
  source(id: string): SourceBlock {
    const row = this.db.prepare('SELECT data FROM source_blocks WHERE id=?').get(id)
    if (!row) throw new Error('原文定位不存在。')
    const block = JSON.parse(String(row.data)) as SourceBlock
    if (this.paper(block.paperId).checksum !== block.checksum) throw new Error('PDF 已改变，原文定位失效。')
    return block
  }
  private validateSeed(paperId: string, seed: SourceSeed): void {
    const paper = this.paper(paperId)
    if (!seed || !['paragraph', 'figure', 'table', 'reference'].includes(seed.kind)) throw new Error('原文块类型无效。')
    bounded(seed.label, 120, true); bounded(seed.text, 50000)
    if (!Array.isArray(seed.parts) || !seed.parts.length || seed.parts.length > 100 || seed.parts.some((part) => !Number.isInteger(part.page) || part.page < 1 || part.page > paper.pageCount || !Array.isArray(part.rects) || part.rects.length > 1000 || part.rects.some((r) => !r || ['x', 'y', 'width', 'height'].some((key) => !Number.isFinite(r[key as keyof typeof r]) || r[key as keyof typeof r] < 0 || r[key as keyof typeof r] > 1) || r.x + r.width > 1.01 || r.y + r.height > 1.01))) throw new Error('原文坐标无效。')
  }
  seedSources(paperId: string, seeds: SourceSeed[]): SourceBlock[] {
    const paper = this.paper(paperId)
    const existing = this.sources(paperId)
    if (this.indexed(paperId)) return existing
    if (!Array.isArray(seeds) || seeds.length > 20000) throw new Error('原文块数量无效。')
    for (const seed of seeds) this.validateSeed(paperId, seed)
    const blocks = seeds.map((seed): SourceBlock => ({ ...seed, id: createHash('sha256').update(`${paper.id}:${paper.checksum}:${seed.kind}:${seed.label}:${normalize(seed.text)}`).digest('hex').slice(0, 28), paperId, checksum: paper.checksum, image: null, createdAt: new Date().toISOString() }))
    for (const block of blocks) {
      const markers = [...block.text.matchAll(/\[(\d+(?:\s*[,–-]\s*\d+)*)\]/g)].flatMap((match) => match[1].split(',').flatMap((piece) => { const [start,end] = piece.trim().split(/[–-]/).map(Number); return end && end>=start && end-start<100 ? Array.from({length:end-start+1},(_,i)=>String(start+i)) : [String(start)] }))
      block.relatedIds = blocks.filter((item) => {
        if(item.kind!=='reference' || item.id===block.id)return false
        if(markers.includes(item.label.slice(1)))return true
        const author=/^(?:\[\d+\]\s*|\d+\.\s*)?([A-Z][\p{L}'’\-]+),/u.exec(item.text)?.[1], year=/\b((?:19|20)\d{2}[a-z]?)\b/.exec(item.text)?.[1]
        return !!author && !!year && block.text.includes(author) && block.text.includes(year)
      }).map((item) => item.id)
      block.relatedIds.push(...blocks.filter((item) => {const number=/\d+[a-z]?$/i.exec(item.label)?.[0];return number && ['figure', 'table'].includes(item.kind) && item.id!==block.id && new RegExp(`${item.kind === 'figure' ? '(?:figure|fig\\.?)' : 'table'}\\s*${number}\\b`, 'i').test(block.text)}).map((item) => item.id))
    }
    // Re-indexing: automatic blocks from an earlier map version are retired, not deleted.
    // Each points at the new block covering most of its text on the same pages.
    const ids = new Set(blocks.map((block) => block.id))
    const retiring = existing.filter((block) => block.image === null && !ids.has(block.id))
    for (const old of retiring) {
      const pages = new Set(old.parts.map((part) => part.page)), oldWords = words(old.text)
      let best: { block: SourceBlock; score: number } | null = null
      for (const block of blocks) {
        if (block.kind !== old.kind || !block.parts.some((part) => pages.has(part.page))) continue
        const newWords = words(block.text)
        const score = [...oldWords].filter((word) => newWords.has(word)).length / Math.max(1, oldWords.size)
        if (!best || score > best.score) best = { block, score }
      }
      old.retired = true
      if (best && best.score >= .5) { old.supersededBy = best.block.id; best.block.replaces = [...(best.block.replaces ?? []), old.id, ...(old.replaces ?? [])] }
    }
    this.db.exec('BEGIN IMMEDIATE')
    try {
      for (const old of retiring) this.db.prepare('UPDATE source_blocks SET data=? WHERE id=?').run(JSON.stringify(old), old.id)
      for (const block of blocks) this.db.prepare('INSERT INTO source_blocks VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(block.id, paperId, paper.checksum, JSON.stringify(block))
      this.db.prepare('INSERT INTO source_maps (paper_id,checksum,version) VALUES (?,?,?) ON CONFLICT(paper_id) DO UPDATE SET checksum=excluded.checksum,version=excluded.version').run(paperId, paper.checksum, SOURCE_MAP_VERSION)
      this.db.exec('COMMIT')
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
    return this.sources(paperId)
  }
  ensureSources(paperId: string): Promise<SourceBlock[]> {
    if (this.indexed(paperId)) return Promise.resolve(this.sources(paperId))
    const active = this.indexing.get(paperId)
    if (active) return active
    const pending = this.indexPdf(paperId).finally(() => this.indexing.delete(paperId))
    this.indexing.set(paperId, pending)
    return pending
  }
  private indexed(paperId: string): boolean {
    const row = this.db.prepare('SELECT checksum,version FROM source_maps WHERE paper_id=?').get(paperId)
    return row?.checksum === this.paper(paperId).checksum && Number(row.version) >= SOURCE_MAP_VERSION
  }
  private async indexPdf(paperId: string): Promise<SourceBlock[]> {
    return this.seedSources(paperId, buildSourceSeeds(await loadPdfPages(this.paper(paperId).sourcePath)))
  }
  saveFigure(input: { paperId: string; sourceId?: string; kind: 'figure' | 'table'; label: string; text: string; parts: SourceSeed['parts']; image: string }): SourceBlock {
    this.validateSeed(input.paperId, input)
    if (!['figure', 'table'].includes(input.kind) || typeof input.image !== 'string' || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(input.image) || input.image.length > 4000000) throw new Error('图表截图无效或过大。')
    const prior = input.sourceId ? this.source(input.sourceId) : null
    if (prior && (prior.paperId !== input.paperId || !['figure', 'table'].includes(prior.kind))) throw new Error('图表来源不匹配。')
    const block: SourceBlock = { id: prior?.id ?? randomUUID(), paperId: input.paperId, checksum: this.paper(input.paperId).checksum, kind: input.kind, label: bounded(input.label, 120, true), text: bounded(input.text, 50000), parts: input.parts, image: input.image, relatedIds: prior?.relatedIds ?? [], createdAt: prior?.createdAt ?? new Date().toISOString() }
    this.db.prepare('INSERT OR REPLACE INTO source_blocks VALUES (?,?,?,?)').run(block.id, block.paperId, block.checksum, JSON.stringify(block))
    return block
  }
  matchSources(paperId: string, text: string, page?: number | null): string[] {
    const needle = normalize(text)
    if (needle.length < 8) return []
    return this.sources(paperId).filter((block) => (!page || block.parts.some((part) => part.page === page)) && normalize(block.text).includes(needle)).map((block) => block.id).slice(0, 8)
  }
  annotations(paperId: string): CardAnnotation[] {
    return this.papers.readerCards(paperId).map((card) => {
      const row = this.db.prepare('SELECT data FROM card_annotations WHERE id=?').get(card.id)
      const section = card.artifactId && card.sectionKey ? this.papers.getArtifact(card.artifactId)?.review?.sections.find((item) => item.key === card.sectionKey) : null
      return row ? JSON.parse(String(row.data)) : { cardId: card.id, nature: card.kind === 'note' ? 'personal' : section?.nature ?? defaultNature(card.sectionKey), sourceIds: this.matchSources(paperId, card.sourceText, card.pageNumber) }
    })
  }
  annotate(cardId: string, nature: ContentNature, ids: string[]): CardAnnotation {
    const card = this.papers.readerCard(cardId)
    if (card) this.paper(card.paperId)
    if (!card || !validNature(nature) || !Array.isArray(ids) || ids.length > 30 || ids.some((id) => this.source(id).paperId !== card.paperId)) throw new Error('卡片来源无效。')
    const result = { cardId, nature, sourceIds: [...new Set(ids)] }
    this.db.prepare('INSERT OR REPLACE INTO card_annotations VALUES (?,?)').run(cardId, JSON.stringify(result))
    return result
  }
  insights(paperId: string): FigureInsight[] { this.paper(paperId); return this.db.prepare('SELECT data FROM figure_insights WHERE paper_id=? ORDER BY rowid').all(paperId).map((row) => JSON.parse(String(row.data))) }
  saveInsight(value: FigureInsight): FigureInsight { this.db.prepare('INSERT OR REPLACE INTO figure_insights VALUES (?,?,?)').run(value.id, value.paperId, JSON.stringify(value)); return value }
  insightState(id: string, hidden: boolean, included: boolean): FigureInsight {
    const row = this.db.prepare('SELECT data FROM figure_insights WHERE id=?').get(id)
    if (!row || typeof hidden !== 'boolean' || typeof included !== 'boolean') throw new Error('图表卡片不存在或状态无效。')
    return this.saveInsight({ ...JSON.parse(String(row.data)), hidden, included })
  }
  projects(): ResearchProject[] {
    return this.db.prepare('SELECT data FROM research_projects ORDER BY rowid DESC').all().map((row) => {
      const value = JSON.parse(String(row.data)) as ResearchProject
      // Projects created before topic/direction existed stay readable without a migration.
      return { ...value, topic: typeof value.topic === 'string' ? value.topic : '', direction: typeof value.direction === 'string' ? value.direction : '' }
    })
  }
  project(id: string): ResearchProject { const item = this.projects().find((value) => value.id === id); if (!item) throw new Error('研究项目不存在。'); return item }
  workflow(projectId: string): ProjectWorkflow {
    this.project(projectId)
    const row = this.db.prepare('SELECT data FROM project_workflows WHERE project_id=?').get(projectId)
    const value: ProjectWorkflow = row ? JSON.parse(String(row.data)) : { projectId, stage: 'method', completed: false, activeMethodId: null, history: [], writingIds: [] }
    value.writingIds = this.db.prepare('SELECT id FROM writing_links WHERE project_id=?').all(projectId).map(row => String(row.id))
    return value
  }
  private saveWorkflow(value: ProjectWorkflow): ProjectWorkflow {
    this.db.prepare('INSERT INTO project_workflows VALUES (?,?) ON CONFLICT(project_id) DO UPDATE SET data=excluded.data').run(value.projectId, JSON.stringify(value))
    return this.workflow(value.projectId)
  }
  setStage(projectId: string, stage: ProjectStage, reason: string): ProjectWorkflow {
    if (!Object.hasOwn(projectStageLabels, stage)) throw new Error('研究阶段无效。')
    const current = this.workflow(projectId)
    if (current.completed) throw new Error('请先重新打开已完成的项目。')
    if (current.stage === stage) return current
    const note = bounded(reason, 3000)
    return this.saveWorkflow({ ...current, stage, history: [...current.history, { stage, reason: note, at: new Date().toISOString() }] })
  }
  setCompleted(projectId: string, completed: boolean): ProjectWorkflow {
    if (typeof completed !== 'boolean') throw new Error('项目完成状态无效。')
    return this.saveWorkflow({ ...this.workflow(projectId), completed })
  }
  projectEntries(projectId: string): ProjectEntry[] {
    this.project(projectId)
    return this.db.prepare('SELECT data FROM project_entries WHERE project_id=? ORDER BY rowid DESC').all(projectId).map(row => JSON.parse(String(row.data)))
  }
  saveEntry(input: ProjectEntryInput): ProjectEntry {
    if (!input || !['method', 'experiment', 'discussion'].includes(input.kind)) throw new Error('研究记录类型无效。')
    const workflow = this.workflow(input.projectId)
    if (workflow.completed) throw new Error('请先重新打开已完成的项目。')
    const entries = this.projectEntries(input.projectId), prior = input.id ? entries.find(e => e.id === input.id) : null
    if (input.id && (!prior || prior.kind !== input.kind || prior.kind !== 'experiment')) throw new Error('记录不存在，或不能覆盖历史方法和讨论。')
    const methodId = input.methodId ?? prior?.methodId ?? (input.kind === 'method' ? null : workflow.activeMethodId)
    if (input.kind === 'experiment' && !methodId) throw new Error('请先建立并选择对应方法版本。')
    if (methodId && !entries.some(e => e.id === methodId && e.kind === 'method')) throw new Error('方法版本不属于当前研究项目。')
    if (prior && prior.methodId !== methodId) throw new Error('历史实验的方法版本不可替换，请新建实验记录。')
    const status = input.status ?? prior?.status ?? 'planned'
    if (!['planned', 'running', 'complete', 'failed'].includes(status)) throw new Error('实验状态无效。')
    const sourceIds = input.sourceIds ?? prior?.sourceIds ?? []
    const project = this.project(input.projectId)
    if (!Array.isArray(sourceIds) || sourceIds.length > 50 || sourceIds.some(id => typeof id !== 'string' || !project.paperIds.includes(this.source(id).paperId))) throw new Error('讨论来源不属于当前研究项目。')
    const origin = input.origin ?? prior?.origin ?? 'manual'
    if (!['manual', 'voice'].includes(origin)) throw new Error('研究记录来源无效。')
    const now = new Date().toISOString()
    const value: ProjectEntry = {
      id: prior?.id ?? randomUUID(), projectId: input.projectId, kind: input.kind, title: bounded(input.title, 300, true), description: bounded(input.description, 12000, true),
      methodId, version: prior?.version ?? (input.kind === 'method' ? entries.filter(e => e.kind === 'method').length + 1 : 0), status,
      dataset: bounded(input.dataset ?? prior?.dataset ?? '', 3000), setup: bounded(input.setup ?? prior?.setup ?? '', 6000), command: bounded(input.command ?? prior?.command ?? '', 6000),
      result: bounded(input.result ?? prior?.result ?? '', 12000), conclusion: bounded(input.conclusion ?? prior?.conclusion ?? '', 6000), nextStep: bounded(input.nextStep ?? prior?.nextStep ?? '', 6000),
      sourceIds: [...new Set(sourceIds)], origin, createdAt: prior?.createdAt ?? now, updatedAt: now,
    }
    if (value.kind === 'experiment' && value.status === 'complete' && !value.result) throw new Error('已完成的实验需要填写实际结果。')
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.prepare('INSERT INTO project_entries VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(value.id, value.projectId, JSON.stringify(value))
      if (value.kind === 'method') this.saveWorkflow({ ...workflow, activeMethodId: value.id })
      this.db.exec('COMMIT')
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
    return value
  }
  openWriting(projectId: string): string {
    const project = this.project(projectId), linked = this.workflow(projectId).writingIds
    if (linked[0]) return linked[0]
    if (this.workflow(projectId).completed) throw new Error('请先重新打开项目，再创建关联稿件。')
    const writing = this.papers.createWritingProject(project.title, '', '')
    this.linkWriting(writing.id, projectId)
    return writing.id
  }
  projectContext(projectId: string): string {
    const project = this.project(projectId), workflow = this.workflow(projectId), entries = this.projectEntries(projectId)
    const context = { title: project.title, topic: project.topic, direction: project.direction, question: project.question, stage: projectStageLabels[workflow.stage], completed: workflow.completed,
      activeMethod: entries.filter(e => e.id === workflow.activeMethodId).map(e => ({ id: e.id, version: e.version, title: e.title, description: e.description.slice(0, 6000), nextStep: e.nextStep.slice(0, 2000) }))[0],
      experiments: entries.filter(e => e.kind === 'experiment').slice(0, 3).map(e => ({ id: e.id, title: e.title, methodId: e.methodId, methodVersion: entries.find(m => m.id === e.methodId)?.version, methodTitle: entries.find(m => m.id === e.methodId)?.title, status: e.status, description: e.description.slice(0, 1000), result: e.result.slice(0, 1500), conclusion: e.conclusion.slice(0, 1000), nextStep: e.nextStep.slice(0, 500), dataset: e.dataset.slice(0, 500), setup: e.setup.slice(0, 500), command: e.command.slice(0, 500) })),
      discussions: entries.filter(e => e.kind === 'discussion').slice(0, 3).map(e => ({ title: e.title, description: e.description.slice(0, 2000) })),
      evidenceNote: '以上方法、实验与讨论为用户研究记录，不能当作已核验论文事实；未运行的实验没有结果。',
      contextNote: '为控制模型上下文长度，仅提供当前方法、最近三次实验与最近三次讨论；完整历史保存在项目内。',
    }
    let serialized = JSON.stringify(context)
    while (serialized.length > 44000 && (context.discussions.length || context.experiments.length)) {
      if (context.discussions.length) context.discussions.pop()
      else context.experiments.pop()
      serialized = JSON.stringify(context)
    }
    return serialized
  }
  saveProject(input: { id?: string; title: string; topic?: string; direction?: string; question: string; paperIds?: string[] }): ResearchProject {
    const prior = input.id ? this.project(input.id) : null
    const now = new Date().toISOString()
    const selected = prior ? prior.paperIds : [...new Set(input.paperIds ?? [])].map((id) => { this.paper(id); return id })
    const value: ResearchProject = {
      id: prior?.id ?? randomUUID(),
      title: bounded(input.title, 300, true),
      topic: bounded(input.topic ?? prior?.topic ?? '', 300),
      direction: bounded(input.direction ?? prior?.direction ?? '', 2000),
      question: bounded(input.question, 6000),
      paperIds: selected, fieldId: prior?.fieldId, fieldContext: prior?.fieldContext, createdAt: prior?.createdAt ?? now, updatedAt: now, sessionId: prior?.sessionId,
    }
    this.db.prepare('INSERT INTO research_projects VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(value.id, JSON.stringify(value)); return value
  }
  setProjectField(projectId: string, fieldId?: string): ResearchProject {
    const project = this.project(projectId)
    const next = { ...project, updatedAt: new Date().toISOString() }
    if (fieldId) next.fieldId = fieldId
    else { delete next.fieldId; delete next.fieldContext }
    this.db.prepare('UPDATE research_projects SET data=? WHERE id=?').run(JSON.stringify(next), projectId)
    return next
  }
  /** 记住哪一版领域简报已经发进会话，下次同一版本就不再粘贴正文；传 null 清空（换会话时用）。 */
  markProjectFieldContext(projectId: string, fieldId: string | null, version = 0): ResearchProject {
    const project = this.project(projectId)
    const next: ResearchProject = { ...project, updatedAt: new Date().toISOString() }
    if (fieldId) next.fieldContext = { ...project.fieldContext, [fieldId]: version }
    else delete next.fieldContext
    this.db.prepare('UPDATE research_projects SET data=? WHERE id=?').run(JSON.stringify(next), projectId)
    return next
  }
  setProjectSession(projectId: string, sessionId: string): void {
    const project = this.project(projectId)
    if (typeof sessionId !== 'string' || !sessionId.trim()) throw new Error('会话标识无效。')
    const result = { ...project, sessionId, updatedAt: new Date().toISOString() }
    /* 新会话里没有旧消息，之前的领域简报记录随之作废。 */
    delete result.fieldContext
    this.db.prepare('UPDATE research_projects SET data=? WHERE id=?').run(JSON.stringify(result), projectId)
  }
  setProjectPaper(projectId: string, paperId: string, included: boolean): ResearchProject {
    const project = this.project(projectId); this.paper(paperId)
    if (typeof included !== 'boolean') throw new Error('关联状态无效。')
    if (!included && this.materials(projectId).some((item) => item.paperId === paperId)) throw new Error('此论文仍有项目材料，请先移除相关材料。')
    const result = { ...project, paperIds: included ? [...new Set([...project.paperIds, paperId])] : project.paperIds.filter((id) => id !== paperId), updatedAt: new Date().toISOString() }
    this.db.prepare('UPDATE research_projects SET data=? WHERE id=?').run(JSON.stringify(result), projectId); return result
  }
  materials(projectId: string): ProjectMaterial[] { this.project(projectId); return this.db.prepare('SELECT data FROM project_materials WHERE project_id=? ORDER BY rowid').all(projectId).map((row) => JSON.parse(String(row.data))) }
  addMaterial(input: { projectId: string; paperId: string; cardId?: string; insightId?: string; sourceId?: string; category: ProjectMaterial['category'] }): ProjectMaterial {
    this.project(input.projectId); this.paper(input.paperId)
    if (!['related', 'method', 'experiment', 'note'].includes(input.category)) throw new Error('材料分类无效。')
    let title = '', content = '', sourceIds: string[] = [], nature: ContentNature = 'fact'
    if (input.cardId) {
      const card = this.papers.readerCards(input.paperId).find((value) => value.id === input.cardId && !value.hidden)
      if (!card?.content.trim()) throw new Error('请先完成卡片内容。')
      const annotation = this.annotations(input.paperId).find((item) => item.cardId === card.id)!
      title = card.sectionKey ?? (card.kind === 'note' ? '阅读笔记' : '论文卡片'); content = card.content; sourceIds = annotation.sourceIds; nature = annotation.nature
    } else if (input.insightId) {
      const insight = this.insights(input.paperId).find((value) => value.id === input.insightId && value.status === 'complete' && !value.hidden)
      if (!insight) throw new Error('图表解读尚未完成。')
      title = insight.title; content = insight.content; sourceIds = [insight.sourceId, ...insight.evidenceIds]; nature = 'inference'
    } else if (input.sourceId) {
      const source = this.source(input.sourceId)
      if (source.paperId !== input.paperId) throw new Error('来源论文不一致。')
      title = source.label; content = source.text; sourceIds = [source.id]
    } else throw new Error('请选择来源。')
    const value: ProjectMaterial = { id: randomUUID(), projectId: input.projectId, paperId: input.paperId, title, content, nature, sourceIds: [...new Set(sourceIds)], sourceCardId: input.cardId ?? input.insightId ?? null, category: input.category, createdAt: new Date().toISOString() }
    this.setProjectPaper(input.projectId, input.paperId, true)
    this.db.prepare('INSERT INTO project_materials VALUES (?,?,?)').run(value.id, value.projectId, JSON.stringify(value)); return value
  }
  removeMaterial(id: string): void {
    const used = this.db.prepare('SELECT data FROM argument_plans').all().some((row) => (JSON.parse(String(row.data)) as ArgumentPlan).materialIds.includes(id))
    if (used) throw new Error('材料已用于写作论证，请先解除段落中的关联。')
    this.db.prepare('DELETE FROM project_materials WHERE id=?').run(id)
  }
  writingLink(id: string): string | null { const row = this.db.prepare('SELECT project_id FROM writing_links WHERE id=?').get(id); return row?.project_id ? String(row.project_id) : null }
  linkWriting(writingId: string, researchId: string | null): void {
    if (!this.papers.writingProjects().some((item) => item.id === writingId)) throw new Error('稿件不存在。')
    if (researchId) this.project(researchId)
    const prior = this.writingLink(writingId)
    if (prior && prior !== researchId) {
      const paragraphIds = ['title', 'abstract', 'introduction', 'related_work', 'methods', 'experiments', 'results', 'discussion', 'conclusion'].flatMap((section) => this.papers.writingParagraphs(writingId, section as import('../shared/types').WritingSectionKey).map((item) => item.id))
      if (paragraphIds.some((id) => this.argument(id).materialIds.length)) throw new Error('段落仍关联原项目材料，请先解除关联。')
    }
    this.db.prepare('INSERT OR REPLACE INTO writing_links VALUES (?,?)').run(writingId, researchId)
  }
  argument(id: string): ArgumentPlan {
    if (!this.papers.writingParagraph(id)) throw new Error('段落不存在。')
    const row = this.db.prepare('SELECT data FROM argument_plans WHERE id=?').get(id)
    return row ? JSON.parse(String(row.data)) : { paragraphId: id, job: 'context', claim: '', evidence: '', boundary: '', sourceIds: [], materialIds: [] }
  }
  saveArgument(input: ArgumentPlan): ArgumentPlan {
    const paragraph = this.papers.writingParagraph(input.paragraphId)
    if (!paragraph || !(input.job in paragraphJobs) || !Array.isArray(input.sourceIds) || !Array.isArray(input.materialIds) || input.sourceIds.length > 30 || input.materialIds.length > 30) throw new Error('段落论证无效。')
    for (const id of input.sourceIds) this.source(id)
    const linked = this.writingLink(paragraph.projectId)
    if (input.materialIds.length && (!linked || input.materialIds.some((id) => !this.materials(linked).some((item) => item.id === id)))) throw new Error('材料不属于关联研究项目。')
    const value: ArgumentPlan = { ...input, claim: bounded(input.claim, 6000), evidence: bounded(input.evidence, 12000), boundary: bounded(input.boundary, 6000), updatedAt: new Date().toISOString() }
    this.db.prepare('INSERT OR REPLACE INTO argument_plans VALUES (?,?)').run(input.paragraphId, JSON.stringify(value)); return value
  }
  argumentContext(paragraphId: string): string {
    const plan = this.argument(paragraphId), paragraph = this.papers.writingParagraph(paragraphId)!, linked = this.writingLink(paragraph.projectId)
    const materials = linked ? this.materials(linked).filter((item) => plan.materialIds.includes(item.id)) : []
    const ids = [...new Set([...plan.sourceIds, ...materials.flatMap((item) => item.sourceIds)])]
    const context = JSON.stringify({ plan, researchQuestion: linked ? this.project(linked).question : '', researchProgress: linked ? this.projectContext(linked) : '', materials, sources: ids.map((id) => this.source(id)) }, (key, value) => key === 'image' ? undefined : value)
    if(context.length>60000)throw new Error('本段论证材料过长，请减少选择的材料；不会截断或丢失原文来源。')
    return context
  }
  argumentReviews(id: string, section: string): ArgumentReview[] { return this.db.prepare('SELECT data FROM argument_reviews WHERE writing_project_id=? AND section=? ORDER BY rowid DESC LIMIT 15').all(id, section).map((row) => JSON.parse(String(row.data))) }
  saveArgumentReview(writingProjectId: string, section: string, content: string): ArgumentReview {
    const result = { id: randomUUID(), writingProjectId, section, content, createdAt: new Date().toISOString() }
    this.db.prepare('INSERT INTO argument_reviews VALUES (?,?,?,?)').run(result.id, writingProjectId, section, JSON.stringify(result)); return result
  }
  async voiceSources(context: VoiceContext, question: string): Promise<{ blocks: SourceBlock[]; description: string; materials: ProjectMaterial[] }> {
    const project = context.projectId ? this.project(context.projectId) : null
    if (context.paperId) this.paper(context.paperId)
    const ids = context.paperId ? [context.paperId] : project?.paperIds ?? []
    if (context.paperId && project && !project.paperIds.includes(context.paperId)) throw new Error('当前论文不属于所选研究项目。')
    const terms: string[] = question.toLowerCase().match(/[a-z0-9]{3,}|[\u4e00-\u9fff]{2,}/g) ?? []
    for(const [chinese,english] of [['方法|架构|流程','method framework architecture pipeline'],['实验|评估|比较','experiment evaluation baseline comparison'],['数据集|队列','dataset benchmark cohort'],['结果|性能|准确','result accuracy performance'],['泛化|外部|可靠','generalization external reliability'],['局限|缺口|不足','limitation gap challenge'],['贡献|创新','contribution novel'],['因果|机制','causal mechanism'],['摘要|概述','abstract introduction']])if(new RegExp(chinese).test(question))terms.push(...english.split(' '))
    const blocks: SourceBlock[] = []
    for (const id of ids.slice(0, 20)) {
      const all = (await this.ensureSources(id)).filter((block) => block.kind !== 'reference')
      const sorted = all.map((block, index) => ({ block, score: terms.reduce((sum, term) => sum + (block.text.toLowerCase().includes(term) ? 10 : 0), 0) + (index < 3 ? 3 - index : 0) })).sort((a, b) => b.score - a.score)
      blocks.push(...sorted.slice(0, context.paperId ? 12 : 3).map((item) => item.block))
    }
    return { blocks: blocks.slice(0, 30), description: project ? this.projectContext(project.id) : context.paperId ? this.paper(context.paperId).title : '', materials: project ? this.materials(project.id).slice(0, 12) : [] }
  }
}
