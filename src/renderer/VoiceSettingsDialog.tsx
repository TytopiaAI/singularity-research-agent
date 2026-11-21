import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import type { VoiceRecognitionProvider, VoiceSettings, VoiceSettingsInput, VoiceSynthesisProvider } from '../shared/voice'

export function VoiceSettingsDialog({ onClose, onSaved }: { onClose: () => void; onSaved: (settings: VoiceSettings) => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [settings, setSettings] = useState<VoiceSettings | null>(null), [form, setForm] = useState<VoiceSettingsInput | null>(null)
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('')
  useEffect(() => {
    dialog.current?.showModal()
    let live = true
    void window.singularity.voice.settings().then(value => {
      if (!live) return
      setSettings(value)
      setForm({
        provider: value.provider, asrProvider: value.asrProvider, voiceId: value.voiceId,
        monthlyCreditLimit: value.monthlyCreditLimit, replyCharacterLimit: value.replyCharacterLimit,
        deepseekVoice: value.deepseekVoice, minimaxBaseUrl: value.minimaxBaseUrl,
        minimaxVoiceId: value.minimaxVoiceId, minimaxModel: value.minimaxModel,
        apiKey: '', deepseekKey: '', minimaxKey: '',
      })
    }).catch(() => { if (live) setMessage('无法读取语音设置。') })
    return () => { live = false }
  }, [])
  const save = async (verify: boolean) => {
    if (!form || busy) return
    setBusy(true); setMessage('')
    try {
      const value = await window.singularity.voice.saveSettings(form)
      setSettings(value); setForm({ ...form, apiKey: '', deepseekKey: '', minimaxKey: '' }); onSaved(value)
      if (verify) setMessage((await window.singularity.voice.verifySettings()).message)
      else setMessage('已保存，下次语音对话使用此配置。')
    } catch (error) { setMessage(error instanceof Error ? error.message : '保存失败。') }
    finally { setBusy(false) }
  }
  const deepseekUsed = form?.provider === 'deepseek' || form?.asrProvider === 'deepseek'
  const minimaxUsed = form?.provider === 'minimax' || form?.asrProvider === 'minimax'
  const cloudTts = form != null && form.provider !== 'windows'
  return <dialog ref={dialog} className="voice-settings-dialog" aria-labelledby="voice-settings-title" onCancel={event => { event.preventDefault(); if (!busy) onClose() }}>
    <header><div><h2 id="voice-settings-title">语音设置</h2><p>选择语音识别与朗读服务，云端服务默认关闭</p></div><button aria-label="关闭语音设置" disabled={busy} onClick={onClose}><X size={18}/></button></header>
    {!form ? <p role="status">{message || '正在读取…'}</p> : <form onSubmit={event => { event.preventDefault(); void save(false) }}>
      <fieldset disabled={busy}>
        <label>语音识别（把你说的话转成文字）
          <select value={form.asrProvider ?? 'windows'} onChange={event => setForm({ ...form, asrProvider: event.target.value as VoiceRecognitionProvider })}>
            <option value="windows">Windows 本地识别 · 免费离线</option>
            <option value="deepseek">DeepSeek ASR · 21 语种自动识别</option>
            <option value="minimax">MiniMax ASR · asr-1.0</option>
          </select>
        </label>
        <label>朗读服务（把回答读出来）
          <select value={form.provider} onChange={event => setForm({ ...form, provider: event.target.value as VoiceSynthesisProvider })}>
            <option value="windows">Windows 本地声音 · 免费离线</option>
            <option value="breezeblue">BreezeBlue · 我的声音</option>
            <option value="deepseek">DeepSeek TTS · Stella / Tide</option>
            <option value="minimax">MiniMax TTS · Speech 2.8</option>
          </select>
        </label>

        <div className="voice-settings-group">
          <div className="voice-settings-group-title"><strong>DeepSeek ASR / TTS API</strong><span className={deepseekUsed ? 'voice-settings-badge on' : 'voice-settings-badge'}>{deepseekUsed ? '使用中' : '未启用'}</span></div>
          <label>API Key<input type="password" autoComplete="new-password" value={form.deepseekKey ?? ''} placeholder={settings?.hasDeepSeekCredential ? '已加密保存，留空沿用' : 'sk-…'} onChange={event => setForm({ ...form, deepseekKey: event.target.value })}/></label>
          <label>朗读音色<select value={form.deepseekVoice ?? 'stella'} onChange={event => setForm({ ...form, deepseekVoice: event.target.value as 'stella' | 'tide' })}><option value="stella">Stella · 女声</option><option value="tide">Tide · 男声</option></select></label>
          <p className="voice-settings-note">同一个 DeepSeek API Key 用于 /v1/tools/asr（识别）与 /v1/tools/tts（朗读），在上方把「语音识别」或「朗读服务」切到 DeepSeek 即启用；未启用时只保存 Key，不发起任何云端调用。识别一次上传整段录音（最长 120 秒、8 MiB），合成按计费字符收费、汉字算 2 个字符；接口会自动过滤 Markdown 再朗读。</p>
        </div>

        {minimaxUsed && <div className="voice-settings-group">
          <strong>MiniMax 语音 API</strong>
          <label>API Key<input type="password" autoComplete="new-password" value={form.minimaxKey ?? ''} placeholder={settings?.hasMiniMaxCredential ? '已加密保存，留空沿用' : '粘贴 API Key'} onChange={event => setForm({ ...form, minimaxKey: event.target.value })}/></label>
          <div className="voice-settings-grid">
            <label>服务区<select value={form.minimaxBaseUrl ?? 'https://api.minimax.cn'} onChange={event => setForm({ ...form, minimaxBaseUrl: event.target.value as 'https://api.minimax.cn' | 'https://api.minimax.io' })}><option value="https://api.minimax.cn">国内 · api.minimax.cn</option><option value="https://api.minimax.io">国际 · api.minimax.io</option></select></label>
            {form.provider === 'minimax' && <label>合成模型<select value={form.minimaxModel ?? 'speech-2.8-turbo'} onChange={event => setForm({ ...form, minimaxModel: event.target.value })}><option value="speech-2.8-turbo">speech-2.8-turbo · 低延迟</option><option value="speech-2.8-hd">speech-2.8-hd · 高音质</option><option value="speech-2.6-turbo">speech-2.6-turbo</option><option value="speech-2.6-hd">speech-2.6-hd</option></select></label>}
          </div>
          {form.provider === 'minimax' && <label>音色 ID<input autoComplete="off" value={form.minimaxVoiceId ?? ''} placeholder="Chinese (Mandarin)_Lyrical_Voice" onChange={event => setForm({ ...form, minimaxVoiceId: event.target.value })}/></label>}
          <p className="voice-settings-note">识别使用 asr-1.0，需要付费账户；朗读按字符计费。音色 ID 可在 MiniMax 官网的系统音色列表里更换。国内 Key 请用国内服务区。</p>
        </div>}

        {form.provider === 'breezeblue' && <>
          <label>Voice ID<input autoComplete="off" value={form.voiceId} placeholder="voc_…" onChange={event => setForm({ ...form, voiceId: event.target.value })}/></label>
          <label>API Key<input type="password" autoComplete="new-password" value={form.apiKey ?? ''} placeholder={settings?.hasCredential ? '已加密保存，留空沿用' : 'brz_…'} onChange={event => setForm({ ...form, apiKey: event.target.value })}/></label>
          <div className="voice-settings-grid"><label>每月上限（credits）<input type="number" min={0} max={1000000} step={1} value={form.monthlyCreditLimit} onChange={event => setForm({ ...form, monthlyCreditLimit: Number(event.target.value) })}/></label>
            <label>单次朗读上限（字符）<input type="number" min={50} max={1000} step={1} value={form.replyCharacterLimit} onChange={event => setForm({ ...form, replyCharacterLimit: Number(event.target.value) })}/></label></div>
          <div className="voice-settings-usage"><strong>{settings?.month} 本机预估用量</strong><span>{(settings?.estimatedCredits ?? 0).toFixed(1)} credits · 约 ${((settings?.estimatedCredits ?? 0) * .0003).toFixed(3)}</span></div>
          <p className="voice-settings-note">按 $30 / 百万加权字符估算，中文按 2 个字符计。相同声音与文字优先复用本地音频；达到上限后保留文字并停止云端朗读。中断请求可能已生成音频，用量估算会保守保留。</p>
          <p className="voice-settings-note">额度按本机自然月统计，实际扣费与免费额度以官网为准；建议同时在官网为专用 Key 设置硬上限。保存和连接检查均不生成语音。</p>
        </>}

        {cloudTts && form.provider !== 'breezeblue' && <label>单次朗读上限（字符）<input type="number" min={50} max={1000} step={1} value={form.replyCharacterLimit} onChange={event => setForm({ ...form, replyCharacterLimit: Number(event.target.value) })}/></label>}

        {(deepseekUsed || minimaxUsed) && <p className="voice-settings-note">云端服务只在你开启语音对话时才调用：录音上传给识别服务、回答文字上传给合成服务，费用按各家官网规则结算，本机不预估账单。两个服务都切回 Windows 即可完全离线、零费用。保存和连接检查都不会产生云端调用。</p>}
      </fieldset>
      {message && <p role="status" className="voice-settings-message">{message}</p>}
      <footer>{(form.provider === 'breezeblue' || deepseekUsed || minimaxUsed) && <button type="button" disabled={busy} onClick={() => void save(true)}>保存并检查连接</button>}<button type="submit" className="primary" disabled={busy}>{busy ? '处理中…' : '保存设置'}</button></footer>
    </form>}
  </dialog>
}
