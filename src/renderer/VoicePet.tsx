import { useEffect, useId, useRef, useState, type MutableRefObject } from 'react'
import type { VoicePhase } from './VoiceOrb'
import type { PlaybackEnvelope } from './voice-playback'
import './voice-pet.css'

type Cue = 'question' | 'surprise' | 'idea' | 'heart' | null
const reactions = [
  { cue:'surprise', mood:'delighted', gesture:'hop' },
  { cue:'question', mood:'wink', gesture:'tilt' },
  { cue:'idea', mood:'inspired', gesture:'nod' },
  { cue:'heart', mood:'happy', gesture:'sway' },
  { cue:null, mood:'shy', gesture:'peek' },
  { cue:'surprise', mood:'surprised', gesture:'jelly' },
  { cue:null, mood:'sleepy', gesture:'yawn' },
] as const
export function petCue(phase: VoicePhase, reply = ''): Cue {
  if (phase === 'thinking' || phase === 'recognizing' || phase === 'error') return 'question'
  if (phase === 'starting') return 'surprise'
  if (phase === 'preparing') return 'idea'
  if (phase === 'speaking') {
    if (/灵感|思路|建议|可以尝试|假设|方案/.test(reply)) return 'idea'
    if (/[?？]/.test(reply)) return 'question'
    if (/[!！]/.test(reply)) return 'surprise'
  }
  return null
}

export function VoicePet({ phase, analyser, inputAnalyser, envelope, reply = '' }: {
  phase: VoicePhase
  analyser: MutableRefObject<AnalyserNode | null>
  inputAnalyser?: MutableRefObject<AnalyserNode | null>
  envelope: MutableRefObject<PlaybackEnvelope | null>
  reply?: string
}) {
  const id = 'voice-pet-' + useId().replace(/[^a-z0-9]/gi, '')
  const button = useRef<HTMLButtonElement>(null), current = useRef(phase), touches = useRef(0)
  const [reaction, setReaction] = useState<{ cue: Cue; mood:string; gesture:string; count: number } | null>(null)
  current.current = phase
  useEffect(() => { if (!reaction) return; const timer = setTimeout(() => setReaction(null), 1800); return () => clearTimeout(timer) }, [reaction])
  useEffect(() => {
    const element = button.current!
    const reduced = matchMedia('(prefers-reduced-motion: reduce)')
    type Point = { x:number; y:number }
    let pointer: Point | null = null, frame = 0, previous = 0
    let x = 0, y = 0, px = 0, py = 0
    const write = (nx:number, ny:number, npx:number, npy:number) => {
      x=nx; y=ny; px=npx; py=npy
      element.style.setProperty('--pet-look-x', `${x.toFixed(2)}px`)
      element.style.setProperty('--pet-look-y', `${y.toFixed(2)}px`)
      element.style.setProperty('--pet-look-px', `${px.toFixed(2)}px`)
      element.style.setProperty('--pet-look-py', `${py.toFixed(2)}px`)
    }
    const center = () => {
      pointer = null
      cancelAnimationFrame(frame); frame = 0; previous = 0
      write(0,0,0,0)
    }
    // Each eye tracks the cursor from its own position, so the pair converges on
    // the same point instead of sliding sideways as one rigid sticker.
    const gaze = (point:Point, eyeX:number, eyeY:number, rect:DOMRect) => {
      const dx = point.x - (rect.left + rect.width * eyeX), dy = point.y - (rect.top + rect.height * eyeY)
      const distance = Math.hypot(dx / (rect.width / 2 + 320), dy / (rect.height / 2 + 320))
      if (distance >= 1) return null
      const fade = 1 - distance * distance
      const soft = (value:number) => Math.sign(value) * Math.pow(Math.min(1, Math.abs(value)), .8)
      return { x:soft(dx / (rect.width / 2)) * 13 * fade, y:soft(dy / (rect.height / 2)) * 9 * fade }
    }
    const target = () => {
      if (!pointer || document.hidden) { center(); return null }
      const rect = element.getBoundingClientRect()
      if (!rect.width || !rect.height || rect.bottom <= 0 || rect.top >= innerHeight || rect.right <= 0 || rect.left >= innerWidth) { center(); return null }
      const left = gaze(pointer, .298, .58, rect), right = gaze(pointer, .697, .602, rect)
      if (!left || !right) { center(); return null }
      return { x:(left.x + right.x) / 2, y:(left.y + right.y) / 2, px:(right.x - left.x) / 2, py:(right.y - left.y) / 2 }
    }
    const step = (now:number) => {
      frame = 0
      const goal = target()
      if (!goal) return
      const dt = previous ? Math.min(48, now - previous) : 16
      previous = now
      // Time-based easing gives the gaze weight and inertia instead of snapping.
      const ease = reduced.matches ? 1 : 1 - Math.exp(-dt / 58)
      const nx = x + (goal.x - x) * ease, ny = y + (goal.y - y) * ease
      const npx = px + (goal.px - px) * ease, npy = py + (goal.py - py) * ease
      write(nx, ny, npx, npy)
      if (Math.abs(goal.x - nx) + Math.abs(goal.y - ny) + Math.abs(goal.px - npx) + Math.abs(goal.py - npy) > .02) schedule()
      else previous = 0
    }
    const schedule = () => { if (!frame && pointer) { previous = 0; frame = requestAnimationFrame(step) } }
    const move = (event:PointerEvent) => {
      if (event.pointerType === 'touch') return center()
      pointer = { x:event.clientX, y:event.clientY }; schedule()
    }
    window.addEventListener('pointermove', move, { passive:true })
    window.addEventListener('blur', center)
    window.addEventListener('resize', schedule)
    window.addEventListener('scroll', schedule, true)
    document.addEventListener('pointerleave', center)
    document.addEventListener('visibilitychange', center)
    return () => {
      center()
      window.removeEventListener('pointermove', move)
      window.removeEventListener('blur', center)
      window.removeEventListener('resize', schedule)
      window.removeEventListener('scroll', schedule, true)
      document.removeEventListener('pointerleave', center)
      document.removeEventListener('visibilitychange', center)
    }
  }, [])
  useEffect(() => {
    const element = button.current!
    let frame = 0, previous = 0, energy = 0, samples = new Uint8Array(1024)
    const animate = (now: number) => {
      frame = requestAnimationFrame(animate)
      if (document.hidden || now - previous < 40) return
      previous = now
      let value = 0
      const meter = current.current === 'listening' ? inputAnalyser?.current : current.current === 'speaking' ? analyser.current : null
      if (meter) {
        if (samples.length !== meter.fftSize) samples = new Uint8Array(meter.fftSize)
        meter.getByteTimeDomainData(samples)
        value = Math.min(1, Math.sqrt(samples.reduce((sum, sample) => sum + ((sample - 128) / 128) ** 2, 0) / samples.length) * 5)
      } else if (current.current === 'speaking' && envelope.current) {
        const audio = envelope.current, index = Math.floor((now - audio.startedAt) / 1000 * audio.rate)
        value = index >= 0 && index < audio.levels.length ? audio.levels[index] : 0
      }
      energy += (value - energy) * (value > energy ? .5 : .16)
      element.style.setProperty('--pet-energy', String(energy))
      element.dataset.energy = energy.toFixed(3)
    }
    frame = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(frame)
  }, [analyser, inputAnalyser, envelope])
  const cue = reaction?.cue ?? petCue(phase, reply)
  const mood = reaction?.mood ?? (phase === 'thinking' || phase === 'recognizing' ? 'curious' : phase === 'error' ? 'concerned' : phase === 'listening' ? 'attentive' : phase === 'preparing' ? 'inspired' : phase === 'starting' ? 'surprised' : 'calm')
  return <button ref={button} type="button" className="voice-pet" data-phase={phase} data-mood={mood} data-gesture={reaction?.gesture || 'none'} data-cue={cue || 'none'} aria-label="和语音宠物互动" title="点点我，打个招呼" onClick={() => { const next=reactions[touches.current % reactions.length]; touches.current++; setReaction({ ...next, count: touches.current }) }}>
    <svg viewBox="0 0 480 440" aria-hidden="true">
      <defs>
        <path id={`${id}-body`} d="M240 78C134 76 69 142 49 226C35 279 47 327 83 351C118 378 174 385 240 385C308 385 367 378 399 350C434 322 443 275 430 224C410 143 344 77 240 78Z"/>
        <filter id={`${id}-handdrawn`} x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency=".4" numOctaves="3" seed="9" result="grain"/><feDisplacementMap in="SourceGraphic" in2="grain" scale="1.8" xChannelSelector="R" yChannelSelector="G"/></filter>
        <radialGradient id={`${id}-ground`}><stop stopColor="#59212e" stopOpacity=".24"/><stop offset=".45" stopColor="#843d48" stopOpacity=".1"/><stop offset="1" stopColor="#843d48" stopOpacity="0"/></radialGradient>
        <radialGradient id={`${id}-bulb`}><stop stopColor="#ffeaa0" stopOpacity=".6"/><stop offset="1" stopColor="#ffdf72" stopOpacity="0"/></radialGradient>
      </defs>
      <ellipse className="pet-ground" cx="240" cy="398" rx="173" ry="22" fill={`url(#${id}-ground)`}/>
      <g className="pet-float"><g className="pet-gesture" key={reaction?.count ?? 0}><g className="pet-audio-body">
        <use className="pet-body" href={`#${id}-body`} fill="#f00000" filter={`url(#${id}-handdrawn)`}/>
        <g className="pet-eye-look"><g className="pet-eye-blink">
          <g className="pet-left-eye"><path className="pet-eye" fill="#ffffff" stroke="#000000" filter={`url(#${id}-handdrawn)`} d="M117 178C96 164 83 182 76 207C62 251 68 293 90 318C113 345 157 350 190 331C211 319 220 300 212 276C198 237 157 195 117 178Z"/></g>
          <g className="pet-right-eye"><path className="pet-eye" fill="#ffffff" stroke="#000000" filter={`url(#${id}-handdrawn)`} d="M358 188C380 175 393 194 400 217C415 260 410 306 388 331C365 356 321 358 288 342C263 331 253 315 262 289C275 250 322 205 358 188Z"/></g>
        </g></g>
      </g></g></g>
      <g transform="translate(22 -19)"><g className="pet-thought" key={reaction?.count || cue}>
        {cue === 'question' && <g className="pet-question"><path d="M316 65C315 47 345 44 349 61C353 76 331 77 331 91"/><circle cx="331" cy="105" r="3.2"/></g>}
        {cue === 'surprise' && <g className="pet-surprise"><path d="M332 47L330 89"/><circle cx="330" cy="104" r="3.2"/><path className="pet-accent-mark" d="M305 65L296 58M357 66L366 59"/></g>}
        {cue === 'idea' && <g className="pet-idea"><circle cx="332" cy="70" r="44" fill={`url(#${id}-bulb)`}/><path className="pet-bulb-glass" d="M317 78C307 65 315 47 331 46C349 45 358 65 348 78L341 88H324Z"/><path className="pet-bulb-detail" d="M325 94H340M328 100H337M331 87V74L325 67M331 74L339 65M331 34V27M306 43L300 37M357 43L364 36M301 66H292M362 66H371"/></g>}
        {cue === 'heart' && <path className="pet-heart" d="M332 92L311 73C295 57 317 41 332 58C347 41 369 57 353 73Z"/>}
      </g></g>
    </svg>
  </button>
}
