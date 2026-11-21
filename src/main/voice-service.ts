import { randomUUID } from 'node:crypto'
import { voiceMessages, type VoiceCapabilities, type VoiceRecognition } from '../shared/voice'
import { windowsSpeech } from './windows-speech'
import type { ProviderStore } from './provider-store'
import type { BreezeVoice } from './breeze-voice'
import type { CloudVoice } from './cloud-voice'
import type { VoiceAudio } from '../shared/voice'

export class VoiceService {
  private session: { id: string; controller: AbortController; busy: boolean } | null = null
  constructor(private readonly providers: ProviderStore, private readonly cloud?: BreezeVoice, private readonly cloudVoice?: CloudVoice) {}

  async capabilities(): Promise<VoiceCapabilities> {
    const native = await windowsSpeech<VoiceCapabilities>('capabilities', AbortSignal.timeout(15000)).catch(() => ({ recognition: false, synthesis: false, language: 'zh-CN' }))
    const settings = await this.cloud?.settings().catch(() => undefined)
    const synthesisProvider = settings?.provider ?? 'windows'
    const asrProvider = settings?.asrProvider ?? 'windows'
    let synthesis = native.synthesis
    if (synthesisProvider === 'breezeblue') synthesis = Boolean(settings?.hasCredential && settings.voiceId)
    else if (synthesisProvider === 'deepseek') synthesis = Boolean(this.cloudVoice && settings?.hasDeepSeekCredential)
    else if (synthesisProvider === 'minimax') synthesis = Boolean(this.cloudVoice && settings?.hasMiniMaxCredential && settings.minimaxVoiceId)
    let recognition = native.recognition
    if (asrProvider === 'deepseek') recognition = Boolean(this.cloudVoice && settings?.hasDeepSeekCredential)
    else if (asrProvider === 'minimax') recognition = Boolean(this.cloudVoice && settings?.hasMiniMaxCredential)
    return { ...native, recognition, synthesis }
  }

  start(): string {
    this.stop()
    const id = randomUUID()
    this.session = { id, controller: new AbortController(), busy: false }
    return id
  }

  stop(id?: string): void {
    if (id && id !== this.session?.id) return
    this.session?.controller.abort()
    this.session = null
  }

  private async run<T>(id: string, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const session = this.session
    if (!session || session.id !== id) throw new Error('语音会话已结束。')
    if (session.busy) throw new Error('请等待当前语音操作完成。')
    session.busy = true
    try {
      const result = await operation(session.controller.signal)
      session.controller.signal.throwIfAborted()
      return result
    } finally { session.busy = false }
  }

  listen(id: string, audio?: unknown): Promise<VoiceRecognition> {
    if (audio !== undefined && (typeof audio !== 'string' || audio.length > 4_000_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(audio) || Buffer.from(audio, 'base64').subarray(0, 4).toString() !== 'RIFF')) throw new Error('麦克风录音格式无效。')
    // Keep the local path synchronous so an immediate stop() still aborts the native recognizer.
    if (!this.cloudVoice) return this.run(id, (signal) => windowsSpeech('listen', signal, audio as string | undefined))
    return this.run(id, async (signal) => {
      const provider = (await this.cloud?.settings())?.asrProvider ?? 'windows'
      if (provider === 'deepseek' || provider === 'minimax') {
        if (typeof audio !== 'string') throw new Error('云端语音识别需要麦克风录音，请检查输入设备。')
        return this.cloudVoice!.transcribe(provider, audio, signal)
      }
      return windowsSpeech('listen', signal, audio as string | undefined)
    })
  }

  play(id: string, audio: unknown): Promise<{ played: boolean }> {
    if (typeof audio !== 'string' || audio.length > 24_000_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(audio)) throw new Error('播放音频格式无效。')
    const bytes = Buffer.from(audio, 'base64')
    // Only bounded, well-formed mono/stereo PCM16 WAVs made by the renderer.
    if (bytes.length < 46 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 16) !== 'WAVEfmt ' || bytes.readUInt32LE(16) !== 16 || bytes.readUInt16LE(20) !== 1 || ![1, 2].includes(bytes.readUInt16LE(22)) || bytes.readUInt16LE(34) !== 16 || bytes.toString('ascii', 36, 40) !== 'data' || bytes.readUInt32LE(40) !== bytes.length - 44 || bytes.readUInt32LE(4) !== bytes.length - 8 || bytes.readUInt32LE(24) < 8000 || bytes.readUInt32LE(24) > 192000 || bytes.readUInt16LE(32) !== bytes.readUInt16LE(22) * 2 || bytes.readUInt32LE(28) !== bytes.readUInt32LE(24) * bytes.readUInt16LE(32)) throw new Error('播放音频格式无效。')
    return this.run(id, signal => windowsSpeech('play', signal, audio))
  }

  reply(id: string, messages: unknown): Promise<string> {
    const validated = voiceMessages(messages)
    return this.run(id, (signal) => this.providers.voiceReply(validated, signal))
  }

  replyWithContext(id: string, messages: unknown, context: string): Promise<string> {
    const validated = voiceMessages(messages)
    return this.run(id, (signal) => this.providers.voiceReply(validated, signal, context))
  }

  speak(id: string, text: unknown): Promise<VoiceAudio> {
    if (typeof text !== 'string' || !text.trim() || text.length > 6000) throw new Error('朗读内容无效或过长。')
    return this.run(id, async (signal) => {
      const provider = (await this.cloud?.settings())?.provider ?? 'windows'
      if (provider === 'breezeblue' && this.cloud) return this.cloud.speak(text, signal)
      if ((provider === 'deepseek' || provider === 'minimax') && this.cloudVoice) return this.cloudVoice.synthesize(provider, text, signal)
      return { ...await windowsSpeech<{ audio: string }>('speak', signal, text), provider: 'windows' as const }
    })
  }
}
