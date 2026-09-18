"""鎖住逐筆寫死的注音修正。

## 為什麼是鎖位置，不是鎖規則

這個檔案的第一版鎖的是「詞 → 讀音」，例如「目的」必須讀 ㄉㄧˋ。
那是規則，而規則會寫到別人的詞上：「目的」的比對命中了「項**目的**臺灣選手」
（項目＋的，該讀 ㄉㄜ˙）13 處、「因為」命中「原**因為**何」8 處、
「長什麼」命中「擅**長什麼**」2 處。我為了擋這些又去列了一份前字黑名單
（題／科／節／書／帳／條／數／曲／劇）—— 那份清單有一半是我憑印象寫的，
替**我沒看過的詞**訂了規則。

課文是封閉的。答案是位置清單。

    data/zhuyin/polyphonic_fixes.json   429 個位置 / 123 課

每一筆是 `(sha256(句子)[:16], UTF-16 位置, 從什麼讀音, 改成什麼)`，
加一個 `word` 欄位給人在 git diff 裡看脈絡。它只會動到被人看過的位置。

## 這份鎖在測什麼

① 清單裡每個位置，課文表現在真的是那個讀音（改壞會紅）
② 清單裡的字跟課文表對得上（課文被重抽而位移 → 紅）
③ 家長回報過的那一課確實在清單裡（L0018《長高的祕密》）

## 新的回報怎麼進來

有人說某個字讀錯 → 找出那個位置 → 加進 `polyphonic_fixes.json` →
這支測試會先紅 → 套用 → 綠。⛔ 不要為了涵蓋更多而把它改回規則。
"""
from __future__ import annotations

import collections
import hashlib
import json
from pathlib import Path

import pytest

_BACKEND = Path(__file__).resolve().parents[1]
_LESSONS = _BACKEND / "data" / "lessons"
_SLOTS = _BACKEND / "data" / "zhuyin" / "font_slot_readings.json"
_FIXES = _BACKEND / "data" / "zhuyin" / "polyphonic_fixes.json"


def _u16(text: str) -> list[str | None]:
    out: list[str | None] = []
    for ch in text:
        out.append(ch)
        if ord(ch) > 0xFFFF:
            out.append(None)
    return out


def _sha(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


@pytest.fixture(scope="module")
def actual() -> dict:
    """走完課文表，回 {(sha, u16): (字, 現在的讀音)}，只收清單關心的位置。"""
    slots = json.loads(_SLOTS.read_text(encoding="utf-8"))["slots"]
    fixes = json.loads(_FIXES.read_text(encoding="utf-8"))["fixes"]
    wanted = {(f["sha"], f["u16"]) for f in fixes}
    out: dict = {}
    for path in sorted(_LESSONS.glob("L*/v*/zhuyin.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        for t in data.get("texts") or []:
            text, ssz = t.get("text"), t.get("ssz")
            if not isinstance(text, str) or not isinstance(ssz, str):
                continue
            units = _u16(text)
            if len(units) != len(ssz):
                continue
            sha = _sha(text)
            for i, ch in enumerate(units):
                if (sha, i) not in wanted or ch is None:
                    continue
                code = ssz[i]
                slot = "0000" if code == "." else f"ss0{code}"
                out[(sha, i)] = (ch, slots.get(ch, {}).get(slot))
    return out


@pytest.fixture(scope="module")
def fixes() -> list[dict]:
    data = json.loads(_FIXES.read_text(encoding="utf-8"))
    assert data["fixes"], "清單是空的 —— 這支測試會變成空轉"
    return data["fixes"]


def test_every_fix_is_present_in_the_lesson_tables(fixes, actual):
    """清單裡的位置必須在課文表裡找得到。找不到 = 課文被重抽而修正遺失。"""
    missing = [f for f in fixes if (f["sha"], f["u16"]) not in actual]
    assert not missing, (
        f"{len(missing)} 個修正的位置在課文表裡找不到，例："
        f"{missing[0]['lesson']} 「{missing[0]['word']}」"
    )


def test_every_fix_reads_what_it_says(fixes, actual):
    """清單裡每個位置，現在真的是那個讀音。"""
    wrong = []
    for f in fixes:
        ch, got = actual[(f["sha"], f["u16"])]
        if got != f["to"]:
            wrong.append(f"{f['lesson']} 「{f['word']}」的「{f['char']}」"
                         f"該 {f['to']} 實際 {got}")
    assert not wrong, f"{len(wrong)} 個位置讀音不對：\n  " + "\n  ".join(wrong[:12])


def test_fix_list_characters_match_the_corpus(fixes, actual):
    """清單記的字跟課文表對得上 —— 對不上代表位移，那會毀掉整課的注音。"""
    drift = []
    for f in fixes:
        ch, _ = actual[(f["sha"], f["u16"])]
        if ch != f["char"]:
            drift.append(f"{f['lesson']} @{f['u16']} 清單「{f['char']}」"
                         f"課文「{ch}」")
    assert not drift, f"{len(drift)} 個位置的字對不上：\n  " + "\n  ".join(drift[:12])


def test_the_reported_lesson_is_covered(fixes):
    """家長 2026-09-18 回報的那一課 —— L0018《長高的祕密》的「長」讀成 ㄔㄤˊ。

    這條不是規則，是點名那個真實回報。它防的是「修正清單被清空或重建時，
    最初的那個 bug 悄悄掉出去」。
    """
    l0018 = [f for f in fixes if f["lesson"] == "L0018" and f["char"] == "長"]
    assert l0018, "L0018 的「長」不在修正清單裡 —— 那是最初被回報的 bug"
    assert all(f["to"] == "ㄓㄤˇ" for f in l0018), (
        f"L0018 的「長」應該全部改成 ㄓㄤˇ，實際有 "
        f"{collections.Counter(f['to'] for f in l0018)}"
    )


#: 字型畫不出來、而且**刻意不正規化**的字。逐課完整性只容許這 8 處。
#: 2026-09-18：課文原本有 19 種字型沒有的字（77 處），16 種正規化成標準體
#: （爲→為、絶→絕、脱→脫、纠→糾、説→說、没→沒、靭→韌、歳→歲、条→條、
#:  吿→告、啓→啟、点→點、响→響、麽→麼、鈎→鉤、着→著，共 69 處）。
#: 這三種留著，理由寫在下面 —— 它們不是錯字。
FONT_GAP: dict[str, str] = {
    "吔": "台灣口語語尾（「很ㄙㄨㄥˊ吔」「缺人吔」），刻意用字不是異體字",
    "凃": "人名（凃文），不改別人的名字",
    "軁": "台語漢字（諺語「痟貪軁雞籠」）",
}
FONT_GAP_TOTAL = 8


def test_every_character_in_every_lesson_has_a_reading():
    """逐課完整性：每一課的每一個漢字，表上指到的槽位在字型裡都畫得出來。

    這就是「窮舉」的驗收條件 —— 逐課都有該上去的注音，而那張表就是該課的 SOT。
    唯一容許的缺口是 FONT_GAP 那三種字（8 處），而且**數量寫死**：
    多出一處就紅，不管是課文新增了字型沒有的字、或有人加了新的異體字。
    """
    all_readings = _BACKEND / "data" / "zhuyin" / "font_all_readings.json"
    if not all_readings.is_file():
        pytest.skip(f"{all_readings.name} 不在（由 extract_font_readings.py 產生）")
    raw = json.loads(all_readings.read_text(encoding="utf-8"))
    readings = raw.get("slots", raw)

    def is_cjk(ch: str | None) -> bool:
        return bool(ch) and (("一" <= ch <= "鿿") or ("㐀" <= ch <= "䶿"))

    gaps: collections.Counter = collections.Counter()
    misaligned: list[str] = []
    for path in sorted(_LESSONS.glob("L*/v*/zhuyin.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        uid = path.parts[-3]
        for t in data.get("texts") or []:
            text, ssz = t.get("text"), t.get("ssz")
            if not isinstance(text, str) or not isinstance(ssz, str):
                continue
            units = _u16(text)
            if len(units) != len(ssz):
                misaligned.append(f"{uid} {t.get('section')}")
                continue
            for i, ch in enumerate(units):
                if not is_cjk(ch):
                    continue
                slot = "0000" if ssz[i] == "." else f"ss0{ssz[i]}"
                if readings.get(ch, {}).get(slot) is None:
                    gaps[ch] += 1

    assert not misaligned, (
        f"{len(misaligned)} 個字串的 ssz 長度跟文字對不上 —— 那會讓整段注音位移："
        f"{misaligned[:5]}"
    )
    unexpected = {ch: n for ch, n in gaps.items() if ch not in FONT_GAP}
    assert not unexpected, (
        f"課文出現字型畫不出來的新字：{unexpected}。"
        f"要嘛正規化成標準體，要嘛加進 FONT_GAP 並寫明為什麼不改"
    )
    assert sum(gaps.values()) == FONT_GAP_TOTAL, (
        f"字型缺口從 {FONT_GAP_TOTAL} 處變成 {sum(gaps.values())} 處：{dict(gaps)}"
    )
