export type VoiceSynthesisProvider = 'windows' | 'breezeblue' | 'deepseek' | 'minimax'
export type VoiceRecognitionProvider = 'windows' | 'deepseek' | 'minimax'
export type CloudVoiceProvider = 'deepseek' | 'minimax'

export interface VoiceMessage { role: 'user' | 'assistant'; content: string }
export interface VoiceCapabilities { recognition: boolean; synthesis: boolean; language: string }
export interface VoiceRecognition { text: string; confidence: number }
export interface VoiceSettingsInput {
  /** Read-aloud service. Kept as `provider` for compatibility with existing voice-settings.json files. */
  provider: VoiceSynthesisProvider
  /** Speech-to-text service. Optional on input so older callers stay valid; persisted as 'windows' by default. */
  asrProvider?: VoiceRecognitionProvider
  voiceId: string
  apiKey?: string
  monthlyCreditLimit: number
  replyCharacterLimit: number
  deepseekKey?: string
  deepseekVoice?: 'stella' | 'tide'
  minimaxKey?: string
  minimaxBaseUrl?: string
  minimaxVoiceId?: string
  minimaxModel?: string
}
export interface VoiceSettings extends Omit<VoiceSettingsInput, 'apiKey' | 'deepseekKey' | 'minimaxKey'> {
  asrProvider: VoiceRecognitionProvider
  hasCredential: boolean
  hasDeepSeekCredential: boolean
  hasMiniMaxCredential: boolean
  month: string
  estimatedCredits: number
}
export interface VoiceAudio { audio: string; provider?: VoiceSynthesisProvider; cached?: boolean }

export const VOICE_PROVIDER_NAME: Record<VoiceSynthesisProvider, string> = {
  windows: 'Windows 本地声音', breezeblue: 'BreezeBlue', deepseek: 'DeepSeek', minimax: 'MiniMax',
}

/** Estimate the provider's standard TTS character weighting; the provider remains authoritative. */
export function voiceCredits(text: string): number {
  let weighted = 0
  for (const character of text) weighted += /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(character) ? 2 : 1
  return weighted / 10
}

/** Limit the conversation sent to a voice turn, not the provider's global output budget. */
export function voiceMessages(value: unknown): VoiceMessage[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 24) throw new Error('语音会话内容无效。')
  const messages = value.map((item): VoiceMessage => {
    if (!item || !['user', 'assistant'].includes(item.role) || typeof item.content !== 'string' || !item.content.trim() || item.content.length > 6000) throw new Error('语音会话内容无效。')
    return { role: item.role, content: item.content.trim() }
  })
  if (messages.at(-1)?.role !== 'user' || messages.reduce((total, item) => total + item.content.length, 0) > 36000) throw new Error('语音会话过长，请开启新对话。')
  return messages
}
