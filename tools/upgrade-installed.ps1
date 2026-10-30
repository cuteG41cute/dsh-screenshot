# dsh-screenshot：把「本仓库的 static/」同步进已经安装好的包。
#
# 负责的事：
#   1. 先备份目标目录（package.json / lib/*.js / cordis.patch.yml）到 profiles\<p>\_backup；
#   2. 用仓库版本覆盖 node_modules\dsh-screenshot；
#   3. 逐个文件比对 sha256，确认真的写进去了；
#   4. 检查 cordis.patch.yml 里是否还有 dsh-screenshot 的条目（没有就报出来，不擅自改 YAML）。
#
#   powershell -ExecutionPolicy Bypass -File tools\upgrade-installed.ps1            # 应用（之后必须重启 harness）
#   powershell -ExecutionPolicy Bypass -File tools\upgrade-installed.ps1 -Verify    # 重启后确认进程真的在发新 bundle
#
# 静态插件在 harness 启动时装载，所以复制完不重启是不会生效的（浏览器刷新也不够）。

[CmdletBinding()]
param(
    [string]$Profile = 'web',
    [string]$DshHome = (Join-Path $env:USERPROFILE '.dsh'),
    [string]$Source = '',
    [switch]$Verify
)

$ErrorActionPreference = 'Stop'
$script:Failed = $false

function Say([string]$text) { Write-Host $text }
function Ok([string]$text) { Write-Host "  [ok] $text" -ForegroundColor Green }
function Bad([string]$text) { Write-Host "  [!!] $text" -ForegroundColor Red; $script:Failed = $true }
function Get-Hash([string]$path) { return (Get-FileHash -Path $path -Algorithm SHA256).Hash }

if ([string]::IsNullOrWhiteSpace($Source)) {
    $Source = Join-Path (Split-Path -Parent $PSScriptRoot) 'static'
}

$profileDir = Join-Path $DshHome (Join-Path 'profiles' $Profile)
$target = Join-Path $profileDir 'node_modules\dsh-screenshot'
$patch = Join-Path $profileDir 'cordis.patch.yml'
$sourceManifest = Join-Path $Source 'package.json'

Say 'dsh-screenshot: 同步已安装的包到仓库版本'
Say "  来源 : $Source"
Say "  目标 : $target"
Say ''

if (-not (Test-Path $sourceManifest)) { throw "找不到 $sourceManifest （用 -Source 指定 static 目录）" }
if (-not (Test-Path $target)) { throw "目标不存在: $target —— 请先用 install.ps1 安装" }

$sourceVersion = (Get-Content $sourceManifest -Raw | ConvertFrom-Json).version

# ------------------------------------------------------------------ 仅校验
if ($Verify) {
    Say '模式：只校验，不改文件'
    $installedVersion = (Get-Content (Join-Path $target 'package.json') -Raw | ConvertFrom-Json).version
    if ($installedVersion -eq $sourceVersion) { Ok "已安装的 package.json = $installedVersion" }
    else { Bad "已安装的 package.json = $installedVersion，期望 $sourceVersion" }

    foreach ($name in @('client.js', 'index.js')) {
        $src = Join-Path $Source "lib\$name"
        $dst = Join-Path $target "lib\$name"
        if (-not (Test-Path $src)) { continue }
        if (-not (Test-Path $dst)) { Bad "缺少 $dst"; continue }
        $h = Get-Hash $dst
        if ($h -eq (Get-Hash $src)) { Ok "$name 与仓库一致 ($h)" }
        else { Bad "$name 与仓库不一致 ($h)" }
    }

    Say ''
    Say '服务端 HTTP 探测不可用（/plugins/<id>/client.js 只以 ??id1,id2&rev= 批量形式提供，'
    Say '且默认 401 需要 token），所以运行态请在页面控制台确认：'
    Say ('  window.__dshScreenshot.version              // 期望 ' + $sourceVersion)
    Say '  window.__DSH_BOOT__.entries.some(e => e.id === ''dsh-screenshot'')   // 期望 true'
    Say '  document.querySelector(''[data-dsh-screenshot="button"]'')           // 期望 <button>'

    Say ''
    if ($script:Failed) { Say '结果：文件层面失败'; exit 1 }
    Say '结果：磁盘上的文件正确；运行态以上面三行在页面里确认。'
    exit 0
}

# ------------------------------------------------------------------ 应用
$installedVersion = (Get-Content (Join-Path $target 'package.json') -Raw | ConvertFrom-Json).version
Say "已安装版本：$installedVersion  ->  仓库版本：$sourceVersion"

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = Join-Path $profileDir "_backup\dsh-screenshot-$stamp"
New-Item -ItemType Directory -Path (Join-Path $backup 'lib') -Force | Out-Null
Copy-Item (Join-Path $target 'package.json') (Join-Path $backup 'package.json') -Force
Copy-Item (Join-Path $target 'lib\*.js') (Join-Path $backup 'lib') -Force
if (Test-Path $patch) { Copy-Item $patch (Join-Path $backup 'cordis.patch.yml') -Force }
Ok "备份到 $backup"

Copy-Item (Join-Path $Source 'package.json') (Join-Path $target 'package.json') -Force
Copy-Item (Join-Path $Source 'lib\*.js') (Join-Path $target 'lib') -Force

foreach ($name in @('client.js', 'index.js')) {
    $src = Join-Path $Source "lib\$name"
    $dst = Join-Path $target "lib\$name"
    if (-not (Test-Path $src)) { continue }
    if ((Get-Hash $src) -eq (Get-Hash $dst)) { Ok "$name 已写入（$((Get-Item $dst).Length) 字节）" }
    else { Bad "$name 复制后仍不一致" }
}
$nowVersion = (Get-Content (Join-Path $target 'package.json') -Raw | ConvertFrom-Json).version
if ($nowVersion -eq $sourceVersion) { Ok "package.json 现在是 $nowVersion" } else { Bad "package.json = $nowVersion" }

if (Test-Path $patch) {
    if (Select-String -Path $patch -Pattern 'id:\s*dsh-screenshot' -Quiet) { Ok 'cordis.patch.yml 已有 dsh-screenshot 条目' }
    else {
        Bad 'cordis.patch.yml 里没有 dsh-screenshot 条目，需要手工加（不自动改 YAML）'
        Say '    在 - insert: 列表下追加：'
        Say '        - id: dsh-screenshot'
        Say "          name: 'dsh-screenshot'"
    }
}
else { Bad "找不到 $patch" }

Say ''
if ($script:Failed) { Say '结果：失败'; exit 1 }
Say '结果：已复制。现在必须重启 harness（关掉并重新打开 dsh web / 桌面版）。'
Say '重启后再跑一次：powershell -ExecutionPolicy Bypass -File tools\upgrade-installed.ps1 -Verify'
exit 0
