import { useCallback, useEffect, useRef, useState } from 'react'
import { launchVariant, type StartupVariant } from './StartupSplash'

export function useStartupSequence(phase: string, variant: StartupVariant = launchVariant) {
  const began = useRef(performance.now())
  const [complete, setComplete] = useState(false), [leaving, setLeaving] = useState(false)
  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
  useEffect(() => {
    // A startup error must immediately expose the error view and retry controls.
    if (phase === 'error' || phase === 'ready' && variant !== 'armor') { setComplete(true); return }
    // The animation gates the desktop shell, not the backend. Offline pages
    // remain usable while the research engine starts in the background.
    const timer = window.setTimeout(() => setLeaving(true), reduced() ? 0 : Math.max(0, 5200 - (performance.now() - began.current)))
    return () => clearTimeout(timer)
  }, [phase, variant])
  useEffect(() => {
    if (!leaving) return
    const timer = window.setTimeout(() => setComplete(true), reduced() ? 0 : 480)
    return () => clearTimeout(timer)
  }, [leaving])
  const skip = useCallback(() => setLeaving(true), [])
  return { complete, leaving, skip }
}
