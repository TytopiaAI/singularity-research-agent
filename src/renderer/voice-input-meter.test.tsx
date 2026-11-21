// @vitest-environment jsdom
import { act, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useVoiceInputMeter } from './useVoiceInputMeter'

let host: HTMLDivElement, root: Root, result: ReturnType<typeof useVoiceInputMeter>
const trackStop = vi.fn(), sourceDisconnect = vi.fn(), meterDisconnect = vi.fn(), connect = vi.fn()
const meter = { disconnect: meterDisconnect, fftSize: 0 } as unknown as AnalyserNode
const stream = { getTracks: () => [{ stop: trackStop }] } as unknown as MediaStream
const context = { state: 'running', createAnalyser: () => meter, createMediaStreamSource: () => ({ connect, disconnect: sourceDisconnect }) } as unknown as AudioContext
const getUserMedia = vi.fn()
function Fixture({ listening }: { listening: boolean }) { result = useVoiceInputMeter(listening, useRef(context)); return null }
beforeEach(() => {
  vi.clearAllMocks(); getUserMedia.mockReset()
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true })
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })
const render = (listening: boolean) => act(async () => root.render(<Fixture listening={listening}/>))

it('only captures while listening and never connects the microphone to speakers', async () => {
  getUserMedia.mockResolvedValue(stream)
  await render(false); expect(getUserMedia).not.toHaveBeenCalled()
  await render(true); expect(getUserMedia).toHaveBeenCalledWith({ audio: true, video: false })
  expect(result.analyser.current).toBe(meter); expect(connect).toHaveBeenCalledExactlyOnceWith(meter)
  await render(false)
  expect(trackStop).toHaveBeenCalled(); expect(sourceDisconnect).toHaveBeenCalled(); expect(meterDisconnect).toHaveBeenCalled()
  expect(result.analyser.current).toBe(null)
})
it('releases an input stream that arrives after the conversation has stopped', async () => {
  let resolve!: (value: MediaStream) => void
  getUserMedia.mockReturnValue(new Promise<MediaStream>(done => { resolve = done }))
  await render(true); await act(async () => result.stop())
  await act(async () => resolve(stream))
  expect(trackStop).toHaveBeenCalled(); expect(connect).not.toHaveBeenCalled(); expect(result.analyser.current).toBe(null)
})
it('releases the microphone immediately on stop and when leaving the page', async () => {
  getUserMedia.mockResolvedValue(stream); await render(true)
  await act(async () => result.stop()); expect(trackStop).toHaveBeenCalled(); expect(result.analyser.current).toBe(null)
  await render(false); await render(true); trackStop.mockClear()
  await act(async () => root.unmount()); root = createRoot(host)
  expect(trackStop).toHaveBeenCalled()
})
it('a denied microphone meter leaves native recognition usable without an unhandled rejection', async () => {
  getUserMedia.mockRejectedValue(new DOMException('Permission denied', 'NotAllowedError'))
  await render(true); expect(result.analyser.current).toBe(null); expect(connect).not.toHaveBeenCalled()
})
