/** Independent hardware-rate output: recording remains on its 16 kHz ASR clock. */
type OutputContext = AudioContext & { setSinkId?: (id: string) => Promise<void> }
const outputError = '音频输出没有启动。请切换为系统默认扬声器，检查 Windows 音量合成器中的 Singularity 音量，再点击“测试声音”。'
type NativePlay = (wave: string) => Promise<unknown>
export interface PlaybackEnvelope { levels: Float32Array; startedAt: number; rate: number }

export function playbackWave(buffer: AudioBuffer): string {
  const channels = Math.min(2, buffer.numberOfChannels), bytes = new Uint8Array(44 + buffer.length * channels * 2), view = new DataView(bytes.buffer)
  const text = (at: number, value: string) => [...value].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)))
  text(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); text(8, 'WAVEfmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true)
  view.setUint32(24, buffer.sampleRate, true); view.setUint32(28, buffer.sampleRate * channels * 2, true); view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, bytes.length - 44, true)
  const samples = Array.from({ length: channels }, (_, c) => buffer.getChannelData(c))
  for (let i = 0; i < buffer.length; i++) for (let c = 0; c < channels; c++) view.setInt16(44 + (i * channels + c) * 2, Math.max(-1, Math.min(1, samples[c][i] || 0)) * 32767, true)
  const chunks: string[] = []
  for (let i = 0; i < bytes.length; i += 32768) chunks.push(String.fromCharCode(...bytes.subarray(i, i + 32768)))
  return btoa(chunks.join(''))
}

export class VoicePlayback {
  readonly analyser: { current: AnalyserNode | null } = { current: null }
  readonly envelope: { current: PlaybackEnvelope | null } = { current: null }
  private context: OutputContext | null = null
  private output = ''
  private source: AudioBufferSourceNode | null = null
  private finish: ((error?: Error) => void) | null = null
  private nativeOutput = false
  private prepared = false
  get ready(): boolean { return this.prepared }

  private useNative(): void {
    const context = this.context
    this.context = null; this.output = ''; this.nativeOutput = true; this.prepared = true
    if (context) void context.close().catch(() => {})
  }

  async prepare(output = '', allowNative = false): Promise<void> {
    if (this.nativeOutput && !output) { this.prepared = true; return }
    if (output) this.nativeOutput = false
    const context: OutputContext = this.context ??= new AudioContext({ latencyHint: 'interactive' })
    if (output !== this.output) {
      if (!context.setSinkId) throw new Error('当前系统不支持指定扬声器，请选择系统默认输出设备。')
      try { await context.setSinkId(output || 'default'); this.output = output }
      catch { throw new Error('所选音频输出设备不可用，请选择其他扬声器或系统默认输出。') }
    }
    if (context.state !== 'running') {
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.race([context.resume(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(outputError)), 3000) })])
        if ((context as AudioContext).state !== 'running' || context !== this.context) throw new Error(outputError)
      } catch (error) {
        if (allowNative && !output && context === this.context) { this.useNative(); return }
        throw error
      } finally { clearTimeout(timer) }
    }
    this.prepared = true
  }

  async play(audio: string, onStarted: () => void, nativePlay?: NativePlay, onNative?: () => void): Promise<void> {
    const context = this.context
    if (!this.prepared) throw new Error(outputError)
    const decoder = context ?? new OfflineAudioContext(1, 1, 48000)
    const bytes = Uint8Array.from(atob(audio), char => char.charCodeAt(0))
    let buffer: AudioBuffer
    try { buffer = await decoder.decodeAudioData(bytes.buffer) }
    catch { throw new Error('朗读音频无法解码。文字已保留，请更换声音或重新尝试。') }
    if (!this.prepared || context !== this.context) return
    await this.playDecoded(buffer, onStarted, nativePlay, onNative)
  }

  async test(output = '', nativePlay?: NativePlay, onNative?: () => void): Promise<void> {
    await this.prepare(output, Boolean(nativePlay))
    const context = this.context ?? new OfflineAudioContext(1, 1, 48000)
    const buffer = context.createBuffer(1, Math.round(context.sampleRate * .9), context.sampleRate)
    const samples = buffer.getChannelData(0)
    for (let i = 0; i < samples.length; i++) {
      const t = i / context.sampleRate, part = t % .3
      samples[i] = .16 * Math.sin(2 * Math.PI * (t < .3 ? 440 : t < .6 ? 554 : 660) * t) * Math.min(1, part / .02, (.28 - part) / .04) * (part < .28 ? 1 : 0)
    }
    await this.playDecoded(buffer, () => {}, nativePlay, onNative)
  }

  private async playDecoded(buffer: AudioBuffer, onStarted: () => void, nativePlay?: NativePlay, onNative?: () => void): Promise<void> {
    let peak = 0
    for (let c = 0; c < buffer.numberOfChannels; c++) for (const sample of buffer.getChannelData(c)) peak = Math.max(peak, Math.abs(sample))
    if (!buffer.length || !Number.isFinite(buffer.duration) || peak < .00001) throw new Error('朗读服务返回了空白或静音音频，文字已保留；请更换声音后重试。')
    try {
      if (this.nativeOutput) throw new Error(outputError)
      await this.playBuffer(buffer, onStarted)
    } catch (error) {
      if (!(error instanceof Error) || error.message !== outputError || !nativePlay || this.output || !this.prepared) throw error
      this.useNative(); onNative?.(); onStarted()
      const rate = 40, size = Math.max(1, Math.floor(buffer.sampleRate / rate)), samples = buffer.getChannelData(0)
      const levels = new Float32Array(Math.ceil(samples.length / size))
      for (let i = 0; i < levels.length; i++) { let sum = 0; const end = Math.min(samples.length, (i + 1) * size); for (let j = i * size; j < end; j++) sum += samples[j] ** 2; levels[i] = Math.min(1, Math.sqrt(sum / Math.max(1, end - i * size)) * 5) }
      // Native output has no browser analyser: use the actual decoded PCM energy.
      // Small lead-in accommodates Windows player creation, without inventing a signal.
      const timeline = { levels, startedAt: performance.now() + 400, rate }
      this.envelope.current = timeline
      try { await nativePlay(playbackWave(buffer)) }
      finally { if (this.envelope.current === timeline) this.envelope.current = null }
    }
  }

  private async playBuffer(buffer: AudioBuffer, onStarted: () => void): Promise<void> {
    const context = this.context
    if (!context) throw new Error(outputError)
    if (context !== this.context) return
    const source = context.createBufferSource(), meter = context.createAnalyser()
    source.buffer = buffer; meter.fftSize = 1024
    source.connect(meter); meter.connect(context.destination)
    this.source = source; this.analyser.current = meter
    await new Promise<void>((resolve, reject) => {
      const began = performance.now()
      let lastTime = context.currentTime, progressed = began, recovering = true, settled = false
      const finish = (error?: Error) => {
        if (settled) return
        settled = true; clearInterval(watchdog); source.onended = null
        try { source.stop() } catch { /* Already ended. */ }
        source.disconnect(); meter.disconnect()
        if (this.source === source) { this.source = null; this.analyser.current = null; this.finish = null }
        if (error) reject(error); else resolve()
      }
      const watchdog = setInterval(() => {
        const now = performance.now()
        if (context.currentTime > lastTime) { lastTime = context.currentTime; progressed = now }
        if (now - progressed > 3500 || now - began > buffer.duration * 1000 + 8000) { finish(new Error(outputError)); return }
        if (context.state !== 'running' && !recovering) {
          recovering = true
          void this.prepare(this.output).catch(() => finish(new Error(outputError))).finally(() => { recovering = false })
        }
      }, 250)
      this.finish = finish; source.onended = () => finish()
      // Schedule a connected source before resuming. Some Windows output
      // drivers do not restart an idle/suspended graph until it has work.
      try {
        source.start()
        void this.prepare(this.output).then(() => { if (!settled) onStarted() }).catch(() => finish(new Error(outputError))).finally(() => { recovering = false })
      } catch { finish(new Error(outputError)) }
    })
  }

  stop(): void {
    this.finish?.()
    const context = this.context
    this.context = null; this.output = ''; this.analyser.current = null; this.envelope.current = null; this.prepared = false
    if (context) void context.close().catch(() => {})
  }
}
