import { beforeEach, expect, it, vi } from 'vitest'
import { CloudVoice, pcmToWav } from '../src/main/cloud-voice'
import type { VoiceSettings } from '../src/shared/voice'

const settings: VoiceSettings = {
  provider: 'deepseek', asrProvider: 'deepseek', voiceId: '', monthlyCreditLimit: 10000, replyCharacterLimit: 1000,
  deepseekVoice: 'stella', minimaxBaseUrl: 'https://api.minimax.cn',
  minimaxVoiceId: 'Chinese (Mandarin)_Lyrical_Voice', minimaxModel: 'speech-2.8-turbo',
  hasCredential: false, hasDeepSeekCredential: true, hasMiniMaxCredential: true, month: '2026-11', estimatedCredits: 0,
}

// Minimal mono 16 kHz PCM16 WAV, matching what useVoiceCapture produces.
const wav = (() => {
  const buffer = Buffer.alloc(44 + 4)
  buffer.write('RIFF', 0, 'ascii'); buffer.writeUInt32LE(36 + 4, 4); buffer.write('WAVE', 8, 'ascii')
  buffer.write('fmt ', 12, 'ascii'); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(16000, 24); buffer.writeUInt32LE(32000, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36, 'ascii'); buffer.writeUInt32LE(4, 40)
  return buffer.toString('base64')
})()

const request = vi.fn<typeof fetch>()
let current: VoiceSettings
let cloud: CloudVoice
const live = () => new AbortController().signal

beforeEach(() => {
  request.mockReset()
  current = settings
  cloud = new CloudVoice({
    settings: async () => current,
    credential: async () => 'sk_test_secret_key',
  }, request)
})

it('wraps DeepSeek raw PCM in a decodable RIFF/WAVE header', () => {
  const wrapped = pcmToWav(Buffer.from([1, 2, 3, 4, 5]))
  expect(wrapped.toString('ascii', 0, 4)).toBe('RIFF')
  expect(wrapped.toString('ascii', 8, 16)).toBe('WAVEfmt ')
  expect(wrapped.readUInt32LE(24)).toBe(24000)
  expect(wrapped.readUInt16LE(22)).toBe(1)
  expect(wrapped.readUInt16LE(34)).toBe(16)
  expect(wrapped.readUInt32LE(40)).toBe(4)
  expect(wrapped.readUInt32LE(4)).toBe(wrapped.length - 8)
  expect(wrapped.length).toBe(48)
})

it('sends DeepSeek ASR as a multipart file and returns the transcript', async () => {
  request.mockResolvedValue(new Response(JSON.stringify({ text: '今天读哪篇论文', duration_ms: 1200 })))
  await expect(cloud.transcribe('deepseek', wav, live())).resolves.toEqual({ text: '今天读哪篇论文', confidence: 1 })
  const [url, init] = request.mock.calls[0]
  expect(url).toBe('https://api.deepseek.com/v1/tools/asr')
  expect(init?.method).toBe('POST')
  expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer sk_test_secret_key')
  expect((init?.headers as Record<string, string>)['Content-Type']).toMatch(/^multipart\/form-data; boundary=/)
  const body = Buffer.from(init?.body as ArrayBuffer).toString('latin1')
  expect(body).toContain('name="file"; filename="recording.wav"')
  expect(body).toContain('Content-Type: audio/wav')
})

it('sends MiniMax ASR to the domestic endpoint with asr-1.0', async () => {
  request.mockResolvedValue(new Response(JSON.stringify({ text: '打开论文库', base_resp: { status_code: 0, status_msg: 'success' } })))
  await expect(cloud.transcribe('minimax', wav, live())).resolves.toMatchObject({ text: '打开论文库' })
  const [url, init] = request.mock.calls[0]
  expect(url).toBe('https://api.minimax.cn/v1/speech_to_text')
  const body = Buffer.from(init?.body as ArrayBuffer).toString('latin1')
  expect(body).toContain('name="model"')
  expect(body).toContain('asr-1.0')
  expect(body).toContain('name="file"; filename="recording.wav"')
})

it('requests DeepSeek TTS with a voice and returns playable WAV audio', async () => {
  request.mockResolvedValue(new Response(new Uint8Array([1, 2, 3, 4, 5, 6]), { headers: { 'content-type': 'application/octet-stream' } }))
  const result = await cloud.synthesize('deepseek', '你好，小桃', live())
  expect(result.provider).toBe('deepseek')
  const audio = Buffer.from(result.audio, 'base64')
  expect(audio.toString('ascii', 0, 4)).toBe('RIFF')
  expect(audio.readUInt32LE(24)).toBe(24000)
  const [url, init] = request.mock.calls[0]
  expect(url).toBe('https://api.deepseek.com/v1/tools/tts')
  expect(JSON.parse(init?.body as string)).toEqual({ text: '你好，小桃', voice_id: 'stella', format: 'pcm', filter_markdown: true })
})

it('decodes MiniMax hex audio and honours the international endpoint', async () => {
  current = { ...settings, minimaxBaseUrl: 'https://api.minimax.io' }
  const mp3 = Buffer.from([0x49, 0x44, 0x33, 0x04, 0x01, 0x02])
  request.mockResolvedValue(new Response(JSON.stringify({
    data: { audio: mp3.toString('hex'), status: 2 }, base_resp: { status_code: 0, status_msg: 'success' },
  })))
  const result = await cloud.synthesize('minimax', '这段是回答', live())
  expect(result.provider).toBe('minimax')
  expect(Buffer.from(result.audio, 'base64').equals(mp3)).toBe(true)
  expect(request.mock.calls[0][0]).toBe('https://api.minimax.io/v1/t2a_v2')
  const payload = JSON.parse(request.mock.calls[0][1]?.body as string)
  expect(payload).toMatchObject({ model: 'speech-2.8-turbo', output_format: 'hex', stream: false })
  expect(payload.voice_setting.voice_id).toBe(settings.minimaxVoiceId)
})

it('maps HTTP and business errors to readable messages without exposing keys', async () => {
  request.mockResolvedValue(new Response('unauthorized', { status: 401 }))
  const first = await cloud.synthesize('deepseek', '测试', live()).catch(error => error as Error)
  expect(first.message).toContain('API Key 无效')
  expect(first.message).not.toContain('sk_test_secret_key')
  request.mockResolvedValue(new Response(JSON.stringify({ base_resp: { status_code: 1004, status_msg: 'auth failed' } })))
  await expect(cloud.synthesize('minimax', '测试', live())).rejects.toThrow('1004')
})

it('respects the local character cap before any billable request', async () => {
  await expect(cloud.synthesize('deepseek', '文'.repeat(1001), live())).rejects.toThrow('朗读上限')
  expect(request).not.toHaveBeenCalled()
})

it('stops cleanly when the session is already aborted', async () => {
  const controller = new AbortController()
  controller.abort()
  await expect(cloud.transcribe('deepseek', wav, controller.signal)).rejects.toThrow('语音操作已停止')
  await expect(cloud.synthesize('minimax', '测试', controller.signal)).rejects.toThrow('语音操作已停止')
  expect(request).not.toHaveBeenCalled()
})

it('never makes a network call during a connection check', async () => {
  const result = await cloud.verify('deepseek')
  expect(result.ok).toBe(true)
  expect(result.message).toContain('不调用云端接口')
  expect(request).not.toHaveBeenCalled()
})
