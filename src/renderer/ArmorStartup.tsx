import { useEffect, useId, useRef } from 'react'
import { armorPanels, armorBackPanels, armorBackSeams, armorSeams, armorEyeSockets, armorEyes, armorCore, armorCorePath, type ArmorPanel } from './armor-geometry'
import './armor-startup.css'

export function ArmorStartup({ ready = false }: { ready?: boolean }) {
  const id = 'mk3-' + useId().replace(/[^a-z0-9]/gi, '')
  const scene = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const element = canvas.current!, container = scene.current!, ctx = element.getContext('2d')
    if (!ctx) return
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    // Sample the actual panel geometry, so every arriving spark belongs to the armor.
    const frontPaths = [...container.querySelectorAll<SVGPathElement>('.armor-body .armor-panel-trace')]
    const anchors = [...container.querySelectorAll<SVGPathElement>('.armor-panel-trace')].flatMap(path => {
      const length = path.getTotalLength()
      const points = Array.from({ length: Math.max(8, Math.ceil(length / 16)) }, (_, i) => path.getPointAtLength(i * 16 % length))
      // Rear attachment roots are hidden by the suit; their sparks belong behind it too.
      return path.closest('.armor-back') ? points.filter(point=>!frontPaths.some(front=>front.isPointInFill(point))) : points
    })
    let seed = 31
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 }
    const sparks = anchors.map(point => ({ x: point.x, y: point.y, angle: random() * Math.PI * 2, drift: 190 + random() * 390, phase: random() * 6.28, gold: random() > .4, size: .5 + random() * 1.2 }))
    const stars = Array.from({ length: 95 }, () => ({ x: random() * 1000, y: random() * 1000, size: .3 + random() * .9, phase: random() * 6.28 }))
    let frame = 0, last = 0
    const began = performance.now()
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2), size = Math.max(1, container.clientWidth)
      element.width = Math.round(size * 1.14 * dpr); element.height = Math.round(size * dpr)
    }
    const observer = new ResizeObserver(resize); observer.observe(container); resize()
    const ease = (v: number) => { const x = Math.max(0, Math.min(1, v)); return x * x * (3 - 2 * x) }
    const draw = (now: number) => {
      if (!motion.matches) frame = requestAnimationFrame(draw)
      if (document.hidden || (!motion.matches && now - last < 32)) return
      last = now
      const t = motion.matches ? 6 : (now - began) / 1000
      // Extra side space lets the added gauntlets extend beyond the original crop.
      ctx.setTransform(element.width / 1140, 0, 0, element.height / 1000, element.width * 70 / 1140, 0)
      ctx.clearRect(-70, 0, 1140, 1000)
      const light = ease((t - .2) / 1.3), settle = ease((t - 1.3) / 2.8)
      ctx.globalCompositeOperation = 'lighter'
      for (const star of stars) {
        ctx.fillStyle = `rgba(237,170,82,${(.08 + .12 * Math.sin(t * .35 + star.phase) ** 2) * light})`
        ctx.fillRect(star.x, star.y, star.size, star.size)
      }
      // Continuous Bezier ribbons pass behind and in front of the shell.
      for (let band = 0; band < 3; band++) {
        const offset = band * 1.8, y = 510 + Math.sin(t * .5 + offset) * 160
        const alpha = light * (.18 + (1 - settle) * .32)
        const gradient = ctx.createLinearGradient(0, 0, 1000, 0)
        gradient.addColorStop(0, 'rgba(226,56,43,0)'); gradient.addColorStop(.25, `rgba(220,47,38,${alpha})`)
        gradient.addColorStop(.55, `rgba(255,212,137,${alpha * 1.2})`); gradient.addColorStop(.8, `rgba(219,101,42,${alpha})`); gradient.addColorStop(1, 'rgba(226,56,43,0)')
        ctx.beginPath(); ctx.moveTo(-80, y - 210)
        ctx.bezierCurveTo(250, y + 130 + band * 28, 620, y - 280, 1080, y + 150)
        ctx.strokeStyle = gradient; ctx.lineWidth = band === 1 ? 1.6 : .7; ctx.stroke()
      }
      for (const spark of sparks) {
        const dissolve = 1 - settle, drift = spark.drift * dissolve
        const x = spark.x + Math.cos(spark.angle + t * .12) * drift
        const y = spark.y + Math.sin(spark.angle + t * .12) * drift
        const twinkle = .5 + .5 * Math.sin(t * 1.8 + spark.phase)
        const alpha = light * ((1 - settle) * .45 + settle * (.08 + twinkle * .35))
        ctx.fillStyle = spark.gold ? `rgba(255,204,122,${alpha})` : `rgba(248,64,43,${alpha})`
        ctx.beginPath(); ctx.arc(x, y, spark.size * (.7 + dissolve), 0, Math.PI * 2); ctx.fill()
        if (dissolve > .1 && dissolve < .85) {
          ctx.strokeStyle = spark.gold ? `rgba(255,194,90,${alpha * .35})` : `rgba(240,51,30,${alpha * .35})`
          ctx.lineWidth = .45; ctx.beginPath(); ctx.moveTo(x, y)
          ctx.lineTo(x + (spark.x - x) * .07, y + (spark.y - y) * .07); ctx.stroke()
        }
      }
      ctx.globalCompositeOperation = 'source-over'
    }
    const restart = () => { cancelAnimationFrame(frame); draw(performance.now()) }
    motion.addEventListener('change', restart); draw(performance.now())
    return () => { cancelAnimationFrame(frame); observer.disconnect(); motion.removeEventListener('change', restart) }
  }, [])

  const renderPanel = (panel: ArmorPanel) => <g key={panel.name} data-armor-panel={panel.name} className={'armor-part armor-part-'+panel.metal} style={{ '--panel-delay': `${panel.delay + .55}s` } as React.CSSProperties}>
    {panel.backing && <path className="armor-hand-backing" d={panel.path} fill="#080709"/>}
    <path className={`armor-panel-surface armor-metal-${panel.metal}`} d={panel.path} fill={'url(#'+id+'-'+panel.metal+')'}/>
    <path className={`armor-panel-trace armor-trace-${panel.metal}`} d={panel.path} stroke={'url(#'+id+(panel.metal==='red'?'-red-edge':'-edge')+')'} strokeWidth="1.1" pathLength="1"/>
    <path className="armor-panel-bloom" d={panel.path} stroke={panel.metal==='gold'?'#ffc66e':'#ef5037'} strokeWidth="2" filter={'url(#'+id+'-bloom)'} pathLength="1"/>
  </g>

  return <div className="armor-startup" aria-label="红金装甲轮廓启动动画">
    <div className="armor-ambient" aria-hidden="true" />
    <div className="armor-corner armor-corner-left" aria-hidden="true"><span>ARMOR / ONLINE</span><i /> <small>STARK INDUSTRIES<br/>SYSTEM INITIALIZATION</small></div>
    <div className="armor-corner armor-corner-right" aria-hidden="true"><span>Au · Fe</span><i /><small>GOLD / TITANIUM ALLOY<br/>RESEARCH INTERFACE</small></div>
    <div ref={scene} className="armor-scene" aria-hidden="true">
      <svg viewBox="0 0 1000 1000" className="armor-svg" fill="none">
        <defs>
          <linearGradient id={id+'-red'} x1=".2" y1="0" x2=".8" y2="1" gradientUnits="objectBoundingBox"><stop stopColor="#521817"/><stop offset=".42" stopColor="#1e090c"/><stop offset=".8" stopColor="#3f0b10"/><stop offset="1" stopColor="#0a0609"/></linearGradient>
          <linearGradient id={id+'-gold'} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#997344"/><stop offset=".3" stopColor="#4a3520"/><stop offset=".65" stopColor="#231b14"/><stop offset="1" stopColor="#8b5728"/></linearGradient>
          <linearGradient id={id+'-dark'} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#261a19"/><stop offset="1" stopColor="#09090b"/></linearGradient>
          <linearGradient id={id+'-edge'} x1="0" y1="0" x2=".8" y2="1"><stop stopColor="#ffe1a5"/><stop offset=".36" stopColor="#d47043"/><stop offset=".7" stopColor="#fbbb6b"/><stop offset="1" stopColor="#9b3029"/></linearGradient>
          <linearGradient id={id+'-red-edge'} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#ffb18a"/><stop offset=".3" stopColor="#e84b3b"/><stop offset=".7" stopColor="#fa6146"/><stop offset="1" stopColor="#8c172b"/></linearGradient>
          <radialGradient id={id+'-core'}><stop stopColor="#fffbed"/><stop offset=".38" stopColor="#ffeac1"/><stop offset=".63" stopColor="#ffbd59"/><stop offset="1" stopColor="#c33d20" stopOpacity=".1"/></radialGradient>
          <filter id={id+'-bloom'} x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="3.5"/></filter>
          <filter id={id+'-wide-bloom'} x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="12"/></filter>
          <radialGradient id={id+'-halo'}><stop stopColor="#ec8c3d" stopOpacity=".2"/><stop offset="1" stopColor="#a71e21" stopOpacity="0"/></radialGradient>
          <mask id={id+'-fade'}><rect x="-70" width="1140" height="1000" fill="white"/><rect x="-70" y="875" width="1140" height="125" fill={'url(#'+id+'-bottom)'}/></mask>
          <mask id={id+'-rear-occlusion'}>
            <rect x="-70" width="1140" height="1000" fill="white"/>
            {armorPanels.map(panel=><path key={panel.name} d={panel.path} fill="black"/>)}
          </mask>
          <linearGradient id={id+'-bottom'} x1="0" y1="0" x2="0" y2="1"><stop stopColor="white"/><stop offset="1" stopColor="black"/></linearGradient>
        </defs>
        <circle className="armor-core-halo" cx={armorCore.x} cy={armorCore.y} r="270" fill={'url(#'+id+'-halo)'}/>
        <g className="armor-back" data-armor-layer="back" mask={'url(#'+id+'-fade)'}>
          <g mask={'url(#'+id+'-rear-occlusion)'}>
            {armorBackPanels.map(renderPanel)}
            <g className="armor-seams" stroke="#ad6840" strokeWidth=".85">{armorBackSeams.map((d,i)=><path key={i} d={d}/>)}</g>
          </g>
        </g>
        <g className="armor-body" mask={'url(#'+id+'-fade)'}>
          {armorPanels.map(renderPanel)}
          <g className="armor-seams" stroke="#ad6840" strokeWidth=".85">{armorSeams.map((d,i)=><path key={i} d={d} strokeOpacity={i<2?.3:1}/>)}</g>
          <g className="armor-hardware" fill="#08080b" stroke="#9b7551" strokeWidth="1.1">
            <path d={armorEyeSockets} stroke="#9c784f" strokeWidth=".7"/>
          </g>
          <g className="armor-eyes" fill="#fff4df">
            <path d={armorEyes} filter={'url(#'+id+'-bloom)'} stroke="#ffd699" strokeWidth="1.5" opacity=".8"/>
            <path d={armorEyes}/>
          </g>
        </g>
        <g className="armor-reactor" transform={`translate(${armorCore.x} ${armorCore.y})`}>
          <circle className="armor-reactor-aura" r="62" fill={'url(#'+id+'-core)'} filter={'url(#'+id+'-wide-bloom)'}/>
          <path d={armorCorePath} fill="#100c0d" stroke="#f2bf74" strokeWidth="1.4"/>
          <path d={armorCorePath} transform="scale(.86)" fill="#ffdf9e" stroke="#fff5d7" strokeWidth="1.2"/>
          <path d={armorCorePath} transform="scale(.73)" fill="#fff8e7"/>
          <path d={armorCorePath} transform="scale(.86)" fill="#ffe8b0" opacity=".65" filter={'url(#'+id+'-bloom)'}/>
        </g>
        <circle className="armor-scan-ring" style={{transformOrigin:`${armorCore.x}px ${armorCore.y}px`}} cx={armorCore.x} cy={armorCore.y} r="45" stroke="#f5bc75" strokeWidth=".6"/>
      </svg>
      <canvas ref={canvas} className="armor-sparks"/>
    </div>
    <div className="armor-caption"><span className="armor-edition">ARMOR · ENERGY ONLINE</span><strong>Singularity</strong><span className="armor-caption-status">{ready?'系统已就绪 · 正在进入':'正在连接研究引擎'}</span><div className="armor-loading-track"><i/></div></div>
  </div>
}
