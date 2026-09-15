#!/usr/bin/env python3
"""凍結「課文頁 vs 診斷頁」的全語料差異基準。(#3215)

## 為什麼不是用既有那條棘輪就好

`test_zhuyin_cross_surface_drift_3202.py` 比的是**前端測試檔裡的 31 句**。
它現在停在 2 筆，讀起來像「快好了」——**它綠是因為它的世界只有 31 句**：

    31 條斷言實際守住的字      7 個
    全語料會不一致的字        74 個
      完全沒有測試提到的      68 個
      落在無人看守的字上      1,322 / 3,934 = 33.6%

跟這個 repo 自己 postmortem 過的 #3177 完全同型（44 條全綠而 行／著 是反的）：
**綠著的 golden set 鎖住的是一個太小的世界。**

## 課文頁那一半怎麼來的（不移植）

用 `esbuild` 把**出貨的那份 TS** 打包成 node 腳本直接跑，拿它的輸出當 oracle。
移植會漏規則（一/不變調、`skipPrev`、`SPECIAL_DOUBLE_CHARACTERS`），而這招沒有
任何東西可以移植錯 —— 因為沒有移植。完整配方在下面 `--help` 的註解裡。

⚠️ 三個會咬人的地方（都實際發生過）：
  1. 繞開 `fetch()` 的招數抄 `polyphonicReadings.test.ts` 的 `beforeAll`，不要自己發明
  2. **長度守衛不可省** —— 錯位會給出一整份看起來合理、實際整串位移的答案（#3175 的形狀）
  3. fixture 存的是**拼音**（`de5`）不是注音 —— 忘了轉會得到「100% 全錯」。
     ⭐ 一個「全錯」的結果通常是單位沒對齊，不是東西真的全錯

## 這份檔凍結什麼

  triples      83 組 (字, 課文頁讀音, 後端讀音, 次數) —— 差異本身
  fingerprints 每課一個後端輸出的 hash —— **連「兩邊一起漂」都抓得到**
  _provenance  四樣來源的 sha256

⛔ 沒有那四個 sha256 就不要用這份檔：清單會靜靜過期，而那正是這整件事在修的病。

    python3 backend/scripts/generate_cross_surface_baseline.py --fe <fe_readings.json>
    python3 backend/scripts/generate_cross_surface_baseline.py --check
"""

from __future__ import annotations

import argparse
import collections
import glob
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
REPO = BACKEND.parent
OUT = BACKEND / "data" / "zhuyin" / "cross_surface_baseline.json"

#: 這四樣任一改變，凍結的清單就可能過期
SOURCES = [
    "frontend/public/data/poyin_db.json",
    "frontend/src/components/zhuyin/__fixtures__/fontReadings.generated.json",
]
TS_GLOB = "frontend/src/components/zhuyin/*.ts"


def corpus() -> list[dict]:
    """服務端會餵給 `/reading/evaluate` 的那兩種文字。"""
    import yaml

    out = []
    for f in sorted(glob.glob(str(BACKEND / "data/lessons/L*/v3/full_text_annotate.*.yml"))):
        d = yaml.safe_load(Path(f).read_text(encoding="utf-8")) or {}
        fta = d.get("full_text_annotate") or d
        for p in fta.get("paragraphs") or []:
            t = p.get("text") if isinstance(p, dict) else p
            if isinstance(t, str) and t.strip():
                out.append({"lesson": Path(f).parents[1].name, "text": t})
    for f in sorted(glob.glob(str(BACKEND / "data/lessons/L*/v3/key_reading.*.yml"))):
        d = yaml.safe_load(Path(f).read_text(encoding="utf-8")) or {}
        kr = d.get("key_reading") or d
        t = kr.get("passage")
        if isinstance(t, str) and t.strip():
            out.append({"lesson": Path(f).parents[1].name, "text": t})
    return out


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def source_fingerprints() -> dict[str, str]:
    out = {p: _sha(REPO / p) for p in SOURCES}
    # 前端的 .ts 邏輯（toneSandhi / patternMatcher / processor …）合起來一個 hash。
    # ⛔ 漏掉這一項最致命：它最容易被改，而改了清單就過期。
    h = hashlib.sha256()
    for f in sorted(glob.glob(str(REPO / TS_GLOB))):
        h.update(Path(f).name.encode())
        h.update(Path(f).read_bytes())
    out[TS_GLOB] = h.hexdigest()
    return out


def backend_readings(texts: list[dict]) -> list[dict[int, str]]:
    sys.path.insert(0, str(BACKEND))
    from app.routes.learning.learning_reading import _build_zhuyin_map

    return [_build_zhuyin_map(i["text"]) for i in texts]


def _to_bopomofo(pinyin_with_tone: str) -> str:
    from pypinyin.style.bopomofo import BopomofoConverter

    return BopomofoConverter().to_bopomofo(re.sub(r"5$", "", pinyin_with_tone))


def build(fe_path: Path) -> dict:
    texts = corpus()
    fe = json.loads(fe_path.read_text(encoding="utf-8"))
    if len(fe) != len(texts):
        raise SystemExit(f"⛔ 前端輸出 {len(fe)} 段、語料 {len(texts)} 段 —— 對不起來")

    be = backend_readings(texts)

    comparable = agree = 0
    triples: collections.Counter = collections.Counter()
    per_lesson: dict[str, list[str]] = collections.defaultdict(list)

    for item, fe_row, be_map in zip(texts, fe, be):
        t = item["text"]
        if len(fe_row) != len(t):
            raise SystemExit(f"⛔ 長度對不齊：{item['lesson']}")
        # 每課的後端輸出指紋 —— 連「兩邊一起漂」都抓得到
        per_lesson[item["lesson"]].append(
            "|".join(f"{i}:{be_map[i]}" for i in sorted(be_map))
        )
        for i, ch in enumerate(t):
            f = fe_row[i]
            if not f:
                continue
            comparable += 1
            want, got = _to_bopomofo(f), be_map.get(i)
            if got == want:
                agree += 1
            else:
                triples[(ch, want, got)] += 1

    fingerprints = {
        lesson: hashlib.sha256("\n".join(rows).encode()).hexdigest()[:16]
        for lesson, rows in sorted(per_lesson.items())
    }
    return {
        "_provenance": {
            "generator": "backend/scripts/generate_cross_surface_baseline.py",
            "frontend_oracle": "esbuild 打包出貨的 components/zhuyin TS，直接在 node 跑（非移植）",
            "sources": source_fingerprints(),
            "edition": f"git {_git_sha()}",
            "issue": "#3215",
        },
        "passages": len(texts),
        "comparable": comparable,
        "agree": agree,
        "triples": [[c, f, b, n] for (c, f, b), n in triples.most_common()],
        "fingerprints": fingerprints,
    }


def _git_sha() -> str:
    try:
        return subprocess.run(
            ["git", "rev-parse", "--short=12", "HEAD"],
            cwd=REPO, capture_output=True, text=True, check=True,
        ).stdout.strip()
    except (OSError, subprocess.CalledProcessError):  # pragma: no cover
        return "unknown"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--fe", type=Path, help="前端 oracle 的輸出（見檔頭配方）")
    ap.add_argument("--check", action="store_true", help="只驗來源 sha256 有沒有變")
    ap.add_argument("--accept-growth", action="store_true",
                    help="明確接受「不一致變多」（要在 PR 裡說明為什麼）")
    args = ap.parse_args()

    if args.check:
        if not OUT.exists():
            print(f"⛔ {OUT.relative_to(REPO)} 不存在")
            return 1
        have = json.loads(OUT.read_text(encoding="utf-8"))["_provenance"]["sources"]
        now = source_fingerprints()
        drifted = sorted(k for k in now if have.get(k) != now[k])
        if drifted:
            print("⛔ 這些來源變了，凍結的基準已過期，請重跑產生器：\n  " + "\n  ".join(drifted))
            return 1
        print(f"✓ 四樣來源都沒變（{len(now)} 項）")
        return 0

    if not args.fe:
        print("⛔ 需要 --fe（前端 oracle 的輸出）"); return 1
    table = build(args.fe)

    # ⛔ 重跑產生器最危險的路徑：來源變了 → 測試叫你重生 → **新增的不一致靜靜重新凍結**，
    #    而沒有任何東西說「你讓它從 3,934 變成 4,300」。這裡當場擋住。
    if OUT.exists():
        prev = json.loads(OUT.read_text(encoding="utf-8"))
        before = prev["comparable"] - prev["agree"]
        after = table["comparable"] - table["agree"]
        if after > before and not args.accept_growth:
            print(f"⛔ 跨畫面不一致從 {before} 增加到 {after}（+{after - before}）。")
            print("   這代表這次的來源改動讓兩個畫面更不一致了。確認那是刻意的之後，")
            print("   加 --accept-growth 並在 PR 裡說明為什麼。")
            return 1
        if after != before:
            print(f"（不一致 {before} → {after}）")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    body = json.dumps(table, ensure_ascii=False, indent=1, sort_keys=True)
    OUT.write_text(body + "\n", encoding="utf-8")
    print(f"寫入 {OUT.relative_to(REPO)}  ({len(body.encode('utf-8'))/1024:.0f} KB)")
    print(f"  {table['passages']} 段 · 可比 {table['comparable']} · "
          f"一致 {table['agree']} ({table['agree']/table['comparable']*100:.2f}%) · "
          f"相異三元組 {len(table['triples'])} · 每課指紋 {len(table['fingerprints'])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
