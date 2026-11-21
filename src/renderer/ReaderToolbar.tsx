import { Children, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown } from 'lucide-react'

/** Keep complete control groups together when the PDF pane shrinks. */
export function ReaderToolbar({ children }: { children: ReactNode }) {
  const groups = Children.toArray(children)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const popup = useRef<HTMLDivElement>(null)
  const widths = useRef<number[]>([])
  const [count, setCount] = useState(groups.length)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ top: 0, right: 0 })

  useLayoutEffect(() => {
    const element = root.current!
    const measure = () => {
      for (const group of element.querySelectorAll<HTMLElement>('[data-toolbar-index]')) {
        widths.current[Number(group.dataset.toolbarIndex)] = group.getBoundingClientRect().width
      }
      const style = getComputedStyle(element)
      const available = element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
      const gap = parseFloat(style.columnGap) || 10
      let visible = groups.length
      const required = (n: number) => widths.current.slice(0, n).reduce((sum, width) => sum + width, 0) + Math.max(0, n - 1) * gap + (n < groups.length ? 76 + (n ? gap : 0) : 0)
      while (visible > 0 && required(visible) > available) visible--
      setCount(visible)
      setOpen(false)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [groups.length])

  useLayoutEffect(() => {
    if (!open) return
    const rect = trigger.current!.getBoundingClientRect()
    setPosition({ top: rect.bottom + 8, right: Math.max(8, window.innerWidth - rect.right) })
    const outside = (event: PointerEvent) => {
      if (!popup.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); trigger.current?.focus() }
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape) }
  }, [open])

  return <div ref={root} className="pdf-toolbar reader-pdf-toolbar" aria-label="PDF 阅读工具栏">
    {groups.slice(0, count).map((group, index) => <div className="reader-toolbar-slot" data-toolbar-index={index} key={index}>{group}</div>)}
    {count < groups.length && <button ref={trigger} className="reader-toolbar-more" aria-label="更多阅读工具" aria-expanded={open} aria-controls="reader-toolbar-overflow" onClick={() => setOpen(!open)}>更多<ChevronDown size={14}/></button>}
    {open && createPortal(<div ref={popup} id="reader-toolbar-overflow" className="reader-toolbar-overflow" role="dialog" aria-label="更多阅读工具" style={position}>
      {groups.slice(count).map((group, index) => <div className="reader-toolbar-overflow-item" key={count + index}>{group}</div>)}
    </div>, document.body)}
  </div>
}
