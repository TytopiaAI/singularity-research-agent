import { useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { VoiceOrb, type VoicePhase } from '../../src/renderer/VoiceOrb'
import '../../src/renderer/styles.css'
import '../../src/renderer/workspace.css'
import '../../src/renderer/acrylic.css'
import '../../src/renderer/voice.css'
import '../../src/renderer/design.css'

declare global { interface Window { voicePreview: { level: number; phase: (phase: VoicePhase) => void; unmount: () => void } } }
window.voicePreview = { level: 0, phase: () => {}, unmount: () => {} }
const labels: Record<VoicePhase, string> = { idle: '随时，聊一聊', recognizing: '正在识别语音', listening: '我在听', speaking: '正在说话', thinking: '正在思考', preparing: '准备朗读', starting: '正在开启语音', error: '语音已暂停' }
function Preview() {
  const [phase, setPhase] = useState<VoicePhase>('idle')
  window.voicePreview.phase = setPhase
  const meter = useRef({ fftSize: 1024, frequencyBinCount: 512,
    getByteTimeDomainData(samples: Uint8Array) { for (let i = 0; i < samples.length; i++) samples[i] = 128 + Math.sin(i * .11) * 55 * window.voicePreview.level },
    getByteFrequencyData(samples: Uint8Array) { for (let i = 0; i < samples.length; i++) samples[i] = 210 * window.voicePreview.level * Math.exp(-i / 100) },
  } as AnalyserNode)
  return <div className="app-shell sidebar-open"><aside className="app-sidebar"/><header className="titlebar"/><main className="main-content" data-chat-theme="warm"><section className="voice-workspace">
    <header className="voice-heading"><div><span className="eyebrow">SINGULARITY VOICE</span><h1>语音对话</h1></div><button>对话记录</button></header>
    <div className="voice-stage"><VoiceOrb phase={phase} analyser={meter} inputAnalyser={meter}/>
      <div className="voice-status"><span className={'voice-indicator' + (phase === 'idle' ? '' : ' on')}/>{labels[phase]}</div>
      <p className="voice-hint">{phase === 'listening' ? '直接说话，停顿后自动发送' : phase === 'speaking' ? '可以随时打断，接着说你的想法' : '从一个问题，或一句问候开始'}</p>
      <div className="voice-caption">{phase === 'speaking' && <><span>Singularity</span><p>我们可以先从相关论文出发，再一起梳理研究思路。</p></>}</div>
      <div className="voice-controls"><button className="primary voice-start">{phase === 'idle' ? '开启语音对话' : '结束对话'}</button></div>
      <div className="voice-input"><input placeholder="也可以输入一句话…"/><button>↵</button></div>
      <p className="voice-privacy">离线动效预览 · 模拟音量，未调用麦克风或模型</p>
    </div>
  </section></main></div>
}
const root = createRoot(document.getElementById('root')!)
window.voicePreview.unmount = () => root.unmount()
root.render(<Preview/>)
