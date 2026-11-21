import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronDown } from 'lucide-react'

export function VoiceSelect<T extends string>({ label, value, options, disabled, onChange, icon }: {
  label: string
  value: T
  options: { value: T; label: string }[]
  disabled?: boolean
  onChange: (value: T) => void
  icon?: ReactNode
}): ReactNode {
  const [open, setOpen] = useState(false)
  const [focused, setFocused] = useState(0)
  const holder = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const menuId = useId()
  const selected = options.findIndex((option) => option.value === value)
  const show = (last = false): void => {
    setFocused(selected >= 0 ? selected : last ? options.length - 1 : 0)
    setOpen(true)
  }
  const close = (): void => { setOpen(false); trigger.current?.focus() }

  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent): void => {
      if (!holder.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open])
  useEffect(() => {
    if (open) holder.current?.querySelectorAll<HTMLButtonElement>('[role="option"]')[focused]?.focus()
  }, [open, focused])
  useEffect(() => { if (disabled) setOpen(false) }, [disabled])

  return <div className="voice-select" ref={holder} onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false)
  }}>
    <button ref={trigger} type="button" className={`voice-select-trigger${icon?' voice-icon-select':''}`} aria-label={label} title={icon?`${label} · ${options[selected]?.label??'请选择'}`:undefined} data-tooltip={icon?`${label} · ${options[selected]?.label??'请选择'}`:undefined}
      aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? menuId : undefined}
      disabled={disabled} onClick={() => open ? close() : show()} onKeyDown={(event) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault(); show(event.key === 'ArrowUp')
        }
      }}>
      {icon || <><span title={options[selected]?.label}>{options[selected]?.label ?? '请选择…'}</span><ChevronDown size={16} aria-hidden="true" /></>}
    </button>
    {open && <div id={menuId} className="voice-select-menu" role="listbox" aria-label={label} onKeyDown={(event) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() }
      else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        setFocused((index) => (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length)
      } else if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault(); setFocused(event.key === 'Home' ? 0 : options.length - 1)
      }
    }}>
      {options.map((option, index) => <button key={option.value} type="button" role="option"
        aria-selected={value === option.value} tabIndex={focused === index ? 0 : -1}
        onFocus={() => setFocused(index)} onClick={() => { onChange(option.value); close() }}>
        <span title={option.label}>{option.label}</span>
        {value === option.value && <Check size={15} aria-hidden="true" />}
      </button>)}
    </div>}
  </div>
}
