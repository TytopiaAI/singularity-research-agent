import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { AudioLines, BookOpen, CornerDownLeft, FolderKanban, Ghost, Info, Layers, Mic, MicOff, Orbit, Settings, Square, Volume2, X } from 'lucide-react'
import type { VoiceCapabilities, VoiceMessage, VoiceSettings } from '../shared/voice'
import { VOICE_PROVIDER_NAME } from '../shared/voice'
import type { VoiceCitation, ResearchProject } from '../shared/knowledge'
import type { PaperRecord } from '../shared/types'
import { VoiceOrb, type VoicePhase } from './VoiceOrb'
import { VoicePet } from './VoicePet'
import { VoiceSelect } from './VoiceSelect'
import { useVoiceCapture } from './useVoiceCapture'
import { VoiceSettingsDialog } from './VoiceSettingsDialog'
import { VoicePlayback } from './voice-playback'
import './voice.css'
import './knowledge.css'
import './voice-minimal.css'

const labels: Record<VoicePhase, string> = { idle: '随时，聊一聊', starting: '正在开启语音', listening: '我在听', recognizing: '正在识别语音', thinking: '正在思考', preparing: '准备朗读', speaking: '正在说话', error: '语音已暂停' }

export function VoiceWorkspace({ currentPaperId, currentProjectId, initialMode, onOpenSource }: { currentPaperId?: string | null; currentProjectId?: string | null; initialMode?: 'paper' | 'project'; onOpenSource?: (paperId: string, sourceId: string) => void }): ReactNode {
  const [phase, setPhase] = useState<VoicePhase>('idle')
  const [visualizer, setVisualizer] = useState<'orb' | 'pet'>(() => {
    try { return localStorage.getItem('singularity.voice.visualizer') === 'pet' ? 'pet' : 'orb' } catch { return 'orb' }
  })
  const [capabilities, setCapabilities] = useState<VoiceCapabilities | null>(null)
  const [voiceSettings, setVoiceSettings] = useState<VoiceSettings | null>(null), [settingsOpen, setSettingsOpen] = useState(false)
  const [error, setError] = useState('')
  const [messages, setMessages] = useState<VoiceMessage[]>([])
  const [draft, setDraft] = useState('')
  const [transcriptOpen, setTranscriptOpen] = useState(false)
  const [hint, setHint] = useState('')
  const [savedTurns, setSavedTurns] = useState<number[]>([]), [savingTurn, setSavingTurn] = useState<number | null>(null)
  const history = useRef<VoiceMessage[]>([])
  const generation = useRef(0)
  const session = useRef<string | null>(null)
  const audioContext = useRef<AudioContext | null>(null)
  const [playback] = useState(() => new VoicePlayback())
  const [speakers, setSpeakers] = useState<MediaDeviceInfo[]>([])
  const [speakerId, setSpeakerId] = useState(() => localStorage.getItem('singularity.voice.speaker') || '')
  const [testingSound, setTestingSound] = useState(false)
  const inputMeter = useVoiceCapture()
  const [microphones, setMicrophones] = useState<MediaDeviceInfo[]>([])
  const [microphoneId, setMicrophoneId] = useState(() => localStorage.getItem('singularity.voice.microphone') || '')
  useEffect(() => {
    const devices = navigator.mediaDevices
    if (!devices?.enumerateDevices) return
    const refresh = () => { void devices.enumerateDevices().then(items => { if (mounted.current) { setMicrophones(items.filter(item => item.kind === 'audioinput' && item.deviceId !== 'default')); setSpeakers(items.filter(item => item.kind === 'audiooutput' && item.deviceId !== 'default')) } }).catch(() => {}) }
    refresh(); devices.addEventListener?.('devicechange', refresh)
    return () => devices.removeEventListener?.('devicechange', refresh)
  }, [phase === 'listening'])
  const transcriptEnd = useRef<HTMLDivElement>(null)
  const mounted = useRef(true)
  const [papers, setPapers] = useState<PaperRecord[]>([]), [projects, setProjects] = useState<ResearchProject[]>([])
  const [mode, setMode] = useState<'none' | 'paper' | 'project'>(initialMode ?? (currentPaperId ? 'paper' : currentProjectId ? 'project' : 'none'))
  const [paperId, setPaperId] = useState(currentPaperId ?? ''), [projectId, setProjectId] = useState(currentProjectId ?? '')
  const [citations, setCitations] = useState<VoiceCitation[]>([])
  const [turnSources, setTurnSources] = useState<Record<number, VoiceCitation[]>>({})
  useEffect(() => { let live = true; void Promise.all([window.singularity.papers.list(), window.singularity.knowledge.projects()]).then(([library, research]) => { if (live) { setPapers(library); setProjects(research) } }).catch((e) => { if (live) setError(String(e)) }); return () => { live = false } }, [])
  useEffect(() => { history.current = []; setMessages([]); setCitations([]); setTurnSources({}); setSavedTurns([]) }, [mode, paperId, projectId])
  const saveDiscussion = async (index: number) => {
    setSavingTurn(index)
    try {
      const question = messages[index - 1]?.content ?? ''
      await window.singularity.knowledge.saveEntry({ projectId, kind: 'discussion', title: question.slice(0, 100) || '项目讨论', description: `研究问题：${question.slice(0, 3000)}\n讨论建议（待验证）：${messages[index].content.slice(0, 8500)}`, sourceIds: (turnSources[index] ?? []).map(c => c.sourceId), origin: 'voice' })
      setSavedTurns(previous => [...previous, index]); setHint('已保存到研究项目的讨论记录，可以继续迭代方法。')
    } catch (e) { setError(String(e)) } finally { setSavingTurn(null) }
  }

  const stop = (): void => {
    inputMeter.stop()
    generation.current++
    const id = session.current
    session.current = null
    if (id) void window.singularity.voice.stop(id).catch(() => {})
    playback.stop()
    const context = audioContext.current
    audioContext.current = null
    if (context) void context.close().catch(() => {})
    if (mounted.current) setTestingSound(false)
  }

  useEffect(() => {
    mounted.current = true
    void window.singularity.voice.settings().then(value => { if (mounted.current) setVoiceSettings(value) }).catch(() => {})
    void window.singularity.voice.capabilities().then((result) => {
      if (mounted.current) setCapabilities(result)
    }).catch((reason) => { if (mounted.current) setError(String(reason.message || reason)) })
    // End the conversation when the window is minimized or hidden to the tray. Windows also
    // reports a page "hidden" when another window merely covers it, which must not cut a reply short.
    const unsubscribe = window.singularity.windowControls.onConcealed(() => { stop(); setPhase('idle') })
    return () => { mounted.current = false; stop(); unsubscribe() }
  }, [])

  useEffect(() => { transcriptEnd.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) }, [messages, transcriptOpen])

  const append = (message: VoiceMessage): void => {
    history.current = [...history.current, message].slice(-24)
    setMessages(history.current)
  }

  const testSound = async (): Promise<void> => {
    stop(); setPhase('idle'); setError(''); setHint('正在播放本地测试音，不调用云端语音。'); setTestingSound(true)
    const token = generation.current
    try {
      await playback.test(speakerId, window.singularity.voice.play ? async wave => {
        const id = await window.singularity.voice.start()
        if (!mounted.current || token !== generation.current) { await window.singularity.voice.stop(id); return }
        session.current = id
        try { await window.singularity.voice.play(id, wave) }
        finally { if (session.current === id) session.current = null; await window.singularity.voice.stop(id) }
      } : undefined)
      if (mounted.current && token === generation.current) setHint('测试音已播放。如果仍听不到，请检查所选扬声器，以及 Windows 音量合成器中 Singularity 是否被静音。')
    } catch (reason) { if (mounted.current && token === generation.current) setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { if (token === generation.current) { playback.stop(); if (mounted.current) setTestingSound(false) } }
  }

  const begin = async (typed?: string): Promise<void> => {
    stop()
    const token = generation.current
    const live = (): boolean => mounted.current && token === generation.current
    setError(''); setHint(''); setPhase('starting')
    try {
      // Resume from the user's click, before any async network/native operation.
      try { await playback.prepare(speakerId, Boolean(window.singularity.voice.play)) } catch (error) { if (!typed) throw error }
      if (!typed) {
        const context = new AudioContext({ sampleRate: 16000 })
        audioContext.current = context
        await context.resume()
      }
      if (!live()) return
      const id = await window.singularity.voice.start()
      if (!live()) { void window.singularity.voice.stop(id); return }
      session.current = id
      let nextText = typed || ''
      while (live()) {
        if (!nextText) {
          if (!capabilities?.recognition) throw new Error((voiceSettings?.asrProvider ?? 'windows') === 'windows'
            ? '未检测到 Windows 中文语音识别组件。可先使用下方文字输入，或在 Windows 语言设置中安装中文语音。'
            : '云端语音识别尚未配置完成，请在语音设置中检查 API Key。')
          setPhase('listening')
          const audio = await inputMeter.record(audioContext.current!, microphoneId)
          if (!live()) return
          setPhase('recognizing')
          const result = await window.singularity.voice.listen(id, audio)
          if (!live()) return
          if (!result.text.trim()) throw new Error((voiceSettings?.asrProvider ?? 'windows') === 'windows'
            ? '已录到声音，但本机中文识别没有识别出文字。请确认麦克风输入清晰、靠近麦克风说一句普通话，或切换输入设备重试。'
            : '已录到声音，但云端识别没有返回文字。请检查麦克风输入与云端服务配置后重试。')
          nextText = result.text
        }
        setHint('')
        append({ role: 'user', content: nextText })
        nextText = ''
        setPhase('thinking')
        // Keep whole recent turns within a bounded context.
        let contextMessages = history.current.slice(-15)
        while (contextMessages.reduce((sum, item) => sum + item.content.length, 0) > 30000) contextMessages = contextMessages.slice(1)
        const scoped = mode !== 'none'
        const result = scoped ? await window.singularity.knowledge.contextReply(id, contextMessages, mode === 'paper' ? { paperId } : { projectId }) : { text: await window.singularity.voice.reply(id, contextMessages), citations: [] }
        if (!live()) return
        const answer = result.text
        append({ role: 'assistant', content: answer })
        setCitations(result.citations)
        setTurnSources((items) => ({ ...items, [history.current.length - 1]: result.citations }))
        if (!capabilities?.synthesis || !playback.ready) { stop(); setPhase('idle'); setHint('回答已显示；朗读暂不可用，可点击“测试声音”检查音频输出。'); return }
        setPhase('preparing')
        // Recover after a long model response or device change, before billing TTS.
        await playback.prepare(speakerId, Boolean(window.singularity.voice.play))
        if (!live()) return
        const speech = await window.singularity.voice.speak(id, answer)
        if (!live()) return
        if (speech.cached) setHint('正在播放本地缓存，本次未生成新的云端音频。')
        void window.singularity.voice.settings().then(value => { if (mounted.current) setVoiceSettings(value) }).catch(() => {})
        await playback.play(speech.audio, () => { if (live()) setPhase('speaking') }, window.singularity.voice.play ? wave => window.singularity.voice.play(id, wave) : undefined, () => { if (live()) setHint('兼容播放 · 使用系统默认扬声器') })
        if (!live()) return
        if (typed) { stop(); setPhase('idle'); return }
      }
    } catch (reason) {
      if (!live()) return
      stop()
      setError(reason instanceof Error ? reason.message : String(reason))
      setPhase('error')
      void window.singularity.voice.settings().then(value => { if (mounted.current) setVoiceSettings(value) }).catch(() => {})
    }
  }

  const active = phase !== 'idle' && phase !== 'error'
  const last = messages.at(-1)
  const asrName = voiceSettings?.asrProvider && voiceSettings.asrProvider !== 'windows' ? VOICE_PROVIDER_NAME[voiceSettings.asrProvider] : null
  const ttsName = voiceSettings?.provider && voiceSettings.provider !== 'windows' ? VOICE_PROVIDER_NAME[voiceSettings.provider] : null
  const privacy = `${asrName ? `录音发送至 ${asrName} 识别` : '录音在本机识别'}；${ttsName ? `朗读文字发送至 ${ttsName}` : '朗读由本机合成'}；${mode==='none'?'对话文字':'对话及检索到的论文节选'}发送至当前模型；离开页面自动结束。${voiceSettings?.provider==='breezeblue'?`\n本月预估 ${voiceSettings.estimatedCredits.toFixed(1)} / ${voiceSettings.monthlyCreditLimit} credits，约 $${(voiceSettings.estimatedCredits*.0003).toFixed(3)}`:''}`
  return <section className="voice-workspace voice-minimal">
    <header className="voice-heading"><div className="voice-heading-mark" title="语音对话"><AudioLines size={23}/><h1 className="voice-sr-only">语音对话</h1></div>
      <div className="voice-heading-actions"><VoiceIconButton label="语音设置" onClick={() => { stop(); setPhase('idle'); setSettingsOpen(true) }}><Settings size={19}/></VoiceIconButton><VoiceIconButton label="对话记录" className={transcriptOpen?'active':''} onClick={() => setTranscriptOpen(!transcriptOpen)} aria-expanded={transcriptOpen}><AudioLines size={19}/></VoiceIconButton></div>
    </header>
    <div className="voice-toolbar">
    <div className="voice-context-controls">
      <VoiceSelect label="语音讨论范围" icon={<Layers size={18}/>} value={mode} disabled={active} onChange={setMode}
        options={[{ value: 'none', label: '自由对话' }, { value: 'paper', label: '当前论文' }, { value: 'project', label: '研究项目' }]} />
      {mode === 'paper' && <VoiceSelect label="语音论文上下文" icon={<BookOpen size={18}/>} value={paperId} disabled={active} onChange={setPaperId}
        options={[{ value: '', label: '选择论文…' }, ...papers.filter((item) => !item.missing).map((paper) => ({ value: paper.id, label: paper.title }))]} />}
      {mode === 'project' && <VoiceSelect label="语音项目上下文" icon={<FolderKanban size={18}/>} value={projectId} disabled={active} onChange={setProjectId}
        options={[{ value: '', label: '选择研究项目…' }, ...projects.map((project) => ({ value: project.id, label: project.title }))]} />}
    </div>
    <div className="voice-device-controls">
      <div className="voice-microphone-control"><VoiceSelect label="麦克风输入设备" icon={<Mic size={18}/>} value={microphoneId} disabled={active} onChange={value => { setMicrophoneId(value); localStorage.setItem('singularity.voice.microphone', value) }} options={[{value:'',label:'系统默认麦克风'}, ...microphones.map((device,index) => ({value:device.deviceId,label:device.label || `麦克风 ${index+1}`}))]}/></div>
      <div className="voice-output-control"><VoiceSelect label="声音输出设备" icon={<Volume2 size={18}/>} value={speakerId} disabled={active || testingSound} onChange={value => { setSpeakerId(value); localStorage.setItem('singularity.voice.speaker', value) }} options={[{value:'',label:'系统默认扬声器'}, ...speakers.map((device,index) => ({value:device.deviceId,label:device.label || `扬声器 ${index+1}`}))]}/><VoiceIconButton label={testingSound?'正在测试…':'测试声音'} disabled={active||testingSound} onClick={()=>void testSound()} aria-busy={testingSound}><AudioLines size={18}/></VoiceIconButton></div>
    </div>
    </div>
    <div className="voice-stage">
      {visualizer === 'pet'
        ? <VoicePet phase={phase} analyser={playback.analyser} inputAnalyser={inputMeter.analyser} envelope={playback.envelope} reply={last?.role === 'assistant' ? last.content : ''}/>
        : <VoiceOrb phase={phase} analyser={playback.analyser} inputAnalyser={inputMeter.analyser} />}
      {phase!=='idle'&&<div className="voice-status" role="status"><span className={`voice-indicator ${active ? 'on' : ''}`} />{labels[phase]}</div>}
      {hint&&<p className="voice-hint">{hint}</p>}
      {phase === 'listening' && <div className="voice-input-level" title={inputMeter.progress?.device||'正在打开麦克风'}><meter min={0} max={1} value={inputMeter.progress?.level || 0} aria-label="麦克风输入音量"/><span>{Math.floor(inputMeter.progress?.seconds || 0)}s</span></div>}
      {last&&<div className="voice-caption" aria-live="polite"><span>{last.role === 'user' ? '你' : 'Singularity'}</span><p>{last.content}</p></div>}
      {!!citations.length && <div className="voice-source-list" aria-label="语音回答原文依据">{citations.map((citation) => <button key={citation.sourceId} title={citation.text} onClick={() => onOpenSource?.(citation.paperId, citation.sourceId)}>{citation.label} · p.{citation.page}</button>)}</div>}
      {error && <div className="voice-error" role="alert">{error}</div>}
      <div className="voice-controls">
        {active ? <>
          <VoiceIconButton label="结束对话" onClick={() => { stop(); setPhase('idle'); setHint('') }}><Square size={17}/></VoiceIconButton>
          {phase !== 'listening' && <VoiceIconButton label="打断并说话" className="primary voice-start" onClick={() => void begin()}><Mic size={23}/></VoiceIconButton>}
          {phase === 'listening' && <VoiceIconButton label="说完了" className="primary voice-start" onClick={inputMeter.finish}><CornerDownLeft size={23}/></VoiceIconButton>}
          {phase === 'listening' && <VoiceIconButton label="关闭麦克风" onClick={() => { stop(); setPhase('idle'); setHint('麦克风已关闭，点击开启继续对话。') }}><MicOff size={18}/></VoiceIconButton>}
        </> : <VoiceIconButton label="开启语音对话" className="primary voice-start" disabled={!capabilities || mode === 'paper' && !paperId || mode === 'project' && !projectId} onClick={() => void begin()}><Mic size={23}/></VoiceIconButton>}
      </div>
      <form className="voice-input" onSubmit={(event) => { event.preventDefault(); if (draft.trim() && (mode === 'none' || mode === 'paper' && paperId || mode === 'project' && projectId)) { const text = draft.trim(); setDraft(''); void begin(text) } }}>
        <input aria-label="文字输入" placeholder="输入消息…" value={draft} maxLength={4000} onChange={(event) => setDraft(event.target.value)} />
        <button aria-label="发送并朗读" title="发送并朗读" disabled={!draft.trim() || mode === 'paper' && !paperId || mode === 'project' && !projectId}><CornerDownLeft size={18} /></button>
      </form>
    </div>
    {transcriptOpen && <aside className="voice-transcript" aria-label="对话记录"><header><strong>本次对话</strong><button disabled={active || !messages.length || savingTurn !== null} onClick={() => { history.current = []; setMessages([]); setCitations([]); setTurnSources({}); setSavedTurns([]) }}>清空</button><button aria-label="收起对话记录" onClick={() => setTranscriptOpen(false)}><X size={17} /></button></header><div className="voice-transcript-scroll">{messages.length ? messages.map((message, index) => <div key={index} className={`voice-message ${message.role}`}><small>{message.role === 'user' ? '你' : 'Singularity'}</small><p>{message.content}</p>{turnSources[index]?.map((citation) => <button key={citation.sourceId} onClick={() => onOpenSource?.(citation.paperId, citation.sourceId)}>{citation.label} · p.{citation.page}</button>)}{message.role === 'assistant' && mode === 'project' && projectId && <button disabled={savingTurn !== null || savedTurns.includes(index)} onClick={() => void saveDiscussion(index)}>{savedTurns.includes(index) ? '已保存到项目' : savingTurn === index ? '保存中…' : '保存为项目讨论'}</button>}</div>) : <p className="voice-hint">开始后，对话会显示在这里。</p>}<div ref={transcriptEnd} /></div></aside>}
    <div className="voice-minimal-footer"><button className="voice-icon voice-info" type="button" aria-label={privacy} title={privacy} data-tooltip={privacy}><Info size={17}/></button><button type="button" className="voice-icon voice-appearance" aria-label="切换语音形象" aria-pressed={visualizer==='pet'} data-visualizer={visualizer} onClick={()=>{
      const value=visualizer==='pet'?'orb':'pet'
      setVisualizer(value)
      try { localStorage.setItem('singularity.voice.visualizer', value) } catch { /* The selection still works for this visit. */ }
    }}>{visualizer==='pet'?<Ghost size={20}/>:<Orbit size={20}/>}</button></div>
    {settingsOpen && <VoiceSettingsDialog
      onClose={() => setSettingsOpen(false)}
      onSaved={value => { setVoiceSettings(value); void window.singularity.voice.capabilities().then(value => { if (mounted.current) setCapabilities(value) }).catch(() => {}) }}
    />}
  </section>
}

function VoiceIconButton({label,className='',...props}:{label:string}&ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" {...props} className={`voice-icon ${className}`} aria-label={label} title={label} data-tooltip={label}/>
}
