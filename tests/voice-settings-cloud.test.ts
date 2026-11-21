import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { BreezeVoice } from '../src/main/breeze-voice'
import type { VoiceSettingsInput } from '../src/shared/voice'

vi.mock('../src/main/voice-credential', () => ({
  encryptVoiceCredential: async (key: string) => Buffer.from('enc:' + key).toString('base64'),
  decryptVoiceCredential: async (value: string) => Buffer.from(value, 'base64').toString().replace('enc:', ''),
}))
vi.mock('electron', () => ({ safeStorage: { isEncryptionAvailable: () => true } }))

let directory: string, voice: BreezeVoice
const base: VoiceSettingsInput = {
  provider: 'windows', asrProvider: 'windows', voiceId: '', monthlyCreditLimit: 10000, replyCharacterLimit: 1000,
}
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-settings-cloud-'))
  voice = new BreezeVoice(path.join(directory, 'config'), path.join(directory, 'cache'), vi.fn<typeof fetch>())
})
afterEach(async () => { await fs.rm(directory, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 }) })

it('keeps two cloud keys encrypted, never returns them to the renderer, and preserves blanks', async () => {
  await voice.save({ ...base, provider: 'deepseek', asrProvider: 'minimax', deepseekKey: 'sk_deepseek_secret', minimaxKey: 'mm_minimax_secret' })
  const visible = await voice.settings()
  expect(visible.hasDeepSeekCredential).toBe(true)
  expect(visible.hasMiniMaxCredential).toBe(true)
  expect(visible.asrProvider).toBe('minimax')
  expect(JSON.stringify(visible)).not.toMatch(/sk_deepseek_secret|mm_minimax_secret/)
  const stored = await fs.readFile(path.join(directory, 'config/voice-settings.json'), 'utf8')
  expect(stored).not.toMatch(/sk_deepseek_secret|mm_minimax_secret/)
  expect(await voice.credential('deepseek')).toBe('sk_deepseek_secret')
  expect(await voice.credential('minimax')).toBe('mm_minimax_secret')
  await voice.save({ ...base, provider: 'windows', asrProvider: 'windows' })
  expect((await voice.settings()).hasDeepSeekCredential).toBe(true)
})

it('requires a key for whichever cloud service is selected', async () => {
  await expect(voice.save({ ...base, provider: 'deepseek' })).rejects.toThrow('DeepSeek API Key')
  await expect(voice.save({ ...base, asrProvider: 'minimax' })).rejects.toThrow('MiniMax API Key')
  await expect(voice.save({ ...base, provider: 'minimax', minimaxKey: 'mm_key' })).rejects.toThrow('音色 ID')
  await expect(voice.credential('deepseek')).rejects.toThrow('请先保存')
})

it('reads older settings files that have no cloud fields', async () => {
  await fs.mkdir(path.join(directory, 'config'), { recursive: true })
  await fs.writeFile(path.join(directory, 'config/voice-settings.json'), JSON.stringify({
    provider: 'windows', voiceId: '', monthlyCreditLimit: 10000, replyCharacterLimit: 1000,
  }))
  const visible = await voice.settings()
  expect(visible.asrProvider).toBe('windows')
  expect(visible.hasDeepSeekCredential).toBe(false)
  expect(visible.hasMiniMaxCredential).toBe(false)
  expect(visible.deepseekVoice).toBe('stella')
  expect(visible.minimaxBaseUrl).toBe('https://api.minimax.cn')
})

it('rejects an unknown MiniMax endpoint instead of sending keys elsewhere', async () => {
  await expect(voice.save({ ...base, minimaxBaseUrl: 'https://evil.example.com' as never })).rejects.toThrow()
})
