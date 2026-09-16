"""#3230 —— 服務端送出去的每一個字串都必須在注音表裡（端到端窮舉鎖）。

## 為什麼要這一條

窮舉法的前提是「**表的 key 就是消費端會拿到的字串**」。表存在、逐課都有、
長度也對得上，全部都可以成立，而消費端拿到的卻是**另一個字串** —— 那時它會
靜靜掉回舊的執行期選擇器，畫面上看不出任何異狀。

2026-09-16 實測就是這樣：產生器自己走一遍 yml，伺服器用 `build_all_lessons()`
組課文，兩者不一樣 → **179 課裡有 28 處服務端文字不在表裡**
（L0157 服務 10 段、表只有 5 段；L0020/L0097/L0119 的 `key_reading` 被前端按
`\n` 切行，而表存的是整段），那 28 處全部走 fallback。

⛔ 既有的三道檢查都抓不到它：
   - `test_lesson_zhuyin_all_lessons_3218` 驗的是「表自己內部一致」（ss 長度 == 課文長度）
   - `--check` 比的是「表 vs 產生器自己收的文字」—— 兩邊用同一個錯的收法，對得上
   - 逐課 TDD 驗「有課就有表」—— 表在，只是 key 不對

所以這一條的量具必須是**伺服器那一支函式**，不是產生器的收法。
"""
from __future__ import annotations

import glob
import json
import re
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]


def _text_of(v) -> str:
    if isinstance(v, str):
        return v
    if isinstance(v, dict):
        return v.get("text") or ""
    return ""


_CJK = re.compile(r"[\u3400-\u9fff\uf900-\ufaff]")
_SKIP_KEYS = {
    "thumbnail_url", "knowledge_video_url", "worksheet_docx_url", "worksheet_pdf_url",
    "source_file", "lesson_uid", "slug", "id", "grade_code", "text_ref",
}
_INTERNAL_KEY = re.compile(
    r"(answer_note|_note$|^notes$|^qa|review|errata|provenance|evidence|rationale"
    r"|verdict|audit|debug|todo|comment)", re.I)


def served_strings(lesson: dict) -> list[tuple[str, str]]:
    """消費端真的可能餵進 `toProcessed()` 的每一個中文字串。

    ⛔ 遞迴收整份，**不是**列欄位 —— `useZhuyin()` 有 19 個消費端，
    餵進去的不只課文段落（還有課名、題幹、選項、生詞、釋義、聚光燈、重點表…）。
    列欄位那條路的失敗模式是「每加一個元件就悄悄多一個漏洞」：
    2026-09-16 實測，表只涵蓋 6 種課文表面時，那十幾種一個都不在表裡。

    這裡的收法必須跟產生器的 `collect_served_texts()` 同語意 —— 兩邊都改才算改。
    """
    found: list[tuple[str, str]] = []

    def walk(node, path: str, depth: int = 0) -> None:
        if depth > 8:
            return
        if isinstance(node, str):
            if node.strip() and len(node) <= 1200 and _CJK.search(node):
                found.append((path, node))
                if "\n" in node:
                    for line in node.split("\n"):
                        if line.strip() and _CJK.search(line):
                            found.append((path + "#line", line))
        elif isinstance(node, dict):
            for k, v in node.items():
                if str(k) in _SKIP_KEYS or _INTERNAL_KEY.search(str(k)):
                    continue
                walk(v, f"{path}.{k}" if path else str(k), depth + 1)
        elif isinstance(node, list):
            for n, v in enumerate(node):
                walk(v, f"{path}[{n}]", depth + 1)

    walk(lesson, "")
    return found


@pytest.fixture(scope="module")
def served() -> dict:
    from app.services.lesson_indexes import build_all_lessons

    return {L["lesson_uid"]: L for L in build_all_lessons() if L.get("lesson_uid")}


@pytest.fixture(scope="module")
def tables() -> dict:
    out = {}
    for f in sorted(glob.glob(str(BACKEND / "data/lessons/*/v*/zhuyin.json"))):
        d = json.load(open(f, encoding="utf-8"))
        out[d["lesson_uid"]] = {t["text"] for t in (d.get("texts") or [])}
    return out


def test_每一課都有表(served, tables):
    missing = sorted(set(served) - set(tables))
    assert not missing, f"這些課沒有 zhuyin.json：{missing}"


def test_服務端送出去的每一個字串都在表裡(served, tables):
    """⭐ 主鎖。MISS > 0 = 那幾處會掉回舊選擇器。"""
    misses = []
    total = 0
    for uid, lesson in sorted(served.items()):
        keys = tables.get(uid, set())
        for kind, s in served_strings(lesson):
            total += 1
            if s not in keys and s.strip() not in keys:
                misses.append((uid, kind, s[:50]))
    assert total > 35000, f"量具壞了 —— 只掃到 {total} 個字串（預期 >35000）"
    assert not misses, (
        f"{len(misses)}/{total} 個服務端字串不在表裡（會掉回舊選擇器）：\n"
        + "\n".join(f"  {u} [{k}] {s}" for u, k, s in misses[:15])
    )


def test_表裡的每一段都能對回自己的槽位長度(tables):
    """⛔ 正向對照：表本身沒壞（否則上面那條可能是在對一張空表）。

    ⛔ 長度一律用 **UTF-16 單位**（#3230）—— `len(text)` 是碼點，
    非 BMP 字（課名〈𪹚龍慶元宵〉的 U+2AE5A）會差一格，而槽位是照 UTF-16 產的。
    """
    from app.services.lesson_zhuyin import u16_chars, unpack_slots

    bad = []
    n = 0
    for f in sorted(glob.glob(str(BACKEND / "data/lessons/*/v*/zhuyin.json"))):
        d = json.load(open(f, encoding="utf-8"))
        for t in d.get("texts") or []:
            n += 1
            slots = unpack_slots(t.get("ssz") or "")
            if not (len(slots) == t.get("n") == len(u16_chars(t.get("text") or ""))):
                bad.append((d["lesson_uid"], t.get("section"), t.get("n"), len(slots)))
    assert n > 35000, f"量具壞了 —— 只掃到 {n} 段（預期 >35000）"
    assert not bad, f"這些段的槽位長度對不上課文：{bad[:10]}"
