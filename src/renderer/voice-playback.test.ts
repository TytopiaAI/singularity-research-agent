import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { VoicePlayback } from './voice-playback'

const nodes: { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; onended: (() => void) | null }[] = []
let contexts: FakeContext[], silent = false
class FakeContext {
  state = 'running'; currentTime = 0; sampleRate = 48000; destination = {}
  resume = vi.fn(async () => { this.state = 'running' })
  close = vi.fn(async () => { this.state = 'closed' })
  setSinkId = vi.fn(async (_id: string) => {})
  decodeAudioData = vi.fn(async () => ({ numberOfChannels: 1, sampleRate: 48000, length: 48000, duration: 1, getChannelData: () => new Float32Array(silent ? [0, 0] : [.1, -.1]) }))
  constructor(readonly options?: unknown) { contexts.push(this) }
  createBufferSource() { const node = { buffer: null, connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null as (() => void) | null }; nodes.push(node); return node }
  createAnalyser() { return { fftSize: 0, connect: vi.fn(), disconnect: vi.fn() } }
}
let player: VoicePlayback
beforeEach(() => { contexts = []; nodes.length = 0; silent = false; vi.stubGlobal('AudioContext', FakeContext); player = new VoicePlayback() })
afterEach(() => { player.stop(); vi.unstubAllGlobals(); vi.useRealTimers() })
it('uses hardware-rate output and resumes again after the model/TTS wait before saying it is speaking', async () => {
  await player.prepare()
  expect(contexts[0].options).toEqual({ latencyHint: 'interactive' })
  contexts[0].state = 'suspended'
  const started = vi.fn(), playing = player.play('YQ==', started)
  await vi.waitFor(() => expect(started).toHaveBeenCalledOnce())
  expect(contexts[0].resume).toHaveBeenCalledOnce()
  expect(player.analyser.current).not.toBeNull()
  nodes[0].onended!(); await playing
  expect(player.analyser.current).toBeNull()
})
it('rejects silent provider output without showing a speaking state', async () => {
  await player.prepare(); silent = true
  const started = vi.fn()
  await expect(player.play('YQ==', started)).rejects.toThrow('静音音频')
  expect(started).not.toHaveBeenCalled(); expect(nodes).toHaveLength(0)
})
it('reports a blocked output resume instead of hanging on speaking', async () => {
  vi.useFakeTimers(); await player.prepare(); contexts[0].state = 'suspended'
  contexts[0].resume.mockImplementation(() => new Promise(() => {}))
  const started = vi.fn(), expectation = expect(player.play('YQ==', started)).rejects.toThrow('音频输出没有启动')
  await vi.advanceTimersByTimeAsync(3100); await expectation
  expect(started).not.toHaveBeenCalled()
})
it('detects a stalled audio clock and releases the pending playback', async () => {
  vi.useFakeTimers({ toFake: ['performance', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
  await player.prepare()
  const expectation = expect(player.play('YQ==', () => {})).rejects.toThrow('音频输出没有启动')
  await vi.advanceTimersByTimeAsync(4000); await expectation
  expect(player.analyser.current).toBeNull()
})
it('routes to the selected speaker and cancels playback without leaking a pending turn', async () => {
  await player.prepare('headphones')
  expect(contexts[0].setSinkId).toHaveBeenCalledWith('headphones')
  const started = vi.fn(), playing = player.play('YQ==', started)
  await vi.waitFor(() => expect(started).toHaveBeenCalledOnce())
  player.stop(); await playing
  expect(player.ready).toBe(false); expect(contexts[0].close).toHaveBeenCalledOnce()
})
it('does not restart stale audio when stopped during decoding', async () => {
  await player.prepare()
  let decode!: (buffer: Awaited<ReturnType<FakeContext['decodeAudioData']>>) => void
  contexts[0].decodeAudioData.mockImplementation(() => new Promise(resolve => { decode = resolve }))
  const started = vi.fn(), playing = player.play('YQ==', started)
  player.stop(); decode({ numberOfChannels: 1, sampleRate: 48000, length: 1, duration: 1, getChannelData: () => new Float32Array([.1]) }); await playing
  expect(started).not.toHaveBeenCalled(); expect(nodes).toHaveLength(0)
})
it('falls back once to the same decoded audio through Windows without regenerating speech', async () => {
  vi.useFakeTimers({ toFake: ['performance', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
  await player.prepare()
  const native = vi.fn().mockResolvedValue({ played: true }), compatibility = vi.fn()
  const playing = player.play('YQ==', () => {}, native, compatibility)
  await vi.advanceTimersByTimeAsync(4000); await playing
  expect(native).toHaveBeenCalledOnce(); expect(compatibility).toHaveBeenCalledOnce()
  const wave = Buffer.from(native.mock.calls[0][0], 'base64')
  expect(wave.toString('ascii', 0, 4)).toBe('RIFF')
  expect(wave.readUInt32LE(24)).toBe(48000)
  expect(wave.readInt16LE(44)).toBeGreaterThan(100)
  expect(player.analyser.current).toBeNull()
})
it('exposes a PCM-driven animation envelope only while native audio is playing', async () => {
  vi.useFakeTimers({ toFake: ['performance', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
  await player.prepare()
  let complete!: () => void
  const native = vi.fn(() => new Promise<void>(resolve => { complete = resolve }))
  const playing = player.play('YQ==', () => {}, native)
  await vi.advanceTimersByTimeAsync(4000)
  expect(native).toHaveBeenCalledOnce()
  expect(player.envelope.current?.rate).toBe(40)
  expect(Math.max(...player.envelope.current!.levels)).toBeGreaterThan(0)
  player.stop(); expect(player.envelope.current).toBeNull()
  complete(); await playing; expect(player.envelope.current).toBeNull()
})
