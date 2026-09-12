"""朗讀比對的注音，每個中文字拿到的必須是**自己的**讀音。(#3175)

## 病在哪

`_build_zhuyin_map` 的 docstring 寫著「lazy_pinyin returns one bopomofo element
per character (including punctuation)」。**那句話是錯的。** 連續的非中文
（數字、拉丁字母、連著的標點）會被 pypinyin 塌成**一個**元素，於是後面那句
`zip(target_text, bopomofo_list)` 從那一點開始整串位移：

    _build_zhuyin_map("民國2019年楊俊體育課")
        年 → ㄊㄧˇ（「體」的）   楊 → ㄩˋ（「育」的）   俊 → ㄎㄜˋ（「課」的）
        體育課 三個字完全沒有注音

更難看的一種：`"他說「你好」，我點頭。"` 裡的 `」，` 也會塌，於是
**「頭」拿到的 ruby 是句號**（`bpmf != char` 那個過濾器攔不住它）。

服務端量到的規模（2026-09-12，`data/lessons/L*/v3/key_reading.*.yml`）：
**151 課有 135 課（89.4%）至少一段對不齊，51870 個中文字有 36026 個（69.5%）
落在位移點之後。** 純中文無標點的段落則完全正確 —— 那是本檔的正向對照。

## ⛔ 斷言為什麼不直接比對 `lazy_pinyin` 的輸出

那會變成把修法抄一遍（修法就是「分段呼叫」），突變後照樣綠。

這裡改用一個**跟實作無關的裁判**：`pinyin(字, heteronym=True)` 給出那個字
**所有合法的讀音**，斷言拿到的注音必須落在那個集合裡。「年」拿到 ㄊㄧˇ 會被咬，
因為 ㄊㄧˇ 不在「年」的合法讀音裡 —— 不管實作怎麼寫都咬得到。
裁判自己有沒有牙齒，由 `test_the_oracle_has_teeth` 用一個故意位移的 map 證明。

## ⛔ 也不可以改成逐字呼叫

docstring 說整串傳是為了讓 pypinyin 用上下文消破音字，那個能力是真的：
`目的地` → ㄉㄧˋ，而 `lazy_pinyin("的")` 單獨呼叫是 ㄉㄜ˙。
`test_context_disambiguation_survives_an_embedded_number` 守著它。
"""

from __future__ import annotations

import functools
import pathlib
import re

import pytest
import yaml
from pypinyin import Style, pinyin

from app.routes.learning.learning_reading import _CHINESE_CHAR_RE, _build_zhuyin_map

LESSONS = pathlib.Path(__file__).resolve().parents[1] / "data" / "lessons"

#: 注音符號 ㄅ–ㄦ、介音、四個聲調符號與輕聲點。合法的注音只由這些組成。
BOPOMOFO_ONLY = re.compile(r"^[ㄅ-ㄩˇˊˋ˙ˊˇˋ˙]+$")


#: pypinyin 依上下文做的輕聲變調，字典的異讀表裡沒有這些形。
#:
#: ⚠️ **這是白名單，不是規則。** 第一版寫成「聲韻母對得上就放行輕聲」，
#: 而那個放寬會讓真正的位移溜過去 —— code review 當場示範：
#:
#:     這 的合法讀音 = {ㄓㄜˋ, ㄓㄟˋ, ㄧㄢˋ}
#:     若「這」拿到隔壁「著」的 ㄓㄜ˙ → 基底 ㄓㄜ 對得上 → **被原諒**
#:
#: 常用字裡這種碰撞有 33 對（場/當→ㄉㄤ˙、郭/過→ㄍㄨㄛ˙、化/和→ㄏㄨㄛ˙…），
#: 正好是這支鎖要擋的那一類。改成逐筆列舉之後那個洞就沒了。
#:
#: 這五筆是跑遍服務端全部語料實測出來的**全部**（不是抽樣）。
#: pypinyin 升版若冒出新的輕聲形，這裡會紅 —— 那是刻意的：
#: 要有人看一眼確認那是變調而不是位移，再加進來。
NEUTRAL_TONE_SANDHI = frozenset({
    ("不", "ㄅㄨ˙"),   # 差不多
    ("宜", "ㄧ˙"),     # 便宜
    ("巴", "ㄅㄚ˙"),   # 尾巴
    ("弟", "ㄉㄧ˙"),   # 弟弟
    ("思", "ㄙ˙"),     # 意思
})


@functools.lru_cache(maxsize=None)
def legal_readings(char: str) -> frozenset[str]:
    """那個字所有合法的注音讀音 —— 跟 `_build_zhuyin_map` 的實作無關的裁判。"""
    return frozenset(pinyin(char, style=Style.BOPOMOFO, heteronym=True)[0])


def is_legal(char: str, reading: str) -> bool:
    """那個讀音對這個字合不合法（字典的異讀 ＋ 上面那五筆實測到的輕聲變調）。"""
    return reading in legal_readings(char) or (char, reading) in NEUTRAL_TONE_SANDHI


def misassigned(text: str) -> list[str]:
    """回傳每一個『拿到別人讀音 / 沒拿到 / 拿到不是注音的東西』的位置說明。"""
    zmap = _build_zhuyin_map(text)
    problems: list[str] = []
    for idx, char in enumerate(text):
        if not _CHINESE_CHAR_RE.match(char):
            if idx in zmap:
                problems.append(f"pos {idx} {char!r} 不是中文字卻有注音 {zmap[idx]!r}")
            continue
        got = zmap.get(idx)
        if got is None:
            problems.append(f"pos {idx} {char!r} 沒有注音")
        elif not BOPOMOFO_ONLY.match(got):
            problems.append(f"pos {idx} {char!r} 的注音 {got!r} 不是注音符號")
        elif not is_legal(char, got):
            problems.append(
                f"pos {idx} {char!r} 拿到 {got!r}，但它的合法讀音是 {sorted(legal_readings(char))}"
            )
    return problems


# ── 復現用的句子：每一種會讓 pypinyin 塌成一個元素的形狀各一 ──────────────
CONTAMINATED = [
    pytest.param("民國2019年楊俊體育課", id="連續數字"),
    pytest.param("他說「你好」，我點頭。", id="連續標點"),
    pytest.param("Wi-Fi很方便", id="拉丁字母加連字號"),
    pytest.param("她在2021年8月1日拿下金牌", id="多段數字"),
    pytest.param("成績從100分掉到60分，他很難過", id="數字夾標點"),
    # ⬇︎ code review 抓到的：pypinyin 認得、而舊的中文字範圍漏掉的字。
    #    漏掉的後果不是那一個字沒注音，是**它之後整行都沒有**（fail-closed 停住）。
    pytest.param("今年是二〇二六年，我很快樂", id="〇-台灣寫年份用的漢字零"),
    pytest.param("你好\U00020001你好", id="CJK擴充B的罕用字"),
]

PURE_CHINESE = [
    pytest.param("體育課很好玩", id="正向對照一"),
    pytest.param("他說你好我點頭", id="正向對照二"),
    pytest.param("運動員一旦受傷就要復健", id="正向對照三"),
]


@pytest.mark.parametrize("text", CONTAMINATED)
def test_chinese_chars_keep_their_own_reading_around_non_chinese(text: str) -> None:
    """數字／拉丁／連續標點之後，中文字仍然拿到自己的讀音。"""
    assert misassigned(text) == []


@pytest.mark.parametrize("text", PURE_CHINESE)
def test_pure_chinese_is_the_positive_control(text: str) -> None:
    """正向對照：純中文本來就是對的。

    它綠著才證明上面那組紅燈是「位移」造成的，不是裁判太嚴把所有東西都判紅。
    """
    assert misassigned(text) == []


def test_the_oracle_has_teeth() -> None:
    """負向對照：故意把 map 位移一格，裁判必須咬。

    少了這條，`misassigned()` 有可能整支是空轉的，而所有測試照樣綠。
    """
    text = "體育課很好玩"
    zmap = _build_zhuyin_map(text)
    assert misassigned(text) == [], "前提：這句話本來是對的"

    shifted = {i: zmap[i + 1] for i in zmap if (i + 1) in zmap}
    problems: list[str] = []
    for idx, char in enumerate(text):
        got = shifted.get(idx)
        if got is None or not is_legal(char, got):
            problems.append(f"pos {idx}")
    assert problems, "把 map 位移一格之後裁判卻沒咬 —— 那它什麼都沒在驗"


def test_context_disambiguation_survives_an_embedded_number() -> None:
    """破音字要靠上下文消歧義的能力不可以因為修位移而弄丟。

    ⛔ 這條專門擋「改成逐字呼叫 lazy_pinyin」那個修法：
       `lazy_pinyin("的")` 單獨呼叫回 ㄉㄜ˙，而「目的地」的「的」要讀 ㄉㄧˋ。
    """
    text = "他在2024年抵達目的地"
    zmap = _build_zhuyin_map(text)
    de_index = text.index("目") + 1
    assert text[de_index] == "的"
    assert zmap.get(de_index) == "ㄉㄧˋ", (
        f"「目的地」的「的」拿到 {zmap.get(de_index)!r}；"
        "逐字呼叫會退化成 ㄉㄜ˙，上下文消歧義被弄丟了"
    )


def _served_key_reading_passages() -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    for path in sorted(LESSONS.glob("L*/v3/key_reading.*.yml")):
        data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}

        def walk(node: object) -> None:
            if isinstance(node, dict):
                for key, value in node.items():
                    if key == "passage" and isinstance(value, str) and len(value) > 10:
                        out.append((path.parts[-3], value))
                    walk(value)
            elif isinstance(node, list):
                for value in node:
                    walk(value)

        walk(data)
    return out


def test_every_served_key_reading_passage_is_aligned() -> None:
    """學生真的會唸出聲的那 150+ 段，逐字都拿到自己的讀音。

    修之前這裡是 137/154 段紅。廣度鎖 —— 單句的 case 修得掉，整批的修不掉。
    """
    passages = _served_key_reading_passages()
    assert len(passages) > 100, f"只找到 {len(passages)} 段，語料沒載到（這條紅不是對齊的問題）"

    broken: list[str] = []
    for lesson, text in passages:
        problems = misassigned(text)
        if problems:
            broken.append(f"{lesson}: {problems[0]}（共 {len(problems)} 處）")
    assert not broken, f"{len(broken)}/{len(passages)} 段有字拿到別人的注音：\n" + "\n".join(
        broken[:10]
    )


def test_fail_closed_stops_instead_of_guessing(monkeypatch: pytest.MonkeyPatch) -> None:
    """對不上的時候寧可不標，也不要往後硬數。

    這條是 mutation 逼出來的：把 fail-closed 的 `break` 改成「吞一格繼續」，
    上面每一條都照樣綠 —— 因為真實語料裡 pypinyin 從來沒有對不上過
    （25080 條字串零失敗）。**沒有輸入走得到那個分支，它就等於沒被測。**

    所以這裡直接把 `lazy_pinyin` 換掉，造一個對不上的回傳，
    斷言「後面的字寧可沒有注音，也不可以拿到別人的」。
    """
    import app.routes.learning.learning_reading as mod

    text = "他,,好嗎"
    # 第二個元素該是 ",,"（兩個字元）卻回了對不上的東西 —— 往後數一定會歪。
    fake = ["ㄊㄚ", "XX", "ㄏㄠˇ", "ㄇㄚ˙"]
    monkeypatch.setattr(mod, "lazy_pinyin", lambda *a, **k: fake)

    zmap = mod._build_zhuyin_map(text)

    wrong = [
        f"pos {i} {text[i]!r} 拿到 {v!r}"
        for i, v in zmap.items()
        if not is_legal(text[i], v)
    ]
    assert not wrong, "對不上之後還繼續往下數，把別人的讀音標給了中文字：" + "; ".join(wrong)
    assert zmap == {0: "ㄊㄚ"}, f"應該只留對不上之前的那個字，實際 {zmap}"


def test_a_chinese_char_never_gets_a_non_bopomofo_ruby(monkeypatch: pytest.MonkeyPatch) -> None:
    """中文字那一條分支也要 fail-closed，不是只有非中文那條。

    code review 指出：`break` 只守在非中文分支，中文分支完全信任「一個字一個
    元素」。真實語料裡 pypinyin 對中文字一直是 1:1（151 課全部驗過），
    **所以那個不變量從來沒被測過** —— 跟 fail-closed 那條一模一樣的病。

    這裡強迫中文字的位置收到一個不是注音的東西，斷言它寧可沒有 ruby。
    原始 bug 最難看的一種正是這個形狀：「…我點頭。」的「頭」拿到句號當 ruby。
    """
    import app.routes.learning.learning_reading as mod

    text = "他好嗎"
    monkeypatch.setattr(mod, "lazy_pinyin", lambda *a, **k: ["ㄊㄚ", "2019", "ㄇㄚ˙"])

    zmap = mod._build_zhuyin_map(text)

    assert 1 not in zmap, f"「好」拿到了 {zmap.get(1)!r} 當注音 —— 那不是注音"
    assert all(is_legal(text[i], v) for i, v in zmap.items()), zmap
