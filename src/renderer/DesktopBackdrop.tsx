import { useEffect, useState, type ReactNode } from 'react'
import type { DesktopBackdrop as Backdrop } from '../shared/types'

const fitSize: Record<Backdrop['fit'], string> = { cover: 'cover', contain: 'contain', stretch: '100% 100%' }

/** Frosted desktop wallpaper behind the whole window, aligned to where the window sits on screen. */
export function DesktopBackdrop(): ReactNode {
  const [backdrop, setBackdrop] = useState<Backdrop | null>(null)
  useEffect(() => {
    const controls = window.singularity.windowControls
    let mounted = true
    void controls.backdrop().then((value) => { if (mounted) setBackdrop(value) }).catch(() => {})
    const unsubscribe = controls.onBackdrop(setBackdrop)
    const unsubscribeGeometry = controls.onBackdropGeometry((geometry) => setBackdrop((current) => current && { ...current, ...geometry }))
    return () => { mounted = false; unsubscribe(); unsubscribeGeometry() }
  }, [])
  if (!backdrop?.image) return null
  return <div className="desktop-backdrop" aria-hidden="true">
    <div className="desktop-backdrop-image" style={{ transform: `translate3d(${backdrop.x}px, ${backdrop.y}px, 0)`, width: backdrop.width, height: backdrop.height, backgroundImage: `url("${backdrop.image}")`, backgroundSize: fitSize[backdrop.fit] }}/>
  </div>
}
