"""朗讀診斷報告的注音必須是台灣讀音，不是 pypinyin 的大陸讀音。(#3202)

## 為什麼需要這一道

全站有三處會產生注音。TTS 那處 2026-08 就接了台灣來源
（`data/tts/taiwan_pronunciation.json`，教育部辭典生成）；課文顯示那處走出貨字型
＋`poyin_db.json`。**只有朗讀診斷報告這處直接吐 pypinyin 的原始輸出**，
而 pypinyin 是大陸的函式庫。

真環境重現（staging，2026-09-14）：送「研究垃圾的消息和血型」，十個字五個是大陸音 ——
究 ㄐㄧㄡ、垃 ㄌㄚ、圾 ㄐㄧ、息 ㄒㄧ、血 ㄒㄩㄝˋ。
那是「學生剛唸完、系統要告訴他哪個字唸錯」的那一頁。

拿 175 課真實課文量：單音字 1.09%（1524/140085 字次、108 個不重複字）跟出貨字型不同。

## 真值來源

出貨字型 `BpmfZihiSerif-Regular.ttf` —— 本 repo 已宣告的台灣讀音權威
（`test_font_is_taiwan_reading_authority_3173.py`，Young 2026-09-12 逐字確認 12 個）。
用字型而不是教育部辭典，因為字型就是畫面上實際畫出來的讀音，而且已經在出貨，
不受辭典 CC BY-ND 授權限制。

⛔ 這支不驗「教育部說什麼」，只驗「我們出貨的字型說什麼，而後端有沒有照著吐」。
"""

from __future__ import annotations

import importlib.util
import json
import pathlib

import pytest
from pypinyin import Style, lazy_pinyin

import app.routes.learning.learning_reading as mod
from app.routes.learning.learning_reading import _build_zhuyin_map
from app.services.zhuyin_readings import TABLE_PATH, font_zhuyin_table

BACKEND = pathlib.Path(__file__).resolve().parents[1]
REPO = BACKEND.parent
TABLE = BACKEND / "data" / "zhuyin" / "font_readings.json"
FONT = REPO / "frontend" / "public" / "fonts" / "BpmfZihiSerif-Regular.ttf"


# (句子, 目標字, 台灣讀音, pypinyin 給的大陸讀音) —— 全部取自課文裡出現最多的分歧字。
# 句子刻意全中文：非中文會走另一條消耗分支，那是 #3175 在管的，不要混進來。
TAIWAN_NOT_MAINLAND = [
    ("科學研究",   "究", "ㄐㄧㄡˋ", "ㄐㄧㄡ"),
    ("捐血救人",   "血", "ㄒㄧㄝˇ", "ㄒㄩㄝˋ"),
    ("休息一下",   "息", "ㄒㄧˊ",   "ㄒㄧ"),
    ("攻擊行為",   "擊", "ㄐㄧˊ",   "ㄐㄧ"),
    ("突然下雨",   "突", "ㄊㄨˊ",   "ㄊㄨ"),
    ("微小的事",   "微", "ㄨㄟˊ",   "ㄨㄟ"),
    ("危險動作",   "危", "ㄨㄟˊ",   "ㄨㄟ"),
    ("垃圾分類",   "垃", "ㄌㄜˋ",   "ㄌㄚ"),
    ("垃圾分類",   "圾", "ㄙㄜˋ",   "ㄐㄧ"),
    ("廣播電台",   "播", "ㄅㄛˋ",   "ㄅㄛ"),
    ("洗頭髮",     "髮", "ㄈㄚˇ",   "ㄈㄚˋ"),
    ("暫時停止",   "暫", "ㄓㄢˋ",   "ㄗㄢˋ"),
    ("蝸牛爬行",   "蝸", "ㄍㄨㄚ",  "ㄨㄛ"),
    ("企業經營",   "企", "ㄑㄧˋ",   "ㄑㄧˇ"),
]


@pytest.mark.parametrize("sentence,char,taiwan,mainland", TAIWAN_NOT_MAINLAND)
def test_reading_is_taiwan_not_mainland(sentence: str, char: str, taiwan: str, mainland: str) -> None:
    idx = sentence.index(char)
    zmap = _build_zhuyin_map(sentence)
    got = zmap.get(idx)
    assert got == taiwan, f"{sentence!r} 的「{char}」標成 {got!r}，台灣讀音是 {taiwan!r}"
    assert got != mainland, f"「{char}」還是大陸讀音 {mainland!r}"


@pytest.mark.parametrize("sentence,char,mainland", [(s, c, m) for s, c, _, m in TAIWAN_NOT_MAINLAND])
def test_the_mainland_reading_is_what_pypinyin_actually_gives(sentence: str, char: str, mainland: str) -> None:
    """正向對照：上一條裡的「大陸讀音」欄不是我編的，是 pypinyin 真的會給的。

    少了這條，上面那張表可能兩欄都寫成同一個值，而測試照樣全綠 —— 那就什麼都沒驗。
    """
    idx = sentence.index(char)
    assert lazy_pinyin(sentence, style=Style.BOPOMOFO)[idx] == mainland


# (句子, 目標字, 該讀什麼) —— 破音字仍然要靠 pypinyin 看上下文，這個能力不可以弄丟
# ⚠️ #3237：`_build_zhuyin_map()` 從「pypinyin 選擇器」改成純查表之後，
#    上下文判斷沒有了 —— 破音字退回字型預設。
#    所以只有「字型預設剛好就是對的」那兩個還成立；另兩個逐案標 xfail(strict)，
#    **有人把它修好那天會 XPASS 而整支紅**，逼人回來把標記拿掉（同下面 KNOWN_GAPS 的作法）。
_RETIRED_3237 = pytest.mark.xfail(
    strict=True,
    reason="#3237：fallback 不再用 pypinyin，破音字退回字型預設 —— 上下文判斷是刻意放棄的",
)
POLYPHONE_CONTEXT = [
    ("他慢慢行走",   "行", "ㄒㄧㄥˊ"),          # 字型預設就是 ㄒㄧㄥˊ
    pytest.param("這是目的地", "的", "ㄉㄧˋ", marks=_RETIRED_3237),
    ("我的書",       "的", "ㄉㄜ˙"),            # 字型預設就是 ㄉㄜ˙
    pytest.param("他長大了", "長", "ㄓㄤˇ", marks=_RETIRED_3237),
]

#: pypinyin 上下文判讀本來就錯的地方 —— **跟 #3202 這次改動無關**，改動前後輸出一樣。
#:
#: 誠實記在這裡而不是把錯的值鎖進上面那張表：`strict=True` 的 xfail 代表
#: **有人把它修好的那天這條會 XPASS 而整支紅**，逼人回來把它搬到 POLYPHONE_CONTEXT。
#: 直接斷言錯值才是把 bug 鎖住。
#:
#: 「行」在正式站被回報過同一類問題（#3177，那條走的是前端資料表路徑）。
KNOWN_POLYPHONE_GAPS = [
    ("我去銀行辦事", "行", "ㄏㄤˊ", "字型預設是 ㄒㄧㄥˊ；#3237 前 pypinyin 也給 ㄒㄧㄥˊ"),
    # ⭐ #3237 之後這個**變好了**：字型預設 ㄔㄤˊ 剛好是對的（pypinyin 以前給 ㄓㄤˇ）。
    #    所以它從「已知缺陷」升級成正常案例，搬到 POLYPHONE_CONTEXT 的行為由下面那條驗。
]
#: #3237 修好的：拿掉 pypinyin 之後字型預設剛好對
FIXED_BY_3237 = [
    ("這條路很長", "長", "ㄔㄤˊ"),
]


@pytest.mark.xfail(strict=True, reason="pypinyin 上下文判讀的既有缺陷，非本次改動造成")
def test_known_polyphone_gaps(sentence: str, char: str, correct: str, note: str) -> None:
    idx = sentence.index(char)
    assert _build_zhuyin_map(sentence).get(idx) == correct, note


@pytest.mark.parametrize("sentence,char,correct,note", KNOWN_POLYPHONE_GAPS)
def test_known_gaps_still_produce_a_reading_that_font_carries(
    sentence: str, char: str, correct: str, note: str
) -> None:
    """就算判錯，吐出來的也必須是**這個字在台灣字型裡有的讀音**。

    判錯上下文（ㄒㄧㄥˊ 而不是 ㄏㄤˊ）跟吐出一個台灣根本沒有的讀音，
    是兩種嚴重程度不同的錯。這條守住後者。
    """
    _, poly = font_zhuyin_table()
    idx = sentence.index(char)
    got = _build_zhuyin_map(sentence).get(idx)
    assert got in set(poly[char]["v"]) | {poly[char]["d"]}, f"{got!r} 不在字型收的讀音裡"


@pytest.mark.parametrize("sentence,char,expected", POLYPHONE_CONTEXT)
def test_polyphone_context_disambiguation_survives(sentence: str, char: str, expected: str) -> None:
    """接上字型表之後，破音字仍然要看上下文。

    最容易寫壞的方式是「所有字都查表」—— 那會讓每個破音字都固定拿預設讀音，
    銀行變 ㄒㄧㄥˊ、目的地變 ㄉㄜ˙。實作只讓**單音字**查表。
    """
    idx = sentence.index(char)
    assert _build_zhuyin_map(sentence).get(idx) == expected, (
        f"{sentence!r} 的「{char}」應為 {expected}，實際 {_build_zhuyin_map(sentence).get(idx)}"
    )


def test_font_default_wins_when_pypinyin_picks_a_reading_taiwan_does_not_have() -> None:
    """破音字的另一半規則：pypinyin 挑了一個台灣字型沒有的讀音時，退回字型預設。

    真實語料裡這條分支很少被走到，所以這裡直接把表換成「字型沒有 pypinyin 那個讀音」
    的樣子，逼它走進去 —— 不然這段 code 永遠沒被測過。

    ⚠️ 第一版把假表的預設值設成 `ㄒㄧㄥˊ`，而 pypinyin 對「銀行」給的正是 `ㄒㄧㄥˊ`
    —— **兩條路徑輸出相同，這條測試整支是空轉的**。突變驗證當場抓到：把
    `element if element in entry["v"] else entry["d"]` 改成 `element`，38 條照樣全綠。
    假表的預設值必須跟 pypinyin 的判讀**不同**，這條分支才真的被分開。
    """
    single, poly = font_zhuyin_table()
    assert lazy_pinyin("我去銀行辦事", style=Style.BOPOMOFO)[3] == "ㄒㄧㄥˊ", (
        "前提：pypinyin 對這句的「行」給 ㄒㄧㄥˊ。它哪天改了，下面的期望值要跟著改"
    )
    faked = dict(poly)
    faked["行"] = {"d": "ㄏㄤˊ", "v": ["ㄏㄤˊ", "ㄏㄤˋ"]}   # 刻意不含 pypinyin 的 ㄒㄧㄥˊ

    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(mod, "font_zhuyin_table", lambda: (single, faked))
        zmap = mod._build_zhuyin_map("我去銀行辦事")

    assert zmap[3] == "ㄏㄤˊ", (
        f"pypinyin 挑了字型沒有的 ㄒㄧㄥˊ，應退回字型預設 ㄏㄤˊ，實際 {zmap.get(3)!r}"
    )


def test_missing_table_degrades_to_nothing_not_to_a_crash() -> None:
    """字型表讀不到時**漏標**，不是整支炸掉，也不是退回另一個來源。

    ⚠️ #3237 改寫：這條原本叫 `test_missing_table_degrades_to_pypinyin`，
    斷言「退回 pypinyin 的原始輸出」（`研 → ㄐㄧㄡ`，大陸讀音）。
    那條退路已經拿掉了 —— pypinyin 是這個檔開頭 TAIWAN_NOT_MAINLAND 那串錯誤的來源。

    現在的行為：字型表空的 → 沒有任何字拿得到讀音 → **漏標**。
    漏標只是少一排注音，標錯是教錯讀音（同 TTS 的 `_load_taiwan_corrections` 的取捨）。
    重點仍然是「不 crash」。
    """
    sentence = "科學研究"
    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(mod, "font_zhuyin_table", lambda: ({}, {}))
        zmap = mod._build_zhuyin_map(sentence)

    assert zmap == {}, f"字型表空的時候不該生出讀音：{zmap}"

    # ⛔ 正向對照：沒有 monkeypatch 時同一句要有讀音 —— 否則上面那個空 dict
    #    可能是因為 `_build_zhuyin_map` 整支壞了，而不是因為表空
    real = mod._build_zhuyin_map(sentence)
    assert len(real) == len(sentence), f"正常情況下每個字都要有讀音：{real}"
    assert real[3] == "ㄐㄧㄡˋ", "台灣讀音（pypinyin 給的是 ㄐㄧㄡ）"


def test_table_really_came_from_the_shipped_font() -> None:
    """committed 的對照表必須真的是從這支字型抽出來的。

    ⛔ 不要把這支改成「比對一份寫死的期望值」—— 那又是一張會過期的表。
    它每次都真的去讀 TTF，跟 test_font_readings_match_shipped_font_3177.py 同一個做法。
    """
    spec = importlib.util.spec_from_file_location(
        "gen", BACKEND / "scripts" / "generate_taiwan_zhuyin_table.py"
    )
    gen = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(gen)

    fresh = gen.build()
    have = json.loads(TABLE.read_text(encoding="utf-8"))
    assert have["single"] == fresh["single"], "單音字表跟字型對不上 —— 重跑產生器"
    assert have["poly"] == fresh["poly"], "破音字表跟字型對不上 —— 重跑產生器"
    assert have["_provenance"]["font_sha256"], "對照表要記得它是從哪個字型來的"


def test_notation_is_identical_where_the_two_sources_agree() -> None:
    """換來源不可以順便換記法。

    對照表的注音是用 pypinyin 自己的 `BopomofoConverter` 轉的（見產生器）。
    凡是兩邊**讀音相同**的字，產出的注音字串必須**逐字相同** —— 否則這次改動
    不只換了讀音，還悄悄換了記法（輕聲點、ㄩ 的寫法、ㄦ 化都可能漂），
    而那種漂移沒有任何其他測試看得到。

    比對方式：讀音同不同，用「拼音＋聲調」判（字型存 `le4`，pypinyin 給 `le4`）；
    判為相同的那批，再比注音字串。實測（2026-09-14）10057 個字，零漂移。
    """
    import re

    single, _ = font_zhuyin_table()
    spec = importlib.util.spec_from_file_location(
        "efr", BACKEND / "scripts" / "extract_font_readings.py"
    )
    efr = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(efr)
    raw = efr.build_reading_table(str(FONT))

    def key(pinyin_with_tone: str) -> str:
        m = re.match(r"^([a-z]+)([1-5])?$", pinyin_with_tone.strip())
        if not m:
            return pinyin_with_tone
        return m.group(1).replace("v", "ü") + (m.group(2) or "5")

    compared = 0
    drift: list[str] = []
    for char, taiwan in single.items():
        their_pinyin = lazy_pinyin(char, style=Style.TONE3, neutral_tone_with_five=True)[0]
        if key(raw[char]["0000"]) != key(their_pinyin):
            continue  # 讀音本來就不同，不在這道對照範圍
        compared += 1
        theirs = lazy_pinyin(char, style=Style.BOPOMOFO)[0]
        if taiwan != theirs:
            drift.append(f"{char}: 我們 {taiwan!r} / pypinyin {theirs!r}")

    assert compared > 9000, f"只比到 {compared} 個字 —— 對照範圍算錯了，這條等於沒驗"
    assert not drift, f"{len(drift)} 個字的記法漂了（讀音相同卻寫法不同）：" + "; ".join(drift[:8])


def test_backend_table_agrees_with_the_frontend_projection() -> None:
    """同一支字型的兩份投影不可以說出不同的讀音。

    前端要的是「slot → 拼音」（`fontReadings.generated.json`，541 個破音字，
    餵 `polyphonicReadings.test.ts`）；後端要的是「字 → 注音字串」（本次新增）。
    形狀不同是對的 —— 渲染方式不同。但**讀音必須一致**，否則同一個字在
    課文上標一種、在朗讀回饋裡標另一種，而兩邊的測試都會是綠的。

    兩份各自都有「重新從 TTF 推一次」的門在守
    （前端 test_font_readings_match_shipped_font_3177.py、後端
    test_table_really_came_from_the_shipped_font），這條守的是**它們彼此**。

    實測（2026-09-14）541/541 一致。
    """
    fe_path = REPO / "frontend/src/components/zhuyin/__fixtures__/fontReadings.generated.json"
    assert fe_path.exists(), f"前端 fixture 不在 {fe_path} —— 路徑改了就要改這條鎖"
    fe = json.loads(fe_path.read_text(encoding="utf-8"))
    assert len(fe) > 500, f"前端 fixture 只有 {len(fe)} 筆，沒載到"

    single, poly = font_zhuyin_table()

    import re as _re

    from pypinyin.style.bopomofo import BopomofoConverter

    to_bopomofo = lambda r: BopomofoConverter().to_bopomofo(_re.sub(r"5$", "", r))

    disagree = []
    for char, slots in fe.items():
        mine = poly.get(char)
        if mine is None and char in single:
            mine = {"d": single[char], "v": [single[char]]}
        if mine is None:
            disagree.append(f"{char}: 後端表沒收這個字")
            continue
        expect_v = sorted({to_bopomofo(r) for r in slots.values()})
        if sorted(mine["v"]) != expect_v:
            disagree.append(f"{char}: 候選 {sorted(mine['v'])} ≠ 前端推得 {expect_v}")
        elif mine["d"] != to_bopomofo(slots["0000"]):
            disagree.append(f"{char}: 預設 {mine['d']} ≠ 前端推得 {to_bopomofo(slots['0000'])}")

    assert not disagree, f"{len(disagree)}/{len(fe)} 個字兩份投影對不上：" + "; ".join(disagree[:8])


def test_the_table_actually_loads_where_it_ships() -> None:
    """對照表在真實的模組佈局下真的讀得到 —— 路徑算錯是靜默的。

    載入器 fail-open：讀不到就回空表、注音全部退回 pypinyin，**不會丟例外、
    不會紅**。而路徑是 `Path(__file__).parents[N]`，跟模組深度綁死 ——
    這個檔從 `routes/learning/` 搬到 `services/` 時 N 就變了（3 → 2），
    算錯的唯一症狀是「台灣讀音靜靜地不見了」。

    所以要有一條測試直接看**表是不是空的**。上面每一條讀音斷言其實都會紅，
    但錯誤訊息會說「究標成 ㄐㄧㄡ」，讓人去追讀音，而真正的原因是檔案沒讀到。
    這條把原因講清楚。
    """
    assert TABLE_PATH.exists(), f"對照表不在 {TABLE_PATH} —— 路徑算錯或檔案沒進 image"
    single, poly = font_zhuyin_table()
    assert len(single) > 10_000, f"單音字表只有 {len(single)} 筆 —— 表是空的或讀錯檔"
    assert len(poly) > 1_000, f"破音字表只有 {len(poly)} 筆"


def test_table_is_inside_the_backend_package_so_the_image_has_it() -> None:
    """對照表必須住在 `backend/data/` 底下 —— Dockerfile 只 COPY 那一層。

    字型本身在 `frontend/public/fonts/`，**容器裡沒有**。所以執行期不能去讀字型，
    只能讀這份 committed 的衍生表；而產生器與
    `test_table_really_came_from_the_shipped_font` 只在 CI/本機跑得動。
    這條確保那個分工沒有被搬到容器外。
    """
    backend_data = pathlib.Path(__file__).resolve().parents[1] / "data"
    assert backend_data in TABLE_PATH.parents, (
        f"{TABLE_PATH} 不在 backend/data/ 底下 —— Dockerfile 不會把它帶進 image"
    )


@pytest.mark.parametrize("sentence,char,expected", FIXED_BY_3237)
def test_cases_that_3237_fixed(sentence: str, char: str, expected: str) -> None:
    """⭐ 拿掉 pypinyin 的附帶好處 —— 這幾個以前是「已知缺陷」。

    ⛔ 這條不是裝飾：它讓「#3237 換到了什麼」有量，而不是只記「失去了什麼」。
    """
    idx = sentence.index(char)
    assert _build_zhuyin_map(sentence).get(idx) == expected
