"""#3264 —— 「兒」的輕聲樣式 `個*` 跨詞界誤中「個/兒童」

## 怎麼發現的（重點）

**不是測試、不是複審，是對外部權威量正確率**：抽 120 種 (字,槽) 組合問
教育部辭典（`moedict.tw`，repo 裡 `dictionary_service.py` 本來就在用）
「這個讀音是這個字的合法讀音嗎」——

    在辭典的合法集合裡          102 種（85.0%）
    變調／輕聲（辭典不另收）      17 種（14.2%）
    真的不是合法讀音             1 種（0.8%）  ← 就是這個

那一種是 `兒 → ㄦ`，而辭典只有 ㄦˊ／ㄋㄧˊ。

## 根因跟「和」同一型

`poyin_db.data['兒'].v[1]`（輕聲樣式）原本含 `個*`，而樣式是**純子字串比對、
沒有檢查目標字的右邊界** —— 所以「3個兒童」裡的「個兒」被搶走，「兒」讀成輕聲 ㄦ。

語料實測：`個兒` 命中 8 處，**全部是誤中**（個|兒童 5、個|兒子 3），
「個兒」（ㄍㄜˋ ㄦ，身高／個頭）是真詞但這套教材 0 處真用例。
（其中 3 處「個兒子」在修之前就已經是 ㄦˊ —— 被別的規則先接走，所以實際改變 5 處。）

## 這一份鎖什麼

1. 「兒童」的「兒」一律 ㄦˊ，不管前面那個字是什麼
2. 真的輕聲用例（魚兒／鳥兒／哪兒／點兒）**不可以被連坐** ← 負向對照
3. `個*` 不在輕聲樣式裡
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[2]
_LESSONS = _ROOT / "backend" / "data" / "lessons"
_POYIN = _ROOT / "frontend" / "public" / "data" / "poyin_db.json"
_SLOTS = json.loads(
    (_ROOT / "backend" / "data" / "zhuyin" / "font_slot_readings.json").read_text(encoding="utf-8")
)["slots"]["兒"]


def _u16(text: str) -> list[str | None]:
    out: list[str | None] = []
    for ch in text:
        out.append(ch)
        if ord(ch) > 0xFFFF:
            out.append(None)
    return out


def _er_readings() -> dict[str, list[tuple[str, str]]]:
    """語料裡每一個「兒」→ (前後文, 讀音)，按「前一字+兒+後一字」分組。"""
    out: dict[str, list[tuple[str, str]]] = {}
    for p in sorted(_LESSONS.glob("L*/v*/zhuyin.json")):
        d = json.loads(p.read_text(encoding="utf-8"))
        for t in d.get("texts") or []:
            txt, z = t.get("text"), t.get("ssz")
            if not isinstance(txt, str) or not isinstance(z, str) or "兒" not in txt:
                continue
            u = _u16(txt)
            for i, c in enumerate(z):
                if i >= len(u) or u[i] != "兒":
                    continue
                cp = sum(1 for k in range(i) if u[k] is not None)
                ctx = txt[max(0, cp - 1):cp + 2]
                slot = "0000" if c == "." else f"ss0{c}"
                out.setdefault(ctx, []).append((p.parts[-3], _SLOTS.get(slot, slot)))
    return out


def test_er_tong_is_always_second_tone():
    """「兒童」的「兒」= ㄦˊ，不管前面那個字是什麼（辭典：ㄦˊ ㄊㄨㄥˊ）。"""
    bad = []
    for ctx, rows in _er_readings().items():
        if not ctx.endswith("童") or "兒" not in ctx:
            continue
        for uid, reading in rows:
            if reading != "ㄦˊ":
                bad.append((uid, ctx, reading))
    assert bad == [], f"這些「兒童」的兒不是 ㄦˊ：{bad[:8]}"


@pytest.mark.parametrize("ctx_tail,word", [("兒", "魚兒"), ("兒", "鳥兒")])
def test_real_neutral_tone_uses_are_not_collateral_damage(ctx_tail: str, word: str):
    """負向對照：真的輕聲用例不可以被連坐。

    少了這條，「把整條輕聲樣式刪掉」也會讓上面那條綠 —— 而那會讓魚兒／鳥兒全部讀錯。
    """
    hits = [
        (uid, ctx, r)
        for ctx, rows in _er_readings().items()
        for uid, r in rows
        if ctx.startswith(word[0]) and "兒" in ctx
    ]
    assert hits, f"語料裡找不到「{word}」—— 這條負向對照量不到東西，換一個詞"
    wrong = [h for h in hits if h[2] != "ㄦ"]
    assert wrong == [], f"「{word}」的兒應該是輕聲 ㄦ，這些不是：{wrong[:5]}"


def test_ge_star_is_out_of_the_neutral_tone_pattern():
    """`個*` 不在輕聲樣式裡 —— 它是上面那個誤中的來源。"""
    raw = json.loads(_POYIN.read_text(encoding="utf-8"))
    pattern = raw["data"]["兒"]["v"][1]
    assert "個*" not in pattern, (
        "「個*」回到輕聲樣式了 —— 它會讓「個/兒童」誤讀成輕聲。"
        "要放回必須先讓樣式比對認得詞界（見產生器檔頭的對照表）"
    )
    # 正向對照：樣式本身還在，不是被整條清掉
    assert "魚*" in pattern and "鳥*" in pattern, f"輕聲樣式被清掉了：{pattern}"
