import type { ResearchCandidate, ResearchRecommendation } from './research-explorer'

export interface FieldPaper {
  starred?: boolean; id: string; source: ResearchCandidate; analysis: ResearchRecommendation; directions: string[]; curated: boolean
  origins: { runId: string; sourceId: string }[]; firstSeenAt: string; updatedAt: string
}
export type FieldRelationKind = 'improves' | 'combines' | 'inspires' | 'similar'
export const fieldRelationLabels: Record<FieldRelationKind, string> = { similar: '方法相似', improves: '方法改进', combines: '机制结合', inspires: '思路借鉴' }
export interface FieldRelation { id: string; from: string; to: string; kind: FieldRelationKind; reason: string }
export interface FieldSection { title: string; body: string; kind: 'development' | 'evaluation' | 'insight'; sourceIds: string[] }
export interface FieldReport { warnings?: string[]; runId: string; createdAt: string; overview: string; insights: string[]; paperIds: string[] }
/** How a paper found by a follow-up bears on the conclusion captured before that run. */
export type DeltaVerdict = 'supports' | 'refutes' | 'extends' | 'irrelevant' | 'unverified'
export const deltaVerdictLabels: Record<DeltaVerdict, string> = {
  supports: '支持', refutes: '推翻 / 冲突', extends: '扩展', irrelevant: '无关', unverified: '证据不足',
}
/** Snapshot of the field's conclusion taken when a delta follow-up starts, before any new paper is ingested. */
export interface FieldDeltaBaseline {
  capturedAt: string; documentVersion: number
  sections: { title: string; kind: FieldSection['kind']; body: string }[]
  report?: { overview: string; insights: string[] }
  survey?: { createdAt: string; overview: string; insights: string[]; bottlenecks: string }
}
export interface FieldDeltaItem {
  sourceId: string; title: string; verdict: DeltaVerdict
  claim: string; section: string; reason: string; quote: string
  evidenceKind: 'full-text' | 'abstract'
}
export interface FieldDeltaReport {
  id: string; runId: string; createdAt: string
  dateFrom?: string; dateTo?: string
  baselineAt: string; baselineVersion: number
  summary: string; shifts: string[]; action: string
  items: FieldDeltaItem[]; warnings: string[]
}
export interface FieldSummary {
  parentId?: string; monthly?: boolean; nextUpdateAt?: string; monthlyError?: string; lastSurveyAt?: string;
  id: string; title: string; paperCount: number; directionCount: number; revision: number; updatedAt: string
  documentVersion: number; documentState: 'draft' | 'current' | 'outdated' | 'updating' | 'failed'
}
export interface FieldKnowledge extends FieldSummary {
  reports?: FieldReport[]; deltas?: FieldDeltaReport[]; papers: FieldPaper[]; relations: FieldRelation[]; notes: string; sections: FieldSection[]
  documentMarkdown: string; documentPath: string; documentUpdatedAt: string | null; synthesisCoverage: number; error: string | null
}
export interface FieldApi {
  setFieldMonthly(id: string, enabled: boolean): Promise<FieldKnowledge>
  starFieldPaper(id: string, paperId: string, starred: boolean): Promise<FieldKnowledge>
  fields(): Promise<FieldSummary[]>
  field(id: string): Promise<FieldKnowledge>
  createField(title: string, parentId?: string): Promise<FieldKnowledge>
  saveFieldNotes(id: string, notes: string, previous: string): Promise<FieldKnowledge>
  setFieldDirections(id: string, paperId: string, directions: string[]): Promise<FieldKnowledge>
  addFieldRelation(id: string, input: Omit<FieldRelation, 'id'>): Promise<FieldKnowledge>
  removeFieldRelation(id: string, relationId: string): Promise<FieldKnowledge>
  updateFieldDocument(id: string): Promise<FieldKnowledge>
  importFieldPaper(id: string, paperId: string, projectId?: string): Promise<import('./types').PaperRecord>
}
export const normalizeField = (value: string) => value.normalize('NFKC').replace(/\s+/g, '').toLowerCase()
export function validateDirections(value: unknown): string[] {
  if (!Array.isArray(value) || !value.length || value.length > 3 || value.some(v => typeof v !== 'string' || !v.trim() || v.length > 50)) throw new Error('请选择 1–3 个研究方向，每项不超过 50 字。')
  return [...new Set(value.map(v => v.trim()))]
}
export function inferDirections(item: ResearchRecommendation): string[] {
  if (item.directions?.length) return validateDirections(item.directions)
  const rules: [string, RegExp][] = [['重建', /重建|reconstruct/i], ['知识嵌入', /知识嵌入|知识注入|knowledge.embed|knowledge.inject/i], ['知识蒸馏', /蒸馏|distill/i], ['特征匹配', /特征匹配|feature.match|memory.bank/i], ['生成建模', /扩散模型|diffusion.model|生成建模/i]]
  const result = rules.filter(([, re]) => re.test(item.method)).map(([label]) => label).slice(0, 3)
  return result.length ? result : ['待归类']
}
export function fieldDate(value: string): string {
  const date = value?.slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date)) && new Date(date).toISOString().startsWith(date) ? date : ''
}
export function layoutFieldGraph(papers: FieldPaper[], relations: FieldRelation[], direction = '', unit: 'month' | 'year' = 'month') {
  const selected = papers.filter(p => !direction || p.directions.includes(direction)).sort((a,b) => (fieldDate(a.source.date) || '9999').localeCompare(fieldDate(b.source.date) || '9999') || a.source.title.localeCompare(b.source.title)).slice(0, 100)
  const bucket = (p: FieldPaper) => fieldDate(p.source.date)?.slice(0, unit === 'month' ? 7 : 4) || '日期待核验'
  const dates = [...new Set(selected.map(bucket))].sort((a,b) => a === '日期待核验' ? 1 : b === '日期待核验' ? -1 : a.localeCompare(b))
  const labels = direction ? [direction] : [...new Set(selected.flatMap(p => p.directions))].sort()
  const nodes: { key: string; paper: FieldPaper; direction: string; x: number; y: number }[] = []
  const lanes: { title: string; y: number; height: number }[] = [], edges: { from: string; to: string; relation?: FieldRelation }[] = []
  let y = 48
  for (const label of labels) {
    const items = selected.filter(p => p.directions.includes(label)), counts = new Map<string, number>()
    for (const paper of items) {
      const date = bucket(paper), row = counts.get(date) ?? 0; counts.set(date, row + 1)
      nodes.push({ key: `${paper.id}:${label}`, paper, direction: label, x: 170 + dates.indexOf(date) * 254, y: y + 28 + row * 126 })
    }
    for (let i = 1; i < items.length; i++) if (fieldDate(items[i-1].source.date) && fieldDate(items[i].source.date) && fieldDate(items[i-1].source.date) !== fieldDate(items[i].source.date)) edges.push({ from: `${items[i-1].id}:${label}`, to: `${items[i].id}:${label}` })
    const height = Math.max(1, ...counts.values()) * 126 + 42; lanes.push({ title: label, y, height }); y += height
  }
  for (const relation of relations) {
    const from = nodes.find(n => n.paper.id === relation.from), to = nodes.find(n => n.paper.id === relation.to)
    if (from && to) edges.push({ from: from.key, to: to.key, relation })
  }
  return { nodes, edges, lanes, dates, width: Math.max(680, 182 + dates.length * 254), height: Math.max(210, y + 12), shown: selected.length }
}

