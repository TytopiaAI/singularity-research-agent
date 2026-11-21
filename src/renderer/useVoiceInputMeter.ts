import { useCallback, useEffect, useRef, type MutableRefObject } from 'react'

/** Local volume analysis only; no recording, playback or network connection. */
export function useVoiceInputMeter(listening: boolean, audioContext: MutableRefObject<AudioContext | null>) {
  const analyser = useRef<AnalyserNode | null>(null), releaseCurrent = useRef<(() => void) | null>(null)
  const stop = useCallback(() => releaseCurrent.current?.(), [])
  useEffect(() => {
    const context = audioContext.current
    if (!listening || !context || !navigator.mediaDevices?.getUserMedia) return
    let cancelled = false, stream: MediaStream | undefined, source: MediaStreamAudioSourceNode | undefined, meter: AnalyserNode | undefined
    const release = () => {
      cancelled = true
      stream?.getTracks().forEach(track => track.stop()); source?.disconnect(); meter?.disconnect()
      if (analyser.current === meter) analyser.current = null
      if (releaseCurrent.current === release) releaseCurrent.current = null
    }
    releaseCurrent.current = release
    void navigator.mediaDevices.getUserMedia({ audio: true, video: false }).then(input => {
      stream = input
      if (cancelled || audioContext.current !== context || context.state === 'closed') { release(); return }
      meter = context.createAnalyser(); meter.fftSize = 1024
      source = context.createMediaStreamSource(input); source.connect(meter)
      analyser.current = meter
    }).catch(release) // A denied/unavailable meter must not interrupt native recognition.
    return release
  }, [listening, audioContext])
  return { analyser, stop }
}
