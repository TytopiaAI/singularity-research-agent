import { spawn } from 'node:child_process'
import path from 'node:path'
import { safeStorage } from 'electron'

// Windows CurrentUser protection survives changes to Electron's userData directory.
// Secrets only travel over anonymous pipes, never command arguments or logs.
const script = `
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Security
  $r = [Console]::In.ReadToEnd() | ConvertFrom-Json
  $bytes = [Convert]::FromBase64String($r.data)
  $scope = [System.Security.Cryptography.DataProtectionScope]::CurrentUser
  if ($r.protect) { $bytes = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, $scope) }
  else { $bytes = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, $scope) }
  [Console]::Write([Convert]::ToBase64String($bytes))
} catch { exit 1 }
`
function protect(data: string, encrypt: boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] })
    let output = '', settled = false
    const finish = (ok: boolean) => {
      if (settled) return
      settled = true; clearTimeout(timer)
      if (ok && output.trim()) resolve(output.trim())
      else { child.kill(); reject(new Error('Windows 用户密钥保护失败，请重新保存 API Key。')) }
    }
    const timer = setTimeout(() => finish(false), 10000)
    child.stdout.on('data', chunk => { output += chunk; if (output.length > 16000) finish(false) })
    child.on('error', () => finish(false)); child.stdin.on('error', () => finish(false))
    child.on('close', code => finish(code === 0))
    child.stdin.end(JSON.stringify({ data, protect: encrypt }))
  })
}
export async function encryptVoiceCredential(key: string): Promise<string> {
  if (process.platform === 'win32') return 'dpapi:' + await protect(Buffer.from(key, 'utf8').toString('base64'), true)
  return (await safeStorage.encryptStringAsync(key)).toString('base64')
}
export async function decryptVoiceCredential(value: string): Promise<string> {
  if (value.startsWith('dpapi:')) return Buffer.from(await protect(value.slice(6), false), 'base64').toString('utf8')
  const buffer = Buffer.from(value, 'base64')
  try { return safeStorage.decryptString(buffer) }
  catch { return (await safeStorage.decryptStringAsync(buffer)).result }
}
