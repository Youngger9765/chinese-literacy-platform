#!/usr/bin/env bash
# 用 codex 對「已抽好的一課」做獨立內容覆核（producer ≠ auditor）
#
# 為什麼是 codex 做這件事
# ------------------------
# 抽取的人不能自己驗自己：他會看到自己以為看到的東西。而閘門只驗得了
# 「有沒有抄錯」（逐字）跟「有沒有漏整段課文」（覆蓋），驗不了
# **答案對不對** —— 紅色 ☑ 勾在哪一個選項，只有再看一次圖才知道。
#
# codex 能看圖（實測拿一題已知答案的 ☑ 考它，答對），而且不吃 Claude 的額度，
# 正好當第二雙眼睛。
#
# ⚠️ 一次只餵**一頁**。整課 11 頁一次餵，實測 10 分鐘跑不完 ——
#    小塊、有邊界、失敗只賠一頁。
#
# 用法：
#   scripts/codex_qa_lesson.sh <UID> [頁碼...]     # 不給頁碼 = 挑有答案的頁
#
# 輸出：qa/content-evidence/codex-qa-<UID>/page-NN.txt + verdict.md

set -uo pipefail
REPO=$(cd "$(dirname "$0")/.." && pwd)
UID_ARG=${1:?用法：$0 <UID> [頁碼...]}
shift || true

# ⚠️ 不能用 `ls | head -1` 挑 scratchpad：那底下每個**專案**都有一份，
#    head -1 會挑到別的專案（實測挑到 career-creator-card），然後報「找不到 PDF」，
#    看起來像檔案沒產出，實際是找錯地方。認 UID 資料夾在哪就用哪個。
W=""
for cand in /private/tmp/claude-501/*chinese-literacy*/*/scratchpad/"$UID_ARG"; do
  [ -s "$cand/src.pdf" ] && { W="$cand"; break; }
done
if [ -z "$W" ]; then
  # 沒有現成 PDF 就自己轉一份，別讓 QA 卡在「要先有人幫我轉檔」
  W=$(ls -d /private/tmp/claude-501/*chinese-literacy*/*/scratchpad 2>/dev/null | head -1)/"$UID_ARG"
  mkdir -p "$W"
  dp=$(python3 -c "
import yaml,sys
from pathlib import Path
for v in ('v3','v2'):
    f=Path(f'backend/data/lessons/$UID_ARG/{v}/lesson.yml')
    if f.is_file():
        d=(yaml.safe_load(f.read_text(encoding='utf-8')) or {}).get('source') or {}
        if d.get('drive_path'): print(d['drive_path']); break")
  [ -n "$dp" ] && cp "private/curriculum-source/_SOT/$dp" "$W/src.docx" 2>/dev/null
  [ -s "$W/src.docx" ] && scripts/docx_to_pdf.sh "$W/src.docx" "$W" "$UID_ARG" >/dev/null
fi
OUT="$REPO/qa/content-evidence/codex-qa-$UID_ARG"
mkdir -p "$OUT"

[ -s "backend/data/lessons/_extracted/${UID_ARG}.yml" ] || {
  echo "⛔ ${UID_ARG} 還沒抽出來（backend/data/lessons/_extracted/${UID_ARG}.yml 不存在）" >&2
  echo "   這支是覆核已抽好的課，不是抽取本身。" >&2
  exit 1
}
[ -s "$W/src.pdf" ] || { echo "⛔ 找不到 $W/src.pdf，轉檔失敗" >&2; exit 1; }

# 抽出這一課的答案，讓 codex 有東西可以比對（不給答案的話它只是重抽一次）
python3 - "$UID_ARG" "$OUT/claims.txt" <<'PY'
import sys, yaml
from pathlib import Path
uid, out = sys.argv[1], Path(sys.argv[2])
d = yaml.safe_load(Path(f"backend/data/lessons/_extracted/{uid}.yml").read_text(encoding="utf-8"))
lines = []
def walk(node, path=""):
    if isinstance(node, dict):
        # 有 options + answer 的就是選擇題，那是最值得覆核的東西
        if node.get("options") and (node.get("answer") is not None or node.get("answers")):
            opts = node["options"]
            items = opts.items() if isinstance(opts, dict) else enumerate(opts, 1)
            stem = node.get("prompt") or node.get("stem") or node.get("label") or path
            ans = node.get("answers") or node.get("answer")
            lines.append(f"題目：{str(stem)[:60]}")
            for k, v in items:
                lines.append(f"    {k}. {v}")
            lines.append(f"  我抽到的答案：{ans}")
            lines.append("")
        for k, v in node.items():
            walk(v, f"{path}/{k}")
    elif isinstance(node, list):
        for i, v in enumerate(node):
            walk(v, f"{path}[{i}]")
walk(d)
out.write_text("\n".join(lines) or "(這一課沒有選擇題)", encoding="utf-8")
print(f"待覆核的選擇題：{sum(1 for l in lines if l.startswith('題目：'))} 題")
PY

checked=0
failed=0
PAGES=("$@")
if [ ${#PAGES[@]} -eq 0 ]; then
  total=$(python3 -c "import fitz;print(fitz.open('$W/src.pdf').page_count)")
  # 答案密集的通常在後半（聚光燈、閱讀理解），但別猜 —— 全掃，一頁一個 call
  PAGES=($(seq 1 "$total"))
fi

for n in "${PAGES[@]}"; do
  png="$W/qa-page-$(printf '%02d' "$n").png"
  [ -s "$png" ] || python3 -c "
import fitz
d=fitz.open('$W/src.pdf'); d[$n-1].get_pixmap(dpi=150).save('$png')"
  echo "── 第 $n 頁 ──"
  out_txt="$OUT/page-$(printf '%02d' "$n").txt"
  rm -f "$out_txt"
  timeout 300 codex exec --skip-git-repo-check -i "$png" \
    -o "$out_txt" \
    "這是國語文學習單教師版的第 $n 頁。紅色 ☑ 是老師勾的答案、橘色圈是圈選答案、紅色手寫字是填空答案。

下面是別人從這份學習單抽出來的答案。**只針對這一頁上看得到的題目**，逐題核對：

$(cat "$OUT/claims.txt")

回報格式（每題一行，只列這一頁有的）：
題目前 12 字 | 圖上實際勾的 | 抽到的 | 相同/不同

看不到的題目就不要列。這一頁沒有選擇題就只回「本頁無選擇題」。" >/dev/null 2>&1
  if [ -s "$out_txt" ]; then
    checked=$((checked + 1))
    tail -6 "$out_txt"
  else
    # ⚠️ 沒輸出要當失敗，不能當「沒問題」。第一版就是這樣：一頁都沒驗到
    #    照樣印 CODEX_QA=PASS —— 那個綠什麼都不代表，比沒跑更糟。
    failed=$((failed + 1))
    echo "  ⛔ 第 $n 頁 codex 沒有產出（逾時或額度）"
  fi
done

grep -l "不同" "$OUT"/page-*.txt 2>/dev/null | sed 's/^/  🔴 /' > "$OUT/verdict.md" || true
if [ -s "$OUT/verdict.md" ]; then
  echo; echo "🔴 有不一致，逐頁看："; cat "$OUT/verdict.md"
  exit 1
fi
echo
if [ "$checked" -eq 0 ]; then
  echo "⛔ 一頁都沒驗到（$failed 頁沒產出）—— 視為失敗，不要把空跑當成通過"
  echo "CODEX_QA=FAIL"
  exit 1
fi
[ "$failed" -gt 0 ] && echo "⚠️ $failed 頁沒產出，只驗到 $checked 頁"
echo "CODEX_QA=PASS（${UID_ARG}，驗過 $checked/${#PAGES[@]} 頁）"
