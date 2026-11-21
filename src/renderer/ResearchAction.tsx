import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import './research-minimal.css'

/** Compact action with a readable label for pointer, keyboard and assistive tools. */
export function ResearchAction({label,children,className='',disabled,...props}:ButtonHTMLAttributes<HTMLButtonElement>&{label:string;children:ReactNode}) {
  const id=useId(),[anchor,setAnchor]=useState<{x:number;y:number;host:HTMLElement}|null>(null)
  useEffect(()=>{
    if(!anchor)return
    const hide=()=>setAnchor(null)
    window.addEventListener('scroll',hide,true);window.addEventListener('resize',hide)
    return()=>{window.removeEventListener('scroll',hide,true);window.removeEventListener('resize',hide)}
  },[anchor])
  const show=(element:HTMLElement)=>{const r=element.getBoundingClientRect();setAnchor({x:r.left+r.width/2,y:r.bottom,host:element.closest('dialog')??document.body})}
  return <span className="research-action-wrap" onMouseEnter={event=>show(event.currentTarget)} onMouseLeave={()=>setAnchor(null)} onFocus={event=>show(event.currentTarget)} onBlur={()=>setAnchor(null)} onKeyDown={event=>{if(event.key==='Escape')setAnchor(null)}}>
    <button {...props} type={props.type??'button'} disabled={disabled} aria-label={label} aria-describedby={anchor?id:undefined} className={`research-icon-action ${className}`}>{children}</button>
    {anchor&&createPortal(<ActionTooltip id={id} x={anchor.x} y={anchor.y} label={label}/>,anchor.host)}
  </span>
}

function ActionTooltip({id,x,y,label}:{id:string;x:number;y:number;label:string}) {
  const element=useRef<HTMLSpanElement>(null)
  useEffect(()=>{element.current?.showPopover()},[])
  return <span ref={element} popover="manual" id={id} role="tooltip" className="research-action-tooltip" style={{left:Math.min(Math.max(x,140),window.innerWidth-140),top:Math.min(y+9,window.innerHeight-65)}}>{label}</span>
}
