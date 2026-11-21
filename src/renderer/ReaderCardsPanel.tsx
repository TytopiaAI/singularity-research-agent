import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { SourceBlock, CardAnnotation } from '../shared/knowledge'
import { CardProvenance } from './KnowledgePanels'
import { Check, CornerDownLeft, FileText, Languages, NotebookPen, Plus, RotateCcw, Trash2 } from 'lucide-react'
import type { PaperArtifact, PaperNoteVersion, PaperRecord, ReaderCard, ReaderNoteInput, ReaderRect, ReviewSectionKey } from '../shared/types'
import { isTranslatableParagraph } from '../shared/academic-text'
import { ReadableAcademicText } from './AcademicText'
import { reviewLabels } from './review-evidence'
import { reviewColors } from './review-colors'
import type { PageSelection } from './ContinuousPdfPage'
import { defaultNoteColor, type NoteColor } from '../shared/note-colors'
import { ReaderQuestionContexts } from './ReaderQuestionContexts'
import type { ReaderQuestionContext } from '../shared/types'

export interface ReaderAnchor { page: number; text: string; rects: ReaderRect[]; segments?: PageSelection['segments'] }

export function ReaderCardsPanel({ paper, cards, artifacts, busy, summaryStarting=false, anchor, pendingTranslation, focusNoteId=null, newNoteSignal=0, newNoteColor=defaultNoteColor, initialNoteOpen=false, onNoteFocused, onTranslate, onCancelTranslation, onEditTranslation, onSummary, onQuestion, onSaveNote, onState,
  onRetry, onJump, onEvidence, onAnswerEvidence, onFinalize, onClearAnchor, sources=[], annotations=[], onSource=()=>{}, onKnowledgeRefresh=()=>{}, extras, hasFigureNotes=false,
  questionContexts=[], onRemoveQuestionContext, onClearQuestionContexts, questionFocusSignal=0, questionDraft, onQuestionDraftChange }: {
  questionContexts?: ReaderQuestionContext[]; onRemoveQuestionContext?: (id: string) => void; onClearQuestionContexts?: () => void; questionFocusSignal?: number
  questionDraft?: string; onQuestionDraftChange?: (text: string) => void
  sources?: SourceBlock[]; annotations?: CardAnnotation[]; onSource?: (source: SourceBlock) => void; onKnowledgeRefresh?: () => void; extras?: ReactNode; hasFigureNotes?: boolean
  paper: PaperRecord; cards: ReaderCard[]; artifacts: PaperArtifact[]; busy: boolean; summaryStarting?: boolean; anchor: ReaderAnchor | null; pendingTranslation: PageSelection | null; focusNoteId?: string | null; newNoteSignal?: number; newNoteColor?: NoteColor; initialNoteOpen?: boolean
  onNoteFocused: () => void
  onTranslate: () => Promise<void>; onCancelTranslation: () => void; onEditTranslation?: (text: string) => void
  onSummary: () => Promise<void>; onQuestion: (question:string) => Promise<void>
  onSaveNote: (input:ReaderNoteInput) => Promise<void>; onState: (card:ReaderCard, hidden:boolean, included:boolean) => Promise<void>
  onRetry: (card:ReaderCard) => Promise<void>; onJump: (page:number) => void
  onEvidence: (page:number,key:ReviewSectionKey,index:number) => void
  onAnswerEvidence?: (artifactId:string,page:number,index:number) => void
  onFinalize: () => Promise<PaperNoteVersion>
  onClearAnchor: () => void
}) {
  const [noteOpen,setNoteOpen]=useState(initialNoteOpen)
  const [editing,setEditing]=useState<ReaderCard|null>(null)
  const [noteText,setNoteText]=useState('')
  const [noteColor,setNoteColor]=useState<NoteColor>(defaultNoteColor)
  const [localQuestion,setLocalQuestion]=useState('')
  const question = questionDraft ?? localQuestion
  const setQuestion = onQuestionDraftChange ?? setLocalQuestion
  const questionInput = useRef<HTMLInputElement>(null)
  const noteFocusTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(noteFocusTimer.current), [])
  const [asking, setAsking] = useState(false)
  const submitting = useRef(false)
  useEffect(() => { if (questionFocusSignal) questionInput.current?.focus() }, [questionFocusSignal])
  const [message,setMessage]=useState('')
  const [error,setError]=useState('')
  const [summaryError,setSummaryError]=useState('')
  const [versions,setVersions]=useState<PaperNoteVersion[]>([])
  const [showVersions,setShowVersions]=useState(false)
  useEffect(()=>{void window.singularity.papers.noteVersions(paper.id).then(setVersions).catch(()=>{})},[paper.id])
  useEffect(()=>{if(!newNoteSignal)return;setEditing(null);setNoteText('');setNoteColor(newNoteColor);setNoteOpen(true);clearTimeout(noteFocusTimer.current);noteFocusTimer.current=setTimeout(()=>document.querySelector<HTMLTextAreaElement>('.reader-note-editor textarea')?.focus(),80)},[newNoteSignal])
  useEffect(()=>{if(!focusNoteId)return;const card=cards.find((item)=>item.id===focusNoteId);if(!card)return;setEditing(card);setNoteText(card.content);setNoteColor(card.noteColor??defaultNoteColor);setNoteOpen(true);onNoteFocused();clearTimeout(noteFocusTimer.current);noteFocusTimer.current=setTimeout(()=>{const element=document.getElementById(`reader-card-${card.id}`);element?.scrollIntoView({behavior:'smooth',block:'nearest'});element?.querySelector('textarea')?.focus()},80)},[focusNoteId,cards,onNoteFocused])
  const visible=cards.filter((card)=>!card.hidden&&(card.kind!=='translation'||isTranslatableParagraph(card.sourceText))).sort((a,b)=>a.kind==='translation'&&b.kind==='translation'?b.createdAt.localeCompare(a.createdAt):a.kind==='translation'?-1:b.kind==='translation'?1:0)
  const hidden=cards.filter((card)=>card.hidden)
  const summaryRunning=artifacts.some((item)=>item.kind==='summary'&&['queued','running'].includes(item.status))
  const latestSummary=artifacts.find((item)=>item.kind==='summary')
  const run=async(task:()=>Promise<void>):Promise<void>=>{setError('');try{await task()}catch(e){setError(String(e))}}
  const triggerSummary=async():Promise<void>=>{setSummaryError('');try{await onSummary()}catch(e){setSummaryError(String(e))}}
  const saveNote=async():Promise<void>=>{
    const current=editing ? cards.find((card)=>card.id===editing.id)??editing : null
    await run(async()=>{await onSaveNote({id:current?.id,paperId:paper.id,content:noteText,pageNumber:current ? current.pageNumber : anchor?.page??null,
      sourceText:current ? current.sourceText : anchor?.text??'',rects:current ? current.rects : anchor?.rects??[],segments:current ? current.segments : anchor?.segments,noteColor});setNoteText('');setNoteOpen(false);setEditing(null);setMessage('笔记卡片已保存到本地')})
  }
  const noteEditor=<><textarea aria-label="笔记卡片内容" value={noteText} onChange={(event)=>setNoteText(event.target.value)} placeholder="记录你的判断、疑问和后续实验…" rows={5}/><div className="reader-card-actions"><button onClick={()=>{setNoteOpen(false);setEditing(null)}}>取消</button><button className="primary" disabled={!noteText.trim()} onClick={()=>void saveNote()}>保存卡片</button></div></>
  const ask=async():Promise<void>=>{
    if(!question.trim() || busy || submitting.current || paper.indexStatus !== 'ready')return
    submitting.current=true;setAsking(true)
    try { await run(async()=>{await onQuestion(question.trim());setQuestion('');setMessage('问题已提交，回答会出现在卡片列表中；引用保留，可继续追问')}) }
    finally { submitting.current=false;setAsking(false) }
  }
  const finalize=async():Promise<void>=>{await run(async()=>{const version=await onFinalize();setVersions((items)=>[version,...items]);setShowVersions(true);setMessage(`已生成论文笔记 v${version.version}`)})}
  return <aside className="translation-panel reader-card-panel">
    <div className="reader-panel-top reader-card-header"><span className="section-label">PAPER WORKSPACE</span><div><button title="添加笔记卡片" onClick={()=>{setEditing(null);setNoteText('');setNoteColor(defaultNoteColor);setNoteOpen(true)}}><Plus size={14}/>笔记</button><button title="将已选卡片生成最终论文笔记" className="soft" disabled={!hasFigureNotes&&!visible.some((card)=>card.included&&card.content.trim())} onClick={()=>void finalize()}><FileText size={14}/>生成笔记</button><button className="primary" disabled={busy||summaryStarting||summaryRunning||paper.indexStatus!=='ready'} onClick={()=>void triggerSummary()}>{summaryStarting?'启动中…':summaryRunning?'总结中…':'总结'}</button></div></div>
    {(summaryStarting||summaryRunning||latestSummary?.status==='failed'||summaryError)&&<div className="reader-summary-status" role={latestSummary?.status==='failed'||summaryError?'alert':'status'}>
      <span>{summaryError|| (summaryStarting?'正在启动论文总结…':summaryRunning?'正在生成论文总结，完成后卡片会显示在这里。':latestSummary?.error||'论文总结失败。')}</span>
      {!summaryStarting&&!summaryRunning&&(latestSummary?.status==='failed'||summaryError)&&<button disabled={busy} onClick={()=>void triggerSummary()}>重试总结</button>}
    </div>}
    <div className="reader-card-scroll">
      {pendingTranslation&&<div className="reader-note-card reader-work-card pending-translation-card" role="region" aria-label="待翻译段落"><div className="reader-note-heading"><Languages size={15}/><h3>待翻译段落</h3><span className="pending-page">p.{pendingTranslation.page}{pendingTranslation.segments&&pendingTranslation.segments.length>1?`–${pendingTranslation.segments.at(-1)!.page}`:''}</span></div><textarea className="pending-translation-source" aria-label="待翻译原文" value={pendingTranslation.text} maxLength={20000} readOnly={!onEditTranslation} onChange={(event)=>onEditTranslation?.(event.target.value)}/><p>已选择 {pendingTranslation.text.length} 个字符 · {pendingTranslation.text.trim().split(/\s+/).length} 个词</p><div className="reader-card-actions"><button onClick={onCancelTranslation}>取消</button><button className="primary" disabled={busy||!pendingTranslation.text.trim()} onClick={()=>void run(onTranslate)}>翻译</button></div></div>}
      {extras}
      {anchor&&<div className="reader-anchor-tip"><span>已关联 p.{anchor.page}</span><button onClick={onClearAnchor}>取消区域关联</button></div>}
      {noteOpen&&!editing&&<div className="reader-note-card reader-note-editor" style={{'--note-color':noteColor} as CSSProperties}><div className="reader-note-heading"><NotebookPen size={16}/><h3>新建笔记</h3></div>{noteEditor}</div>}
      {!visible.length&&!pendingTranslation&&<p className="reader-card-empty">用鼠标划选论文文字，译文会自动出现在这里。跨页段落可开启拼接模式。</p>}
      <div className="reader-card-list">{visible.map((card)=>{
        const artifact=artifacts.find((item)=>item.id===card.artifactId)
        const evidence=card.kind==='summary'?artifact?.review?.sections.find((section)=>section.key===card.sectionKey)?.evidence??[]:[]
        const answerEvidence=card.kind==='answer'?artifact?.answer?.evidence??[]:[]
        const cardPage=card.kind==='answer'?answerEvidence[0]?.page:card.pageNumber
        const title=card.kind==='summary'&&card.sectionKey?reviewLabels[card.sectionKey]:{translation:'段落翻译',note:'我的笔记',answer:'论文问答',summary:'论文总结'}[card.kind]
        const editingNote=card.kind==='note'&&noteOpen&&editing?.id===card.id
        // The locator marker is our own prompt prefix; a model that echoes it back
        // must not turn into visible card text.
        const body=card.content.replace(/^\s*\[p\.\d+\]\s*/i,'')
        return <article id={`reader-card-${card.id}`} className={`reader-note-card reader-work-card ${card.kind==='summary'?'review-card':''}`} data-kind={card.kind} data-review-key={card.sectionKey??undefined} style={card.kind==='note'?{'--note-color':noteOpen&&editing?.id===card.id?noteColor:card.noteColor??defaultNoteColor} as CSSProperties:card.kind==='summary'&&card.sectionKey?{'--review-tint':reviewColors[card.sectionKey].tint,'--review-color':reviewColors[card.sectionKey].edge} as CSSProperties:card.kind==='answer'&&artifact?.answer?{'--answer-color':artifact.answer.color} as CSSProperties:undefined} key={card.id}>
          <div className="reader-note-heading"><span className="reader-kind-icon">{card.kind==='translation'?<Languages size={15}/>:card.kind==='note'?<NotebookPen size={15}/>:<FileText size={15}/>}</span><h3>{title}</h3><span className="reader-card-pages">{evidence.length>0?evidence.map((item,index)=><button key={`${item.page}-${index}`} className="text-action" aria-label={`定位 p.${item.page} 原文`} onClick={()=>onEvidence(item.page,card.sectionKey!,index)}>p.{item.page}</button>):answerEvidence.length>0?answerEvidence.map((item,index)=><button key={`${item.page}-${index}`} className="text-action" aria-label={`定位 p.${item.page} 引文`} onClick={()=>onAnswerEvidence?.(artifact!.id,item.page,index)}>p.{item.page}</button>):cardPage?<button className="text-action" onClick={()=>onJump(cardPage)}>p.{cardPage}</button>:null}</span>{!editingNote&&<button className={`reader-card-icon ${card.included?'included':''}`} aria-label={card.included?'已加入最终笔记':'加入最终笔记'} title={card.included?'已加入最终笔记':'加入最终笔记'} onClick={()=>void run(()=>onState(card,false,!card.included))}>{card.included?<Check size={14}/>:<Plus size={14}/>}</button>}{card.kind==='note'&&!editingNote&&<button className="reader-card-icon" aria-label="编辑笔记" onClick={()=>{setEditing(card);setNoteText(card.content);setNoteColor(card.noteColor??defaultNoteColor);setNoteOpen(true)}}><NotebookPen size={14}/></button>}<button aria-label={`移除${title}卡片`} title="从阅读工作台移除，可恢复" className="reader-remove-card" onClick={()=>void run(()=>onState(card,true,card.included))}><Trash2 size={14}/></button></div>
          <CardProvenance card={card} annotation={annotations.find((item)=>item.cardId===card.id)} sources={sources} onSource={onSource} onChange={onKnowledgeRefresh}/>
          {card.sourceText&&card.kind==='answer'&&<blockquote className="reader-card-source">问题：<ReadableAcademicText text={card.sourceText}/></blockquote>}
          {card.kind==='answer'&&!!artifact?.questionContexts?.length&&<details className="reader-answer-context"><summary>本次提问引用 · {artifact.questionContexts.length} 段</summary><ReaderQuestionContexts contexts={artifact.questionContexts} onJump={onJump}/></details>}
          {artifact&&['queued','running'].includes(artifact.status)&&<p role="status" className="muted">{card.kind==='translation'?'正在翻译段落…':'正在查阅论文并回答…'}</p>}
          {artifact?.status==='failed'&&<div role="alert" className="reader-card-failure"><span>{artifact.error||'生成失败'}</span><button onClick={()=>void run(()=>onRetry(card))}>重试</button></div>}
          {editingNote?<div className="reader-note-editor inline-note-editor">{noteEditor}</div>:body?<p className="reader-card-content"><ReadableAcademicText text={body}/></p>:card.kind==='note'?<p className="reader-note-placeholder">点击编辑，记录你的想法…</p>:null}
          {card.kind==='summary'&&evidence.length===0&&<p className="review-grounding">暂无原文定位</p>}
          {answerEvidence.length>0&&<div className="answer-evidence-list">{answerEvidence.map((item,index)=><button key={`${item.page}-${index}`} onClick={()=>onAnswerEvidence?.(artifact!.id,item.page,index)}><q>{item.quote}</q></button>)}</div>}
        </article>
      })}</div>

      {hidden.length>0&&<details className="reading-history reader-restorable"><summary>已移除的卡片 · {hidden.length}</summary>{hidden.map((card)=><button key={card.id} onClick={()=>void run(()=>onState(card,false,card.included))}><RotateCcw size={13}/>{card.kind==='summary'&&card.sectionKey?reviewLabels[card.sectionKey]:card.kind==='note'?'我的笔记':card.kind==='answer'?'论文问答':'段落翻译'} · 恢复</button>)}</details>}
      {versions.length>0&&<details className="reading-history" open={showVersions} onToggle={(event)=>setShowVersions(event.currentTarget.open)}><summary>最终笔记版本 · {versions.length}</summary>{versions.map((version)=><div className="reader-note-card reader-note-version" key={version.id}><strong>v{version.version} · {new Date(version.createdAt).toLocaleString('zh-CN')}</strong>{version.filePath&&<button onClick={()=>void window.singularity.nativeFiles.show(version.filePath!).catch((e)=>setError(String(e)))}>在资源管理器中查看</button>}<pre>{version.markdown}</pre></div>)}</details>}
      {message&&<p role="status" className="reader-message">{message}</p>}{error&&<p role="alert" className="inline-error">{error}</p>}
    </div>
    <form className="reader-question-dock" onSubmit={(event)=>{event.preventDefault();void ask()}}><label htmlFor="paper-question">向这篇论文提问</label>
      <ReaderQuestionContexts contexts={questionContexts} onRemove={onRemoveQuestionContext} onClear={onClearQuestionContexts} onJump={onJump}/>
      {!questionContexts.length&&<p className="reader-question-hint">划选词语或段落，点击“添加到提问上下文”，可连续添加多段。</p>}
      <div className="reader-question-input"><input ref={questionInput} id="paper-question" maxLength={4000} value={question} onChange={(event)=>setQuestion(event.target.value)} placeholder={questionContexts.length?'例如：这几个选段有什么联系？':'例如：这项研究的主要局限是什么？'} disabled={asking||paper.indexStatus!=='ready'}/><button aria-label="发送论文问题" className="primary" type="submit" disabled={!question.trim()||busy||asking||paper.indexStatus!=='ready'}><CornerDownLeft size={16}/></button></div>
    </form>
  </aside>
}
