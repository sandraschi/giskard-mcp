$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$Installer = Get-ChildItem "$RepoRoot\dist\*setup.exe" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $Installer) { throw "No NSIS installer found in $RepoRoot\dist\" }

$LinkPath = "D:\Dev\Tauri starts\giskard-mcp-setup.lnk"
$ws = New-Object -ComObject WScript.Shell
$lnk = $ws.CreateShortcut($LinkPath)
$lnk.TargetPath = $Installer.FullName
$lnk.WorkingDirectory = $Installer.DirectoryName
$lnk.Description = "Giskard Red-Team Node NSIS Installer v0.1.0"
$lnk.Save()
Write-Host "Updated: $LinkPath -> $($Installer.Name)" -ForegroundColor Green
