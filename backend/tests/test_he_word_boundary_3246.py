"""#3246 —— 「和」的詞界：例外清單改成對齊斷詞邊界。

## #3238 收工時剩下什麼

#3238 把 176 處壓到 16 處，靠的是「把這份語料裡量到的錯逐一修掉」。
剩下的 16 處分兩堆：**9 處出貨仍然是錯的**，7 處靠 `lesson_corrections.json` 壓住。

為什麼 #3238 的主鎖沒抓到那 9 處 —— 它問的是「上下文裡**有沒有出現**真的和詞」，
而那是**子字串**檢查，跟它要抓的 bug 是同一個形狀：

    感到困惑和好奇   上下文裡有「和好」→ 鎖判定通過，但這裡是連接詞
    理解和解釋       上下文裡有「和解」→ 同上

所以這一份的斷言改成**逐處寫死**：這 16 個位置各自該讀什麼。

## 根因（第二層，#3238 沒查到的那個）

jieba 的字典是簡體導向的，下面這些**繁體常用詞根本不在字典裡**：

    freq(和平)   = 7998    ← 正向對照，字典確實查得到
    freq(和解)   = 394
    freq(和服)   = 81
    freq(解釋)   = None    ← 字典裡只有「解释」
    freq(解決)   = None    ← 只有「解决」
    freq(服務業) = None
    freq(隊友)   = None
    freq(好朋友) = None
    freq(面臨)   = None

所以「理解|和解|釋」「工作|和服|務業」不是被誤判 —— 是**它們的對手根本不存在**，
和解／和服 不戰而勝。逐案修正表壓住的就是這些。

## 修法

例外清單的比對從**子字串**改成**對齊斷詞邊界**：例外詞的頭尾都要落在 token 邊界上
才算覆蓋。外加把 jieba 缺的那幾個繁體鄰詞補進字典。

⚠️ 三道門（斷詞獨立性／例外清單／自我指稱）**一道都沒有拿掉**。中途試過收成
「和所在的 token 不是例外詞就是連接詞」這一條規則，被既有測試
`test_he_conjunction.py::test_a_word_the_list_misses_is_still_caught_by_segmentation`
擋下來：`和煦` 不在那 371 筆清單裡，**是斷詞那道門在保護它**，收掉就讀錯。
那個版本因此作廢，斷詞門保留。

同理保留的還有 `add_word("和", freq=2_000_000)` 與 `HMM=False` ——
它們各自是 5 個與 82 個位置的唯一守衛，下面有 case 盯著。

## 量到的效果（全庫 2,856 處，真值人工標註）

    現行（不含逐案修正）        16 處錯
    改成對齊詞界                10 處錯
    ＋補繁體鄰詞                 2 處錯   ← 這一版

剩下 2 處都**不是**詞界問題，留 `lesson_corrections.json`（見
`test_逐案修正表的和只剩兩筆` 的說明）。
"""
from __future__ import annotations

import glob
import json
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]

#: 16 處已知的跨詞界誤判。片語要足以在該課唯一定位。
KNOWN_CROSS_BOUNDARY = [
    ("L0017", "困惑和好奇"),
    ("L0022", "、和平常不同"),
    ("L0038", "問題和解決方法"),
    ("L0038", "問題和解決辦法"),
    ("L0039", "勞力工作和服務業"),
    ("L0064", "你和好朋友吵架"),
    ("L0084", "新鮮感和好奇"),
    ("L0116", "和好友翻臉"),
    ("L0116", "壞事和好事"),
    ("L0116", "理解和解釋"),
    ("L0135", "嘴喙和尾羽"),
    ("L0176", "小庭和好友"),
    ("L0176", "你和好朋友一起參加"),
    ("L0179", "不和隊友說話"),
]


@pytest.fixture(scope="module")
def texts() -> list[tuple[str, str, str]]:
    """全庫每一段文字：(uid, text, ssz)"""
    out = []
    for f in sorted(glob.glob(str(BACKEND / "data/lessons/*/v*/zhuyin.json"))):
        d = json.load(open(f, encoding="utf-8"))
        for t in d.get("texts") or []:
            out.append((d["lesson_uid"], t["text"], t.get("ssz") or ""))
    return out


def _slots_of(text: str, ssz: str, phrase: str) -> list[str]:
    """`phrase` 裡那個「和」在這段文字中每次出現時的字型槽位。

    ⚠️ ssz 的第 i 個字元對應第 i 個 **UTF-16 單位**，不是 codepoint ——
    非 BMP 字會讓整串位移。所以先把文字展開成 UTF-16 單位再索引。
    """
    from app.services.lesson_zhuyin import u16_chars, unpack_slots

    units = u16_chars(text)
    slots = unpack_slots(ssz)
    if len(units) != len(slots):
        return []
    k = phrase.index("和")
    flat = "".join(units)
    found, start = [], 0
    while True:
        p = flat.find(phrase, start)
        if p == -1:
            return found
        found.append(slots[p + k])
        start = p + 1


def test_量具抓得到全庫的和(texts):
    """⛔ 量具自檢 —— 抓不到就下面全部不算數。"""
    total = sum(t.count("和") for _, t, _ in texts)
    assert total > 2500, f"只抓到 {total} 個「和」（預期 >2500）"


def test_量具定位得到片語(texts):
    """⛔ 正向對照 —— 每個片語都要真的在那一課找得到。

    少了這條，片語打錯字時 `_slots_of` 回空 list，主鎖會**靜靜地通過**。
    """
    for uid, phrase in KNOWN_CROSS_BOUNDARY:
        hits = [s for u, t, z in texts if u == uid for s in _slots_of(t, z, phrase)]
        assert hits, f"{uid} 找不到「{phrase}」—— 片語過期了，這條鎖已經量不到東西"


@pytest.mark.parametrize("uid,phrase", KNOWN_CROSS_BOUNDARY)
def test_跨詞界的和讀連接詞(texts, uid, phrase):
    """⭐ 主鎖：這 16 處都是連接詞，要讀 ㄏㄢˋ（ss01）。

    修之前全部讀 ㄏㄜˊ（0000）—— 例外清單用子字串比對，
    「和好」「和解」「和服」「和尾」「和平」跨過了詞界。
    """
    slots = [s for u, t, z in texts if u == uid for s in _slots_of(t, z, phrase)]
    bad = [s for s in slots if s != "ss01"]
    assert not bad, f"{uid}「{phrase}」有 {len(bad)} 處不是 ㄏㄢˋ：{set(bad)}"


#: (片語, 第幾個字是要問的那個「和」, 該不該是連接詞, 這個 case 在守什麼)
#: ⚠️ 索引寫死，不要用 `.index("和")` 去猜 —— 多個「和」的句子會問錯那一個。
RESOLVER_CASES = [
    # 這次要修的跨詞界誤判
    ("感到困惑和好奇", 4, True, "困惑|和|好奇：和好 跨詞界"),
    ("對一件事的理解和解釋", 7, True, "理解|和|解釋：和解 跨詞界"),
    ("你和好朋友吵架", 1, True, "你|和|好朋友：和好 跨詞界"),
    ("找出問題和解決方法", 4, True, "問題|和|解決：和解 跨詞界"),
    ("勞力工作和服務業", 4, True, "工作|和|服務業：和服 跨詞界"),
    ("壞事和好事常常連在一起", 2, True, "壞事|和|好事：和好 跨詞界"),
    ("不一樣、和平常不同", 4, True, "和|平常：和平 跨詞界"),
    # ⛔ 反向對照：真的「和」詞不可以被刷成連接詞
    ("兩人終於和好", 4, False, "和好 是真詞"),
    ("不該和吵架的朋友和好", 8, False, "句末的 和好 是真詞（句首那個才是連接詞）"),
    ("不該和吵架的朋友和好", 2, True, "同一句裡的連接詞 —— 例外詞不能讓整句失效"),
    ("與仇人和解", 3, False, "和解 是真詞"),
    ("期待的大和解落空", 4, False, "大和解"),
    ("用溫和的言語", 2, False, "溫和"),
    ("沒主見／隨和", 5, False, "隨和"),
    ("剃度成為小和尚", 5, False, "和尚"),
    ("為世界和平與安全", 3, False, "和平"),
    ("與自然和諧共存", 3, False, "和諧"),
    # ⛔ 這四個 case 各自是某一個守衛的唯一證人（複審發現它們原本無人看守）
    ("春天的和煦陽光", 3, False,
     "和煦 不在 371 筆例外清單裡 —— 唯一保護它的是斷詞那道門"),
    ("大衛和歌利亞的故事", 2, True,
     "和歌 是 jieba 的詞 —— 守 add_word(和, 2_000_000) 與「例外詞要在清單裡」"),
    ("溫暖和改變的力量", 2, True,
     "jieba 原本切 溫/暖和 —— 守 _MISSING_TRADITIONAL_WORDS 的 溫暖"),
    ("象鼻蟲和黃面蜂", 3, True,
     "HMM 會造出 蟲和黃面 這種詞 —— 守 HMM=False"),
    ("世界和平面臨考驗", 2, False,
     "少了 面臨 會切成 世界/和/平面/臨，把 和平 拆散 —— 守 面臨"),
]


@pytest.mark.parametrize("phrase,index,expect,why", RESOLVER_CASES)
def test_解析器本身的判斷(phrase, index, expect, why):
    """⭐ 直接問解析器，不經過產表。

    ⚠️ 上面的 corpus 主鎖讀的是**出貨的 JSON**，所以它擋得住「表跑掉了」，
    擋不住「解析器壞了但表沒重產」。這一組才是程式碼的鎖。
    """
    from app.services.he_conjunction import _he_conjunction_positions

    assert phrase[index] == "和", f"case 寫壞了：「{phrase}」第 {index} 個字是「{phrase[index]}」"
    got = index in _he_conjunction_positions(phrase)
    assert got is expect, (
        f"「{phrase}」第 {index} 個字的「和」：解析器說{'是' if got else '不是'}連接詞，"
        f"應該{'是' if expect else '不是'}（{why}）"
    )


def test_正反兩邊都有足夠的case():
    """⛔ 量具自檢：不能全是同一個方向。

    只有正例的話，「把所有和都判成連接詞」這個 mutation 會全綠。
    """
    pos = sum(1 for _, _, e, _ in RESOLVER_CASES if e)
    neg = sum(1 for _, _, e, _ in RESOLVER_CASES if not e)
    assert pos >= 8, f"連接詞的 case 只有 {pos} 個"
    assert neg >= 8, f"非連接詞的 case 只有 {neg} 個"


def test_只建一份字典():
    """⭐ 只能有一份 tokenizer，而且一次賦值。

    兩份的版本有兩個缺陷，同一個根因：

      - 分兩步賦值 → 晚到的執行緒看到半建好的狀態，而漏掉的那一份是例外詞門，
        它 fail-open（回空集合）→ `溫和`／`和好`／`和諧` 被讀成連接詞。
        TTS 走 `asyncio.to_thread`，多個學生同時按朗讀就會進來。
      - 兩份 50 萬條的 prefix dict 多吃 +71 MB 穩態 RSS，而後端上限是 512Mi。

    這條鎖盯的是「別再加第二份」。
    """
    from app.services import he_conjunction as hc

    hc._he_conjunction_positions("測試和驗證")      # 觸發建置
    held = sorted(n for n, v in vars(hc).items()
                  if "tokenizer" in n.lower() and not callable(v)
                  and not isinstance(v, type(hc._tokenizer_lock)))
    assert held == ["_tokenizer"], (
        f"存著 tokenizer 的 module 變數是 {held} —— 只應該有一份 `_tokenizer`")
    assert hc._tokenizer is not None and hc._tokenizer is not False


def test_逐案修正表的和只剩兩筆():
    """⭐ 詞界對齊之後，#3238 那 7 筆「和」的逐案修正要移掉 5 筆。

    ⛔ 留著就變成兩套來源互相覆蓋，而那**不會有任何錯誤訊息** ——
    表贏了，解析器的改動靜靜地沒有作用。

    剩下的兩筆都**不是**詞界問題，所以不該由解析器處理：

      - L0135「嘴喙和尾羽」：`和尾羽` 是 jieba 字典裡 freq=6 的詞，第一道門（斷詞）
        因此判「和」不獨立。而那正是保護 `和煦`（例外清單漏收的真和詞）的同一道門 ——
        為了這一處把它拆掉，會讓所有清單漏收的和詞一起讀錯。
      - L0179「暫時不和隊友說話」：「不和」是教育部收的真詞（不睦），
        這裡是「不／和（跟）／隊友」，要語境才分得開。
    """
    p = BACKEND / "data/zhuyin/lesson_corrections.json"
    d = json.load(open(p, encoding="utf-8"))
    he = [c for c in d["corrections"] if c.get("c") == "和"]
    assert len(he) == 2, (
        f"「和」的逐案修正有 {len(he)} 筆，應該剩 2 筆（嘴喙和尾羽／不和隊友）：\n"
        + "\n".join(f"  {c['lesson_uid']} i={c['i']} {c.get('why')}" for c in he)
    )
    assert {c["lesson_uid"] for c in he} == {"L0135", "L0179"}, he


def test_剩下的兩筆修正不是空砲():
    """⛔ 解析器要是哪天自己把它們修對了，那兩筆修正就變成靜默的空砲。

    `test_逐案修正表的和只剩兩筆` 只數數量，數量對不代表它們還在做事。
    """
    from app.services.he_conjunction import _he_conjunction_positions

    for phrase, index in (("只要觀察嘴喙和尾羽的顏色", 6), ("暫時不和隊友說話", 3)):
        assert phrase[index] == "和"
        assert index not in _he_conjunction_positions(phrase), (
            f"解析器現在已經判對「{phrase}」了 —— "
            "請把 lesson_corrections.json 裡對應的那筆刪掉，不要留著空砲")
