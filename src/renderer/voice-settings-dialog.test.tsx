// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { VoiceSettingsDialog } from './VoiceSettingsDialog'
import type { VoiceSettings } from '../shared/voice'

const base: VoiceSettings = {
  provider: 'windows', asrProvider: 'windows', voiceId: '', monthlyCreditLimit: 10000, replyCharacterLimit: 1000,
  deepseekVoice: 'stella', minimaxBaseUrl: 'https://api.minimax.cn',
  minimaxVoiceId: 'Chinese (Mandarin)_Lyrical_Voice', minimaxModel: 'speech-2.8-turbo',
  hasCredential: false, hasDeepSeekCredential: false, hasMiniMaxCredential: false, month: '2026-11', estimatedCredits: 0,
}

async function render(settings: VoiceSettings): Promise<{ text: string; options: string[] }> {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true })
  Object.defineProperty(window, 'singularity', { configurable: true, value: { voice: {
    settings: vi.fn().mockResolvedValue(settings), saveSettings: vi.fn(), verifySettings: vi.fn(),
  } } })
  HTMLDialogElement.prototype.showModal = vi.fn()
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => root.render(<VoiceSettingsDialog onClose={() => {}} onSaved={() => {}} />))
  const text = host.textContent ?? ''
  const options = [...host.querySelectorAll('option')].map(option => option.textContent ?? '')
  await act(async () => root.unmount())
  host.remove()
  return { text, options }
}

it('offers both local and cloud services, with local selected by default', async () => {
  const { text, options } = await render(base)
  expect(options).toContain('Windows 本地识别 · 免费离线')
  expect(options).toContain('DeepSeek ASR · 21 语种自动识别')
  expect(options).toContain('MiniMax ASR · asr-1.0')
  expect(options).toContain('DeepSeek TTS · Stella / Tide')
  expect(options).toContain('MiniMax TTS · Speech 2.8')
  expect(text).toContain('DeepSeek ASR / TTS API')
  expect(text).toContain('未启用')
  expect(text).not.toContain('MiniMax 语音 API')
  expect(text).toContain('云端服务默认关闭')
})

it('shows only the credential blocks for the selected cloud providers', async () => {
  const { text } = await render({ ...base, provider: 'minimax', asrProvider: 'deepseek' })
  expect(text).toContain('DeepSeek ASR / TTS API')
  expect(text).toContain('使用中')
  expect(text).toContain('MiniMax 语音 API')
  expect(text).toContain('音色 ID')
  expect(text).toContain('服务区')
  expect(text).toContain('本机不预估账单')
})

it('keeps the original BreezeBlue fields when that service is selected', async () => {
  const { text } = await render({ ...base, provider: 'breezeblue', hasCredential: true, voiceId: 'voc_test' })
  expect(text).toContain('Voice ID')
  expect(text).toContain('每月上限（credits）')
  expect(text).toContain('DeepSeek ASR / TTS API')
  expect(text).toContain('未启用')
  expect(text).not.toContain('MiniMax 语音 API')
})
