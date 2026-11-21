import { useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { VoiceWorkspace } from '../../src/renderer/VoiceWorkspace'
import { VoicePet } from '../../src/renderer/VoicePet'
import type { VoicePhase } from '../../src/renderer/VoiceOrb'
import type { PlaybackEnvelope } from '../../src/renderer/voice-playback'
import '../../src/renderer/styles.css'
import '../../src/renderer/workspace.css'
import '../../src/renderer/acrylic.css'
import '../../src/renderer/design.css'

const preview = { level:0, stops:0, replies:0, phase:(_phase:VoicePhase)=>{}, resolve:(_text:string)=>{}, unmount:()=>{}, specimen:()=>{}, native:(_on:boolean)=>{} }
// Text-flow test deliberately has no audio device; waveform checks below use controlled meters.
Object.defineProperty(window,'AudioContext',{value:class { constructor(){throw new Error('Isolated visual test: no audio device')} }})
Object.assign(window, { petPreview:preview, singularity:{
  voice:{settings:async()=>({provider:'windows'}),capabilities:async()=>({recognition:false,synthesis:false}),start:async()=>'preview',stop:async()=>{preview.stops++},reply:async()=>{preview.replies++;return new Promise<string>(resolve=>{preview.resolve=resolve})}},
  papers:{list:async()=>[]},knowledge:{projects:async()=>[]},windowControls:{onConcealed:()=>()=>{}},
}})
function Shell({children}:{children:React.ReactNode}) { return <div className="app-shell sidebar-open"><aside className="app-sidebar"/><header className="titlebar"/><main className="main-content" data-chat-theme="warm">{children}</main></div> }
function Specimen() {
  const [phase,setPhase]=useState<VoicePhase>('idle')
  preview.phase=setPhase
  const meter=useRef<AnalyserNode|null>({fftSize:1024,getByteTimeDomainData(samples:Uint8Array){for(let i=0;i<samples.length;i++)samples[i]=128+Math.sin(i*.11)*50*preview.level}} as AnalyserNode)
  const envelope=useRef<PlaybackEnvelope|null>(null)
  preview.native=on=>{meter.current=on?null:({fftSize:1024,getByteTimeDomainData(samples:Uint8Array){for(let i=0;i<samples.length;i++)samples[i]=128+Math.sin(i*.11)*50*preview.level}} as AnalyserNode);envelope.current=on?{levels:new Float32Array(400).fill(.8),startedAt:performance.now(),rate:40}:null}
  return <Shell><section className="voice-workspace"><header className="voice-heading"><div><span className="eyebrow">SINGULARITY VOICE</span><h1>语音对话</h1></div></header><div className="voice-stage"><VoicePet phase={phase} analyser={meter} inputAnalyser={meter} envelope={envelope} reply="可以尝试一个新的思路。"/><div className="voice-status">{phase==='thinking'?'正在思考':phase==='speaking'?'正在说话':phase==='listening'?'我在听':'随时，聊一聊'}</div><p className="voice-hint">点点红团子，和它打个招呼</p><div className="voice-input"><input placeholder="也可以输入一句话…"/><button>↵</button></div></div></section></Shell>
}
const root=createRoot(document.getElementById('root')!)
root.render(<Shell><VoiceWorkspace/></Shell>)
preview.specimen=()=>root.render(<Specimen/>)
preview.unmount=()=>root.unmount()
