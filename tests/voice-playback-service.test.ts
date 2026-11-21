import { expect, it, vi } from 'vitest'
import { VoiceService } from '../src/main/voice-service'
import { windowsSpeech } from '../src/main/windows-speech'
import type { ProviderStore } from '../src/main/provider-store'
vi.mock('../src/main/windows-speech', () => ({ windowsSpeech: vi.fn().mockResolvedValue({ played: true }) }))
function wave() {
  const bytes=Buffer.alloc(48)
  bytes.write('RIFF');bytes.writeUInt32LE(40,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(16000,24);bytes.writeUInt32LE(32000,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(4,40);bytes.writeInt16LE(1000,44)
  return bytes
}
it('only plays validated PCM in a live session and shares its cancellation signal', async () => {
  const voice=new VoiceService({} as ProviderStore), id=voice.start()
  await expect(voice.play(id,wave().toString('base64'))).resolves.toEqual({played:true})
  expect(windowsSpeech).toHaveBeenLastCalledWith('play',expect.any(AbortSignal),wave().toString('base64'))
  const signal=vi.mocked(windowsSpeech).mock.lastCall![1]
  voice.stop(id);expect(signal.aborted).toBe(true)
  await expect(voice.play(id,wave().toString('base64'))).rejects.toThrow('会话已结束')
})
it('rejects malformed data, executable text and inconsistent WAV headers before starting native playback', () => {
  const voice=new VoiceService({} as ProviderStore),id=voice.start()
  for(const value of [null,'not audio','powershell.exe',Buffer.from('RIFF garbage').toString('base64')])expect(()=>voice.play(id,value)).toThrow('格式无效')
  const wrong=wave();wrong.writeUInt32LE(999999,24)
  expect(()=>voice.play(id,wrong.toString('base64'))).toThrow('格式无效')
  voice.stop()
})
