# 对话健壮性扩展一键配置（幂等，可重复执行）：
# 1) pi-response-guard：把包内默认 config.json 复制到
#    ~/.pi/agent/extensions/pi-response-guard/config.json
#    （等价于 /response-guard:install-config 命令，免交互）
# 2) pi-compaction-control：settings.json 写入 contextCap（全模型 256k 硬上限），
#    让 autocompact 在 256k - reserveTokens 处提前触发（不再等原生 1M 窗口）
$ErrorActionPreference = 'Stop'
# 统一输出编码：避免 Git Bash / 不同代码页下中文乱码
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$dir = Join-Path $HOME '.pi\agent'

# --- 1) pi-response-guard config ---
$src = Join-Path $dir 'npm\node_modules\pi-response-guard\config.json'
$dstDir = Join-Path $dir 'extensions\pi-response-guard'
$dst = Join-Path $dstDir 'config.json'
if (Test-Path $dst) {
    Write-Host "[skip] response-guard config already exists -> $dst"
    Write-Host '       (edit that file to customize retryMessage / maxConsecutiveAutoRetries / errorPatterns)'
} else {
    if (-not (Test-Path $src)) { Write-Error "bundled config not found: $src"; exit 1 }
    New-Item -ItemType Directory -Force -Path $dstDir | Out-Null
    Copy-Item $src $dst
    Write-Host "[done] response-guard config copied -> $dst"
}

# --- 2) pi-compaction-control: contextCap ---
$s = Join-Path $dir 'settings.json'
if (-not (Test-Path $s)) { Write-Error "settings.json not found: $s"; exit 1 }
$t = [System.IO.File]::ReadAllText($s)
if ($t -match '"contextCap"') {
    Write-Host '[skip] contextCap already present in settings.json'
    Write-Host '       (edit cap / matchPatterns / models there to customize)'
} else {
    $cap = "{`n  `"contextCap`": {`n    `"cap`": 256000,`n    `"matchPatterns`": [`"*`"],`n    `"notify`": true`n  },"
    $t2 = [regex]::Replace($t, '\{', $cap, 1)
    [System.IO.File]::WriteAllText($s, $t2, (New-Object System.Text.UTF8Encoding($false)))
    Write-Host '[done] contextCap -> cap 256000, matchPatterns ["*"] (all models)'
    Write-Host '       autocompact 将在 256k - reserveTokens 处提前触发'
}

Write-Host ''
Write-Host 'Done. 重启 Pi 或 /reload 生效。'
Write-Host '按需微调:'
Write-Host "  pi-response-guard     -> $dst"
Write-Host "  pi-compaction-control -> settings.json 的 contextCap（cap / matchPatterns / models）"
Write-Host '                          及可选 compactionModel（换更便宜模型跑压缩摘要）'