import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { safeStorage } from 'electron'
import { encryptVoiceCredential, decryptVoiceCredential } from './voice-credential'
import { z } from 'zod'
import { voiceCredits, type CloudVoiceProvider, type VoiceAudio, type VoiceSettings, type VoiceSettingsInput } from '../shared/voice'

const secret = z.string().trim().max(512).refine(value => !/[\r\n]/.test(value)).optional()
const schema = z.object({
  provider: z.enum(['windows', 'breezeblue', 'deepseek', 'minimax']),
  asrProvider: z.enum(['windows', 'deepseek', 'minimax']).optional(),
  voiceId: z.string().trim().max(140),
  apiKey: secret,
  monthlyCreditLimit: z.number().int().min(0).max(1_000_000),
  replyCharacterLimit: z.number().int().min(50).max(1000),
  deepseekKey: secret,
  deepseekVoice: z.enum(['stella', 'tide']).optional(),
  minimaxKey: secret,
  minimaxBaseUrl: z.enum(['https://api.minimax.cn', 'https://api.minimax.io']).optional(),
  minimaxVoiceId: z.string().trim().max(140).optional(),
  minimaxModel: z.string().trim().max(80).optional(),
})
interface Stored extends Omit<VoiceSettingsInput, 'apiKey' | 'deepseekKey' | 'minimaxKey'> { encryptedKey?: string; encryptedKeys?: Partial<Record<CloudVoiceProvider, string>> }
interface Usage { month: string; estimatedCredits: number }
const defaults: Stored = {
  provider: 'windows', asrProvider: 'windows', voiceId: '', monthlyCreditLimit: 10_000, replyCharacterLimit: 1000,
  deepseekVoice: 'stella', minimaxBaseUrl: 'https://api.minimax.cn',
  minimaxVoiceId: 'Chinese (Mandarin)_Lyrical_Voice', minimaxModel: 'speech-2.8-turbo',
}
const month = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }
const digest = (value: string) => createHash('sha256').update(value).digest('hex')
const api = 'https://api.breeze.blue/v1'

/** Keys never cross the settings read API. Paid requests have no automatic retries. */
/** Also owns the shared voice settings file and the per-provider encrypted credentials. */
export class BreezeVoice {
  private readonly settingsFile: string
  private readonly usageFile: string
  private readonly cache: string
  private queue: Promise<unknown> = Promise.resolve()
  private generating = false
  constructor(config: string, cache: string, private readonly request: typeof fetch = fetch) {
    this.settingsFile = path.join(config, 'voice-settings.json')
    this.usageFile = path.join(config, 'voice-usage.json')
    this.cache = path.join(cache, 'breeze-voice')
  }
  private async read<T>(file: string, fallback: T): Promise<T> {
    try { return JSON.parse(await fs.readFile(file, 'utf8')) as T }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback; throw new Error('无法读取语音配置，请检查本地数据。') }
  }
  private async write(file: string, value: unknown): Promise<void> {
    await fs.mkdir(path.dirname(file), { recursive: true })
    const temporary = `${file}.${randomUUID()}.tmp`
    try { await fs.writeFile(temporary, JSON.stringify(value, null, 2), { mode: 0o600 }); await fs.rename(temporary, file) }
    finally { await fs.rm(temporary, { force: true }).catch(() => {}) }
  }
  private locked<T>(task: () => Promise<T>): Promise<T> {
    const pending = this.queue.then(task); this.queue = pending.then(() => {}, () => {}); return pending
  }
  private async usage(): Promise<Usage> {
    const current = month(), stored = await this.read<Usage>(this.usageFile, { month: current, estimatedCredits: 0 })
    if (stored.month !== current) return { month: current, estimatedCredits: 0 }
    if (!Number.isFinite(stored.estimatedCredits) || stored.estimatedCredits < 0) throw new Error('语音用量记录无效，请检查本地数据。')
    return stored
  }
  async settings(): Promise<VoiceSettings> {
    const [stored, usage] = await Promise.all([this.read<Stored>(this.settingsFile, defaults), this.usage()])
    return {
      provider: stored.provider, asrProvider: stored.asrProvider ?? 'windows', voiceId: stored.voiceId,
      monthlyCreditLimit: stored.monthlyCreditLimit, replyCharacterLimit: stored.replyCharacterLimit,
      deepseekVoice: stored.deepseekVoice ?? 'stella',
      minimaxBaseUrl: stored.minimaxBaseUrl ?? 'https://api.minimax.cn',
      minimaxVoiceId: stored.minimaxVoiceId ?? 'Chinese (Mandarin)_Lyrical_Voice',
      minimaxModel: stored.minimaxModel ?? 'speech-2.8-turbo',
      hasCredential: Boolean(stored.encryptedKey),
      hasDeepSeekCredential: Boolean(stored.encryptedKeys?.deepseek),
      hasMiniMaxCredential: Boolean(stored.encryptedKeys?.minimax),
      ...usage,
    }
  }
  async save(raw: VoiceSettingsInput): Promise<VoiceSettings> {
    await this.locked(async () => {
      const input = schema.parse(raw), previous = await this.read<Stored>(this.settingsFile, defaults)
      if (input.provider === 'breezeblue' && input.voiceId && !/^voc_[A-Za-z0-9_-]+$/.test(input.voiceId)) throw new Error('Voice ID 格式不正确。')
      if (!safeStorage.isEncryptionAvailable() && (input.apiKey || input.deepseekKey || input.minimaxKey)) throw new Error('Windows 密钥加密当前不可用。')
      let encryptedKey = previous.encryptedKey
      if (input.apiKey) encryptedKey = await encryptVoiceCredential(input.apiKey)
      const encryptedKeys: Partial<Record<CloudVoiceProvider, string>> = { ...(previous.encryptedKeys ?? {}) }
      if (input.deepseekKey) encryptedKeys.deepseek = await encryptVoiceCredential(input.deepseekKey)
      if (input.minimaxKey) encryptedKeys.minimax = await encryptVoiceCredential(input.minimaxKey)
      const asrProvider = input.asrProvider ?? 'windows'
      if (input.provider === 'breezeblue' && (!input.voiceId || !encryptedKey)) throw new Error('请填写 Voice ID 和 API Key。')
      if ((input.provider === 'deepseek' || asrProvider === 'deepseek') && !encryptedKeys.deepseek) throw new Error('请填写 DeepSeek API Key。')
      if ((input.provider === 'minimax' || asrProvider === 'minimax') && !encryptedKeys.minimax) throw new Error('请填写 MiniMax API Key。')
      if (input.provider === 'minimax' && !input.minimaxVoiceId?.trim()) throw new Error('请填写 MiniMax 音色 ID。')
      const { apiKey: _breeze, deepseekKey: _deepseek, minimaxKey: _minimax, ...metadata } = input
      await this.write(this.settingsFile, { ...metadata, asrProvider, encryptedKey, encryptedKeys })
    })
    return this.settings()
  }
  /**
   * MiniMax is shared by voice and image generation: keep exactly one encrypted key so it
   * only needs to be typed once. This never touches the voice provider selection or limits.
   */
  async saveMiniMaxCredential(input: { minimaxKey?: string; minimaxBaseUrl?: string }): Promise<VoiceSettings> {
    await this.locked(async () => {
      const previous = await this.read<Stored>(this.settingsFile, defaults)
      const encryptedKeys: Partial<Record<CloudVoiceProvider, string>> = { ...(previous.encryptedKeys ?? {}) }
      if (input.minimaxKey?.trim()) {
        if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows 密钥加密当前不可用。')
        encryptedKeys.minimax = await encryptVoiceCredential(input.minimaxKey.trim())
      }
      const baseUrl = input.minimaxBaseUrl === 'https://api.minimax.io' || input.minimaxBaseUrl === 'https://api.minimax.cn'
        ? input.minimaxBaseUrl : (previous.minimaxBaseUrl ?? 'https://api.minimax.cn')
      await this.write(this.settingsFile, { ...previous, minimaxBaseUrl: baseUrl, encryptedKeys })
    })
    return this.settings()
  }
  /** Cloud keys are decrypted only inside the main process, never sent back to the renderer. */
  async credential(provider: CloudVoiceProvider): Promise<string> {
    const settings = await this.read<Stored>(this.settingsFile, defaults)
    const value = settings.encryptedKeys?.[provider]
    const name = provider === 'deepseek' ? 'DeepSeek' : 'MiniMax'
    if (!value) throw new Error(`请先保存 ${name} 的 API Key。`)
    let key: string
    try { key = await decryptVoiceCredential(value) }
    catch { throw new Error(`无法解密 ${name} API Key，请在语音设置中重新保存。`) }
    if (!key.trim()) throw new Error(`${name} API Key 为空，请重新保存。`)
    return key
  }
  private async credentials(): Promise<{ settings: Stored; key: string }> {
    const settings = await this.read(this.settingsFile, defaults)
    if (!settings.encryptedKey || !settings.voiceId) throw new Error('请先保存 BreezeBlue 的 Voice ID 和 API Key。')
    let key: string
    try { key = await decryptVoiceCredential(settings.encryptedKey) }
    catch { throw new Error('无法解密 BreezeBlue API Key：旧密钥属于另一个应用配置目录，请在语音设置中重新保存 API Key。') }
    if (!key) throw new Error('无法解密 BreezeBlue API Key，请重新保存。')
    return { settings, key }
  }
  private httpError(status: number): Error {
    const message: Record<number, string> = { 401: 'API Key 无效或已停用。', 402: '余额或官网 Key 额度不足，请查看官网。', 403: '当前 Key 无权使用该声音。', 404: '未找到该 Voice ID。', 429: '请求过于频繁，请稍后再试。' }
    return new Error(`BreezeBlue HTTP ${status}：${message[status] ?? '语音生成未完成，请稍后手动重试。'}`)
  }
  /** Non-billable voice lookup; deliberately never synthesize on save or connection check. */
  async verify(): Promise<{ ok: boolean; message: string }> {
    try {
      const { settings, key } = await this.credentials()
      const response = await this.request(`${api}/voices/${encodeURIComponent(settings.voiceId)}`, {
        headers: { 'xi-api-key': key }, signal: AbortSignal.timeout(15_000), redirect: 'error',
      })
      await response.body?.cancel()
      if (!response.ok) throw this.httpError(response.status)
      return { ok: true, message: 'API Key 和声音可用，检查未生成音频。' }
    } catch (error) { return { ok: false, message: error instanceof Error && (/^(BreezeBlue HTTP|无法解密 BreezeBlue|请先保存 BreezeBlue)/.test(error.message)) ? error.message : '连接检查失败，请检查配置和网络。' } }
  }
  async speak(text: string, signal: AbortSignal): Promise<VoiceAudio> {
    signal.throwIfAborted()
    const { settings, key } = await this.credentials()
    const identity = digest(key), cacheFile = path.join(this.cache, `${digest(JSON.stringify([identity, settings.voiceId, 'breeze-tts-2', text]))}.mp3`)
    try {
      const cached = await fs.readFile(cacheFile); signal.throwIfAborted()
      if (cached.length) return { audio: cached.toString('base64'), provider: 'breezeblue', cached: true }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    if (Array.from(text).length > settings.replyCharacterLimit) throw new Error(`本次回答超过云端朗读上限（${settings.replyCharacterLimit} 字符），文字已保留；可在语音设置中调整或切回本地声音。`)
    if (this.generating) throw new Error('上一段云端语音仍在结束，请稍后重试。')
    this.generating = true
    const credits = voiceCredits(text), reservedMonth = month()
    let reserved = false, sent = false
    try {
      await this.locked(async () => {
        signal.throwIfAborted()
        const usage = await this.usage(), latest = await this.settings()
        if (latest.provider !== 'breezeblue') throw new Error('语音提供商已切换，请重新开始。')
        if (usage.estimatedCredits + credits > latest.monthlyCreditLimit) throw new Error('已达到本机设置的月度云端额度；文字已保留，可切回本地声音。')
        await this.write(this.usageFile, { ...usage, estimatedCredits: Math.round((usage.estimatedCredits + credits) * 10) / 10 })
        reserved = true
      })
      signal.throwIfAborted(); sent = true
      const response = await this.request(`${api}/text-to-speech/${encodeURIComponent(settings.voiceId)}?output_format=mp3&delivery=sync`, {
        method: 'POST', headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, model_id: 'breeze-tts-2' }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(90_000)]), redirect: 'error',
      })
      if (!response.ok) {
        await response.body?.cancel()
        // Rejections before generation do not consume our local estimate.
        if ([400, 401, 402, 403, 404, 422, 429].includes(response.status)) sent = false
        throw this.httpError(response.status)
      }
      if (response.status !== 200 || !/^audio\//i.test(response.headers.get('content-type') ?? '') || !response.body) {
        await response.body?.cancel(); throw new Error('BreezeBlue 未返回可播放音频，未自动重复生成；请查看官网记录。')
      }
      const reader = response.body.getReader(), chunks: Uint8Array[] = []
      let bytes = 0
      try {
        for (;;) { const next = await reader.read(); if (next.done) break; bytes += next.value.length; if (bytes > 12 * 1024 * 1024) throw new Error('云端语音文件过大。'); chunks.push(next.value) }
      } finally { await reader.cancel().catch(() => {}) }
      signal.throwIfAborted()
      if (!bytes) throw new Error('BreezeBlue 返回了空音频，请查看官网生成记录。')
      const audio = Buffer.concat(chunks)
      await fs.mkdir(this.cache, { recursive: true })
      const temporary = `${cacheFile}.${randomUUID()}.tmp`
      try { await fs.writeFile(temporary, audio); await fs.rename(temporary, cacheFile) }
      finally { await fs.rm(temporary, { force: true }).catch(() => {}) }
      return { audio: audio.toString('base64'), provider: 'breezeblue', cached: false }
    } catch (error) {
      if (signal.aborted) throw new Error('语音操作已停止。')
      if (error instanceof Error && /^(BreezeBlue|本次|已达到|语音提供商|云端)/.test(error.message)) throw error
      throw new Error('BreezeBlue 语音请求中断或超时，未自动重试；已发送请求的费用请以官网记录为准。')
    } finally {
      if (reserved && !sent) await this.locked(async () => {
        const usage = await this.usage()
        if (usage.month === reservedMonth) await this.write(this.usageFile, { ...usage, estimatedCredits: Math.max(0, Math.round((usage.estimatedCredits - credits) * 10) / 10) })
      }).finally(() => { this.generating = false })
      else this.generating = false
    }
  }
}
