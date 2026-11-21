import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Minus, Square, X } from 'lucide-react'
import appIconUrl from '../../build/icon-ui.png'
import { t } from './i18n'
import { ArmorStartup } from './ArmorStartup'

export type StartupVariant = 'planets' | 'willow' | 'sail' | 'armor'
const startupOrder = ['planets', 'willow', 'sail', 'armor'] as const
export const startupHistoryKey = 'singularity.startup.last-variant'
export function chooseStartupVariant(storage?: Pick<Storage, 'getItem' | 'setItem'>, sample = Math.random()): StartupVariant {
  try {
    const history = storage ?? window.localStorage
    const last = history.getItem(startupHistoryKey)
    const index = startupOrder.findIndex(variant => variant === last)
    const next = startupOrder[(index + 1) % startupOrder.length]
    history.setItem(startupHistoryKey, next)
    return next
  } catch {
    // A restricted/full storage must not prevent startup. Fall back to equal odds.
    return startupOrder[Math.min(3, Math.max(0, Math.floor(sample * 4)))]
  }
}
// Pick once for this renderer launch, including React StrictMode remounts.
export const launchVariant = chooseStartupVariant()

function PixelSun(): ReactNode {
  return <svg className="startup-sun" viewBox="0 0 160 160" aria-hidden="true" focusable="false" shapeRendering="crispEdges">
    <g fill="#D65F35">
      <path d="M66 10h28v8h18v9h13v12h11v16h9v24h7v25h-9v17h-12v13h-16v8H45v-9H29v-13H18v-16H9V58h9V40h12V27h16v-9h20z" />
      <path d="M77 0h8v16h-8zM151 76h9v9h-17v-9zM77 145h8v15h-8zM0 76h17v9H0zM16 20h10v10H16zM136 20h10v10h-10zM16 132h10v10H16zM136 132h10v10h-10z" />
    </g>
    <path fill="#FF7E5F" d="M57 25h47v8h16v12h12v17h8v36h-8v18h-13v13h-17v8H57v-8H40v-13H27V98h-8V62h8V45h13V33h17z" />
    <path fill="#FFA74F" d="M61 35h39v7h14v11h11v15h7v26h-7v15h-11v11h-14v7H61v-7H47v-11H36V94h-7V68h7V53h11V42h14z" />
    <path fill="#F0D7A3" d="M66 47h29v7h13v10h9v13h5v17h-8v13h-12v10H63v-7H51v-12h-8V75h8V61h15z" />
    <path fill="#FFF1B8" d="M70 59h24v7h10v10h7v20h-9v10H70v-8H59V80h8V68h3z" />
    <path fill="none" stroke="#FFF9D7" strokeWidth="6" strokeLinecap="square" strokeLinejoin="miter" d="M61 87v-13h10V63h15v9h11v15H86v11H71" />
    <path fill="#E97436" d="M37 56h8v10h-8zM111 42h9v8h-9zM119 103h9v9h-9zM48 117h9v9h-9z" />
  </svg>
}

function PixelEarth(): ReactNode {
  return <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false" shapeRendering="crispEdges">
    <defs>
      <clipPath id="startup-earth-shape"><path d="M24 3h16v3h8v4h6v6h4v8h3v16h-3v8h-4v6h-6v4h-8v3H24v-3h-8v-4h-6v-6H6v-8H3V24h3v-8h4v-6h6V6h8z" /></clipPath>
    </defs>
    <g clipPath="url(#startup-earth-shape)">
      <path fill="#285460" d="M0 0h64v64H0z" />
      <path fill="#4CA5B9" d="M5 3h47v12H40v8h12v8h-7v9h10v15H8V44h9V31H4z" />
      <path fill="#6BAF4A" d="M18 5h20v7h-6v7h-8v8h-7v9h-8V20h5v-8h4zM37 21h14v7h7v10h-8v5h-6v8H32v-7h-6V33h8v-6h3zM14 47h9v6h9v8H13z" />
      <path fill="#39815B" d="M11 25h7v10h7v7h-9v-5h-7zM39 31h12v8h-5v8h-8v-9h-5v-5h6zM23 53h8v8h-8z" />
      <path fill="#183F4A" d="M47 2h17v25h-5v-8h-6v-7h-6zM48 50h16v14H37v-5h11zM0 41h7v12h8v11H0z" />
      <path fill="#D9F5E9" d="M23 12h8v3h8v3H27v-2h-7zM7 37h7v3h8v3H11v-2H5zM37 48h8v3h10v2H43v-2h-6z" />
    </g>
  </svg>
}

function PixelBlackHole(): ReactNode {
  return <svg viewBox="0 0 80 80" aria-hidden="true" focusable="false" shapeRendering="crispEdges">
    <path fill="#A44E37" d="M27 13h25v4h9v8h5v9h3v13h-3v9h-5v8h-9v4H27v-4h-9v-8h-5v-9h-3V34h3v-9h5v-8h9z" />
    <path fill="#E98945" d="M27 17h25v4h8v7h5v9h2v10h-4v9h-7v7H25v-4h-7v-9h-4V35h4v-9h9z" />
    <path fill="#F7C27A" d="M29 22h21v4h8v8h4v13h-4v8h-8v4H29v-4h-8v-8h-4V34h4v-8h8z" />
    <path fill="#172034" d="M30 26h19v4h7v7h3v10h-3v7H49v3H30v-3h-7v-7h-3V37h3v-7h7z" />
    <path fill="#FFF1BD" d="M30 28h19v3h6v6h2v10h-3v6h-6v2H30v-2h-6v-6h-2V37h2v-6h6z" />
    <path fill="#171925" d="M30 31h18v3h5v5h2v7h-2v5h-5v3H30v-3h-5v-5h-2v-7h2v-5h5z" />
    <path fill="#D9683E" d="M4 69 60 14 75 4 66 19 18 69 4 76z" />
    <path fill="#F5A94D" d="M8 70 61 15 76 4 64 22 16 70 3 77z" />
    <path fill="#FFE1A0" d="M13 67 62 18 73 8 62 24 17 68z" />
  </svg>
}

export function StartupSplash({ variant = launchVariant, ready = false, leaving = false, onSkip }: { variant?: StartupVariant; ready?: boolean; leaving?: boolean; onSkip?: () => void } = {}): ReactNode {
  const frame = useRef<HTMLIFrameElement>(null)
  const [paintingFailed, setPaintingFailed] = useState(false)
  const armor = variant === 'armor'
  const painting = (variant === 'willow' || variant === 'sail') && !paintingFailed
  const paintingUrl = `${import.meta.env.BASE_URL}startup/${variant}.html`
  const paintingName = variant === 'sail' ? 'Sail' : 'Willow'
  useEffect(() => {
    if (!painting) return
    const onMessage = (event: MessageEvent): void => {
      if (event.source === frame.current?.contentWindow && event.data?.type === 'singularity:painting-error') setPaintingFailed(true)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [painting])
  return <div className={`startup-splash${armor ? ' startup-splash-armor' : ''}${leaving ? ' startup-splash-leaving' : ''}${painting ? ` startup-splash-painting startup-splash-${variant}` : ''}`} data-startup-variant={armor ? 'armor' : painting ? variant : 'planets'} role="status" aria-live="polite" aria-label={ready ? '系统已就绪' : t('connecting')}>
    {armor && <ArmorStartup ready={ready}/>}
    {painting && <iframe ref={frame} className="startup-painting" title={`${paintingName} 水彩加载动画`} src={paintingUrl} sandbox="allow-scripts allow-same-origin" tabIndex={-1} aria-hidden="true" />}
    <div className="startup-window-actions">
      <button aria-label="最小化" onClick={() => void window.singularity.windowControls.minimize()}><Minus size={16} /></button>
      <button aria-label="最大化" onClick={() => void window.singularity.windowControls.toggleMaximize()}><Square size={13} /></button>
      <button aria-label="关闭" onClick={() => void window.singularity.windowControls.close()}><X size={17} /></button>
    </div>
    {armor ? onSkip && <button className="armor-skip" onClick={onSkip}>{ready ? '进入应用 ↗' : '先进入应用 ↗'}</button> : painting ? <div className="startup-painting-caption"><div className="startup-wordmark">Singularity</div><span>{t('connecting')}</span></div> : <div className="startup-center">
      <div className="startup-scene" aria-hidden="true">
        <div className="startup-orbit startup-orbit-earth"><div className="startup-orbit-body"><PixelEarth /></div></div>
        <div className="startup-orbit startup-orbit-saturn"><div className="startup-orbit-body"><img src={appIconUrl} alt="" /></div></div>
        <div className="startup-orbit startup-orbit-black-hole"><div className="startup-orbit-body"><PixelBlackHole /></div></div>
        <PixelSun />
      </div>
      <div className="startup-wordmark">Singularity</div>
    </div>}
  </div>
}
