import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { BreezeVoice } from '../src/main/breeze-voice'
import { voiceCredits } from '../src/shared/voice'
import { redact } from '../src/main/redaction'

vi.mock('../src/main/voice-credential', () => ({
  encryptVoiceCredential: async (key: string) => Buffer.from('test-encrypted:' + key).toString('base64'),
  decryptVoiceCredential: async (value: string) => Buffer.from(value, 'base64').toString().replace('test-encrypted:', ''),
}))

vi.mock('electron', () => ({ safeStorage: {
  isEncryptionAvailable: () => true,
  encryptString: (value: string) => Buffer.from('test-encrypted:' + value),
  decryptString: (value: Buffer) => value.toString().replace('test-encrypted:', ''),
  decryptStringAsync: async (value: Buffer) => ({ result: value.toString().replace('test-encrypted:', '') }),
} }))
let directory: string, voice: BreezeVoice
const request = vi.fn<typeof fetch>()
const input = { provider: 'breezeblue' as const, voiceId: 'voc_test', apiKey: 'brz_dummy_credential_for_testing', monthlyCreditLimit: 100, replyCharacterLimit: 1000 }
const audio = () => new Response(new Uint8Array([73, 68, 51, 1, 2, 3]), { headers: { 'content-type': 'audio/mpeg' } })
beforeEach(async () => { request.mockReset(); directory = await fs.mkdtemp(path.join(os.tmpdir(), 'breeze-voice-')); voice = new BreezeVoice(path.join(directory, 'config'), path.join(directory, 'cache'), request); await voice.save(input) })
afterEach(async () => { await fs.rm(directory, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 }) })
it('encrypts keys, never reads them back to the renderer, and preserves a blank key on save', async () => {
  const visible = await voice.settings()
  expect(visible.hasCredential).toBe(true); expect(JSON.stringify(visible)).not.toContain(input.apiKey)
  expect(await fs.readFile(path.join(directory, 'config/voice-settings.json'), 'utf8')).not.toContain(input.apiKey)
  await voice.save({ ...input, apiKey: '', provider: 'windows' }); expect((await voice.settings()).hasCredential).toBe(true)
  expect(request).not.toHaveBeenCalled()
  expect(redact('key=' + input.apiKey)).not.toContain('dummy_credential')
})
it('checks a voice with a non-billable GET and never synthesizes when saving or verifying', async () => {
  request.mockResolvedValue(new Response('{}'))
  expect((await voice.verify()).ok).toBe(true)
  expect(request.mock.calls[0][0]).toBe('https://api.breeze.blue/v1/voices/voc_test')
  expect(request.mock.calls[0][1]?.method).toBeUndefined()
  expect((await voice.settings()).estimatedCredits).toBe(0)
})
it('caches identical speech across restarts and blocks new generation before crossing the local cap', async () => {
  request.mockImplementation(async () => audio())
  await voice.save({ ...input, monthlyCreditLimit: 1 })
  const first = await voice.speak('中文', new AbortController().signal)
  expect(first.cached).toBe(false)
  voice = new BreezeVoice(path.join(directory, 'config'), path.join(directory, 'cache'), request)
  expect((await voice.speak('中文', new AbortController().signal)).cached).toBe(true)
  expect(request).toHaveBeenCalledTimes(1)
  expect((await voice.settings()).estimatedCredits).toBe(.4)
  await expect(voice.speak('中文句子', new AbortController().signal)).rejects.toThrow('月度云端额度')
  expect(request).toHaveBeenCalledTimes(1)
  expect(request.mock.calls[0][1]?.headers).toEqual(expect.objectContaining({ 'xi-api-key': input.apiKey }))
  expect(request.mock.calls[0][1]?.body).not.toContain(input.apiKey)
})
it('enforces the reply limit and weights mixed text without truncating the answer', async () => {
  await voice.save({ ...input, replyCharacterLimit: 50 })
  await expect(voice.speak('文'.repeat(51), new AbortController().signal)).rejects.toThrow('朗读上限')
  expect(request).not.toHaveBeenCalled()
  expect(voiceCredits('中文Hi')).toBe(.6)
})
it('keeps an uncertain sent request in the estimate and never automatically retries it', async () => {
  request.mockRejectedValue(new Error('network disconnected ' + input.apiKey))
  await expect(voice.speak('测试', new AbortController().signal)).rejects.toThrow('未自动重试')
  expect((await voice.settings()).estimatedCredits).toBe(.4); expect(request).toHaveBeenCalledTimes(1)
})
it('releases an estimate for rejected authentication, without echoing provider errors or secrets', async () => {
  request.mockResolvedValue(new Response(input.apiKey, { status: 401 }))
  await expect(voice.speak('测试', new AbortController().signal)).rejects.toThrow('API Key 无效')
  expect((await voice.settings()).estimatedCredits).toBe(0); expect(request).toHaveBeenCalledTimes(1)
})
it('prevents overlapping paid requests and aborts the fetch when the session stops', async () => {
  let started!: () => void
  const began = new Promise<void>(done => { started = done })
  request.mockImplementation(async (_url, options) => new Promise<Response>((_resolve, reject) => {
    started(); options!.signal!.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })
  }))
  const controller = new AbortController(), pending = voice.speak('第一句', controller.signal)
  await began
  await expect(voice.speak('第二句', new AbortController().signal)).rejects.toThrow('上一段')
  const stopped = expect(pending).rejects.toThrow('已停止'); controller.abort(); await stopped
  expect(request).toHaveBeenCalledTimes(1)
  expect((await voice.settings()).estimatedCredits).toBe(.6)
})
it('starts a new local month without carrying over last month usage', async () => {
  await fs.writeFile(path.join(directory, 'config/voice-usage.json'), JSON.stringify({ month: '2000-01', estimatedCredits: 999 }))
  expect((await voice.settings()).estimatedCredits).toBe(0)
})
