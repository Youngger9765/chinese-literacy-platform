#!/usr/bin/env python3
"""產生「時長門檻字數 vs 前端計分字數」的對照表（#3299）。

為什麼要有這個檔
----------------
時長門檻 `min_ms = gate_char_count(target) / MAX_PLAUSIBLE_CPM * 60000` 只有在
`gate_char_count` **不超過**前端計分器實際數到的字數時才安全 —— 多算一個字就多
要求 100ms，而那是砍掉真的在唸的孩子。

兩邊是不同語言的兩套正規化，不可能靠讀 code 保證，所以用**全部真實服務中的
課文**逐一比對，把結果凍結成 fixture，由 spec 每次重跑比對。

跑法（需要 node）：
    python3 scripts/build_gate_char_count_fixture.py
"""
from __future__ import annotations

import csv
import glob
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import yaml

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "backend"))
OUT = REPO / "backend" / "specs" / "fixtures" / "gate_char_count.csv"

_FE = """
import { countScorableCharacters } from './src/utils/textDiff.ts';
const items = JSON.parse(process.argv[2]);
console.log(JSON.stringify(items.map((t) => countScorableCharacters(t))));
"""


def collect() -> list[tuple[str, str]]:
    """(標籤, 真正會被送進 target_text 的文字)。

    ⚠️ 標籤要帶**檔名**不能只用課號 —— 一課多篇的課（L0063 / L0111）底下有多個
       `key_reading.*.yml`，只用課號會互相覆蓋，比對時看起來像「漂移」。
    """
    out: list[tuple[str, str]] = []
    for p in sorted(glob.glob(str(REPO / "backend/data/lessons/*/v3/key_reading.*.yml"))):
        uid = Path(p).parts[-3]
        y = yaml.safe_load(Path(p).read_text("utf-8")) or {}
        t = (y.get("key_reading") or {}).get("passage")
        if t:
            out.append((f"{uid}/{Path(p).name}", t))
    for p in sorted(glob.glob(str(REPO / "backend/data/lessons/*/v3/full_text_annotate.*.yml"))):
        uid = Path(p).parts[-3]
        y = yaml.safe_load(Path(p).read_text("utf-8")) or {}
        paras = []
        for blk in (y.get("full_text_annotate") or {}).get("paragraphs") or []:
            if isinstance(blk, dict) and blk.get("text"):
                paras.append(str(blk["text"]))
        if paras:
            out.append((f"{uid}/{Path(p).name}", "".join(paras)))
    return out


def frontend_counts(texts: list[str]) -> list[int]:
    fe = REPO / "frontend"
    with tempfile.NamedTemporaryFile("w", suffix=".mjs", dir=fe, delete=False) as f:
        f.write(_FE)
        script = Path(f.name)
    try:
        r = subprocess.run(
            ["npx", "vite-node", script.name, "--", json.dumps(texts, ensure_ascii=False)],
            cwd=fe, capture_output=True, text=True,
        )
        if r.returncode != 0:
            sys.exit(f"前端計數失敗：\n{r.stderr[-2000:]}")
        return json.loads(r.stdout.strip().splitlines()[-1])
    finally:
        script.unlink(missing_ok=True)


def main() -> int:
    from app.services.reading_transcription_service import gate_char_count

    items = collect()
    if len(items) < 150:
        sys.exit(f"只收集到 {len(items)} 段課文，太少 —— 路徑可能變了")
    fe = frontend_counts([t for _, t in items])
    rows = [(label, gate_char_count(t), n) for (label, t), n in zip(items, fe)]
    over = [r for r in rows if r[1] > r[2]]
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["label", "gate_chars", "frontend_scorable_chars"])
        w.writerows(sorted(rows))
    print(f"✅ {OUT.relative_to(REPO)}：{len(rows)} 段；gate 高於前端的有 {len(over)} 段")
    for r in over[:10]:
        print("   ⛔", r)
    return 1 if over else 0


if __name__ == "__main__":
    raise SystemExit(main())
