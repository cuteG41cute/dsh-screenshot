# dsh-screenshot uninstaller
#
# Removes the installed package and the composition row that install.ps1 added.
# Only the block whose marker line is '# ==== dsh-screenshot ...' is removed,
# so unrelated composition entries are left untouched.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File uninstall.ps1
#   powershell -ExecutionPolicy Bypass -File uninstall.ps1 -RestoreBackup
#
# -RestoreBackup instead restores cordis.patch.yml from the newest
# <profile>\_backup\dsh-screenshot-* snapshot taken by install.ps1.
[CmdletBinding()]
param(
  [string]$Profile = (Join-Path $env:USERPROFILE '.dsh\profiles\web'),
  [switch]$RestoreBackup
)

$ErrorActionPreference = 'Stop'

$pluginId = 'dsh-screenshot'
$markerPattern = '^\s*#\s*={2,}\s*dsh-screenshot'
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

if (-not (Test-Path -LiteralPath $Profile)) { throw "DSH profile not found: $Profile" }
$patch = Join-Path $Profile 'cordis.patch.yml'
$target = Join-Path $Profile ('node_modules\' + $pluginId)

# ---- optional: restore the configuration from the newest backup ------------
if ($RestoreBackup) {
  $backups = Get-ChildItem -Path (Join-Path $Profile '_backup') -Directory -Filter 'dsh-screenshot-*' -ErrorAction SilentlyContinue |
    Sort-Object Name -Descending
  if ($null -eq $backups -or $backups.Count -eq 0) { throw 'no dsh-screenshot backup found under ' + (Join-Path $Profile '_backup') }
  $newest = $backups[0].FullName
  Copy-Item -LiteralPath (Join-Path $newest 'cordis.patch.yml') -Destination $patch -Force
  Write-Host "composition restored from: $newest"
} elseif (Test-Path -LiteralPath $patch) {
  # Drop the marker line and every following indented/blank line (the row).
  $raw = [System.IO.File]::ReadAllText($patch, [System.Text.UTF8Encoding]::new($false))
  $lines = $raw -split "`r?`n"
  $kept = New-Object System.Collections.Generic.List[string]
  $skipping = $false
  foreach ($line in $lines) {
    if (-not $skipping -and $line -match $markerPattern) { $skipping = $true; continue }
    if ($skipping) {
      if ($line -match '^\s' -or $line.Trim().Length -eq 0) { continue }
      $skipping = $false
    }
    $kept.Add($line)
  }
  $text = ($kept -join "`n").TrimEnd() + "`n"
  [System.IO.File]::WriteAllText($patch, $text, $utf8NoBom)
  Write-Host "composition: dsh-screenshot row removed from $patch"
}

# ---- remove the package ----------------------------------------------------
if (Test-Path -LiteralPath $target) {
  Remove-Item -LiteralPath $target -Recurse -Force
  Write-Host "package removed: $target"
} else {
  Write-Host "package not installed: $target"
}

Write-Host ''
Write-Host 'Uninstalled. Restart the harness process to drop it from the boot graph.'
