"""#3236 —— 「相」的讀音全庫鎖。

## 教育部國語辭典（萌典 API `/uni/相`，2026-09-17 查）

    ㄒㄧㄤ   [副] 交互，兩方面都進行 —— 互相、守望相助、兩地相思、相得益彰
             [副] 彼此，強調雙方比較後的差異 —— 相異、相像、旗鼓相當
             [助] 由交互演變為單方面 —— 有事相煩、實不相瞞
    ㄒㄧㄤˋ  [動] 審視／占視／輔佐／掌管／挑選 —— 相字、相夫教子、相人
             [名] 容貌 —— 長相、福相、吃相；相片／相機／照相；宰相／丞相／首相

⭐ **ㄒㄧㄤˋ 是封閉集，ㄒㄧㄤ 是預設。** 所以鎖只需要列得出 ㄒㄧㄤˋ 的詞 ——
交互義那條尾巴沒有頭（相信/相同/相處/相關/相反/相符/相向/相覷/相看/相悖/相爭/
相棄/相及/相視/相謂…窮舉不完）。

## 出貨 processor 的錯誤是系統性的

修之前全庫 1,301 個「相」有 **36 處**把交互義讀成 ㄒㄧㄤˋ：
環環相扣 ×6、遠來相視 ×8、賊相謂曰 ×3、餓餒相及 ×3、互不相讓 ×3、爭相報導 ×2、
於是相隨往 ×2、相違背／相傳／互相獨立／兩相宜／自相矛盾／相悖／相爭／相棄／
花色相同／將相關 各 1–2 處，分佈在 17 課。

## 兩個踩過的坑（都寫在這裡，不要再犯）

**① 封閉集不可以放會跨詞界誤命中的詞。** 第一版我放了 `出相`／`面相`／`福相`，
誤命中 **37 處**本來就正確的「找出+相同」「面面+相覷」「禍福+相倚」。

**② 比對一定要在 UTF-16 單位上做。** 第一版 `_xiang4_at()` 收原字串、用 UTF-16 位移
去索引（Python 是碼點）→ L0001 的 `相傳「炸龍」`（同段有 𪹚 U+2AE5A）與 L0075 的
`兩條互相獨立` **沒被裁決到**。這個索引坑在 #3230 那一輪咬了三次。
"""
from __future__ import annotations

import glob
import json
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]

# ⚠️ 每一筆都要是「相」在詞中位置固定、不會跨詞界誤命中的（見 ① ）
XIANG4_WORDS = (
    "長相", "吃相", "窘相", "窮酸相", "睡相", "站相", "坐相", "醜相", "怪相", "傻相",
    "相片", "相簿", "相機", "照相", "相館", "相框",
    "宰相", "丞相", "首相", "相位", "相國", "相爺", "拜相", "相夫教子", "相不賢",
    "真相", "月相", "亮相", "相人", "相字", "相馬", "相術", "相士", "相命", "相貌",
    "相聲", "露相",
)


def u16(text: str) -> list[str]:
    from app.services.lesson_zhuyin import u16_chars
    return u16_chars(text)


def xiang4_at(units: list[str], i: int) -> str | None:
    for w in XIANG4_WORDS:
        k = w.index("相")
        s = i - k
        if s >= 0 and "".join(units[s:s + len(w)]) == w:
            return w
    return None


@pytest.fixture(scope="module")
def positions() -> list[tuple]:
    """全庫每一個「相」：(uid, section, 目前槽位, 該讀的槽位, 上下文)"""
    from app.services.lesson_zhuyin import unpack_slots

    out = []
    for f in sorted(glob.glob(str(BACKEND / "data/lessons/*/v*/zhuyin.json"))):
        d = json.load(open(f, encoding="utf-8"))
        for t in d.get("texts") or []:
            units = u16(t["text"])
            slots = unpack_slots(t.get("ssz") or "")
            for i, ch in enumerate(units):
                if ch != "相":
                    continue
                want = "0000" if xiang4_at(units, i) else "ss01"
                out.append((d["lesson_uid"], t.get("section"), slots[i], want,
                            "".join(units[max(0, i - 8):i + 8])))
    return out


def test_量具抓得到全庫的相(positions):
    """⛔ 量具自檢：抓不到足夠的位置，下面兩條就什麼都不證明。"""
    assert len(positions) > 1200, f"只抓到 {len(positions)} 個「相」（預期 >1200）"


def test_交互義一律讀ㄒㄧㄤ(positions):
    """⭐ 主鎖。"""
    bad = [(u, s, c) for u, sec, cur, want, c in positions
           if want == "ss01" and cur != want for s in [sec]]
    assert not bad, (
        f"{len(bad)} 處交互義的「相」讀成 ㄒㄧㄤˋ：\n"
        + "\n".join(f"  {u} [{s}] …{c}…" for u, s, c in bad[:15])
    )


def test_封閉集那些詞一律讀ㄒㄧㄤˋ(positions):
    """⛔ 反向對照：不是把所有「相」都刷成 ㄒㄧㄤ（否則上一條是假的）。"""
    bad = [(u, sec, c) for u, sec, cur, want, c in positions
           if want == "0000" and cur != want]
    assert not bad, (
        f"{len(bad)} 處名詞/動詞義的「相」讀成 ㄒㄧㄤ：\n"
        + "\n".join(f"  {u} [{s}] …{c}…" for u, s, c in bad[:15])
    )


def test_兩種讀音都真的存在(positions):
    """⛔ 正向對照：兩邊都要有量，否則上面兩條可能是在對一個全同的集合。"""
    n1 = sum(1 for *_, want, _ in positions if want == "ss01")
    n4 = sum(1 for *_, want, _ in positions if want == "0000")
    assert n1 > 1000, f"ㄒㄧㄤ 只有 {n1} 處"
    assert n4 > 50, f"ㄒㄧㄤˋ 只有 {n4} 處 —— 封閉集可能沒在作用"


def test_具名的那幾個都對(positions):
    """把家長／稽核點名的個案寫死，避免將來被『整批刷成某一邊』蓋過去。"""
    want_xiang = ["爭相報導", "相隨往", "餓餒相及", "遠來相視", "賊相謂曰",
                  "環環相扣", "互不相讓", "自相矛盾", "相傳", "互相獨立"]
    want_xiang4 = ["宰相", "長相", "相機", "月相", "真相", "亮相", "相人"]
    ctxs = {c: (cur, want) for *_, cur, want, c in
            [(u, s, cur, want, c) for u, s, cur, want, c in positions]}
    for w in want_xiang:
        hits = [(cur, want) for c, (cur, want) in ctxs.items() if w in c]
        assert hits, f"語料裡找不到「{w}」—— 這條鎖已經量不到東西了"
        assert all(cur == "ss01" for cur, _ in hits), f"「{w}」沒有全部讀 ㄒㄧㄤ"
    for w in want_xiang4:
        hits = [(cur, want) for c, (cur, want) in ctxs.items() if w in c]
        assert hits, f"語料裡找不到「{w}」"
        assert any(cur == "0000" for cur, _ in hits), f"「{w}」沒有讀 ㄒㄧㄤˋ"
