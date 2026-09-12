# pi-tps 主题跟随系统配置：一次配好两项，幂等可重复执行。
# 1) pi 主题改为 light/dark（跟随系统）
# 2) pi-tps colorPreset 改为 theme（默认 mono 不跟随 pi 主题）
$ErrorActionPreference = 'Stop'
$dir = Join-Path $HOME '.pi\agent'

# --- 1) settings.json: theme -> light/dark ---
$s = Join-Path $dir 'settings.json'
if (-not (Test-Path $s)) { Write-Error "settings.json not found: $s"; exit 1 }
$t = [System.IO.File]::ReadAllText($s)
if ($t -match '"theme"\s*:\s*"light/dark"') {
    Write-Host '[skip] theme already follows system (light/dark)'
} else {
    if ($t -match '"theme"\s*:\s*"[^"]*"') {
        $t2 = [regex]::Replace($t, '"theme"\s*:\s*"[^"]*"', '"theme": "light/dark"')
    } else {
        # theme 键不存在时补上
        $t2 = [regex]::Replace($t, '\{', "{`n  `"theme`": `"light/dark`",", 1)
    }
    [System.IO.File]::WriteAllText($s, $t2, (New-Object System.Text.UTF8Encoding($false)))
    Write-Host '[done] settings theme -> light/dark (follow system)'
}

# --- 2) pi-tps.json: colorPreset -> theme ---
$p = Join-Path $dir 'pi-tps.json'
if (Test-Path $p) {
    $c = [System.IO.File]::ReadAllText($p)
    if ($c -match '"colorPreset"\s*:\s*"theme"') {
        Write-Host '[skip] pi-tps colorPreset already theme'
    } else {
        if ($c -match '"colorPreset"\s*:\s*"[^"]*"') {
            $c2 = [regex]::Replace($c, '"colorPreset"\s*:\s*"[^"]*"', '"colorPreset": "theme"')
        } else {
            # colorPreset 键不存在时补上
            $c2 = [regex]::Replace($c, '\{', "{`n  `"colorPreset`": `"theme`",", 1)
        }
        [System.IO.File]::WriteAllText($p, $c2, (New-Object System.Text.UTF8Encoding($false)))
        Write-Host '[done] pi-tps colorPreset -> theme'
    }
} else {
    # 无配置文件时创建最小配置
    [System.IO.File]::WriteAllText($p, "{`n  `"colorPreset`": `"theme`"`n}", (New-Object System.Text.UTF8Encoding($false)))
    Write-Host '[done] pi-tps.json created with colorPreset theme'
}