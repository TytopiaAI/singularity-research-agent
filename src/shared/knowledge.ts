import type { ReaderRect, ReviewSectionKey } from './types'
import type { ProjectEntry, ProjectEntryInput, ProjectStage, ProjectWorkflow } from './project-workflow'

export type SourceKind = 'paragraph' | 'figure' | 'table' | 'reference'
export interface SourcePart { page: number; rects: ReaderRect[] }
export interface SourceSeed { kind: SourceKind; label: string; text: string; parts: SourcePart[]; relatedIds?: string[] }
export interface SourceBlock extends SourceSeed {
  id: string; paperId: string; checksum: string; image: string | null; createdAt: string
  /** Earlier-version blocks this block supersedes after a source-map re-index. */
  replaces?: string[]
  /** Set on blocks from an earlier map version; they stay readable for old citations. */
  retired?: boolean
  supersededBy?: string
}
/** Find a block by id, following re-index succession. */
export const findSource = (blocks: SourceBlock[], id: string | null | undefined): SourceBlock | undefined =>
  id ? blocks.find((block) => block.id === id) ?? blocks.find((block) => block.replaces?.includes(id)) : undefined
export type ContentNature = 'fact' | 'inference' | 'personal'
export const natureLabels: Record<ContentNature, string> = { fact: '论文事实', inference: '研究推演', personal: '我的推演' }
export function defaultNature(key?: ReviewSectionKey | null): ContentNature {
  return key && ['future', 'action', 'explanation', 'concepts'].includes(key) ? 'inference' : 'fact'
}
export interface CardAnnotation { cardId: string; nature: ContentNature; sourceIds: string[] }
export interface FigureInsight {
  id: string; paperId: string; sourceId: string; title: string; status: 'running' | 'complete' | 'failed'
  content: string; evidenceIds: string[]; scope: 'caption' | 'vision'; error: string | null; hidden: boolean; included: boolean; createdAt: string
}
export interface ResearchProject {
  id: string
  title: string
  /** 研究主题：所属大领域，例如「异常检测」。 */
  topic: string
  /** 研究方向：在主题下具体要推进的子方向或技术路线。 */
  direction: string
  /** 研究重点：这个项目究竟想解决什么问题（沿用早期字段名，兼容历史项目）。 */
  question: string
  paperIds: string[]
  /** 科研发现里已总结的领域，用作项目对话的背景。 */
  fieldId?: string
  /** 本会话里已经发过的领域简报版本（fieldId → version），用来跳过重复粘贴；换会话时清空。 */
  fieldContext?: Record<string, number>
  createdAt: string
  updatedAt: string
  /** Harness session backing the project conversation, created on first open. */
  sessionId?: string
}
export interface ProjectMaterial {
  id: string; projectId: string; paperId: string; title: string; content: string; nature: ContentNature
  sourceIds: string[]; sourceCardId: string | null; category: 'related' | 'method' | 'experiment' | 'note'; createdAt: string
}
export type ParagraphJob = 'context' | 'gap' | 'approach' | 'result' | 'comparison' | 'mechanism' | 'implication' | 'limitation'
export const paragraphJobs: Record<ParagraphJob, string> = { context: '背景', gap: '研究缺口', approach: '方法', result: '结果', comparison: '比较', mechanism: '机制', implication: '意义', limitation: '局限' }
export interface ArgumentPlan { paragraphId: string; job: ParagraphJob; claim: string; evidence: string; boundary: string; sourceIds: string[]; materialIds: string[]; updatedAt?: string }
export interface ArgumentReview { id: string; writingProjectId: string; section: string; content: string; createdAt: string }
export interface VoiceContext { paperId?: string; projectId?: string }
export interface VoiceCitation { sourceId: string; paperId: string; label: string; page: number; text: string }
export interface ContextVoiceAnswer { text: string; citations: VoiceCitation[] }

export interface KnowledgeApi {
  sources(paperId: string): Promise<SourceBlock[]>
  seedSources(paperId: string, seeds: SourceSeed[]): Promise<SourceBlock[]>
  saveFigure(input: { paperId: string; sourceId?: string; kind: 'figure' | 'table'; label: string; text: string; parts: SourcePart[]; image: string }): Promise<SourceBlock>
  annotations(paperId: string): Promise<CardAnnotation[]>
  annotate(cardId: string, nature: ContentNature, sourceIds: string[]): Promise<CardAnnotation>
  insights(paperId: string): Promise<FigureInsight[]>
  interpret(sourceId: string, observation: string, vision: boolean): Promise<FigureInsight>
  insightState(id: string, hidden: boolean, included: boolean): Promise<FigureInsight>
  projects(): Promise<ResearchProject[]>
  workflow(projectId: string): Promise<ProjectWorkflow>
  setStage(projectId: string, stage: ProjectStage, reason: string): Promise<ProjectWorkflow>
  setCompleted(projectId: string, completed: boolean): Promise<ProjectWorkflow>
  projectEntries(projectId: string): Promise<ProjectEntry[]>
  saveEntry(input: ProjectEntryInput): Promise<ProjectEntry>
  openWriting(projectId: string): Promise<string>
  saveProject(input: { id?: string; title: string; topic?: string; direction?: string; question: string; paperIds?: string[] }): Promise<ResearchProject>
  setProjectPaper(projectId: string, paperId: string, included: boolean): Promise<ResearchProject>
  /** Attach or clear a surveyed field as conversation context. */
  setProjectField(projectId: string, fieldId: string): Promise<ResearchProject>
  /** Open (creating on first use) the project's harness-backed conversation. */
  projectChat(projectId: string): Promise<import('./project-chat').ProjectChatState>
  /** Queue one user message onto the project conversation. */
  projectChatSend(projectId: string, text: string): Promise<import('./project-chat').ProjectChatState>
  /** Push the latest topic/direction/focus into an existing conversation. */
  projectChatSync(projectId: string): Promise<import('./project-chat').ProjectChatState>
  /** Stop the project conversation's running turn. */
  projectChatCancel(projectId: string): Promise<void>
  materials(projectId: string): Promise<ProjectMaterial[]>
  addMaterial(input: { projectId: string; paperId: string; cardId?: string; insightId?: string; sourceId?: string; category: ProjectMaterial['category'] }): Promise<ProjectMaterial>
  removeMaterial(id: string): Promise<void>
  linkWriting(writingProjectId: string, researchProjectId: string | null): Promise<void>
  writingLink(writingProjectId: string): Promise<string | null>
  argument(paragraphId: string): Promise<ArgumentPlan>
  saveArgument(input: ArgumentPlan): Promise<ArgumentPlan>
  reviewArgument(writingProjectId: string, section: string): Promise<ArgumentReview>
  argumentReviews(writingProjectId: string, section: string): Promise<ArgumentReview[]>
  contextReply(sessionId: string, messages: import('./voice').VoiceMessage[], context: VoiceContext): Promise<ContextVoiceAnswer>
}
