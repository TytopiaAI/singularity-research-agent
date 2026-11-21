export const researchDirections = ['大语言模型', '强化学习', 'LLM 智能体', '视觉语言模型', '表征学习', '扩散模型', '异常检测']
export const researchYearOptions = [1, 2, 3, 5, 10] as const
export const researchMonthOptions = [1, 3, 6, 12, 24, 60] as const
export type ResearchMode = 'recommend' | 'survey'
export interface ResearchRequest {
  monthly?: boolean; mode: ResearchMode; topics: string[]; inspirations: string[]
  publicationYears: number; preprintMonths: number; count: 5 | 10 | 15 | 20
  /** Optional explicit window (YYYY-MM-DD). Overrides the preset year/month spans. */
  dateFrom?: string; dateTo?: string
  projectId?: string; projectContext?: string; fieldId?: string
  /** Delta follow-up: compare new papers against the conclusion captured before this run. */
  delta?: boolean
}
export interface ResearchCandidate {
  id: string; title: string; authors: string; date: string; venue: string; url: string; arxivId?: string
  group: 'published' | 'preprint'; topics: string[]; roles: ('core' | 'inspiration')[]
  abstract: string; evidence?: string; evidenceKind?: 'full-text' | 'abstract'; links?: string[]
}
export interface ResearchRecommendation {
  directions?: string[]
  sourceId: string; summary: string; method: string; datasets: string; evaluation: string
  contribution: 'substantive' | 'incremental' | 'uncertain'; contributionReason: string; risks: string; transfer: string
  evidence: { claim: string; quote: string }[]; libraryId?: string
}
export interface ResearchMention { sourceId: string; title: string; date: string; venue: string }
export interface ResearchRun {
  id: string; createdAt: string; request: ResearchRequest
  status: 'planning' | 'collecting' | 'reading' | 'analysing' | 'complete' | 'failed' | 'cancelled'
  progress: string; sources: ResearchCandidate[]; items: ResearchRecommendation[]; overview: string; insights: string[]; warnings: string[]; error?: string
  /** Papers the development summary may name. Wider than the recommended set. */
  mentions?: ResearchMention[]
  /** Current bottlenecks and limitations, written after the summary and recommendations. */
  bottlenecks?: string
}
const isoDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().startsWith(value)
export function validateResearchRequest(value: unknown): ResearchRequest {
  const v = value as ResearchRequest
  const topics = (items: unknown, required: boolean): string[] => {
    if (!Array.isArray(items) || items.length > 3 || required && !items.length || items.some(t => typeof t !== 'string' || !t.trim() || t.trim().length > 120)) throw new Error('请选择 1–3 个核心主题，思路主题最多 3 个，每项不超过 120 字')
    return [...new Set(items.map(t => t.trim()))]
  }
  if (!v || !['recommend', 'survey'].includes(v.mode) || !(researchYearOptions as readonly number[]).includes(v.publicationYears) || !(researchMonthOptions as readonly number[]).includes(v.preprintMonths) || ![5, 10, 15, 20].includes(v.count)) throw new Error('研究请求无效')
  const custom = v.dateFrom !== undefined || v.dateTo !== undefined
  if (custom) {
    if (!isoDate(v.dateFrom) || !isoDate(v.dateTo)) throw new Error('自定义时间范围需要完整的开始与结束日期')
    if (v.dateFrom > v.dateTo) throw new Error('自定义时间范围的开始日期不能晚于结束日期')
  }
  if (v.projectId !== undefined && (typeof v.projectId !== 'string' || !v.projectId || v.projectId.length > 100)) throw new Error('关联项目无效')
  if (v.fieldId !== undefined && (typeof v.fieldId !== 'string' || !v.fieldId || v.fieldId.length > 100)) throw new Error('领域知识库无效')
  return { monthly: v.monthly === true, mode: v.mode, topics: topics(v.topics, true), inspirations: v.mode === 'survey' ? topics(v.inspirations, false) : [], publicationYears: v.publicationYears, preprintMonths: v.preprintMonths, count: v.mode === 'recommend' ? 5 : v.count, ...(custom ? { dateFrom: v.dateFrom, dateTo: v.dateTo } : {}), ...(v.fieldId ? { fieldId: v.fieldId } : {}), ...(v.delta === true && v.fieldId ? { delta: true } : {}), ...(v.projectId ? { projectId: v.projectId, projectContext: typeof v.projectContext === 'string' ? v.projectContext.slice(0, 45000) : '' } : {}) }
}
/** Appending new papers to an existing survey: explicit window plus how many new papers to read. */
export interface ResearchUpdateOptions { dateFrom: string; dateTo: string; count: 5 | 10 | 15 | 20 }
export function validateResearchUpdate(value: unknown): ResearchUpdateOptions {
  const v = value as ResearchUpdateOptions
  if (!v || typeof v !== 'object') throw new Error('更新参数无效')
  if (!isoDate(v.dateFrom) || !isoDate(v.dateTo)) throw new Error('更新需要完整的开始与结束日期')
  if (v.dateFrom > v.dateTo) throw new Error('更新时间范围的开始日期不能晚于结束日期')
  if (![5, 10, 15, 20].includes(v.count)) throw new Error('更新篇数无效')
  return { dateFrom: v.dateFrom, dateTo: v.dateTo, count: v.count }
}
export function describeResearchWindow(request: Pick<ResearchRequest, 'publicationYears' | 'preprintMonths' | 'dateFrom' | 'dateTo'>): string {
  if (request.dateFrom && request.dateTo) return `${request.dateFrom} 至 ${request.dateTo}`
  return `近 ${request.publicationYears} 年发表 / 近 ${request.preprintMonths} 个月预印本`
}
