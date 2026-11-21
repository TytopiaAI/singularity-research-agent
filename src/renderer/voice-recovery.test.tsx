// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { VoiceWorkspace } from './VoiceWorkspace'
vi.mock('./VoiceOrb', () => ({ VoiceOrb: () => null }))
const capture = vi.hoisted(() => ({ record: vi.fn(), stop: vi.fn(), analyser: { current: null }, finish: vi.fn(), progress: {heard:false,seconds:0,level:0,device:''} }))
vi.mock('./useVoiceCapture', () => ({ useVoiceCapture: () => capture }))

it.each([false, true])('text remains usable with audio unavailable or while recording: %s', async listening => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true })
  Element.prototype.scrollIntoView = vi.fn()
  vi.stubGlobal('AudioContext', class {
    state = 'running'
    constructor() { if (!listening) throw Error('Audio unavailable') }
    async resume() {} async close() {}
  })
  capture.record.mockImplementation(() => new Promise(() => {}))
  const reply = vi.fn().mockResolvedValue('文字回答成功'), stop = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(window, 'singularity', { configurable: true, value: {
    voice: { settings: vi.fn().mockResolvedValue({ provider: 'windows' }), capabilities: listening ? vi.fn().mockResolvedValue({ recognition: true, synthesis: false }) : vi.fn().mockRejectedValue(Error('Unavailable')), start: vi.fn().mockResolvedValue('session'), stop, reply },
    windowControls: { onConcealed: () => () => {} }, papers: { list: async () => [] }, knowledge: { projects: async () => [] },
  } })
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  try {
    await act(async () => root.render(<VoiceWorkspace/>))
    if (listening) await act(async () => host.querySelector<HTMLButtonElement>('.voice-start')!.click())
    await act(async () => {
      const input = host.querySelector<HTMLInputElement>('input[aria-label="文字输入"]')!
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '你好')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(host.querySelector<HTMLButtonElement>('[aria-label="发送并朗读"]')!.disabled).toBe(false)
    await act(async () => host.querySelector('.voice-input')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    expect(reply).toHaveBeenCalledWith('session', [{role:'user',content:'你好'}])
    expect(host.textContent).toContain('文字回答成功')
    if (listening) expect(stop).toHaveBeenCalledWith('session')
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() }
})

it('shows recognition as its own phase after manual microphone completion, before a model request', async () => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true })
  Element.prototype.scrollIntoView = vi.fn()
  vi.stubGlobal('AudioContext', class { state = 'running'; async resume() {} async close() {} })
  let finishRecording!: (wave: string) => void, finishRecognition!: (value: {text:string;confidence:number}) => void
  capture.record.mockImplementation(() => new Promise(resolve => { finishRecording = resolve }))
  capture.finish.mockImplementation(() => finishRecording('recorded-wave'))
  const listen = vi.fn(() => new Promise(resolve => { finishRecognition = resolve })), reply = vi.fn().mockResolvedValue('这是回答。')
  Object.defineProperty(window, 'singularity', { configurable:true, value: {
    voice: { settings:async()=>({provider:'windows'}), capabilities:async()=>({recognition:true,synthesis:false}), start:async()=>'session',stop:async()=>{},listen,reply },
    windowControls:{onConcealed:()=>()=>{}}, papers:{list:async()=>[]}, knowledge:{projects:async()=>[]},
  }})
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host)
  try {
    await act(async()=>root.render(<VoiceWorkspace/>))
    await act(async()=>host.querySelector<HTMLButtonElement>('.voice-start')!.click())
    await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="说完了"]')!.click())
    expect(listen).toHaveBeenCalledWith('session','recorded-wave')
    expect(host.querySelector('.voice-status')!.textContent).toContain('正在识别语音')
    expect(reply).not.toHaveBeenCalled()
    await act(async()=>finishRecognition({text:'讨论异常检测。',confidence:.5}))
    expect(reply).toHaveBeenCalledWith('session',[{role:'user',content:'讨论异常检测。'}])
    expect(host.textContent).toContain('这是回答。')
  } finally { await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals() }
})
