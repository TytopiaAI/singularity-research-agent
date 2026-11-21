// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { useVoiceCapture } from './useVoiceCapture'

it.each([false, true])('trims long waiting time, normalizes quiet speech, and releases the same microphone (manual=%s)', async manual => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true })
  const stop = vi.fn(), connect = vi.fn(), disconnect = vi.fn()
  const processor = { connect, disconnect, onaudioprocess: null as ((e: unknown) => void) | null }
  const meter = { disconnect }, stream = { getTracks: () => [{ stop }], getAudioTracks: () => [{label:'Test microphone'}] }
  const getUserMedia = vi.fn().mockResolvedValue(stream)
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
  const context = { sampleRate: 16000, destination: {}, createMediaStreamSource: vi.fn(() => ({connect,disconnect})), createBiquadFilter: () => ({type:'',frequency:{value:0},connect,disconnect}), createAnalyser: () => meter, createScriptProcessor: () => processor, createGain: () => ({gain:{value:1},connect,disconnect}) } as unknown as AudioContext
  let capture!: ReturnType<typeof useVoiceCapture>
  function Fixture() { capture = useVoiceCapture(); return null }
  const root = createRoot(document.createElement('div'))
  try {
    await act(async () => root.render(<Fixture/>))
    let result!: Promise<string>
    await act(async () => { result = capture.record(context); await Promise.resolve() })
    expect(capture.analyser.current).toBe(meter)
    const frame = (value: number) => processor.onaudioprocess?.({ inputBuffer: { getChannelData: () => new Float32Array(2048).fill(value) } })
    await act(async () => {
      for (let i = 0; i < 80; i++) frame(0)
      for (let i = 0; i < 8; i++) frame(.003)
      if (manual) capture.finish()
      else for (let i = 0; i < 12; i++) frame(0)
    })
    const bytes = Buffer.from(await result, 'base64')
    expect(bytes.subarray(0,4).toString()).toBe('RIFF')
    expect(bytes.readUInt32LE(24)).toBe(16000)
    expect((bytes.length - 44) / 2 / 16000).toBeLessThan(3.5)
    const pcm = Array.from({length:(bytes.length-44)/2}, (_,i)=>bytes.readInt16LE(44+i*2))
    expect(Math.max(...pcm)).toBeGreaterThan(2000)
    expect(context.createMediaStreamSource).toHaveBeenCalledWith(stream)
    expect(stop).toHaveBeenCalledOnce(); expect(capture.analyser.current).toBeNull()
  } finally { await act(async () => root.unmount()); vi.unstubAllGlobals() }
})
