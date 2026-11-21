import { X } from 'lucide-react'
import type { ReaderQuestionContext } from '../shared/types'

export function ReaderQuestionContexts({ contexts, onRemove, onClear, onJump }: {
  contexts: ReaderQuestionContext[]; onRemove?: (id: string) => void; onClear?: () => void; onJump: (page: number) => void
}) {
  if (!contexts.length) return null
  return <section className="reader-question-contexts" aria-label={onRemove ? '提问上下文' : '本次提问引用'}>
    {onRemove && <header><strong>提问上下文 · {contexts.length} 段</strong><button type="button" onClick={onClear}>清空引用</button></header>}
    <div className="reader-context-list">{contexts.map((context, index) => <article className="reader-context-item" key={context.id}>
      <header><span>引用 {index + 1}</span><div>{context.segments.map(part => <button className="reader-context-page" type="button" key={part.page} title={`定位引用 ${index + 1} 的第 ${part.page} 页`} onClick={() => onJump(part.page)}>p.{part.page}</button>)}</div>{onRemove && <button type="button" aria-label={`移除引用 ${index + 1}`} onClick={() => onRemove(context.id)}><X size={13}/></button>}</header>
      {context.text.length > 110 ? <details><summary>{context.text.slice(0, 110)}…</summary><p>{context.text}</p></details> : <p>{context.text}</p>}
    </article>)}</div>
  </section>
}
