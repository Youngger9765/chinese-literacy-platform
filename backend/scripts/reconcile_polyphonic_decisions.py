#!/usr/bin/env python3
"""把窮舉 LLM 的判讀跟課文表比對，分流成「誰該決定」，只留真的要人判的。

為什麼需要這一層
────────────────
`decide_polyphonic_readings.py` 讓 LLM 逐位置判讀全部破音字位置。它抓到真 bug
（L0018 的 25 處「長高」讀成 ㄔㄤˊ），但同一批提案裡也有它自己判錯的 ——
因為 ㄔㄤˊ 也是「長」的合法讀音，值域約束擋不住這一類。

所以 LLM 給的是**提案**，這支決定每個提案由誰裁決：

  規則      「一」「不」的變調是下一個字聲調的函數
  產品政策  連接詞「和」讀 ㄏㄢˋ 是 #3238 的決定（辭典給 ㄏㄜˊ，所以 LLM 每次都想改回去）
  人        其餘

⚠️ 這支的第一版有兩個我自己造的錯，都被複審與實測抓到，記在這裡免得再犯：

  1. **下一個字的聲調從決策檔查** —— 決策檔只有破音字，而「一半」的半、「不夠」的夠
     都是單讀音字，不在裡面 → 聲調算成 0 → 退回基本讀音。實測 **68%** 的一/不
     落入這個錯誤預設。正解是從**課文表本身**（ssz）配**完整字型讀音表**
     （13,087 字，含單讀音字）算，那裡每個位置都有讀音。
  2. **「一」「不」被無條件歸進「規則」桶** —— 於是規則用錯誤預設算出的答案會
     否決 LLM 的正確判斷，而且永遠不進審核隊列。這跟本檔自己主張的
     「窮舉的 LLM 需要一個不是 LLM 的裁判」正好反過來：變成確定性的規則在製造
     假訊號並藏起來。現在改成**三方比對**，規則與 LLM 不一致一律進隊列。

  另外：序數是變調規則的真例外 —— 「第一個」「第一名」表寫 ㄧ 是對的，
  規則會算成 ㄧˊ/ㄧˋ（實測 135 處）。所以規則也不是權威，只是分流訊號。
"""
from __future__ import annotations

import collections
import json
import hashlib
import sys
from pathlib import Path

_BACKEND = Path(__file__).resolve().parents[1]
_LESSONS = _BACKEND / "data" / "lessons"
_ZH_SLOTS = _BACKEND / "data" / "zhuyin" / "font_slot_readings.json"     # 破音字，注音
_ALL_READINGS = _BACKEND / "data" / "zhuyin" / "font_all_readings.json"  # 全部字，拼音帶聲調
_DECISIONS = _BACKEND / "data" / "zhuyin" / "polyphonic_decisions.jsonl"

NEUTRAL_TAIL = set("了的得麼著子頭們嗎呢吧啊喔呀哦")
#: 「一」讀基本調 ㄧ 的已驗證例外：序數。⛔ 只列查證過的，不要憑印象加。
ORDINAL_PREV = {"第"}


def u16(text: str) -> list[str | None]:
    out: list[str | None] = []
    for ch in text:
        out.append(ch)
        if ord(ch) > 0xFFFF:
            out.append(None)
    return out


def sentence_key(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


def slot_of(code: str) -> str:
    return "0000" if code == "." else f"ss0{code}"


def tone_of(pinyin: str | None) -> int:
    """拼音字尾就是聲調數字（shi4 → 4）。取不到回 0。"""
    if not pinyin or not pinyin[-1].isdigit():
        return 0
    return int(pinyin[-1])


def sandhi(char: str, next_tone: int, prev_char: str | None) -> str | None:
    if char == "不":
        return "ㄅㄨˊ" if next_tone == 4 else "ㄅㄨˋ"
    if char == "一":
        if prev_char in ORDINAL_PREV:      # 第一 → 序數，不變調
            return "ㄧ"
        if next_tone == 4:
            return "ㄧˊ"
        if next_tone in (1, 2, 3):
            return "ㄧˋ"
        return "ㄧ"
    return None


def ensure_all_readings() -> None:
    """缺了就從出貨字型自己生 —— 41,535 行的衍生資料不進 git。

    它百分之百由 `extract_font_readings.py` 從 `BpmfZihiSerif-Regular.ttf` 決定，
    commit 它只會製造一個沒人會讀的巨大 diff。
    """
    if _ALL_READINGS.is_file():
        return
    # ⚠️ 這支目前不在任何 workflow 裡。以後真的接進 CI，第一次跑會花時間抽字型產 ~440KB。
    import subprocess  # noqa: PLC0415
    font = _BACKEND.parent / "frontend" / "public" / "fonts" / "BpmfZihiSerif-Regular.ttf"
    if not font.is_file():
        raise SystemExit(f"找不到出貨字型：{font}")
    print(f"生成 {_ALL_READINGS.name}（從出貨字型抽 13,000+ 字）…")
    out = subprocess.run(
        [sys.executable, str(_BACKEND / "scripts" / "extract_font_readings.py"), str(font)],
        capture_output=True, text=True, check=True).stdout
    _ALL_READINGS.write_text(out, encoding="utf-8")


def load_context() -> dict:
    """走課文表，建 {(sha,u16): {char, cur, next_tone, prev}}。

    這是「下一個字的聲調」唯一正確的來源 —— 表裡每個位置都有讀音，
    不論那個字是不是破音字。
    """
    zh = json.loads(_ZH_SLOTS.read_text(encoding="utf-8"))["slots"]
    raw = json.loads(_ALL_READINGS.read_text(encoding="utf-8"))
    allr = raw.get("slots", raw)
    ctx: dict = {}
    for path in sorted(_LESSONS.glob("L*/v*/zhuyin.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        for t in data.get("texts") or []:
            text, ssz = t.get("text"), t.get("ssz")
            if not isinstance(text, str) or not isinstance(ssz, str):
                continue
            units = u16(text)
            if len(units) != len(ssz):
                continue
            sha = sentence_key(text)
            if (sha, 0) in ctx or any((sha, i) in ctx for i in range(min(3, len(units)))):
                continue                      # 同一句只建一次
            for i, ch in enumerate(units):
                if ch is None:
                    continue
                nxt = units[i + 1] if i + 1 < len(units) else None
                nxt_py = allr.get(nxt, {}).get(slot_of(ssz[i + 1])) if nxt else None
                prev = units[i - 1] if i > 0 else None
                ctx[(sha, i)] = {
                    "char": ch,
                    "cur": zh.get(ch, {}).get(slot_of(ssz[i])),
                    "next_tone": tone_of(nxt_py),
                    "next_char": nxt,
                    "prev": prev,
                }
    return ctx


def load_decisions() -> list[dict]:
    """去重：同一個 (sha,u16) 只留最後一筆。

    ⚠️ append-only 檔案在 resume 時會出現同鍵多行（複審實測 1,269 筆重複、
       其中 50 筆兩次答案不同）。不去重的話統計會灌水、同一個位置在隊列裡
       被算成兩個問題。
    """
    if not _DECISIONS.is_file():
        return []
    latest: dict = {}
    for line in _DECISIONS.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            r = json.loads(line)
        except json.JSONDecodeError:
            continue
        latest[(r["sha"], r["u16"])] = r
    return list(latest.values())


def main() -> None:
    lesson = sys.argv[1] if len(sys.argv) > 1 else None
    ensure_all_readings()
    ctx = load_context()
    rows = load_decisions()
    if lesson:
        rows = [r for r in rows if lesson in r.get("lessons", [])]

    buckets: collections.Counter = collections.Counter()
    queue: collections.Counter = collections.Counter()
    examples: dict = {}
    agree: collections.Counter = collections.Counter()

    for r in rows:
        ch, cur, llm = r["char"], r["current"], r["reading"]
        c = ctx.get((r["sha"], r["u16"]))

        if ch in "一不":
            rule = sandhi(ch, c["next_tone"] if c else 0, c["prev"] if c else None)
            if rule == cur and llm == cur:
                continue                                   # 三方一致，沒事
            if rule == llm and rule != cur:
                buckets["rule+llm 都說表錯"] += 1           # 強候選，仍需核可
                agree[(ch, cur, rule, (c or {}).get("next_char"))] += 1
                continue
            if rule != cur and llm == cur:
                # 規則說表錯、LLM 說表對 —— 這一類幾乎都是 sandhi() 還沒涵蓋的例外
                # （序數以外還有別的），所以要單獨一桶，不要跟真正的三方衝突混在一起。
                # 混在一起的話，看隊列的人會以為 LLM 有異議，其實它同意表。
                buckets["規則錯、LLM 同意表（sandhi 的例外）"] += 1
                key = (ch, cur, f"規則{rule}（LLM 同意表）")
                queue[key] += 1
                examples.setdefault(key, r)
                continue
            buckets["規則與 LLM 衝突 → 人判"] += 1
            key = (ch, cur, f"規則{rule}/LLM{llm}")
            queue[key] += 1
            examples.setdefault(key, r)
            continue

        if llm == cur:
            continue
        if ch == "和" and cur == "ㄏㄢˋ" and llm == "ㄏㄜˊ":
            buckets["產品政策：和讀 ㄏㄢˋ"] += 1
            continue
        if ch in NEUTRAL_TAIL and cur.endswith("˙") and not llm.endswith("˙"):
            buckets["產品政策：詞尾輕聲"] += 1
            continue
        if ch == "個" and cur == "ㄍㄜ˙" and llm == "ㄍㄜˋ":
            buckets["產品政策：量詞個輕聲"] += 1
            continue
        # 疊字的第二個字讀輕聲：太太／奶奶／謝謝／爸爸。
        # 模型會給完整聲調（250 處），那不是發現，是它沒套輕聲慣例。
        if c and c["prev"] == ch and cur.endswith("˙") and not llm.endswith("˙"):
            buckets["產品政策：疊字第二字輕聲"] += 1
            continue
        buckets["其他 → 人判"] += 1
        key = (ch, cur, llm)
        queue[key] += 1
        examples.setdefault(key, r)

    print(f"{lesson or '全部課文'}：去重後 {len(rows):,} 個決策")
    print()
    for name, n in buckets.most_common():
        print(f"  {n:6,}  {name}")
    print()
    print(f"⭐ 審核隊列 {len(queue):,} 種 / {sum(queue.values()):,} 處（前 25）:")
    for k, n in queue.most_common(25):
        ex = examples[k]
        i = ex["u16"]
        print(f"   {n:5,}× 「{k[0]}」 表={k[1]} → {k[2]}"
              f"   …{ex['text'][max(0, i - 8):i + 9]}…")
    if agree:
        print()
        print(f"規則與 LLM 都說表錯 {len(agree):,} 種（前 15，仍需核可才會套用）:")
        for (ch, cur, want, nch), n in agree.most_common(15):
            print(f"   {n:5,}× 「{ch}{nch or ''}」 表={cur} → {want}")


if __name__ == "__main__":
    main()
