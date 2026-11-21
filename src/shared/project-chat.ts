/** One rendered line of a research project conversation. */
export interface ProjectChatMessage {
  /** Stable identity derived from the harness session event seq. */
  id: string
  role: 'user' | 'assistant' | 'tool'
  text: string
  toolName?: string
  toolError?: boolean
  time: number
}

/** Conversation snapshot returned to the renderer. */
export interface ProjectChatState {
  sessionId: string
  running: boolean
  messages: ProjectChatMessage[]
}

/** Minimal structural view of one harness session event; keep in sync with dsh-session. */
export interface HarnessSessionEventLike {
  type: string
  seq: number
  time: number
  data?: {
    message?: { role?: string; content?: unknown; source?: { kind?: string }; toolCallId?: string; isError?: boolean }
    callId?: string
    name?: string
  }
}

interface ContentBlockLike { type?: string; text?: string }

function blocksToText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((block): block is ContentBlockLike => Boolean(block) && typeof block === 'object')
    .filter((block) => block.type === 'text')
    .map((block) => typeof block.text === 'string' ? block.text : '')
    .join('')
    .trim()
}

/**
 * Map an ascending seq-ordered harness event log to the compact conversation
 * view. Only genuine queued user prompts, assistant text, and tool calls are
 * shown; system/developer injections, reasoning-only attempts, and internal
 * context messages stay hidden.
 */
export function projectChatMessages(events: HarnessSessionEventLike[]): ProjectChatMessage[] {
  const messages: ProjectChatMessage[] = []
  const toolNames = new Map<string, string>()
  const settled = new Set<string>()
  for (const event of events) {
    if (event.type === 'tool/call' && event.data?.callId && event.data.name) {
      toolNames.set(event.data.callId, event.data.name)
    }
  }
  for (const event of events) {
    const data = event.data ?? {}
    if (event.type === 'user/message') {
      const message = data.message ?? {}
      if (message.source && message.source.kind !== 'user') continue
      const text = blocksToText(message.content)
      if (!text) continue
      messages.push({ id: `u${event.seq}`, role: 'user', text, time: event.time })
    } else if (event.type === 'assistant/message') {
      const text = blocksToText(data.message?.content)
      if (!text) continue
      messages.push({ id: `a${event.seq}`, role: 'assistant', text, time: event.time })
    } else if (event.type === 'tool/result') {
      const callId = data.message?.toolCallId
      const toolName = callId ? toolNames.get(callId) : undefined
      const failed = Boolean((data.message as { isError?: boolean } | undefined)?.isError)
      const text = blocksToText(data.message?.content).slice(0, 400)
      messages.push({ id: `t${event.seq}`, role: 'tool', text, toolName, toolError: failed, time: event.time })
      if (callId) settled.add(callId)
    }
  }
  // Tool calls still without a result are in flight; surface one pending row each.
  for (const event of events) {
    if (event.type !== 'tool/call' || !event.data?.callId || settled.has(event.data.callId)) continue
    messages.push({ id: `p${event.seq}`, role: 'tool', text: '', toolName: event.data.name, time: event.time })
  }
  messages.sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)))
  return messages
}

/** Project brief shared by the greeting prompt and the harness session factory. */
export interface ProjectBrief {
  title: string
  /** 研究重点：想解决什么问题。 */
  question: string
  /** 研究主题：大领域。 */
  topic?: string
  /** 研究方向：具体推进的子方向。 */
  direction?: string
}

/** Message that pushes an updated project brief into an already-running conversation. */
export function projectSettingsMessage(project: ProjectBrief): string {
  return `【项目设定更新】后续讨论请以以下设定为准：
研究主题：${project.topic || '（尚未设定）'}
研究方向：${project.direction || '（尚未设定）'}
研究重点（想解决什么问题）：${project.question || '（尚未设定）'}
请用一两句话确认你理解的变化，不用重新开场，也不要重复完整的项目介绍。`
}

/** Push a surveyed field, or its removal, into an already-running conversation. */
export function projectFieldMessage(field: { title: string; summary: string } | null): string {
  if (!field) return '【领域上下文已移除】后续讨论不再引用科研发现里的领域总结。请用一句话确认，不用重新开场。'
  return `【领域上下文更新】后续找创新点时，可以把下面这份科研发现的领域总结合进来。它只是背景：论文写明的内容与推演要分开，不能把推演当成已证实事实。
领域：${field.title}
${field.summary}
请用一两句话确认你会怎么用这份总结，不用重新开场。`
}

/** Tell a running conversation which library papers are now in context. */
export function projectPapersMessage(papers: Array<{ id: string; title: string }>): string {
  const list = papers.length
    ? papers.map((paper) => `- ${paper.id}《${paper.title}》`).join('\n')
    : '暂未选择论文库论文。可用 paper_list 浏览本地论文库。'
  return `【论文上下文更新】后续讨论可以查阅这些论文库论文。引用具体内容前先用论文工具核实，并标注 [p.N]。不要把论文结果写成这个项目已经做过的实验。
${list}
请用一句话确认，不用重新开场。`
}

/**
 * 领域简报的字数预算。整份综述是给「读」的，不是给每轮重发的：
 * 这里只带目录级摘要，完整正文留在领域文档里，需要细节时让模型去读文件。
 */
export const fieldBriefBudget = { overview: 240, section: 120, sectionTitle: 40, paperTitle: 90, papers: 10, total: 2600 } as const

export interface FieldBriefInput {
  title: string
  paperCount: number
  documentVersion?: number
  documentState?: 'draft' | 'current' | 'outdated' | 'updating' | 'failed'
  documentPath?: string
  sections?: Array<{ title: string; body: string }>
  reports?: Array<{ overview: string }>
  papers?: Array<{ starred?: boolean; source: { title: string; date?: string } }>
}

export interface FieldBrief {
  title: string
  summary: string
  /** 综述版本；调用方据此判断这份简报是否已经在会话里发过。 */
  version: number
  paperCount: number
  documentPath: string
}

const fieldStateLabels: Record<string, string> = { draft: '尚未综述', current: '已更新', outdated: '待更新', updating: '正在更新', failed: '更新失败' }

/** 按字数裁一段，尽量断在句号或分号上，避免半句话。 */
function clipText(value: string, budget: number): string {
  const plain = value.replace(/\s+/g, ' ').trim()
  if (plain.length <= budget) return plain
  const head = plain.slice(0, budget)
  const stop = Math.max(head.lastIndexOf('。'), head.lastIndexOf('；'), head.lastIndexOf('. '))
  return `${(stop > budget * 0.5 ? head.slice(0, stop + 1) : head).trimEnd()}…`
}

/** 英文标题按词断开，避免截在单词中间；中文按字截。 */
function clipTitle(value: string, budget: number): string {
  const plain = value.replace(/\s+/g, ' ').trim()
  if (plain.length <= budget) return plain
  const head = plain.slice(0, budget)
  const space = head.lastIndexOf(' ')
  return `${(space > budget * 0.6 ? head.slice(0, space) : head).trimEnd()}…`
}

/** 标题去重用：忽略空格、标点、书名号与大小写。 */
function titleKey(value: string): string {
  return value.normalize('NFKC').replace(/[\s《》〈〉「」『』"'“”‘’()（）[\]【】:：,，.。;；!！?？·、—-]/g, '').toLowerCase()
}

/**
 * 领域上下文：综述的分层摘要（状态行 + 梳理概览 + 各节开头），加上已经精读过的论文名。
 * 论文名限量并跳过项目已关联的论文，避免和「论文上下文」重复。
 */
export function fieldBriefText(field: FieldBriefInput, options: { excludeTitles?: string[] } = {}): FieldBrief {
  const version = field.documentVersion ?? 0
  const report = field.reports?.at(-1)
  const lines: string[] = [`综述 v${version}（${fieldStateLabels[field.documentState ?? ''] ?? '版本未知'}）· 收录 ${field.paperCount} 篇`]
  if (report?.overview) lines.push(`最近一次梳理：${clipText(report.overview, fieldBriefBudget.overview)}`)
  const sections = (field.sections ?? []).slice(0, 8)
  if (sections.length) {
    lines.push('各节要点（只保留开头，细节读全文）：')
    for (const section of sections) lines.push(`- ${clipText(section.title, fieldBriefBudget.sectionTitle)}：${clipText(section.body, fieldBriefBudget.section)}`)
  }
  const excluded = new Set((options.excludeTitles ?? []).map(titleKey).filter(Boolean))
  const all = field.papers ?? []
  const seen = new Set<string>()
  const papers = all
    .filter((paper) => {
      const key = titleKey(paper.source.title)
      /* 同一篇论文可能从两次检索各自进来（id 不同），按标题去重只留一条。 */
      if (!key || excluded.has(key) || seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort((a, b) => Number(Boolean(b.starred)) - Number(Boolean(a.starred)) || String(b.source.date ?? '').localeCompare(String(a.source.date ?? '')))
    .slice(0, fieldBriefBudget.papers)
  if (papers.length) {
    const omitted = all.length - papers.length
    lines.push(`已精读 ${field.paperCount} 篇${omitted > 0 ? `（列 ${papers.length} 篇，其余略）` : ''}：`)
    for (const paper of papers) {
      const year = String(paper.source.date ?? '').slice(0, 4)
      lines.push(`- ${clipTitle(paper.source.title, fieldBriefBudget.paperTitle)}${/^\d{4}$/.test(year) ? `（${year}）` : ''}${paper.starred ? ' ★' : ''}`)
    }
  } else if (field.paperCount) {
    lines.push(`已精读 ${field.paperCount} 篇，标题已在别处给出，这里不重复列。`)
  }
  if (field.documentPath) lines.push(`完整综述：${field.documentPath}（需要原文细节时读这个文件，不要凭标题补写内容）。`)
  const summary = lines.join('\n').slice(0, fieldBriefBudget.total)
  return { title: field.title, summary, version, paperCount: field.paperCount, documentPath: field.documentPath ?? '' }
}

/** 同一份领域综述已经在这个会话里发过：只提醒沿用，不再重复正文。 */
export function projectFieldReuseMessage(field: { title: string; version: number; documentPath?: string }): string {
  const where = field.documentPath ? `；需要原文细节时读 ${field.documentPath}` : ''
  return `【领域上下文沿用】继续使用本会话里已经给出的「${field.title}」领域综述（v${field.version}），不重复粘贴正文，结论与已给出的版本一致${where}。请用一句话确认，不用重新开场。`
}

/** Opening prompt for a fresh project conversation session. */
export function projectGreetingPrompt(project: ProjectBrief, papers: Array<{ id: string; title: string }>, field?: { title: string; summary: string } | null): string {
  const library = papers.length
    ? papers.map((paper) => `- ${paper.id}《${paper.title}》`).join('\n')
    : '暂未关联论文。可用 paper_list 浏览本地论文库，用户要求时再查阅。'
  const surveyed = field?.title
    ? `\n领域总结（来自科研发现，只作背景；其中的推演不是已证实事实）：\n领域：${field.title}\n${field.summary}\n`
    : ''
  return `你是 Singularity 研究项目协作助手。这段对话的主要工作是找创新点：一次大约 3 个，然后只沿着用户选中的那一个往下迭代。

项目：${project.title}
研究主题：${project.topic || '（尚未设定）'}
研究方向：${project.direction || '（尚未设定）'}
研究重点（想解决什么问题）：${project.question || '（用户尚未填写，可在对话中询问确认）'}
关联论文（本地论文库，可用 paper_metadata、paper_read_pages、paper_search 查阅原文；引用论文内容时标注 [p.N] 页码）：
${library}
${surveyed}
协作方式：
- 讨论围绕研究主题、研究方向与研究重点，找出还没被做完、而且能被实验证伪的创新点。
- 开场和用户要求新想法时，给出大约 3 个方向不同的想法，不要再堆更多。每个想法写成：名称、假设、机制、对照、证伪标准（出现什么结果就说明这个想法是错的）、最小实验。先做最便宜、能推翻核心假设的实验，不要一上来铺完整系统。
- 用户选定一个想法，或拿来一轮结果时，只迭代这一个：先指出最弱的一环，再改机制、收紧证伪，或明确建议放弃。不要每轮都重新撒三个新想法。连续改了三轮仍没有新证据，就建议换方向，不要用事后解释把失败说圆。
- 若提供了领域总结，用它找缺口，不要把总结里的推演写成已证实事实，也不要据此编造论文。
- 严格区分「论文报告的事实」与「推演/建议」，不编造文献结论、数据或实验。
- 涉及关联论文的具体内容时，先调用论文工具核实，再给 [p.N] 引用；没核实的就说没核实。
- 回答克制、具体、可操作；证据不足时明确指出缺口，不用漂亮话掩盖。

现在请开场：用 3–5 句话说明你对项目主题、方向与重点的理解，然后给出大约 3 个可以马上动手的创新点。每个点用一句话写清证伪标准和最小实验。不要长篇大论。`
}
