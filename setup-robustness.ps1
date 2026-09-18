# 对话健壮性扩展一键配置（幂等，可重复执行）：
# 1) pi-response-guard：把包内默认 config.json 复制到
#    ~/.pi/agent/extensions/pi-response-guard/config.json
#    （等价于 /response-guard:install-config 命令，免交互）
# 注：pi-compaction-control 已于 2026-09-18 从清单移除，本脚本不再写入 contextCap。
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

Write-Host ''
Write-Host 'Done. 重启 Pi 或 /reload 生效。'
Write-Host '按需微调:'
Write-Host "  pi-response-guard -> $dst"