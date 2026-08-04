# setup.ps1 — Windows 環境準備（LibreOffice + ImageMagick + poppler + python-docx/lxml + 字型）
# 用法（PowerShell）:  powershell -ExecutionPolicy Bypass -File .\setup.ps1
# 冪等：可重複執行。若某套件在 winget 找不到，會改用 choco；都沒有時印出手動安裝提示。
# 注意：Codex/AI 執行時若發現套件 ID 與此處不符，應自行以 winget/choco 查正確 ID 後安裝（見 AGENTS.md Step 0）。

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path

function Have($cmd) { return [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }

function Install-Pkg($wingetId, $chocoId, $probeCmd, $name) {
    if ($probeCmd -and (Have $probeCmd)) { Write-Host "[skip] $name 已安裝"; return }
    if (Have winget) {
        Write-Host "[winget] 安裝 $name ($wingetId) ..."
        try { winget install --id $wingetId -e --accept-source-agreements --accept-package-agreements; return } catch { Write-Warning "winget 安裝 $name 失敗，改試 choco" }
    }
    if (Have choco) {
        Write-Host "[choco] 安裝 $name ($chocoId) ..."
        choco install $chocoId -y; return
    }
    Write-Warning "找不到 winget 或 choco，請手動安裝 $name。"
}

# 1. 系統工具
Install-Pkg "TheDocumentFoundation.LibreOffice" "libreoffice-fresh" "soffice"  "LibreOffice"
Install-Pkg "ImageMagick.ImageMagick"           "imagemagick"       "magick"   "ImageMagick"
Install-Pkg "oschwartz10612.Poppler"            "poppler"           "pdfinfo"  "Poppler"

# 2. Python 套件
if (Have python) { python -m pip install --user python-docx lxml }
elseif (Have python3) { python3 -m pip install --user python-docx lxml }
else { Write-Warning "找不到 python，請先安裝 Python 3（winget install Python.Python.3.12）後重跑本腳本。" }

# 3. 字型（使用者字型夾，免系統管理員）
$fontZip = Join-Path $Root "學習單字型.zip"
$fontDir = Join-Path $Root "fonts"
$userFontDir = Join-Path $env:LOCALAPPDATA "Microsoft\Windows\Fonts"
New-Item -ItemType Directory -Force -Path $userFontDir | Out-Null

$src = $null
if (Test-Path $fontZip) {
    $tmp = Join-Path $env:TEMP "converter-fonts"
    if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
    Expand-Archive -Path $fontZip -DestinationPath $tmp -Force
    $src = $tmp
} elseif (Test-Path $fontDir) {
    $src = $fontDir
} else {
    Write-Warning "找不到字型來源（$fontZip 或 ./fonts/）。請把 *.ttf/*.ttc 放進 ./fonts/ 後重跑。"
}

if ($src) {
    Get-ChildItem -Path $src -Recurse -Include *.ttf,*.ttc | ForEach-Object {
        $dest = Join-Path $userFontDir $_.Name
        Copy-Item $_.FullName $dest -Force
        $regName = "$($_.BaseName) (TrueType)"
        New-ItemProperty -Path "HKCU:\Software\Microsoft\Windows NT\CurrentVersion\Fonts" `
            -Name $regName -Value $dest -PropertyType String -Force | Out-Null
        Write-Host "[font] 已安裝 $($_.Name)"
    }
}

# 註：標楷體(kaiu.ttf) / 新細明體(mingliu.ttc) 為 Windows 內建字型，Windows 機器本來就有，
# 不含在開源字型包內，故此處不安裝——這正是要用 Windows 跑轉換排版最一致的原因。

Write-Host ""
Write-Host "=== 驗證 ==="
foreach ($c in @("soffice","magick","pdfinfo")) {
    if (Have $c) { Write-Host "  OK  $c" } else { Write-Warning "  缺 $c（請依上方提示安裝）" }
}
Write-Host "setup.ps1 完成。"
