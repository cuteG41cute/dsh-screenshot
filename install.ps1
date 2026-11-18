# dsh-screenshot installer
#
# Copies the static plugin package into a DSH profile's node_modules and adds
# the composition row (cordis.patch.yml) that puts it in the boot graph.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File install.ps1            # default profile
#   powershell -ExecutionPolicy Bypass -File install.ps1 -Force     # overwrite existing
#   powershell -ExecutionPolicy Bypass -File install.ps1 -Profile "C:\path\to\profiles\web"
#
# A restart of the harness process is required afterwards (composition changes
# are read at boot).
[CmdletBinding()]
param(
  [string]$Profile = (Join-Path $env:USERPROFILE '.dsh\profiles\web'),
  [switch]$Force
)

$ErrorActionPreference = 'Stop'

$pluginId = 'dsh-screenshot'
$marker = '# ==== dsh-screenshot (installed by install.ps1) ===='
$here = Split-Path -Parent $MyInvocation.MyCommand.Definition
$source = Join-Path $here 'static'

if (-not (Test-Path -LiteralPath $source)) { throw "source package not found: $source" }
if (-not (Test-Path -LiteralPath $Profile)) { throw "DSH profile not found: $Profile" }

$modules = Join-Path $Profile 'node_modules'
$patch = Join-Path $Profile 'cordis.patch.yml'
# a pristine 0.2.x profile may not have node_modules yet
if (-not (Test-Path -LiteralPath $modules)) {
  New-Item -ItemType Directory -Force -Path $modules | Out-Null
  Write-Host "node_modules: created $modules"
}

# ---- backup everything we are about to touch -------------------------------
$backupDir = Join-Path $Profile ('_backup\dsh-screenshot-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
if (Test-Path -LiteralPath $patch) {
  Copy-Item -LiteralPath $patch -Destination (Join-Path $backupDir 'cordis.patch.yml') -Force
}
$target = Join-Path $modules $pluginId
if (Test-Path -LiteralPath $target) {
  Copy-Item -LiteralPath $target -Destination (Join-Path $backupDir 'node_modules-dsh-screenshot') -Recurse -Force
}
Write-Host "backup: $backupDir"

# ---- install the package ---------------------------------------------------
if (Test-Path -LiteralPath $target) {
  if (-not $Force) { throw "$target already exists; re-run with -Force to overwrite" }
  Remove-Item -LiteralPath $target -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $target | Out-Null
Copy-Item -LiteralPath (Join-Path $source 'package.json') -Destination $target -Force
Copy-Item -LiteralPath (Join-Path $source 'lib') -Destination $target -Recurse -Force
Write-Host "package: $target"

# ---- composition row (idempotent; repairs a pristine "[]" patch file) ------
$already = (Test-Path -LiteralPath $patch) -and
  (Select-String -LiteralPath $patch -Pattern ('id:\s*' + $pluginId) -Quiet)
if ($already) {
  Write-Host "composition: row already present (id: $pluginId)"
} else {
  # A pristine profile ships a flow-empty sequence ("[]"); block entries cannot
  # be appended to it, so drop that lone line and rewrite as UTF-8 (no BOM).
  $existing = ''
  if (Test-Path -LiteralPath $patch) {
    $kept = @(Get-Content -LiteralPath $patch -Encoding UTF8 |
      Where-Object { $_ -notmatch '^\s*\[\]\s*$' })
    $existing = ($kept -join "`r`n").TrimEnd()
  }
  $block = @(
    $marker,
    '- insert:',
    ('    - id: ' + $pluginId),
    ("      name: '" + $pluginId + "'")
  ) -join "`r`n"
  $text = if ([string]::IsNullOrWhiteSpace($existing)) { $block + "`r`n" }
    else { $existing + "`r`n`r`n" + $block + "`r`n" }
  [System.IO.File]::WriteAllText($patch, $text, (New-Object System.Text.UTF8Encoding($false)))
  Write-Host "composition: row appended to $patch"
}

Write-Host ''
Write-Host 'Installed. RESTART the harness process (close and relaunch) so the'
Write-Host 'composition and the client bundle enter the boot graph.'
