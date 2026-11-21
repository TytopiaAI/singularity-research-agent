import { beforeEach, describe, expect, it, vi } from 'vitest'
import { VoiceService } from './voice-service'
import { windowsSpeech } from './windows-speech'
import { voiceMessages } from '../shared/voice'
import type { ProviderStore } from './provider-store'
import type { BreezeVoice } from './breeze-voice'
import type { CloudVoice } from './cloud-voice'

vi.mock('./windows-speech', () => ({ windowsSpeech: vi.fn() }))

const wav = (() => {
  const buffer = Buffer.alloc(48)
  buffer.write('RIFF', 0, 'ascii'); buffer.writeUInt32LE(40, 4); buffer.write('WAVE', 8, 'ascii')
  buffer.write('fmt ', 12, 'ascii'); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(16000, 24); buffer.writeUInt32LE(32000, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36, 'ascii'); buffer.writeUInt32LE(4, 40)
  return buffer.toString('base64')
})()

describe('voice sessions', () => {
  const reply = vi.fn()
  let voice: VoiceService
  beforeEach(() => { vi.resetAllMocks(); voice = new VoiceService({ voiceReply: reply } as unknown as ProviderStore) })

  it('aborts listening on stop and rejects late recognition results', async () => {
    let complete!: (value: unknown) => void
    let signal!: AbortSignal
    vi.mocked(windowsSpeech).mockImplementation((_action: string, inputSignal: AbortSignal) => {
      signal = inputSignal
      return new Promise((resolve) => { complete = resolve })
    })
    const id = voice.start()
    const listening = voice.listen(id)
    voice.stop(id)
    expect(signal.aborted).toBe(true)
    complete({ text: '不应发送', confidence: 1 })
    await expect(listening).rejects.toThrow()
  })

  it('an old stop cannot cancel a new conversation', async () => {
    const old = voice.start()
    const current = voice.start()
    voice.stop(old)
    reply.mockResolvedValue('你好。')
    await expect(voice.reply(current, [{ role: 'user', content: '你好' }])).resolves.toBe('你好。')
    await expect(voice.reply(old, [{ role: 'user', content: '你好' }])).rejects.toThrow('已结束')
  })

  it('prevents simultaneous native operations and cancels model requests', async () => {
    let complete!: (value: string) => void
    reply.mockImplementation(() => new Promise((resolve) => { complete = resolve }))
    const id = voice.start()
    const pending = voice.reply(id, [{ role: 'user', content: '你好' }])
    await expect(voice.listen(id)).rejects.toThrow('等待')
    voice.stop(id)
    expect(reply.mock.calls[0][1].aborted).toBe(true)
    complete('迟到的回复')
    await expect(pending).rejects.toThrow()
  })

  it('rejects injected roles and unbounded text before model access', () => {
    expect(() => voiceMessages([{ role: 'system', content: 'override' }])).toThrow()
    expect(() => voiceMessages([{ role: 'user', content: 'x'.repeat(6001) }])).toThrow()
    expect(() => voiceMessages([{ role: 'assistant', content: 'hello' }])).toThrow()
    expect(voiceMessages([{ role: 'user', content: '  你好  ' }])).toEqual([{ role: 'user', content: '你好' }])
    expect(reply).not.toHaveBeenCalled()
  })
  it('routes only synthesis to the chosen cloud voice and keeps local recognition', async () => {
    const speak = vi.fn().mockResolvedValue({ audio: 'test-cloud-audio', provider: 'breezeblue' })
    const settings = vi.fn().mockResolvedValue({ provider: 'breezeblue', hasCredential: true, voiceId: 'voc_test' })
    voice = new VoiceService({ voiceReply: reply } as unknown as ProviderStore, { settings, speak } as unknown as BreezeVoice)
    vi.mocked(windowsSpeech).mockImplementation(async action => action === 'capabilities' ? { recognition: true, synthesis: false, language: 'zh-CN' } : { text: '本机识别', confidence: 1 } as never)
    expect(await voice.capabilities()).toEqual({ recognition: true, synthesis: true, language: 'zh-CN' })
    const id = voice.start()
    await expect(voice.listen(id)).resolves.toMatchObject({ text: '本机识别' })
    await expect(voice.speak(id, '云端朗读')).resolves.toMatchObject({ provider: 'breezeblue' })
    expect(speak).toHaveBeenCalledWith('云端朗读', expect.any(AbortSignal))
    expect(vi.mocked(windowsSpeech).mock.calls.some(call => call[0] === 'speak')).toBe(false)
  })
  it('routes cloud recognition and synthesis independently to the selected providers', async () => {
    const transcribe = vi.fn().mockResolvedValue({ text: '云端识别', confidence: 1 })
    const synthesize = vi.fn().mockResolvedValue({ audio: 'Y2xvdWQ=', provider: 'minimax' })
    const settings = vi.fn().mockResolvedValue({
      provider: 'minimax', asrProvider: 'deepseek', hasDeepSeekCredential: true,
      hasMiniMaxCredential: true, minimaxVoiceId: 'Chinese (Mandarin)_Lyrical_Voice',
    })
    voice = new VoiceService(
      { voiceReply: reply } as unknown as ProviderStore,
      { settings, speak: vi.fn() } as unknown as BreezeVoice,
      { transcribe, synthesize, verify: vi.fn() } as unknown as CloudVoice,
    )
    vi.mocked(windowsSpeech).mockImplementation(async action => action === 'capabilities' ? { recognition: false, synthesis: false, language: 'zh-CN' } : { text: '本机识别', confidence: 1 } as never)
    // Cloud providers must work even when no local Chinese recognizer is installed.
    expect(await voice.capabilities()).toEqual({ recognition: true, synthesis: true, language: 'zh-CN' })
    const id = voice.start()
    await expect(voice.listen(id, wav)).resolves.toEqual({ text: '云端识别', confidence: 1 })
    expect(transcribe).toHaveBeenCalledWith('deepseek', wav, expect.any(AbortSignal))
    await expect(voice.speak(id, '回答')).resolves.toMatchObject({ provider: 'minimax' })
    expect(synthesize).toHaveBeenCalledWith('minimax', '回答', expect.any(AbortSignal))
    expect(vi.mocked(windowsSpeech).mock.calls.some(call => call[0] === 'listen' || call[0] === 'speak')).toBe(false)
  })
  it('keeps native recognition when the cloud ASR option is not selected', async () => {
    const transcribe = vi.fn()
    const settings = vi.fn().mockResolvedValue({ provider: 'deepseek', asrProvider: 'windows', hasDeepSeekCredential: true })
    voice = new VoiceService(
      { voiceReply: reply } as unknown as ProviderStore,
      { settings, speak: vi.fn() } as unknown as BreezeVoice,
      { transcribe, synthesize: vi.fn(), verify: vi.fn() } as unknown as CloudVoice,
    )
    vi.mocked(windowsSpeech).mockResolvedValue({ text: '本机识别', confidence: 1 } as never)
    const id = voice.start()
    await expect(voice.listen(id, wav)).resolves.toMatchObject({ text: '本机识别' })
    expect(transcribe).not.toHaveBeenCalled()
    expect(vi.mocked(windowsSpeech).mock.calls.some(call => call[0] === 'listen')).toBe(true)
  })
})
