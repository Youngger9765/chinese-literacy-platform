#!/usr/bin/env python3
"""逐句窮舉破音字讀音 —— 沒有中間層（#3269，Young 2026-09-18 明令重新設計）。

## 為什麼要重新設計

前一版（`audit_polyphonic_readings.py`）用 n-gram 當鍵值。Young 一句話打破它：

    「長高」 → ㄓㄤˇ（他長高了）   而   「加長|高度」 → ㄔㄤˊ

同一個二字對，兩種讀音都合法 —— 因為**詞界可能落在兩個字之間**。
n-gram 是我為了少呼叫 LLM 而蓋的一層抽象，而那層抽象本身就有歧義。

回頭看，這個專案每一次讀錯的根因都是一層「替我猜」的中間層：

    jieba（替我猜詞界）         簡體字典，全庫 1,654 個「長」全切成單字 → #3238 那一整類
    poyin_db 樣式（替我猜讀音）  generative pattern list，沒有「長高」就落預設 → 35 處錯
    n-gram 鍵值（替我把位置壓成規則）  「長高」兩種讀音都合法 → 鍵值有歧義

**這些層存在的唯一理由是「窮舉很貴」，而封閉語料早就讓它不貴了**：

    40,529 句 · 1,066,980 字 · 281,442 個破音字位置
    逐句全量判一次 ≈ US$0.87（gemini-2.5-flash-lite）

我原本「把呼叫壓到 170 次」的優化省不到兩美元，代價是一個被一句話打破的鍵值。

## 設計：最具體的鍵，零抽象

    鍵 = (這一句的 sha256, 這個字的 UTF-16 位置)

句子給定時詞界就定了 —— **不需要猜詞、不需要斷詞器、不需要 n-gram**。
「加長高度」進來就是一個新句子、一個新位置，自己被判一次。

## 窮舉的 LLM 需要三個不是 LLM 的驗證者

「不要中間層」的失效模式不是成本，是**不確定性**。所以：

1. **值域約束** —— LLM 只能從**出貨字型畫得出來的那 2–5 個讀音**裡選。
   用 `response_schema` 的 enum 鎖住，程式再檢一次。它結構上不可能幻想一個讀音。
2. **內部一致性** —— 同一個 (sha, offset) 只能有一個答案；決策檔本身就是這個約束。
3. **覆蓋率** —— 每個位置都要有決策。沒有決策的位置 = 門紅（新課文進來時就是這樣）。

## ⛔ LLM 只離線跑一次，結果凍結

執行期永遠查表。跟 #3218 同一條紀律：**讀音是課文的內容，不是執行期的計算。**

## 用法

    python backend/scripts/decide_polyphonic_readings.py --plan          # 只算工作量
    python backend/scripts/decide_polyphonic_readings.py --run --limit 5 # 試跑 5 句
    python backend/scripts/decide_polyphonic_readings.py --run           # 全量（可中斷續跑）
    python backend/scripts/decide_polyphonic_readings.py --gate          # 覆蓋率門
    # 與課文表的比對走 reconcile_polyphonic_decisions.py（分流在那支）
"""
from __future__ import annotations

import argparse
import asyncio
import collections
import hashlib
import json
import sys
from pathlib import Path

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))

_LESSONS = _BACKEND / "data" / "lessons"
_SLOTS_PATH = _BACKEND / "data" / "zhuyin" / "font_slot_readings.json"
_REJECTS = _BACKEND / "data" / "zhuyin" / "polyphonic_rejects.jsonl"
_DECISIONS = _BACKEND / "data" / "zhuyin" / "polyphonic_decisions.jsonl"

#: 一次給 LLM 幾句。⚠️ 只影響 token 效率，**不影響鍵值** —— 鍵永遠是 (sha, offset)。
_BATCH = 4

#: 用哪個模型。⚠️ **實測 flash-lite 不夠**：3 句 78 個位置裡它跟表不一致 13 處，
#: 而人工逐一核對後**大多是它錯**（還不夠 ㄅㄨˊ／血脈賁張 ㄅㄣ／中華 ㄏㄨㄚˊ／
#: 與金牌 ㄩˇ／上天給我 ㄍㄟˇ 表都是對的）。判讀破音字要語意理解，不是分類。
_TASK = "omo_grader"

#: 同時在跑的批次數。全庫 3,647 批，序列跑要十幾個小時。
_PAR = 24

#: 一次最多問幾個位置。
#: ⚠️ 2026-09-18 實測：L0018 有兩句各 43 與 48 個目標，模型回了全部但**各少一個**
#: （隱「藏」、前「提」）。不是特定字判不出來，是長清單會掉項，而且掉的是哪一個每次不同。
#: 因為鍵是 (sha, u16)，同一句拆成幾次問完全不影響結果 —— 所以這個上限是免費的。
_MAX_TARGETS = 16


def u16(text: str) -> list[str | None]:
    """切成 UTF-16 單位，跟表的 `ssz` 與前端的 `text[i]` 同語意。

    ⛔ Python 的 `list(text)` 是碼點；非 BMP 字會差一格，而槽位是照 UTF-16 排的。
    """
    out: list[str | None] = []
    for ch in text:
        out.append(ch)
        if ord(ch) > 0xFFFF:
            out.append(None)
    return out


def load_slots() -> dict[str, dict[str, str]]:
    return json.loads(_SLOTS_PATH.read_text(encoding="utf-8"))["slots"]


def sentence_key(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


def collect_work(slots: dict) -> dict[str, dict]:
    """走完 179 課，收出每一句要判的位置。

    ⛔ 不分組、不合併相同句子以外的任何東西。相同句子（同 sha）只判一次是唯一的
       去重，而那不是抽象 —— 那是同一個輸入。
    """
    poly = {ch for ch, m in slots.items() if len(m) > 1}
    work: dict[str, dict] = {}
    for path in sorted(_LESSONS.glob("L*/v*/zhuyin.json")):
        uid = path.parts[-3]
        data = json.loads(path.read_text(encoding="utf-8"))
        for t in data.get("texts") or []:
            text, ssz = t.get("text"), t.get("ssz")
            if not isinstance(text, str) or not isinstance(ssz, str):
                continue
            units = u16(text)
            if len(units) != len(ssz):
                continue
            targets = []
            for i, code in enumerate(ssz):
                ch = units[i]
                if ch is None or ch not in poly:
                    continue
                cp = sum(1 for k in range(i) if units[k] is not None)
                slot = "0000" if code == "." else f"ss0{code}"
                targets.append({
                    "u16": i,
                    "cp": cp,
                    "char": ch,
                    "current": slots[ch].get(slot),
                    "choices": sorted(set(slots[ch].values())),
                })
            if not targets:
                continue
            sha = sentence_key(text)
            if sha in work:
                work[sha]["lessons"].add(uid)
                continue
            work[sha] = {"text": text, "targets": targets, "lessons": {uid}}
    return work


def load_decided() -> dict[str, dict[int, str]]:
    out: dict[str, dict[int, str]] = collections.defaultdict(dict)
    if not _DECISIONS.is_file():
        return out
    for line in _DECISIONS.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            r = json.loads(line)
        except Exception:
            continue
        out[r["sha"]][int(r["u16"])] = r["reading"]
    return out


_SYSTEM = """你是台灣國小國語文教材的注音校訂者。

任務：句子裡有幾個破音字被標記出來，替每一個標記的位置選出**在這個句子裡正確**的注音。

鐵則：
1. 只能從該位置提供的 choices 裡選一個，**不可以自己造注音**。
2. 依**這個句子的實際語意與詞界**判斷，不要只看相鄰兩個字。
   例：「他長高了」的長是 ㄓㄤˇ；「加長高度」的長是 ㄔㄤˊ（加長＋高度，詞界在中間）。
3. 台灣教育部的讀音標準，不是中國大陸的。
4. 輕聲、一／不的變調照台灣國語的實際唸法。
5. 不確定時選最常用的那個，並在 note 寫下你猶豫的原因。

台灣國語的變調與輕聲（這些是規則，不是偏好）：
- 「一」在四聲字前讀 ㄧˊ（一半 ㄧˊㄅㄢˋ）；在一、二、三聲字前讀 ㄧˋ（一杯 ㄧˋㄅㄟ）；
  序數與單念讀 ㄧ（第一 ㄉㄧˋㄧ、一百 ㄧˋㄅㄞˇ）。
- 「不」在四聲字前讀 ㄅㄨˊ（不夠 ㄅㄨˊㄍㄡˋ、不是 ㄅㄨˊㄕˋ）；其餘讀 ㄅㄨˋ。
- 詞尾的「了、的、得、麼、著、子、頭」等虛詞讀輕聲。

⛔ 表已經標的讀音多半是對的。**只有你確定它錯了才改**，
   而且 note 要寫出「這個詞是什麼、所以該讀什麼」。沒有把握就選跟 current 一樣的。"""

_SCHEMA = {
    "type": "object",
    "properties": {
        "sentences": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "sha": {"type": "string"},
                    "readings": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "u16": {"type": "integer"},
                                "reading": {"type": "string"},
                                "note": {"type": "string"},
                            },
                            "required": ["u16", "reading"],
                        },
                    },
                },
                "required": ["sha", "readings"],
            },
        }
    },
    "required": ["sentences"],
}


def build_prompt(batch: list[tuple[str, dict]]) -> str:
    lines = []
    for sha, item in batch:
        lines.append(f"### sha={sha}")
        lines.append(f"句子：{item['text']}")
        for t in item["targets"]:
            lines.append(
                f"  - u16={t['u16']}  第 {t['cp'] + 1} 個字「{t['char']}」"
                f"  choices={t['choices']}"
            )
        lines.append("")
    return "\n".join(lines)


async def run(work: dict, limit: int | None, slots: dict) -> None:
    from google.genai import types as genai_types  # noqa: PLC0415

    from app.services.ai.gemini_client import generate_structured_response  # noqa: PLC0415

    decided = load_decided()
    # 只問還沒判的位置，並把長句的目標切段 —— resume 因此是精確的：
    # 重跑時問的就是缺的那幾個偏移量，不是整句重判。
    todo: list[tuple[str, dict]] = []
    for sha, it in work.items():
        pending = [t for t in it["targets"] if t["u16"] not in decided.get(sha, {})]
        if not pending:
            continue
        for i in range(0, len(pending), _MAX_TARGETS):
            todo.append((sha, {**it, "targets": pending[i:i + _MAX_TARGETS]}))
    if limit:
        todo = todo[:limit]

    # 同一個 sha 不可以在同一批出現兩次 —— 回應是用 sha 當鍵的，撞了會只收到一份
    batches: list[list[tuple[str, dict]]] = []
    cur: list[tuple[str, dict]] = []
    cur_shas: set[str] = set()
    cur_n = 0
    for unit in todo:
        if cur and (len(cur) >= _BATCH or cur_n >= _MAX_TARGETS * _BATCH
                    or unit[0] in cur_shas):
            batches.append(cur)
            cur, cur_shas, cur_n = [], set(), 0
        cur.append(unit)
        cur_shas.add(unit[0])
        cur_n += len(unit[1]["targets"])
    if cur:
        batches.append(cur)
    print(f"要問的單位: {len(todo):,}（每單位最多 {_MAX_TARGETS} 個位置）"
          f" · 共 {sum(len(u[1]['targets']) for u in todo):,} 個未判位置"
          f" · {len(batches):,} 批 · 並行 {_PAR}")

    sem = asyncio.Semaphore(_PAR)
    wlock = asyncio.Lock()
    state = {"ok": 0, "bad": 0, "done": 0}

    async def one(batch, fh):
        async with sem:
            try:
                res = await generate_structured_response(
                    system_prompt=_SYSTEM,
                    contents=[genai_types.Content(
                        role="user", parts=[genai_types.Part(text=build_prompt(batch))])],
                    response_schema=_SCHEMA,
                    max_tokens=8192,
                    temperature=0.0,          # 判讀不是創作
                    task=_TASK,
                )
            except Exception as e:  # noqa: BLE001
                async with wlock:
                    state["bad"] += len(batch)
                    state["done"] += 1
                    print(f"  ⚠️ {type(e).__name__}: {str(e)[:70]}", flush=True)
                return
        got = {s["sha"]: s for s in res.get("sentences") or []}
        lines, rejects, ok, bad = [], [], 0, 0
        for sha, item in batch:
            s = got.get(sha)
            if not s:
                bad += 1
                continue
            by = {t["u16"]: t for t in item["targets"]}
            for r in s.get("readings") or []:
                t = by.get(int(r.get("u16", -1)))
                if t is None:
                    continue
                # ⭐ 驗證者 1：值域約束 —— 字型畫不出來的讀音一律拒收
                if r.get("reading") not in t["choices"]:
                    # 記下來 —— 否則「被值域擋掉」跟「沒有回答」在輸出裡長得一樣，
                    # 而前者是有訊息的：模型堅持一個字型畫不出來的讀音。
                    rejects.append(json.dumps({
                        "sha": sha, "u16": t["u16"], "char": t["char"],
                        "said": r.get("reading"), "current": t["current"],
                        "choices": t["choices"], "note": r.get("note", ""),
                        "lessons": sorted(item["lessons"]),
                    }, ensure_ascii=False))
                    bad += 1
                    continue
                lines.append(json.dumps({
                    "sha": sha, "u16": t["u16"], "char": t["char"],
                    "reading": r["reading"], "current": t["current"],
                    "note": r.get("note", ""),
                    "lessons": sorted(item["lessons"]),
                    "text": item["text"],
                }, ensure_ascii=False))
                ok += 1
        async with wlock:
            fh.write("\n".join(lines) + "\n" if lines else "")
            fh.flush()
            if rejects:
                with _REJECTS.open("a", encoding="utf-8") as rf:
                    rf.write("\n".join(rejects) + "\n")
            state["ok"] += ok
            state["bad"] += bad
            state["done"] += 1
            if state["done"] % 25 == 0 or state["done"] == len(batches):
                print(f"  {state['done']:>5,}/{len(batches):,} 批 · "
                      f"決策 {state['ok']:,} · 拒收/失敗 {state['bad']:,}", flush=True)

    with _DECISIONS.open("a", encoding="utf-8") as fh:
        await asyncio.gather(*(one(b, fh) for b in batches))
    print(f"\n完成：決策 {state['ok']:,} 個位置 · 拒收或失敗 {state['bad']:,}")



def gate(work: dict) -> int:
    """⭐ 驗證者 3：覆蓋率 —— 任何沒被判過的破音字位置都是紅燈。

    窮舉法的完成定義只有一個：**沒有位置是空的**。
    這個 gate 存在的理由是 MAX_TOKENS ——
    回應被截斷時 JSON 會被自動修好、看起來成功，但尾段的讀音靜默消失。
    那種缺漏不會讓任何測試變紅，只有逐位置點名才抓得到。
    """
    decided = load_decided()
    missing: list[tuple[str, int, str, str]] = []
    total = 0
    for sha, item in work.items():
        have = decided.get(sha, {})
        for t in item["targets"]:
            total += 1
            if t["u16"] not in have:
                missing.append((sha, t["u16"], t["char"], item["text"][:40]))
    done = total - len(missing)
    pct = done / total * 100 if total else 100.0
    print(f"覆蓋率：{done:,} / {total:,} 個破音字位置（{pct:.3f}%）")
    if not missing:
        print("✅ 沒有未判的位置")
        return 0
    print(f"🔴 還有 {len(missing):,} 個位置沒有決策")
    import collections as _c
    by_char = _c.Counter(m[2] for m in missing)
    for ch, n in by_char.most_common(10):
        print(f"   「{ch}」 {n:,} 處")
    print("   例：", missing[0][3])
    return 1


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--plan", action="store_true")
    ap.add_argument("--run", action="store_true")
    ap.add_argument("--limit", type=int)
    ap.add_argument("--lesson", help="只跑某一課（酸測用，例：L0018）")
    ap.add_argument("--gate", action="store_true",
                    help="覆蓋率門：任何未判的位置回非零（給 CI 用）")
    a = ap.parse_args()

    slots = load_slots()
    work = collect_work(slots)
    pos = sum(len(it["targets"]) for it in work.values())
    print(f"封閉語料：{len(work):,} 個相異句子 · {pos:,} 個破音字位置")

    if a.plan:
        chars = collections.Counter(t["char"] for it in work.values() for t in it["targets"])
        print(f"涉及 {len(chars):,} 種破音字 · 最多的: "
              + ", ".join(f"{c}({n})" for c, n in chars.most_common(8)))
        print(f"批次大小 {_BATCH} → 約 {len(work) // _BATCH + 1:,} 次 LLM 呼叫")
        return 0
    if a.lesson:
        work = {k: v for k, v in work.items() if a.lesson in v["lessons"]}
        print(f"  --lesson {a.lesson} → {len(work):,} 句 · "
              f"{sum(len(i['targets']) for i in work.values()):,} 個位置")
    if a.gate:
        raise SystemExit(gate(work))
    if a.run:
        asyncio.run(run(work, a.limit, slots))
        return 0
    ap.print_help()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
