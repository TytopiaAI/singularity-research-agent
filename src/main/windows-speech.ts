import { spawn } from 'node:child_process'
import path from 'node:path'

// Fixed code only. User text is JSON on stdin, never interpolated into PowerShell.
const script = `
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
try {
  Add-Type -AssemblyName System.Speech
  $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
  if ($request.action -eq 'capabilities') {
    $recognizers = @([System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers() | Where-Object { $_.Culture.Name -eq 'zh-CN' })
    $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
    try {
      $voices = @($synth.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -eq 'zh-CN' })
      @{ recognition = ($recognizers.Count -gt 0); synthesis = ($voices.Count -gt 0); language = 'zh-CN' } | ConvertTo-Json -Compress
    } finally { $synth.Dispose() }
  } elseif ($request.action -eq 'listen') {
    Add-Type -ReferencedAssemblies 'System.Speech' -TypeDefinition @'
using System;
using System.Text;
using System.Threading;
using System.Speech.Recognition;
public class SingularitySpeechResult {
  public string text;
  public double confidence;
  public int rejected;
  public static SingularitySpeechResult Read(SpeechRecognitionEngine engine) {
    var result = new SingularitySpeechResult();
    var text = new StringBuilder();
    int count = 0;
    double confidence = 0;
    Exception error = null;
    using (var done = new ManualResetEvent(false)) {
      engine.SpeechRecognized += (sender, e) => {
        if (!String.IsNullOrWhiteSpace(e.Result.Text)) {
          if (text.Length > 0) text.Append(" ");
          text.Append(e.Result.Text); confidence += e.Result.Confidence; count++;
        }
      };
      engine.SpeechRecognitionRejected += (sender, e) => { result.rejected++; };
      engine.RecognizeCompleted += (sender, e) => { error = e.Error; done.Set(); };
      engine.InitialSilenceTimeout = TimeSpan.FromSeconds(30);
      engine.BabbleTimeout = TimeSpan.FromSeconds(30);
      engine.RecognizeAsync(RecognizeMode.Multiple);
      if (!done.WaitOne(45000)) { engine.RecognizeAsyncCancel(); done.WaitOne(5000); throw new TimeoutException("本机语音识别超时，请重新录制较短的一句话。"); }
      if (error != null) throw error;
    }
    result.text = text.ToString();
    result.confidence = count == 0 ? 0 : confidence / count;
    return result;
  }
}
'@
    $info = [System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers() | Where-Object { $_.Culture.Name -eq 'zh-CN' } | Select-Object -First 1
    if (!$info) { throw 'Windows 尚未安装中文语音识别。请在系统语言设置中安装中文语音组件。' }
    $recognizer = New-Object System.Speech.Recognition.SpeechRecognitionEngine($info)
    try {
      $recognizer.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
      if ($request.text) {
        $audioStream = New-Object System.IO.MemoryStream(,[Convert]::FromBase64String($request.text))
        $recognizer.SetInputToWaveStream($audioStream)
      } else { $recognizer.SetInputToDefaultAudioDevice() }
      $recognizer.EndSilenceTimeout = [TimeSpan]::FromMilliseconds(1100)
      $recognizer.EndSilenceTimeoutAmbiguous = [TimeSpan]::FromMilliseconds(1600)
      $recognizer.BabbleTimeout = [TimeSpan]::FromSeconds(15)
      if ($request.text) {
        [SingularitySpeechResult]::Read($recognizer) | ConvertTo-Json -Compress
      } else {
        $result = $recognizer.Recognize([TimeSpan]::FromSeconds(15))
        if ($result) { @{ text = $result.Text; confidence = $result.Confidence } | ConvertTo-Json -Compress }
        else { @{ text = ''; confidence = 0 } | ConvertTo-Json -Compress }
      }
    } finally { $recognizer.Dispose(); if ($audioStream) { $audioStream.Dispose() } }
  } elseif ($request.action -eq 'speak') {
    $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
    $stream = New-Object System.IO.MemoryStream
    try {
      $synth.SelectVoiceByHints([System.Speech.Synthesis.VoiceGender]::NotSet, [System.Speech.Synthesis.VoiceAge]::NotSet, 0, [System.Globalization.CultureInfo]::GetCultureInfo('zh-CN'))
      $synth.SetOutputToWaveStream($stream)
      $synth.Speak([string]$request.text)
      @{ audio = [Convert]::ToBase64String($stream.ToArray()) } | ConvertTo-Json -Compress
    } finally { $synth.Dispose(); $stream.Dispose() }
  } elseif ($request.action -eq 'play') {
    $stream = [System.IO.MemoryStream]::new([Convert]::FromBase64String([string]$request.text))
    $player = [System.Media.SoundPlayer]::new($stream)
    try {
      $player.Load()
      $player.PlaySync()
      @{ played = $true } | ConvertTo-Json -Compress
    } finally { $player.Dispose(); $stream.Dispose() }
  } else { throw '未知语音操作。' }
} catch {
  @{ error = $_.Exception.Message } | ConvertTo-Json -Compress
  exit 1
}
`

export function windowsSpeech<T>(action: 'capabilities' | 'listen' | 'speak' | 'play', signal: AbortSignal, text?: string): Promise<T> {
  if (process.platform !== 'win32') return Promise.reject(new Error('语音功能需要 Windows 中文语音组件。'))
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const child = spawn(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    let output = ''
    let settled = false
    const finish = (error?: Error, value?: T): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      if (error) { child.kill(); reject(error) } else resolve(value!)
    }
    const abort = (): void => finish(new Error('语音操作已停止。'))
    const timer = setTimeout(() => finish(new Error('语音操作超时，请检查麦克风及 Windows 语音设置。')), action === 'capabilities' ? 15000 : 90000)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) { abort(); return }
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => { output += chunk; if (output.length > 32_000_000) finish(new Error('语音数据过大。')) })
    child.stderr.resume()
    child.on('error', () => finish(new Error('无法启动 Windows 语音组件。')))
    child.stdin.on('error', () => finish(new Error('Windows 语音组件已退出。')))
    child.on('close', (code) => {
      if (settled) return
      try {
        const value = JSON.parse(output.trim())
        if (value.error || code !== 0) finish(new Error(value.error || 'Windows 语音组件运行失败。'))
        else finish(undefined, value as T)
      } catch { finish(new Error('无法读取 Windows 语音结果，请检查系统语音组件。')) }
    })
    child.stdin.end(JSON.stringify({ action, text }), 'utf8')
  })
}
