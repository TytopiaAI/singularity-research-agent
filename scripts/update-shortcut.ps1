param([Parameter(Mandatory=$true)][string]$InstallRoot)
$ErrorActionPreference='Stop'
function Get-ContentHash([string]$FilePath) {
  $stream=[IO.File]::OpenRead($FilePath)
  $hasher=[Security.Cryptography.SHA256]::Create()
  try { return [BitConverter]::ToString($hasher.ComputeHash($stream)).Replace('-','') }
  finally { $hasher.Dispose(); $stream.Dispose() }
}
$resolvedInstall=[IO.Path]::GetFullPath($InstallRoot).TrimEnd('\')
$exe=Join-Path $resolvedInstall 'Singularity.exe'
$source=Join-Path $resolvedInstall 'resources\app\build\icon.ico'
if (!(Test-Path -LiteralPath $exe) -or !(Test-Path -LiteralPath $source)) { throw 'Invalid application directory' }
$icon=Join-Path $resolvedInstall 'saturn-max-256.ico'
if (!(Test-Path -LiteralPath $icon) -or (Get-ContentHash $source) -ne (Get-ContentHash $icon)) { Copy-Item -LiteralPath $source -Destination $icon -Force }
$shortcutPath=Join-Path ([Environment]::GetFolderPath('Desktop')) 'Singularity.lnk'
$shell=New-Object -ComObject WScript.Shell
$shortcut=$shell.CreateShortcut($shortcutPath)
if ($shortcut.TargetPath -ne $exe -or $shortcut.WorkingDirectory -ne $resolvedInstall -or $shortcut.IconLocation -ne "$icon,0") {
  $shortcut.TargetPath=$exe; $shortcut.WorkingDirectory=$resolvedInstall; $shortcut.IconLocation="$icon,0"; $shortcut.Description='Singularity'; $shortcut.Save()
}
$check=$shell.CreateShortcut($shortcutPath)
if ($check.TargetPath -ne $exe -or $check.IconLocation -ne "$icon,0") { throw 'Desktop shortcut validation failed' }
