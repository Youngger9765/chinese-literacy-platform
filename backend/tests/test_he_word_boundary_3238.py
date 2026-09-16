"""#3238 —— 「和」的詞界：全庫鎖。

## 教育部國語辭典（萌典 API `/uni/和`，2026-09-17 查）

    ㄏㄢˋ    [連] (一)之語音 —— 連接詞
    ㄏㄜˊ    總和／講和／議和／大和民族…（名詞義）
    ˙ㄏㄨㄛ  暖和（溫暖的）
    ㄏㄜˋ    附和／唱和（聲音相應）
    ㄏㄨㄛˋ  攪和／和麵
    ㄏㄨˊ    和牌

## 修之前：2,856 個「和」裡有 176 處讀錯

三個各自獨立的成因：

**① jieba 的 HMM 把「和」黏進鄰詞（82 處）。** HMM 是 jieba「從沒見過的字串自己造新詞」
的那一段，而它是簡體語料訓練的 —— 對繁體課文：

    象鼻/蟲和黃面/蜂 · 臺/灣和/周邊 · 佳恩和子/皓 · 像/銅和鐵/做/的/牆 · 狗狗/和貓/咪

關掉 HMM 全部切開，而真的「和」詞仍成立（字典比對不受 HMM 影響）。

**② 「和」沒被當成獨立詞（12 處）。** 它是單字功能詞，`add_word("和", freq=2_000_000)`
再修 大衛|和|歌利亞、農民|和|企業、新加坡|和|澳洲。

**③ 例外清單跨詞界誤中（75 處 + 7 處）。** 清單是子字串比對：

    人和 ×35（家人|和|自己）· 中和 ×14（老中|和|老美）· 和氣 ×8（濕度|和|氣壓）
    和風 ×6（人物|和|風景）· 暖和 ×6（溫暖|和|改變）· 言和 ×3（語言|和|文化）
    求和 ×1 · 和善 ×1 · 太和 ×1

這 9 個詞在**這份語料裡真用例是 0**，所以移到 `_dropped_boundary_collision_3238`
（每一筆都記了理由與判定方式）。另外 7 處的碰撞詞（和解／和服／和尾／不和）**有真用例**，
不能整個移除 → 逐處走 `lesson_corrections.json`。

## 結果

    ㄏㄢˋ 2,586 → 2,762  ·  ㄏㄜˊ 263 → 93  ·  ㄏㄨㄛ˙ 6 → 0  ·  ㄏㄜˋ 1 → 1

⭐ 剩下的 93 處 ㄏㄜˊ，**每一處的上下文都有真的「和」詞**（和尚／和解／溫和／和好／
緩和／和諧／和平／柔和／隨和／祥和／耶和華）—— 這條就是那個斷言。

## ⚠️ 這不是通解

jieba 的繁體問題是長尾；這裡做的是**把這份語料裡量到的錯逐一修掉**（語料是封閉的，
179 課，這正是窮舉法可行的前提）。哪天做出真的詞界解析器，那 7 筆個案修正要一起移除。
"""
from __future__ import annotations

import glob
import json
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]

#: 教育部收的「和」詞（讀音不是 ㄏㄢˋ 的）—— 語料裡剩下讀 ㄏㄜˊ 的位置必須落在其中之一
REAL_HE_WORDS = (
    "和尚", "和解", "溫和", "和好", "緩和", "和諧", "和平", "柔和",
    "隨和", "祥和", "耶和華", "附和", "講和", "議和", "總和", "和約",
)


@pytest.fixture(scope="module")
def positions() -> list[tuple]:
    """全庫每一個「和」：(uid, slot, 上下文)"""
    from app.services.lesson_zhuyin import u16_chars, unpack_slots

    out = []
    for f in sorted(glob.glob(str(BACKEND / "data/lessons/*/v*/zhuyin.json"))):
        d = json.load(open(f, encoding="utf-8"))
        for t in d.get("texts") or []:
            units = u16_chars(t["text"])
            slots = unpack_slots(t.get("ssz") or "")
            for i, ch in enumerate(units):
                if ch == "和":
                    out.append((d["lesson_uid"], slots[i],
                                "".join(units[max(0, i - 10):i + 9])))
    return out


def test_量具抓得到全庫的和(positions):
    """⛔ 量具自檢 —— 抓不到足夠的位置，下面的斷言什麼都不證明。"""
    assert len(positions) > 2500, f"只抓到 {len(positions)} 個「和」（預期 >2500）"


def test_讀ㄏㄜˊ的位置上下文一定有真的和詞(positions):
    """⭐ 主鎖。修之前有 176 處違反（家人和自己、濕度和氣壓、溫暖和改變…）。"""
    bad = [(u, c) for u, slot, c in positions
           if slot == "0000" and not any(w in c for w in REAL_HE_WORDS)]
    assert not bad, (
        f"{len(bad)} 處讀 ㄏㄜˊ 但上下文沒有任何教育部收的「和」詞 —— 應該是連接詞 ㄏㄢˋ：\n"
        + "\n".join(f"  {u} …{c}…" for u, c in bad[:15])
    )


def test_沒有位置讀成暖和的輕聲(positions):
    """⛔ `暖和`（˙ㄏㄨㄛ）在這份語料裡真用例是 0 —— 全是 溫暖|和 的誤中。"""
    bad = [(u, c) for u, slot, c in positions if slot == "ss04"]
    assert not bad, f"又出現 ˙ㄏㄨㄛ：{bad[:5]}"


def test_連接詞是絕對多數_但不是全部(positions):
    """⛔ 正反對照：不是「把所有和都刷成 ㄏㄢˋ」（那會弄壞和尚／和解／溫和）。"""
    han = sum(1 for _, s, _ in positions if s == "ss01")
    he = sum(1 for _, s, _ in positions if s == "0000")
    assert han > 2500, f"ㄏㄢˋ 只有 {han} 處"
    assert he > 50, f"ㄏㄜˊ 只有 {he} 處 —— 例外清單可能整個失效了"
    assert any(s == "ss02" for _, s, _ in positions), "ㄏㄜˋ（附和）不見了"


@pytest.mark.parametrize("word,slot,why", [
    ("和尚", "0000", "剃度成為小和尚"),
    ("大和解", "0000", "期待的大和解落空"),
    ("溫和", "0000", "用溫和的言語"),
    ("附和", "ss02", "一起附和"),
])
def test_真的和詞沒被刷掉(positions, word, slot, why):
    """⛔ 逐案反向對照 —— 把具體的真詞寫死，免得將來被整批刷成一邊。"""
    hits = [s for _, s, c in positions if word in c]
    assert hits, f"語料裡找不到「{word}」—— 這條鎖已經量不到東西了"
    assert slot in hits, f"「{word}」（{why}）沒有任何一處讀 {slot}：{set(hits)}"


def test_移出清單的詞都記了理由():
    """⛔ 那 9 個被移出例外清單的詞，每一個都要有寫下來的判定理由。

    ⭐ 少了這條，下一個人（或我自己）會把它們「看起來是詞」地加回去，
    而那會再誤擋 75 處。
    """
    p = BACKEND / "data/tts/he_exceptions.json"
    d = json.load(open(p, encoding="utf-8"))
    dropped = d.get("_dropped_boundary_collision_3238") or {}
    words = {k for k in dropped if not k.startswith("_")}
    assert len(words) >= 9, f"只記了 {len(words)} 個：{words}"
    for w in words:
        assert w not in d["words"], f"「{w}」同時在 words 與移出清單裡 —— 矛盾"
        assert len(dropped[w]) > 20, f"「{w}」的理由太短，寫清楚為什麼"
    assert "_why" in dropped, "缺整體說明"
