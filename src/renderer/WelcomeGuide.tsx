import { useState, type ReactElement } from 'react'
import type { ProviderConfigInput } from '../shared/types'
import type { VoiceSettingsInput } from '../shared/voice'
import './welcome-guide.css'

const steps = ['welcome', 'model', 'voice', 'done'] as const
type Step = (typeof steps)[number]
type VoiceChoice = 'windows' | 'deepseek' | 'minimax'

export function WelcomeGuide({ onClose, saveModel, saveVoice }: {
  onClose: () => void
  saveModel: (input: ProviderConfigInput) => Promise<void>
  saveVoice: (input: VoiceSettingsInput) => Promise<void>
}): ReactElement {
  const [step, setStep] = useState<Step>('welcome')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [model, setModel] = useState<ProviderConfigInput>({ kind: 'deepseek', displayName: 'DeepSeek', baseUrl: 'https://api.deepseek.com', modelId: 'deepseek-chat', maxOutputTokens: 8192, apiKey: '' })
  const [voiceChoice, setVoiceChoice] = useState<VoiceChoice>('windows')
  const [deepseekKey, setDeepseekKey] = useState('')
  const [minimaxKey, setMinimaxKey] = useState('')
  const index = steps.indexOf(step)

  const finish = () => { onClose() }
  const next = () => { setMessage(''); setStep(steps[index + 1] ?? 'done') }

  const saveModelStep = async () => {
    if (!model.apiKey?.trim()) { next(); return }
    setBusy(true); setMessage('')
    try { await saveModel({ ...model, apiKey: model.apiKey.trim() }); next() }
    catch (error) { setMessage(error instanceof Error ? error.message : '模型配置没有保存。') }
    finally { setBusy(false) }
  }

  const saveVoiceStep = async () => {
    if (voiceChoice === 'windows') { next(); return }
    const key = voiceChoice === 'deepseek' ? deepseekKey.trim() : minimaxKey.trim()
    if (!key) { setMessage(voiceChoice === 'deepseek' ? '请填写 DeepSeek API Key，或改回 Windows 本地语音。' : '请填写 MiniMax API Key，或改回 Windows 本地语音。'); return }
    setBusy(true); setMessage('')
    try {
      await saveVoice(voiceChoice === 'deepseek'
        ? { provider: 'deepseek', asrProvider: 'deepseek', voiceId: '', monthlyCreditLimit: 10000, replyCharacterLimit: 1000, deepseekKey: key, deepseekVoice: 'stella' }
        : { provider: 'minimax', asrProvider: 'minimax', voiceId: '', monthlyCreditLimit: 10000, replyCharacterLimit: 1000, minimaxKey: key, minimaxBaseUrl: 'https://api.minimax.cn', minimaxVoiceId: 'Chinese (Mandarin)_Lyrical_Voice', minimaxModel: 'speech-2.8-turbo' })
      next()
    } catch (error) { setMessage(error instanceof Error ? error.message : '语音配置没有保存。') }
    finally { setBusy(false) }
  }

  return <div className="welcome-guide" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
    <div className="welcome-card">
      <p className="welcome-progress" aria-hidden="true">{index + 1} / {steps.length}</p>
      {step === 'welcome' && <>
        <Celebration />
        <h1 id="welcome-title">欢迎来到 Singularity</h1>
        <p>这是一个放在你自己电脑上的科研助手。论文、计划和对话都留在本地，模型只在你配置密钥之后才会被调用。</p>
        <div className="welcome-actions"><button className="primary" type="button" onClick={next}>下一步</button></div>
      </>}
      {step === 'model' && <>
        <h1 id="welcome-title">配置对话模型</h1>
        <p>填入模型 API Key 之后，就可以使用首页对话、科研发现、论文阅读和写作里的模型能力。密钥会用 Windows 加密保存在本机，不会写进代码仓库。现在跳过的话，之后仍可以在设置里补上。</p>
        <div className="welcome-form">
          <label>服务商<select aria-label="模型服务商" value={model.kind} onChange={event => {
            const kind = event.target.value as ProviderConfigInput['kind']
            setModel({ ...model, kind, baseUrl: kind === 'deepseek' ? 'https://api.deepseek.com' : model.baseUrl, modelId: kind === 'deepseek' ? 'deepseek-chat' : model.modelId })
          }}><option value="deepseek">DeepSeek 官方</option><option value="openai-compatible">OpenAI 兼容接口</option></select></label>
          <label>接口地址<input aria-label="模型接口地址" value={model.baseUrl} onChange={event => setModel({ ...model, baseUrl: event.target.value })} /></label>
          <label>模型名称<input aria-label="模型名称" value={model.modelId} onChange={event => setModel({ ...model, modelId: event.target.value })} /></label>
          <label>API Key<input aria-label="模型 API Key" type="password" autoComplete="new-password" placeholder="sk-…" value={model.apiKey ?? ''} onChange={event => setModel({ ...model, apiKey: event.target.value })} /></label>
        </div>
        {message && <p className="welcome-message" role="alert">{message}</p>}
        <div className="welcome-actions"><button type="button" disabled={busy} onClick={next}>跳过</button><button className="primary" type="button" disabled={busy} onClick={() => void saveModelStep()}>{busy ? '正在保存…' : '保存并下一步'}</button></div>
      </>}
      {step === 'voice' && <>
        <h1 id="welcome-title">配置语音</h1>
        <p>语音对话默认使用 Windows 自带的识别和朗读，不需要额外的 Key。想换成云端语音时，DeepSeek 负责识别和朗读，MiniMax 也可以。云端语音会按各家的价格计费，只有你开启语音对话时才会调用。</p>
        <div className="welcome-form">
          <label>语音服务<select aria-label="语音服务" value={voiceChoice} onChange={event => setVoiceChoice(event.target.value as VoiceChoice)}><option value="windows">Windows 本地，不需要 Key</option><option value="deepseek">DeepSeek 识别与朗读</option><option value="minimax">MiniMax 识别与朗读</option></select></label>
          {voiceChoice === 'deepseek' && <label>DeepSeek API Key<input aria-label="DeepSeek 语音 API Key" type="password" autoComplete="new-password" placeholder="sk-…" value={deepseekKey} onChange={event => setDeepseekKey(event.target.value)} /></label>}
          {voiceChoice === 'minimax' && <label>MiniMax API Key<input aria-label="MiniMax API Key" type="password" autoComplete="new-password" placeholder="粘贴 API Key" value={minimaxKey} onChange={event => setMinimaxKey(event.target.value)} /></label>}
        </div>
        {message && <p className="welcome-message" role="alert">{message}</p>}
        <div className="welcome-actions"><button type="button" disabled={busy} onClick={next}>跳过</button><button className="primary" type="button" disabled={busy} onClick={() => void saveVoiceStep()}>{busy ? '正在保存…' : '保存并下一步'}</button></div>
      </>}
      {step === 'done' && <>
        <h1 id="welcome-title">可以开始了</h1>
        <p>首页可以对话，也能用 @ 引用你的领域和论文。论文库、科研发现、写作和计划都在左侧。模型或语音密钥以后可以在设置里修改。</p>
        <div className="welcome-actions"><button className="primary" type="button" onClick={finish}>进入 Singularity</button></div>
      </>}
    </div>
  </div>
}

function Celebration(): ReactElement {
  return <svg className="welcome-mark" viewBox="0 0 180 128" aria-hidden="true">
    <ellipse cx="90" cy="68" rx="54" ry="16" fill="none" stroke="#C9A15B" strokeWidth="4" transform="rotate(-18 90 68)" />
    <ellipse cx="90" cy="68" rx="54" ry="16" fill="none" stroke="#E8D5A8" strokeWidth="1.5" transform="rotate(-18 90 68)" />
    <circle cx="90" cy="64" r="26" fill="#F7E7C8" />
    <circle cx="90" cy="64" r="26" fill="none" stroke="#8A6A32" strokeWidth="2.4" />
    <path d="M78 52c8-6 24-4 28 8" fill="none" stroke="#D9B36A" strokeWidth="3" strokeLinecap="round" />
    <g fill="#C9A15B">
      <circle cx="36" cy="28" r="2.4" /><circle cx="148" cy="34" r="2" /><circle cx="44" cy="98" r="1.8" /><circle cx="142" cy="96" r="2.2" />
    </g>
    <g fill="none" stroke="#C9A15B" strokeWidth="1.8" strokeLinecap="round">
      <path d="M28 40l7 3M32 26l2 8" /><path d="M152 42l-7 4M148 26l-2 8" /><path d="M30 88l8-1M150 86l-8 2" />
    </g>
  </svg>
}
