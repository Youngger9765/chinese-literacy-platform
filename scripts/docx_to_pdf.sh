#!/usr/bin/env bash
# DOCX → PDF，平行安全，而且不會無聲卡住
#
# 為什麼需要這支
# --------------
# LibreOffice 預設所有 headless 轉檔共用**同一個**使用者 profile，並對它上鎖。
# 第二個 soffice 進來不會報錯、不會退出，就是掛在那裡等鎖 —— 等到天荒地老。
#
# 2026-08-17 實際發生：一輪平行抽取留下的 soffice 殭屍霸著那個鎖 5 小時。
# 之後每個 worker 一轉 PDF 就卡死，現象是「平行抽取好慢」，沒有人往鎖去想。
# 我自己也在同一個坑裡等了 10 分鐘 timeout 才發現。
#
# 這支把三件事焊在一起，讓「記得加旗標」不再是人的責任：
#   1. 每次轉檔一個獨立 profile（不共用就沒有鎖競爭）
#   2. 動手前先清掉**過期的**殭屍（只清自己這條路徑的，不動別人正在跑的）
#   3. timeout + 產出檢查，失敗就非零退出（不讓半套流程往下走）
#
# 用法：
#   scripts/docx_to_pdf.sh <src.docx> <outdir> [uid]
#   scripts/docx_to_pdf.sh --doctor        # 只盤點/清理殭屍，不轉檔
#
# 退出碼：0 轉好了；1 轉不出來（訊息說明卡在哪）

set -uo pipefail

# 超過這麼久還在跑的 soffice 視為殭屍。正常一課 2~10 秒，10 分鐘是很寬的門檻 ——
# 訂太短會殺掉別的 worker 正在跑的大檔。
STALE_SECONDS=${SOFFICE_STALE_SECONDS:-600}
CONVERT_TIMEOUT=${SOFFICE_TIMEOUT:-300}

_elapsed_seconds() {   # $1 = pid → 該行程活了幾秒
  local etime
  etime=$(ps -o etime= -p "$1" 2>/dev/null | tr -d ' ')
  [ -z "$etime" ] && { echo 0; return; }
  # etime 格式：SS / MM:SS / HH:MM:SS / D-HH:MM:SS
  local days=0 rest="$etime"
  case "$rest" in *-*) days=${rest%%-*}; rest=${rest#*-};; esac
  local IFS=:; local parts; read -r -a parts <<< "$rest"
  local s=0
  for p in "${parts[@]}"; do s=$((10#${p:-0} + s * 60)); done
  echo $((s + days * 86400))
}

reap_stale() {         # 清掉過期的轉檔行程；回報清了幾個
  local killed=0 pid age
  for pid in $(pgrep -f 'soffice.*--convert-to pdf' 2>/dev/null); do
    age=$(_elapsed_seconds "$pid")
    if [ "$age" -gt "$STALE_SECONDS" ]; then
      # ⚠️ 只殺過期的。別人剛開始跑的大檔不能動 —— 那會把「防卡住」變成「互相殺」。
      kill -9 "$pid" 2>/dev/null && killed=$((killed + 1))
    fi
  done
  # 殭屍死了鎖檔還在，不清掉下一個進來照樣等
  rm -rf "$HOME/Library/Application Support/LibreOffice/4/user/.lock" \
         "$HOME/.config/libreoffice/4/user/.lock" 2>/dev/null
  echo "$killed"
}

if [ "${1:-}" = "--doctor" ]; then
  echo "=== soffice 轉檔行程 ==="
  running=0
  for pid in $(pgrep -f 'soffice.*--convert-to pdf' 2>/dev/null); do
    running=$((running + 1))
    printf '  pid=%s 已跑 %s 秒\n' "$pid" "$(_elapsed_seconds "$pid")"
  done
  [ "$running" -eq 0 ] && echo "  （沒有）"
  echo "清掉 $(reap_stale) 個過期行程（門檻 ${STALE_SECONDS}s）"
  exit 0
fi

SRC=${1:-}
OUTDIR=${2:-}
if [ -z "$SRC" ] || [ -z "$OUTDIR" ]; then
  echo "用法：$0 <src.docx> <outdir> [uid]   |   $0 --doctor" >&2
  exit 1
fi
UID_TAG=${3:-$(basename "$OUTDIR")}

[ -s "$SRC" ] || { echo "⛔ 來源不存在或是空的：$SRC" >&2; exit 1; }
mkdir -p "$OUTDIR" || exit 1

reaped=$(reap_stale)
[ "$reaped" -gt 0 ] && echo "（清掉 $reaped 個過期的 soffice）"

# ── profile：樣板建一次，之後每次轉檔複製一份 ──────────────────────────
#
# 為什麼不直接「每課一個新 profile」：**全新 profile 的第一次啟動要好幾分鐘**
# （LibreOffice 在 bootstrap 整套設定）。實測 4 分 40 秒 vs 複用時的 2.1 秒。
# 175 課各付一次這個成本是不能接受的。
#
# 樣板只建一次（492K），複製一份 0.04 秒 —— 隔離性跟「每課全新」一樣，
# 成本卻幾乎是零。用完就刪，不留垃圾。
TEMPLATE="/tmp/lo-profile-template"
if [ ! -d "$TEMPLATE/user" ]; then
  echo "（首次使用：建立 LibreOffice profile 樣板，約 1~5 分鐘，只有這一次）"
  # 拿一個保證存在的小檔去觸發 bootstrap；轉出什麼不重要，重點是把 profile 建起來
  seed_dir=$(mktemp -d)
  printf 'seed' > "$seed_dir/seed.txt"
  timeout "$CONVERT_TIMEOUT" soffice --headless \
    -env:UserInstallation="file://$TEMPLATE" \
    --convert-to pdf --outdir "$seed_dir" "$seed_dir/seed.txt" >/dev/null 2>&1
  rm -rf "$seed_dir"
  if [ ! -d "$TEMPLATE/user" ]; then
    echo "⛔ 樣板 profile 建不起來，LibreOffice 可能沒裝好" >&2
    exit 1
  fi
fi

PROFILE=$(mktemp -d "/tmp/lo-run-$UID_TAG.XXXXXX")
cp -R "$TEMPLATE/." "$PROFILE/" 2>/dev/null
trap 'rm -rf "$PROFILE"' EXIT

OUT_PDF="$OUTDIR/$(basename "${SRC%.*}").pdf"
rm -f "$OUT_PDF"

# ⚠️ `rc` 一定要先給值。`set -u` 之下，如果 timeout 被外部訊號中斷、
#    這一行沒跑完就跳走，下面的錯誤處理會炸 `rc: unbound variable`，
#    **把真正的失敗訊息蓋掉** —— 有 worker 因此看不到自己是逾時還是轉檔失敗。
# ⚠️ **LibreOffice 的排版不是決定性的**（#2865 實測，20 次單轉：8 頁 9 次 / 9 頁 11 次）。
#
#    排除過的假設：
#      · 冷熱 profile —— 驗過兩輪像是對的，第三輪就翻掉
#      · 字型替換     —— 三次轉檔的 pdffonts 輸出逐字相同（11 個子集化字型、順序一樣）
#      · 三次取多數   —— 55/45 的分布下只有 57% 命中多數值，等於沒用
#
#    ⇒ 這裡**不試圖讓它變決定性**。正確做法是把 PDF 當**一次性產物**：
#      轉一次、算頁碼、派工、抽取，整條流程用**同一份** PDF 從頭到尾。
#      重轉就要重算頁碼 —— 這是 assert_pdf_matches_manifest.py 在守的事。
#
#    ⛔ 不要在這裡加重試或多數決。要讓它穩，得換掉排版引擎或改用內容錨點
#      （見 docs/prd/extraction-pipeline-map.md §0.5 Q1）。
rc=0
timeout "$CONVERT_TIMEOUT" soffice --headless \
  -env:UserInstallation="file://$PROFILE" \
  --convert-to pdf --outdir "$OUTDIR" "$SRC" >/dev/null 2>&1 || rc=$?

if [ ! -s "$OUT_PDF" ]; then
  # 分清楚「逾時」跟「轉檔本身失敗」——兩者要查的東西完全不同
  if [ "$rc" -eq 124 ]; then
    echo "⛔ 轉檔逾時 ${CONVERT_TIMEOUT}s：$SRC" >&2
    echo "   多半還有別的 soffice 佔著資源，跑 $0 --doctor 看看" >&2
  else
    echo "⛔ 轉檔失敗（soffice 退出碼 $rc），沒有產出 PDF：$SRC" >&2
  fi
  exit 1
fi

# 頁數不只是資訊：0 頁代表轉出了一個空殼，那比失敗更糟（後面會當成「讀完了」）
#
# ⚠️ 這裡曾經寫成 `pages=$(python3 -c "import fitz..." 2>/dev/null || echo 0)`，
#    那是把「工具不存在」跟「真的 0 頁」壓成同一個值。PyMuPDF 只裝在系統 python3，
#    沒裝在 backend/.venv —— 而派工單的標準開頭就是先 activate venv，於是每個照做的人
#    轉出完全正常的 12 頁 PDF 都會被報「0 頁失敗」，然後跑去查 LibreOffice、profile 鎖、
#    殭屍行程，全都查不出東西（症狀在轉檔，病灶在頁數檢查）。
#
# 改法：讓失敗跟空值分得開 —— 先落地 rc，讀不到就換一個讀得到的工具，
# 兩個都不可用就明說「檢查不了」，不要謊報 0。
read_pages() {
  local out rc
  out=$(python3 -c "import fitz,sys;print(fitz.open(sys.argv[1]).page_count)" "$1" 2>&1); rc=$?
  if [ "$rc" -eq 0 ] && [ -n "$out" ]; then echo "$out"; return 0; fi
  # 系統本來就有 pdfinfo（poppler），拿它當第二來源
  out=$(pdfinfo "$1" 2>/dev/null | awk '/^Pages:/{print $2}'); rc=$?
  if [ "$rc" -eq 0 ] && [ -n "$out" ]; then echo "$out"; return 0; fi
  return 1
}

if pages=$(read_pages "$OUT_PDF"); then
  if [ "$pages" -lt 1 ]; then
    echo "⛔ PDF 產出了但 0 頁：$OUT_PDF" >&2
    exit 1
  fi
  echo "$OUT_PDF pages=$pages"
else
  # 檔案存在且非空，只是數不出頁數 —— 這不該擋住流程，但也不可以假裝驗過了
  echo "⚠️ 頁數檢查不可用（fitz 與 pdfinfo 都讀不到），未驗頁數：$OUT_PDF" >&2
  echo "$OUT_PDF pages=unverified"
fi
