import { useCallback, useEffect, useRef, useState } from 'react'
import { CircleStop, LoaderCircle, Send } from 'lucide-react'
import type { ResearchProject } from '../shared/knowledge'
import type { FieldSummary } from '../shared/field-knowledge'
import { projectPapersMessage, type ProjectChatState } from '../shared/project-chat'

/** Conversation surface for one research project, backed by a harness agent session. */
export function ProjectChat({ project, linkedPapers, library = linkedPapers, onTogglePaper }: { project: ResearchProject; linkedPapers: Array<{ id: string; title: string }>; library?: Array<{ id: string; title: string }>; onTogglePaper?: (paperId: string, included: boolean) => Promise<void> }) {
  const [state, setState] = useState<ProjectChatState | null>(null)
  const [starting, setStarting] = useState(true)
  const [sending, setSending] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState('')
  const [fields, setFields] = useState<FieldSummary[]>([])
  const [fieldId, setFieldId] = useState(project.fieldId ?? '')
  const [papersOpen, setPapersOpen] = useState(false)
  const [mentionOpen, setMentionOpen] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const mentionFromType = useRef(false)
  const [paperBusy, setPaperBusy] = useState(false)
  const paperTimer = useRef<number | null>(null)
  const [selectedIds, setSelectedIds] = useState(project.paperIds)
  const selectedPapers = useRef(project.paperIds)
  const logRef = useRef<HTMLDivElement | null>(null)
  const pinnedToBottom = useRef(true)

  const apply = useCallback((next: ProjectChatState) => { setState(next); setError('') }, [])

  useEffect(() => {
    let active = true
    setState(null); setStarting(true); setError(''); setDraft('')
    void window.singularity.knowledge.projectChat(project.id)
      .then((next) => { if (active) apply(next) })
      .catch((cause: unknown) => { if (active) setError(String(cause)) })
      .finally(() => { if (active) setStarting(false) })
    const timer = setInterval(() => {
      if (!active) return
      void window.singularity.knowledge.projectChat(project.id)
        .then((next) => { if (active) apply(next) })
        .catch((cause: unknown) => { if (active) setError(String(cause)) })
    }, 2500)
    return () => { active = false; clearInterval(timer) }
  }, [project.id, apply])

  useEffect(() => { setFieldId(project.fieldId ?? ''); setPapersOpen(false); setMentionOpen(false); setMentionQuery('') }, [project.id, project.fieldId])
  useEffect(() => { selectedPapers.current = project.paperIds; setSelectedIds(project.paperIds) }, [project.id, project.paperIds])
  useEffect(() => () => { if (paperTimer.current) window.clearTimeout(paperTimer.current) }, [])
  useEffect(() => {
    if (!window.singularity.research?.fields) return
    let active = true
    void window.singularity.research.fields().then((items) => { if (active) setFields(items) }).catch(() => {})
    return () => { active = false }
  }, [project.id])

  useEffect(() => {
    const log = logRef.current
    if (!log || !pinnedToBottom.current) return
    log.scrollTop = log.scrollHeight
  }, [state])

  const send = async () => {
    const text = draft.trim()
    if (!text || sending || starting) return
    setSending(true); setError('')
    try {
      apply(await window.singularity.knowledge.projectChatSend(project.id, text))
      setDraft('')
      pinnedToBottom.current = true
    } catch (cause) { setError(String(cause)) }
    finally { setSending(false) }
  }

  const sync = async () => {
    if (syncing || running) return
    setSyncing(true); setError('')
    try { apply(await window.singularity.knowledge.projectChatSync(project.id)); pinnedToBottom.current = true }
    catch (cause) { setError(String(cause)) }
    finally { setSyncing(false) }
  }

  const cancel = async () => {
    if (cancelling) return
    setCancelling(true)
    try { await window.singularity.knowledge.projectChatCancel(project.id) }
    catch (cause) { setError(String(cause)) }
    finally { setCancelling(false) }
  }

  const togglePaper = async (paperId: string, included: boolean) => {
    if (!onTogglePaper || paperBusy) return false
    const next = included ? [...new Set([...selectedPapers.current, paperId])] : selectedPapers.current.filter((id) => id !== paperId)
    selectedPapers.current = next
    setSelectedIds(next)
    setPaperBusy(true); setError('')
    try {
      await onTogglePaper(paperId, included)
      if (!state?.sessionId) return true
      if (paperTimer.current) window.clearTimeout(paperTimer.current)
      const chosen = library.filter((paper) => next.includes(paper.id))
      paperTimer.current = window.setTimeout(() => {
        void window.singularity.knowledge.projectChatSend(project.id, projectPapersMessage(chosen)).then(apply).catch((cause: unknown) => setError(String(cause)))
      }, 400)
      return true
    } catch (cause) { setError(String(cause)); return false }
    finally { setPaperBusy(false) }
  }

  const insertMention = (label: string) => {
    const token = `@${label}`
    setDraft((current) => {
      if (current.includes(token)) return current
      const replaced = current.replace(/(^|[\s\n])@[^\s@]*$/, (_match, lead: string) => `${lead}${token} `)
      if (replaced !== current) return replaced
      const gap = current && !/[\s\n]$/.test(current) ? ' ' : ''
      return `${current}${gap}${token} `
    })
  }

  const mentionPaper = async (paperId: string, title: string, included: boolean) => {
    if (await togglePaper(paperId, included) && included) insertMention(`《${title}》`)
  }

  const mentionField = async (next: string) => {
    const previous = fieldId
    setFieldId(next)
    const field = fields.find((item) => item.id === next)
    if (field) insertMention(field.title)
    try { await window.singularity.knowledge.setProjectField(project.id, next) }
    catch (cause) { setFieldId(previous); setError(String(cause)) }
  }

  const syncMention = (value: string, caret: number) => {
    const match = /(^|[\s\n])@([^\s@]*)$/.exec(value.slice(0, caret))
    if (match) { mentionFromType.current = true; setMentionOpen(true); setMentionQuery(match[2]); return }
    if (mentionFromType.current) { mentionFromType.current = false; setMentionOpen(false); setMentionQuery('') }
  }

  const query = mentionQuery.trim().toLowerCase()
  const mentionPapers = library.filter((paper) => !query || paper.title.toLowerCase().includes(query))
  const mentionFields = fields.filter((field) => !query || field.title.toLowerCase().includes(query))

  const messages = state?.messages ?? []
  const running = Boolean(state?.running)
  return <section className="project-chat" aria-label="项目对话">
    <div className="project-chat-log" ref={logRef} onScroll={(event) => {
      const log = event.currentTarget
      pinnedToBottom.current = log.scrollHeight - log.scrollTop - log.clientHeight < 60
    }}>
      {starting && !state && <p className="project-chat-empty">正在打开这段对话…</p>}
      {state && !messages.length && !running && <p className="project-chat-empty">先找一个还没被做完的点。</p>}
      {messages.map((message) => {
        if (message.role === 'tool') {
          return <div className={`project-chat-tool ${message.toolError ? 'error' : ''}`} key={message.id}>
            <span>{message.toolName ?? '工具调用'}</span>
            {message.text ? <small>{message.toolError ? '失败：' : ''}{message.text.slice(0, 180)}{message.text.length > 180 ? '…' : ''}</small> : <small>正在调用…</small>}
          </div>
        }
        return message.role === 'user'
          ? <div className="project-chat-row user" key={message.id}><p>{message.text}</p></div>
          : <div className="project-chat-row assistant" key={message.id}><p>{message.text}</p></div>
      })}
      {running && !messages.some((message) => message.role === 'assistant') && <div className="project-chat-row assistant pending" aria-live="polite"><p>正在思考…</p></div>}
    </div>
    {error && <p role="alert" className="project-chat-error">{error}</p>}
    <form className="project-chat-input" onSubmit={(event) => { event.preventDefault(); void send() }}>
      <div className="project-chat-composer">
      <textarea
        aria-label="项目对话输入"
        placeholder="想一个创新点：缺口在哪，怎样能证伪"
        rows={2}
        maxLength={20000}
        value={draft}
        onChange={(event) => { setDraft(event.target.value); syncMention(event.target.value, event.target.selectionStart ?? event.target.value.length) }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault()
            void send()
          }
        }}
      />
      <div className="project-chat-composer-bar">
        <div className="project-chat-mention"><button type="button" className="project-chat-at" aria-label="提及论文或领域" aria-expanded={mentionOpen} disabled={starting} onClick={() => { mentionFromType.current = false; setMentionQuery(''); setPapersOpen(false); setMentionOpen((open) => !open) }}>@</button>{mentionOpen && <div role="group" aria-label="提及论文或领域"><input aria-label="搜索可提及的论文或领域" placeholder="搜索论文或领域" value={mentionQuery} onChange={(event) => setMentionQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') event.preventDefault() }} /><p>论文</p>{library.length ? mentionPapers.map((paper) => <label key={paper.id}><input type="checkbox" checked={selectedIds.includes(paper.id)} disabled={paperBusy || !onTogglePaper} onChange={(event) => void mentionPaper(paper.id, paper.title, event.target.checked)} /><span>{paper.title}</span></label>) : <p>论文库还是空的。</p>}{!!library.length && !mentionPapers.length && <p>没有匹配的论文。</p>}<p>领域</p>{fields.length ? mentionFields.map((field) => <button type="button" key={field.id} aria-pressed={fieldId === field.id} onClick={() => void mentionField(field.id)}>{field.title}</button>) : <p>还没有领域。</p>}{!!fields.length && !mentionFields.length && <p>没有匹配的领域。</p>}</div>}</div>
        {selectedIds.length > 0 && <span className="project-chat-context">{selectedIds.length} 篇关联论文</span>}
        <div className="project-chat-papers"><button type="button" aria-expanded={papersOpen} aria-label="论文上下文" disabled={starting} onClick={() => { setMentionOpen(false); setPapersOpen((open) => !open) }}>论文{selectedIds.length ? ` ${selectedIds.length}` : ''}</button>{papersOpen && <div role="group" aria-label="论文库上下文">{library.length ? library.map((paper) => <label key={paper.id}><input type="checkbox" checked={selectedIds.includes(paper.id)} disabled={paperBusy || !onTogglePaper} onChange={(event) => void togglePaper(paper.id, event.target.checked)} /><span>{paper.title}</span></label>) : <p>论文库还是空的。</p>}</div>}</div>
        <label className="project-chat-field">领域<select aria-label="领域上下文" value={fieldId} disabled={syncing || starting} onChange={(event) => {
          const next = event.target.value
          setFieldId(next)
          void window.singularity.knowledge.setProjectField(project.id, next).catch((cause: unknown) => { setFieldId(project.fieldId ?? ''); setError(String(cause)) })
        }}><option value="">未选择</option>{fields.map((field) => <option key={field.id} value={field.id}>{field.title}{field.documentState === 'draft' ? ' · 尚未综述' : ''}</option>)}</select></label>
        <span className="project-chat-status" role="status">{starting && !state ? '正在开启对话…' : running ? '正在思考' : 'DeepSeek'}</span>
        <button className="project-chat-sync" type="button" disabled={syncing || running || starting} title="把最新的研究主题、研究方向与研究重点告诉助手" onClick={() => void sync()}>{syncing ? '正在同步…' : '同步设定'}</button>
        {running && <button className="project-chat-stop" type="button" disabled={cancelling} onClick={() => void cancel()}><CircleStop size={13} />{cancelling ? '正在停止…' : '停止'}</button>}
        <button className="primary" type="submit" disabled={!draft.trim() || sending || starting} aria-label="发送消息">{sending ? <LoaderCircle className="is-spinning" size={15} /> : <Send size={15} />}</button>
      </div>
      </div>
    </form>
  </section>
}
