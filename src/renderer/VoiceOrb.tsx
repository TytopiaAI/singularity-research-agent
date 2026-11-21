import { useEffect, useRef, type MutableRefObject, type ReactNode } from 'react'

export type VoicePhase = 'idle' | 'starting' | 'listening' | 'recognizing' | 'thinking' | 'preparing' | 'speaking' | 'error'

/** Indigo → violet → coral → warm gold, sampled around the sphere. */
const palette: Array<[number, [number, number, number]]> = [
  [0, [92, 104, 224]], [.32, [146, 112, 236]], [.58, [236, 120, 132]], [.78, [255, 156, 112]], [.9, [255, 206, 150]], [1, [92, 104, 224]],
]
const BUCKETS = 48
function paletteColor(position: number): [number, number, number] {
  const upper = palette.findIndex(([at]) => at >= position)
  const [fromAt, from] = palette[Math.max(0, upper - 1)], [toAt, to] = palette[Math.max(0, upper)]
  const mix = toAt === fromAt ? 0 : (position - fromAt) / (toAt - fromAt)
  return [0, 1, 2].map((index) => Math.round(from[index] + (to[index] - from[index]) * mix)) as [number, number, number]
}

/** Per-state targets; the orb eases toward them so state changes never jump. */
const targets: Record<VoicePhase, { amplitude: number; speed: number; swirl: number; glow: number; tighten: number; saturation: number }> = {
  idle: { amplitude: .035, speed: .55, swirl: 0, glow: .8, tighten: 0, saturation: 1 },
  starting: { amplitude: .04, speed: .9, swirl: .2, glow: .9, tighten: .02, saturation: 1 },
  listening: { amplitude: .05, speed: 1.1, swirl: 0, glow: 1.15, tighten: .045, saturation: 1 },
  recognizing: { amplitude: .035, speed: 1.15, swirl: .6, glow: 1, tighten: .02, saturation: 1 },
  thinking: { amplitude: .04, speed: 1.4, swirl: 1, glow: 1, tighten: .02, saturation: 1 },
  preparing: { amplitude: .04, speed: 1.3, swirl: .8, glow: 1, tighten: .02, saturation: 1 },
  speaking: { amplitude: .045, speed: 1, swirl: .15, glow: 1.1, tighten: 0, saturation: 1 },
  error: { amplitude: .03, speed: .35, swirl: 0, glow: .55, tighten: 0, saturation: .15 },
}

/** Soft circular glow sprite, pre-rendered once per colour bucket. */
function sprite(rgb: [number, number, number]): HTMLCanvasElement {
  const canvas = document.createElement('canvas'), size = 32
  canvas.width = canvas.height = size
  const context = canvas.getContext('2d')!
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  gradient.addColorStop(0, `rgba(${rgb.map((c) => Math.min(255, c + 60)).join(',')},1)`)
  gradient.addColorStop(.28, `rgba(${rgb.join(',')},.85)`)
  gradient.addColorStop(1, `rgba(${rgb.join(',')},0)`)
  context.fillStyle = gradient
  context.fillRect(0, 0, size, size)
  return canvas
}

export function VoiceOrb({ phase, analyser, inputAnalyser }: { phase: VoicePhase; analyser: MutableRefObject<AnalyserNode | null>; inputAnalyser?: MutableRefObject<AnalyserNode | null> }): ReactNode {
  const canvas = useRef<HTMLCanvasElement>(null)
  const currentPhase = useRef(phase)
  currentPhase.current = phase
  useEffect(() => {
    const element = canvas.current!
    const context = element.getContext('2d')
    if (!context) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    // Surface shell on a Fibonacci lattice, plus a sparse inner core for depth.
    const SURFACE = 2800, CORE = 380
    // Deterministic pseudo-random jitter: an organic cloud, not a visible lattice.
    const random = (seed: number) => { const value = Math.sin(seed * 12.9898) * 43758.5453; return value - Math.floor(value) }
    const golden = Math.PI * (3 - Math.sqrt(5))
    const particles = Array.from({ length: SURFACE + CORE }, (_, index) => {
      const core = index >= SURFACE, i = core ? index - SURFACE : index, count = core ? CORE : SURFACE
      const y = Math.max(-1, Math.min(1, 1 - 2 * (i + .5 + (random(index + 1) - .5) * .9) / count))
      const ring = Math.sqrt(1 - y * y), angle = i * golden + (random(index + 7) - .5) * .35
      const depth = core ? .3 + .5 * random(index + 13) : 1 + (random(index + 19) - .5) * .05
      return { x: ring * Math.cos(angle) * depth, y: y * depth, z: ring * Math.sin(angle) * depth, core, seed: random(index + 29) }
    })
    const colours = Array.from({ length: BUCKETS }, (_, index) => paletteColor(index / BUCKETS))
    const sprites = colours.map(sprite)
    const greys = colours.map((rgb) => { const g = Math.round(rgb[0] * .3 + rgb[1] * .59 + rgb[2] * .11); return sprite([g, g, g + 8]) })
    const state = { ...targets.idle }
    let size = 440, frame = 0, energy = 0, low = 0, high = 0, lastTime = 0
    let wave = new Uint8Array(1024), spectrum = new Uint8Array(512)
    const resize = (): void => {
      size = element.clientWidth || 440
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      element.width = Math.round(size * dpr)
      element.height = Math.round(size * dpr)
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    const observer = new ResizeObserver(resize)
    observer.observe(element)
    resize()
    const draw = (now: number): void => {
      frame = requestAnimationFrame(draw)
      if (document.visibilityState === 'hidden' || now - lastTime < (reduced.matches ? 200 : 30)) return
      const delta = Math.min(.1, (now - (lastTime || now)) / 1000)
      lastTime = now
      const phaseNow = currentPhase.current, goal = targets[phaseNow]
      for (const key of Object.keys(state) as Array<keyof typeof state>) state[key] += (goal[key] - state[key]) * Math.min(1, delta * 3.2)
      // Playback level drives the surface; bass bends the shape, treble adds shimmer.
      let rms = 0, bass = 0, treble = 0
      const node = phaseNow === 'listening' ? inputAnalyser?.current : analyser.current
      if (node && (phaseNow === 'speaking' || phaseNow === 'listening')) {
        if (wave.length !== node.fftSize) wave = new Uint8Array(node.fftSize)
        if (spectrum.length !== node.frequencyBinCount) spectrum = new Uint8Array(node.frequencyBinCount)
        node.getByteTimeDomainData(wave)
        node.getByteFrequencyData(spectrum)
        rms = Math.sqrt(wave.reduce((sum, sample) => sum + ((sample - 128) / 128) ** 2, 0) / wave.length)
        const third = Math.floor(spectrum.length / 3)
        bass = spectrum.slice(2, third / 2).reduce((a, b) => a + b, 0) / Math.max(1, third / 2 - 2) / 255
        treble = spectrum.slice(third, third * 2).reduce((a, b) => a + b, 0) / Math.max(1, third) / 255
      }
      energy += (Math.min(rms * 4.5, .9) - energy) * .22
      low += (bass - low) * .2
      high += (treble - high) * .25
      const dark = document.documentElement.dataset.theme === 'dark'
      const t = reduced.matches ? 0 : now / 1000
      const center = size / 2
      const breathe = reduced.matches ? 0 : Math.sin(t * 1.15) * .012
      const radius = size * (.3 - state.tighten * .9 + breathe + energy * .03)
      const rotation = t * .16 * state.speed
      const cos = Math.cos(rotation), sin = Math.sin(rotation), tilt = .32, cosT = Math.cos(tilt), sinT = Math.sin(tilt)
      context.clearRect(0, 0, size, size)
      // A soft halo grounds the orb; brighter while listening or speaking.
      const halo = context.createRadialGradient(center, center, radius * .4, center, center, radius * 1.75)
      halo.addColorStop(0, `rgba(${dark ? '146,112,236' : '236,120,132'},${(dark ? .2 : .1) * state.glow + energy * .12})`)
      halo.addColorStop(.6, `rgba(255,170,130,${(dark ? .06 : .04) * state.glow})`)
      halo.addColorStop(1, 'rgba(255,170,130,0)')
      context.fillStyle = halo
      context.fillRect(0, 0, size, size)
      context.globalCompositeOperation = dark ? 'lighter' : 'source-over'
      const amplitude = reduced.matches ? 0 : Math.min(.09, state.amplitude + energy * .05 + low * .035)
      const listening = phaseNow === 'listening'
      for (const particle of particles) {
        // Swirl: latitude bands rotate at different rates while thinking.
        const twist = state.swirl * Math.sin(particle.y * 3 + t * 1.6) * .9
        const ct = Math.cos(twist), st = Math.sin(twist)
        let x = particle.x * ct - particle.z * st, z = particle.x * st + particle.z * ct, y = particle.y
        // Smooth 3D wave field displaces the surface outward and inward.
        const field = (Math.sin(x * 2.4 + t * 1.3 * state.speed) * Math.cos(y * 2.1 - t * .9 * state.speed) +
          .5 * Math.sin(z * 3.2 + y * 1.4 + t * 1.9 * state.speed) + .15 * Math.sin((x + z) * 7.5 - t * 3.2) * (.3 + high * 1.5)) / 1.7
        // Listening: gentle rings rising from below, like an attentive breath.
        const ripple = listening ? .03 * Math.sin(y * 9 - t * 4.2) * Math.exp(-((y + .2) ** 2) * 1.6) : 0
        const scale = 1 + (particle.core ? .3 : 1) * (field * amplitude + ripple)
        x *= scale; y *= scale; z *= scale
        // Spin about the vertical axis, then tilt toward the viewer.
        const rx = x * cos + z * sin, rz0 = z * cos - x * sin
        const ry = y * cosT - rz0 * sinT, rz = y * sinT + rz0 * cosT
        const perspective = 3 / (3 - rz)
        const px = center + rx * radius * perspective, py = center + ry * radius * perspective
        // Fresnel-like rim: edge particles brighten, giving a glassy silhouette.
        const facing = Math.max(0, rz / Math.max(.001, Math.hypot(rx, ry, rz)))
        const rim = particle.core ? 0 : Math.pow(1 - facing, 2.2)
        // Colour flows smoothly through 3D position: no seam where hues wrap.
        const hue = (((.5 - particle.y * .3 + .14 * Math.sin(particle.x * 1.7 + particle.z * .6 + t * .25) + particle.seed * .035) % 1) + 1) % 1
        const bucket = Math.floor(hue * BUCKETS) % BUCKETS
        const depthLight = .35 + (rz + 1) * .32
        const alpha = particle.core ? (dark ? .16 : .08) * state.glow : Math.min(1, (depthLight * (dark ? .3 : .58) + rim * (dark ? .26 : .26)) * state.glow + energy * .1)
        const dot = (particle.core ? 1.5 : 1 + rim * .6 + energy * .5) * perspective * size / 440 * (dark ? 1.8 : 1.9)
        context.globalAlpha = alpha
        context.drawImage(state.saturation < .6 ? greys[bucket] : sprites[bucket], px - dot, py - dot, dot * 2, dot * 2)
      }
      context.globalAlpha = 1
      context.globalCompositeOperation = 'source-over'
    }
    frame = requestAnimationFrame(draw)
    return () => { cancelAnimationFrame(frame); observer.disconnect() }
  }, [analyser, inputAnalyser])
  return <canvas ref={canvas} className="voice-orb" aria-hidden="true" />
}
