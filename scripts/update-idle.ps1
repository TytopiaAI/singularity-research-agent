param([Parameter(Mandatory=$true)][string]$InstallRoot)
$ErrorActionPreference='Stop'
$resolvedInstall=[IO.Path]::GetFullPath($InstallRoot).TrimEnd('\')
if (!(Test-Path -LiteralPath (Join-Path $resolvedInstall 'Singularity.exe'))) { throw 'Invalid application directory' }
$processes=@(Get-CimInstance Win32_Process -Filter "Name='Singularity.exe' OR Name='node.exe'" | Where-Object { $_.ExecutablePath -and ([IO.Path]::GetFullPath($_.ExecutablePath).StartsWith($resolvedInstall+'\',[StringComparison]::OrdinalIgnoreCase)) })
if ($processes.Count) { throw 'Please fully exit Singularity, including the system tray, before updating. Unsaved work will not be closed automatically.' }
