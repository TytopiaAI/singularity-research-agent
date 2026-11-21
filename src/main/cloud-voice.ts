import { randomUUID } from 'node:crypto'
import { voiceCredits, type CloudVoiceProvider, type VoiceAudio, type VoiceRecognition, type VoiceSettings } from '../shared/voice'

/** Narrow slice of the settings store so this service never touches the config files itself. */
export interface CloudVoiceSettingsStore {
  settings(): Promise<VoiceSettings>
  credential(provider: CloudVoiceProvider): Promise<string>
}

const DEEPSEEK_ORIGIN = 'https://api.deepseek.com'
const MAX_AUDIO_BYTES = 12 * 1024 * 1024
const TTS_SAMPLE_RATE = 24_000
const nameOf = (provider: CloudVoiceProvider): string => provider === 'deepseek' ? 'DeepSeek' : 'MiniMax'

/** DeepSeek TTS returns headerless 24 kHz mono PCM16; the renderer can only decode a RIFF/WAVE. */
export function pcmToWav(pcm: Buffer, sampleRate = TTS_SAMPLE_RATE): Buffer {
  const size = pcm.length - (pcm.length % 2)
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + size, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(size, 40)
  return Buffer.concat([header, pcm.subarray(0, size)])
}

/** Hand-built multipart: Electron's net.fetch does not reliably accept Node's undici FormData. */
function multipart(fields: { name: string; value: string }[], file: { name: string; filename: string; data: Buffer }): { body: ArrayBuffer; contentType: string } {
  const boundary = `----SingularityVoice${randomUUID().replace(/-/g, '')}`
  const chunks: Buffer[] = []
  for (const field of fields) chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${field.name}"\r\n\r\n${field.value}\r\n`, 'utf8'))
  chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${file.name}"; filename="${file.filename}"\r\nContent-Type: audio/wav\r\n\r\n`, 'utf8'))
  chunks.push(file.data)
  chunks.push(Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'))
  const body = Buffer.concat(chunks)
  const copy = new Uint8Array(body.length)
  copy.set(body)
  return { body: copy.buffer as ArrayBuffer, contentType: `multipart/form-data; boundary=${boundary}` }
}

async function readBounded(response: Response): Promise<Buffer> {
  if (!response.body) throw new Error('云端语音未返回音频流。')
  const reader = response.body.getReader(), chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.length
      if (total > MAX_AUDIO_BYTES) throw new Error('云端语音文件过大。')
      chunks.push(value)
    }
  } finally { await reader.cancel().catch(() => {}) }
  return Buffer.concat(chunks)
}

function httpError(provider: CloudVoiceProvider, status: number): Error {
  const messages: Record<number, string> = {
    400: '请求音频或文本格式不被接受。', 401: 'API Key 无效或已停用。', 402: '账户余额不足，请查看官网。',
    403: '当前 Key 无权使用该接口。', 404: '接口地址不存在，请检查服务区设置。',
    413: '音频超过大小上限。', 429: '请求过于频繁，请稍后再试。',
  }
  return new Error(`${nameOf(provider)} HTTP ${status}：${messages[status] ?? '语音服务未完成请求，请稍后手动重试。'}`)
}

function parseJson(raw: string, name: string): Record<string, unknown> {
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { throw new Error(`${name} 返回了无法解析的响应。`) }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`${name} 返回了无法解析的响应。`)
  return parsed as Record<string, unknown>
}

function businessError(record: Record<string, unknown>, name: string): void {
  const base = record.base_resp
  if (!base || typeof base !== 'object') return
  const status = (base as { status_code?: unknown }).status_code
  if (typeof status === 'number' && status !== 0) {
    const message = (base as { status_msg?: unknown }).status_msg
    throw new Error(`${name} 语音服务返回错误 ${status}${typeof message === 'string' && message ? `：${message}` : ''}。`)
  }
}

/**
 * DeepSeek / MiniMax speech endpoints. Both are opt-in: nothing is called unless the user
 * selects the provider in voice settings, and no paid request is made during connection checks.
 */
export class CloudVoice {
  constructor(private readonly store: CloudVoiceSettingsStore, private readonly request: typeof fetch = fetch) {}

  /** Local configuration check only. Any network probe here could be billable. */
  async verify(provider: CloudVoiceProvider): Promise<{ ok: boolean; message: string }> {
    try {
      const settings = await this.store.settings()
      await this.store.credential(provider)
      if (provider === 'minimax' && settings.provider === 'minimax' && !settings.minimaxVoiceId?.trim()) throw new Error('请填写 MiniMax 音色 ID。')
      return { ok: true, message: `${nameOf(provider)} API Key 已加密保存，配置完整。为避免产生费用，连接检查不调用云端接口；首次对话时会验证实际连通性。` }
    } catch (error) {
      return { ok: false, message: error instanceof Error && /^(请先保存|无法解密|请填写)/.test(error.message) ? error.message : '语音配置检查失败，请重新保存 API Key。' }
    }
  }

  private failure(name: string, signal: AbortSignal, error: unknown): Error {
    if (signal.aborted) return new Error('语音操作已停止。')
    if (error instanceof Error && /^(请先保存|无法解密|录音超过|云端语音|本次回答)/.test(error.message)) return error
    if (error instanceof Error && error.message.startsWith(name)) return error
    return new Error(`${name} 语音请求中断或超时，未自动重试；已发送请求的费用请以官网记录为准。`)
  }

  private minimaxOrigin(settings: VoiceSettings): string {
    return settings.minimaxBaseUrl === 'https://api.minimax.io' ? 'https://api.minimax.io' : 'https://api.minimax.cn'
  }

  async transcribe(provider: CloudVoiceProvider, audioBase64: string, signal: AbortSignal): Promise<VoiceRecognition> {
    if (signal.aborted) throw new Error('语音操作已停止。')
    const name = nameOf(provider)
    const key = await this.store.credential(provider)
    const settings = await this.store.settings()
    const bytes = Buffer.from(audioBase64, 'base64')
    if (bytes.length > 8 * 1024 * 1024) throw new Error('录音超过 8 MiB，请缩短后重试。')
    const fields = provider === 'deepseek' ? [] : [
      { name: 'model', value: 'asr-1.0' }, { name: 'response_format', value: 'json' }, { name: 'stream', value: 'false' },
    ]
    const { body, contentType } = multipart(fields, { name: 'file', filename: 'recording.wav', data: bytes })
    const url = provider === 'deepseek' ? `${DEEPSEEK_ORIGIN}/v1/tools/asr` : `${this.minimaxOrigin(settings)}/v1/speech_to_text`
    try {
      const response = await this.request(url, {
        method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': contentType }, body,
        signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]), redirect: 'error',
      })
      if (!response.ok) { await response.body?.cancel(); throw httpError(provider, response.status) }
      const record = parseJson(await response.text(), name)
      businessError(record, name)
      if (typeof record.text !== 'string') throw new Error(`${name} 语音识别未返回文字。`)
      signal.throwIfAborted()
      return { text: record.text, confidence: 1 }
    } catch (error) { throw this.failure(name, signal, error) }
  }

  async synthesize(provider: CloudVoiceProvider, text: string, signal: AbortSignal): Promise<VoiceAudio> {
    if (signal.aborted) throw new Error('语音操作已停止。')
    const name = nameOf(provider)
    const settings = await this.store.settings()
    if (Array.from(text).length > settings.replyCharacterLimit) throw new Error(`本次回答超过朗读上限（${settings.replyCharacterLimit} 字符），文字已保留；可在语音设置中调整。`)
    const key = await this.store.credential(provider)
    try {
      if (provider === 'deepseek') {
        if (voiceCredits(text) * 10 > 10_000) throw new Error('本次回答超过 DeepSeek 单次 10,000 计费字符上限，文字已保留。')
        const response = await this.request(`${DEEPSEEK_ORIGIN}/v1/tools/tts`, {
          method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, voice_id: settings.deepseekVoice ?? 'stella', format: 'pcm', filter_markdown: true }),
          signal: AbortSignal.any([signal, AbortSignal.timeout(90_000)]), redirect: 'error',
        })
        if (!response.ok) { await response.body?.cancel(); throw httpError(provider, response.status) }
        const pcm = await readBounded(response)
        if (pcm.length < 2) throw new Error(`${name} 返回了空音频。`)
        signal.throwIfAborted()
        return { audio: pcmToWav(pcm).toString('base64'), provider, cached: false }
      }
      if (Array.from(text).length >= 10_000) throw new Error('本次回答超过 MiniMax 单次 10,000 字符上限，文字已保留。')
      const response = await this.request(`${this.minimaxOrigin(settings)}/v1/t2a_v2`, {
        method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: settings.minimaxModel ?? 'speech-2.8-turbo', text, stream: false, output_format: 'hex', language_boost: 'auto',
          voice_setting: { voice_id: settings.minimaxVoiceId, speed: 1, vol: 1, pitch: 0 },
          audio_setting: { sample_rate: 32_000, bitrate: 128_000, format: 'mp3', channel: 1 },
        }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(90_000)]), redirect: 'error',
      })
      if (!response.ok) { await response.body?.cancel(); throw httpError(provider, response.status) }
      const record = parseJson(await response.text(), name)
      businessError(record, name)
      const data = record.data
      const hex = data && typeof data === 'object' ? (data as { audio?: unknown }).audio : undefined
      if (typeof hex !== 'string' || !hex.length || !/^[0-9a-fA-F]+$/.test(hex)) throw new Error(`${name} 未返回可播放音频。`)
      const audio = Buffer.from(hex, 'hex')
      if (!audio.length || audio.length > MAX_AUDIO_BYTES) throw new Error('云端语音文件过大或为空。')
      signal.throwIfAborted()
      return { audio: audio.toString('base64'), provider, cached: false }
    } catch (error) { throw this.failure(name, signal, error) }
  }
}
