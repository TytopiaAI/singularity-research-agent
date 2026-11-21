import { useCallback, useRef, useState } from 'react'

/** PCM is retained in memory only, and shared by the visualizer and local ASR. */
export function useVoiceCapture() {
  const analyser = useRef<AnalyserNode | null>(null)
  const cancel = useRef<(() => void) | null>(null), complete = useRef<(() => void) | null>(null)
  const [progress, setProgress] = useState({ heard: false, seconds: 0, level: 0, device: '' })
  const stop = useCallback(() => cancel.current?.(), [])
  const finish = useCallback(() => complete.current?.(), [])
  const record = async (context: AudioContext, deviceId = ''): Promise<string> => {
    stop()
    setProgress({ heard: false, seconds: 0, level: 0, device: '' })
    return new Promise((resolve, reject) => {
      let ended = false, stream: MediaStream | undefined, source: MediaStreamAudioSourceNode | undefined
      let processor: ScriptProcessorNode | undefined, mute: GainNode | undefined, filter: BiquadFilterNode | undefined, meter: AnalyserNode | undefined
      const chunks: Float32Array[] = [], preroll: Float32Array[] = []
      let samples = 0, total = 0, lastVoice = 0, heard = false, noise = .0002, lastUpdate = 0
      const release = () => {
        clearTimeout(timer)
        stream?.getTracks().forEach(track => track.stop())
        source?.disconnect(); filter?.disconnect(); processor?.disconnect(); mute?.disconnect(); meter?.disconnect()
        if (processor) processor.onaudioprocess = null
        if (analyser.current === meter) analyser.current = null
        if (cancel.current === abort) { cancel.current = null; complete.current = null }
      }
      const done = (error?: Error) => {
        if (ended) return
        ended = true; release()
        if (error) { reject(error); return }
        if (!heard || !samples) { reject(new Error('没有检测到说话声，请选择正确的麦克风或调高输入音量，再试一次。')); return }
        // Waiting time is excluded; normalize quiet recordings without clipping.
        let sum = 0, peak = 0
        for (const chunk of chunks) for (const sample of chunk) { sum += sample * sample; peak = Math.max(peak, Math.abs(sample)) }
        const gain = Math.min(30, .9 / Math.max(.0001, peak), .09 / Math.max(.0001, Math.sqrt(sum / samples)))
        const buffer = new ArrayBuffer(44 + samples * 2), view = new DataView(buffer)
        const text = (offset: number, value: string) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)))
        text(0, 'RIFF'); view.setUint32(4, 36 + samples * 2, true); text(8, 'WAVE'); text(12, 'fmt ')
        view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
        view.setUint32(24, context.sampleRate, true); view.setUint32(28, context.sampleRate * 2, true)
        view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, samples * 2, true)
        let offset = 44
        for (const chunk of chunks) for (const sample of chunk) { view.setInt16(offset, Math.max(-1, Math.min(1, sample * gain)) * 32767, true); offset += 2 }
        let binary = ''
        for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte)
        resolve(btoa(binary))
      }
      const abort = () => done(new Error('录音已停止。'))
      const timer = setTimeout(() => done(heard ? undefined : new Error('未检测到说话声，请检查麦克风输入设备和音量。')), 35000)
      cancel.current = abort; complete.current = () => done()
      if (!navigator.mediaDevices?.getUserMedia) { done(new Error('无法访问麦克风，请检查系统权限。')); return }
      void navigator.mediaDevices.getUserMedia({ audio: { ...(deviceId ? { deviceId: { exact: deviceId } } : {}), echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false }).then(input => {
        if (ended) { input.getTracks().forEach(track => track.stop()); return }
        stream = input; source = context.createMediaStreamSource(input)
        meter = context.createAnalyser(); meter.fftSize = 1024
        source.connect(meter); analyser.current = meter
        filter = context.createBiquadFilter(); filter.type = 'highpass'; filter.frequency.value = 80
        processor = context.createScriptProcessor(2048, 1, 1)
        mute = context.createGain(); mute.gain.value = 0
        source.connect(filter); filter.connect(processor); processor.connect(mute); mute.connect(context.destination)
        processor.onaudioprocess = event => {
          const chunk = new Float32Array(event.inputBuffer.getChannelData(0))
          total += chunk.length
          const seconds = total / context.sampleRate
          const rms = Math.sqrt(chunk.reduce((sum, n) => sum + n * n, 0) / chunk.length)
          const voiced = rms > Math.max(.0008, Math.min(.008, noise * 2.8))
          if (!voiced) noise += (rms - noise) * .07
          if (!heard) {
            preroll.push(chunk)
            while (preroll.length > Math.ceil(context.sampleRate * .4 / chunk.length)) preroll.shift()
            if (voiced) { heard = true; chunks.push(...preroll); samples = chunks.reduce((n, item) => n + item.length, 0) }
          } else { chunks.push(chunk); samples += chunk.length }
          if (voiced) lastVoice = seconds
          if (seconds - lastUpdate > .2) {
            lastUpdate = seconds
            setProgress({ heard, seconds, level: Math.min(1, rms * 15), device: input.getAudioTracks()[0]?.label || '麦克风' })
          }
          if (heard && seconds - lastVoice > 1.4 || samples / context.sampleRate >= 25) done()
        }
      }).catch(error => {
        const name = error instanceof DOMException ? error.name : ''
        done(new Error(name === 'NotFoundError' || name === 'OverconstrainedError' ? '所选麦克风不可用，请选择其他输入设备。' : '麦克风无法打开，请检查 Windows 麦克风权限及设备是否被占用。'))
      })
    })
  }
  return { analyser, stop, finish, record, progress }
}
