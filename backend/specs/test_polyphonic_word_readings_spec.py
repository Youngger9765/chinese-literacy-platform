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
    # 讀音要用**畫面上那個字**去查（#3277）。清單記的是原稿的字（爲），
    # 而字型裡只有標準體（為）—— 拿原字查一定回 None，於是這一條會把
    # 一筆正確的修正判成「讀音不對」。第三處需要跟替換層合成的地方。
    _vp = (_BACKEND.parent / "frontend" / "src" / "components" / "zhuyin"
           / "fontMissingVariants.json")
    _variants = {}
    if _vp.is_file():
        _variants = (json.loads(_vp.read_text(encoding="utf-8")) or {}).get("variants") or {}
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
                shown = _variants.get(ch, ch)
                out[(sha, i)] = (ch, slots.get(shown, {}).get(slot))
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


#: 字型畫不出來的字（12 種 / 36 處）。
#: 這是**字型缺口**，不是判讀錯誤 —— 課文用了異體／簡體寫法，而出貨字型沒有那些字符，
#: 所以那些位置在畫面上沒有注音。
#:
#: 2026-09-18 試過把它們正規化成標準體（爲→為、絶→絕、着→著…共 16 種 69 處），
#: 被 Gate 8「內容忠實度證明」擋下（改了字＝課文偏離原稿，21 課的證明失效，
#: 而原稿當時不在 repo 裡）→ 全部先 revert，見 44c714e05。
#:
#: 2026-09-19：Google Drive 拿到 179 課教師版原稿，試著逐課重新對照重發證明，
#: **結果是這份「16 種標準化」清單本身有錯，不能整批重套**：
#:
#:   - 「条→條」（L0008/L0068，「來源：一条Yit」）—— 直接看 docx 原文才發現
#:     「一条」是**品牌名**（YouTube 頻道「一条」），原稿兩課都寫簡體「条」，
#:     不是排版錯字。normalize 成「條」= 把品牌名寫錯。
#:   - 「靭→韌」（L0142）—— 這個字**不在**上面 16 種字型缺口清單裡（靭本來就
#:     畫得出來，是同一輪順手改的「一致性」問題）。docx 原文這一處真的印
#:     「心理靭性」，L0142 自己的抽取註記早就寫明「原稿如此，不擅自統一」——
#:     normalize 掉等於推翻一個已經查證過的決定。`source_coverage_gate`
#:     （Gate 10/11）量到這課「未涵蓋字數」從 530 變 533 才抓到。
#:
#:   兩者都被 `content_fidelity_attest.py`（Gate 8）判 PASS —— 它用「≥4 字元
#:   且含中文」門檻找子字串，「一条Yit」只有 2 個連續中文字，**根本沒被列進
#:   受檢字串**，所以編輯完全沒被驗到。Gate 8 的 PASS 在這裡是假訊號，
#:   抓到問題的是 Gate 10（原稿涵蓋率棘輪）。這代表**16 種裡另外 14 種
#:   （爲/絶/吿/歳/鈎/点/響/麽 等）也都還沒有一種是「查過真原稿之後確認
#:   normalize 是對的」**——bb4d58f8e 那份清單只驗證過「這是不是字型缺口」，
#:   沒有逐一驗證過「normalize 之後是不是還忠於原稿」。
#:
#:   唯一存活的是 L0096（metadata.yml 的「説/没→說/沒」，直接查 docx 確認
#:   `說明文`/`淹沒` 全篇一致）——但這個字本身在字型裡畫得出來，metadata.yml
#:   也不算進字型缺口的位置集合，所以不影響下面這兩個數字。
#:
#: 2026-09-20：Young 直接查了出貨字型（BpmfZihiSerif-Regular.ttf）的 cmap ——
#: 這 12 個異體字（爲/絶/吔/条/着/麽/凃/吿/歳/鈎/点/軁）**一個字符都不在字型
#: 裡**（對照組：為/絕/條/著/麼/告/歲/鉤/點 都在）。這代表 36 個位置的字現在
#: 是瀏覽器用 fallback 字型畫的，**跟注音表查不查得到讀音完全無關**——就算
#: 給它正確讀音，字型仍然畫不出那個字。同一天也直接驗證了「正規化」這條路
#: 本身會撞上內容忠實度：把 L0154 的「爲」改成「為」重發證明，
#: `sentence_matching` 模組立刻紅（原稿寫「爲」，逐字比對本來就該紅）。
#:
#: → **這 36 處維持原樣，正規化這條路作廢，不要再嘗試改課文字元去關這個
#:   缺口**。唯二合法的解法都不是改 yml：① 幫出貨字型補上這 12 個字符
#:   （真正修好顯示）② 顯示時另外用一套替換表把這幾個字轉成標準體再渲染
#:   （不動 SOT，只動呈現）——兩者都是產品/字型層的決定，留給 Young。
#:
#: 2026-09-22（#3277）：走了②。替換表 SOT =
#: `frontend/src/components/zhuyin/fontMissingVariants.json`，**產表與渲染共讀同一份**。
#: 關鍵在替換發生的位置：**餵給讀音選擇器之前**就換。只在渲染層換字會拿到預設槽 ——
#: 實測「因爲」的槽位是 `0000`（選擇器對「爲」沒有樣式可比對）＝ ㄨㄟˊ，
#: 而換成「因為」再選才是 `ss01` ＝ ㄨㄟˋ。**只在渲染層換 = 把「沒注音」換成「錯注音」**。
#:
#: 10 個字換得掉（爲/絶/条/着/麽/吿/歳/鈎/点/没 → 為/絕/條/著/麼/告/歲/鉤/點/沒），
#: 剩下 3 個沒有標準體可換，所以缺口不會歸零：
#:   吔（×5）台語句末助詞 —— 沒有對應正字
#:   軁（×1）台語
#:   凃（×1）姓氏「凃文」—— **姓氏不可以替換成別的字**
#: 這 7 處只剩解法①（幫字型補字符），那是要花錢/動字型授權的產品決定，留給 Young。
#:
#: ⚠️ 這條斷言現在算的是**學生實際會看到的那個字**（換過之後），不是 yml 裡的字元 ——
#:    因為它要回答的問題是「畫面上這個字有沒有注音」。yml 一字未改。
FONT_GAP_TOTAL = 7
FONT_GAP_CHARS = 3

def _font_slot_table() -> dict:
    """字型裡每個字有哪些槽位 —— **從版控裡的出貨字型現場推**，不讀衍生檔。

    ⛔ 這裡原本讀 `backend/data/zhuyin/font_all_readings.json`，而那個檔
       **沒進版控**（被 `.git/info/exclude` 跟 `backend/.venv`、`frontend/node_modules`
       排在一起），repo 裡也**沒有任何東西會產生它**（兩支 spec 讀、一支腳本讀、零個寫）。
       後果：依賴它的兩條斷言在乾淨 checkout 一律 `skip` ——
       **只在某一台機器上跑過**（2026-09-22 codex 對抗式複審實跑乾淨 archive 抓到：
       `32 passed, 2 skipped`，兩個 skip 正是這兩條）。這個 repo 同一個病的第六次。

    現場推跟那個檔對「存在性」完全等價（實測：13,087 字，key 集合與逐字槽位集合零差異），
    而字型與抽取器都在版控裡 —— 所以這樣門就永遠跑得到。
    """
    import importlib.util

    font = _BACKEND.parent / "frontend" / "public" / "fonts" / "BpmfZihiSerif-Regular.ttf"
    assert font.is_file(), f"出貨字型不在：{font} —— 這是版控裡的檔，不該缺"
    script = _BACKEND / "scripts" / "extract_font_readings.py"
    spec = importlib.util.spec_from_file_location("_ex_font", script)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    table = mod.build_reading_table(str(font))
    assert len(table) > 10_000, f"只推出 {len(table)} 個字 —— 抽取器或字型有問題"
    return table



def test_font_gap_does_not_grow():
    """逐課完整性：每個漢字表上指到的槽位，字型都要畫得出來。

    這就是「窮舉」的驗收條件 —— 逐課都有該上去的注音，而那張表就是該課的 SOT。
    877,582 個漢字位置裡目前有 36 處畫不出來（見上方說明），**數量寫死**：
    多一處就紅，不管是課文新增了字型沒有的字、或有人加了新的異體寫法。
    """
    readings = _font_slot_table()

    # 學生看到的是換過異體字之後的那個字（見上方 2026-09-22 那段）
    variants_path = (_BACKEND.parent / "frontend" / "src" / "components" / "zhuyin"
                     / "fontMissingVariants.json")
    variants = {}
    if variants_path.is_file():
        variants = (json.loads(variants_path.read_text(encoding="utf-8")) or {}).get("variants") or {}

    def is_cjk(ch: str | None) -> bool:
        return bool(ch) and (("一" <= ch <= "鿿") or ("㐀" <= ch <= "䶿"))

    gaps: collections.Counter = collections.Counter()
    misaligned: list[str] = []
    checked = 0
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
                checked += 1
                shown = variants.get(ch, ch)      # 畫面上真正那個字
                slot = "0000" if ssz[i] == "." else f"ss0{ssz[i]}"
                if readings.get(shown, {}).get(slot) is None:
                    gaps[ch] += 1

    assert checked > 800_000, (
        f"只檢查到 {checked:,} 個漢字位置（預期 87 萬以上）—— 這條斷言等於沒在測"
    )
    assert not misaligned, (
        f"{len(misaligned)} 個字串的 ssz 長度跟文字對不上 —— 那會讓整段注音位移："
        f"{misaligned[:5]}"
    )
    assert len(gaps) <= FONT_GAP_CHARS and sum(gaps.values()) <= FONT_GAP_TOTAL, (
        f"字型缺口變大：{len(gaps)} 種 / {sum(gaps.values())} 處"
        f"（上限 {FONT_GAP_CHARS} 種 / {FONT_GAP_TOTAL} 處）：{dict(gaps)}。"
        f"課文新增了字型畫不出來的字 → 先看能不能加進 "
        f"`frontend/src/components/zhuyin/fontMissingVariants.json`（顯示層換標準體，"
        f"不動 yml）；換不掉的（台語助詞、姓氏）才是真的要補字型"
    )

def test_the_variant_substitution_table_is_usable():
    Q = None
    # 對照組：替換表本身要有效，否則上面那個 7 只是因為表被清空了。
    #
    # ⛔ 少了這一條，把 `fontMissingVariants.json` 的 `variants` 清成 `{}`
    #    會讓缺口從 7 變回 36 —— 那當然會紅。但**反過來**呢：如果有人把表填成
    #    一堆字型也畫不出來的「標準體」，缺口一樣是 36。所以這裡驗的是
    #    **每一筆的目標字在字型裡真的畫得出來**。
    variants_path = (_BACKEND.parent / "frontend" / "src" / "components" / "zhuyin"
                     / "fontMissingVariants.json")
    assert variants_path.is_file(), f"{variants_path} 不在 —— 前端渲染也讀這一份"
    doc = json.loads(variants_path.read_text(encoding="utf-8"))
    variants = doc.get("variants") or {}
    assert variants, "替換表是空的"

    readings = _font_slot_table()

    # ⭐ 這一條驗的是「**這是不是正確的異體字對應**」，不只是「目標字畫得出來」。
    #
    # ⛔ 第一版只驗了後者 —— codex 對抗式複審實跑：把表改成 `絶→狗`
    #    （「拒絶」會顯示成「拒狗」）**所有門依然全綠**，因為「狗」確實在字型裡、
    #    槽位也重現得出來。守衛跟 oracle 都沒有問「這兩個字是不是同一個字」。
    #
    # 機械化的判準：異體字跟它的標準體**必須共用讀音**。
    #    實測 10 對全部共用；負向對照 絶→狗（jue2 vs gou3）、爲→貓、点→犬 全部被擋。
    from pypinyin import Style, pinyin

    def _readings(ch: str) -> set[str]:
        return set(pinyin(ch, heteronym=True, style=Style.TONE3)[0])

    bad = []
    for src, dst in variants.items():
        if len(src) != 1 or len(dst) != 1:
            bad.append(f"{src!r}→{dst!r} 不是一個字換一個字（會讓整串位移）")
        elif src in readings:
            bad.append(f"「{src}」本來就在字型裡，不需要替換")
        elif dst not in readings:
            bad.append(f"「{src}」→「{dst}」但「{dst}」字型也畫不出來")
        elif not (_readings(src) & _readings(dst)):
            bad.append(
                f"「{src}」→「{dst}」讀音沒有交集（{sorted(_readings(src))} vs "
                f"{sorted(_readings(dst))}）—— 這不是異體字對應，換過去學生會看到別的字"
            )
    assert not bad, "替換表有問題：\n  " + "\n  ".join(bad)



#: 「一」「不」變調的詞層級抽點。(詞, 目標字在詞裡第幾個, 該讀什麼, 前字排除)
#: ⚠️ `not_prev` 是必要的，而且是實測出來的：比對字串「一個」會命中「第一個」，
#:    而序數的「一」讀基本調 ㄧ —— 不排除的話這條鎖會把正確的讀音報成違規
#:    （2026-09-19 實測 38 處）。這是子字串比對不等於詞，第三次咬到我。
SANDHI_CASES: list[tuple[str, int, str, set]] = [
    ("一個", 0, "ㄧˊ", {"第", "一"}),   # 個底層四聲；「唯一一個」的前字是一
    ("一次", 0, "ㄧˊ", {"第"}),
    ("一件", 0, "ㄧˊ", set()),
    ("一半", 0, "ㄧˊ", set()),
    ("一樣", 0, "ㄧˊ", {"第"}),
    ("一天", 0, "ㄧˋ", {"第"}),
    ("一般", 0, "ㄧˋ", set()),
    ("一起", 0, "ㄧˋ", {"第"}),
    ("第一名", 1, "ㄧ", set()),          # 序數不變調
    ("第一個", 1, "ㄧ", set()),
    ("一百", 0, "ㄧ", set()),            # 數字串不變調
    ("不夠", 0, "ㄅㄨˊ", set()),          # 後字四聲
    ("不是", 0, "ㄅㄨˊ", set()),
    ("不能", 0, "ㄅㄨˋ", set()),          # 後字非四聲
    ("不同", 0, "ㄅㄨˋ", set()),
    ("不好", 0, "ㄅㄨˋ", set()),
]


@pytest.mark.parametrize("case", SANDHI_CASES, ids=lambda c: f"{c[0]}-{c[2]}")
def test_yi_bu_sandhi(case):
    """「一」「不」的變調在課文表上是對的。

    變調是國語的音韻規則（看下一個字的聲調），但表上存的是結果不是規則 ——
    所以這裡抽點驗結果。2026-09-19 修了 3,875 處，其中 2,311 處是「一」該讀 ㄧˊ
    而表寫基本調 ㄧ。
    """
    word, off, want, not_prev = case
    slots = json.loads(_SLOTS.read_text(encoding="utf-8"))["slots"]
    counts: collections.Counter = collections.Counter()
    for path in sorted(_LESSONS.glob("L*/v*/zhuyin.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        for t in data.get("texts") or []:
            text, ssz = t.get("text"), t.get("ssz")
            if not isinstance(text, str) or not isinstance(ssz, str):
                continue
            units = _u16(text)
            if len(units) != len(ssz):
                continue
            j = text.find(word)
            while j >= 0:
                if not (j > 0 and text[j - 1] in not_prev):
                    k = j + off
                    ui = sum(1 + (1 if ord(c) > 0xFFFF else 0) for c in text[:k])
                    if ui < len(units) and units[ui] == word[off]:
                        code = ssz[ui]
                        slot = "0000" if code == "." else f"ss0{code}"
                        counts[slots.get(word[off], {}).get(slot)] += 1
                j = text.find(word, j + 1)
    assert counts, f"語料裡找不到「{word}」—— 這條斷言等於沒在測"
    wrong = {r: n for r, n in counts.items() if r != want}
    assert not wrong, (
        f"「{word}」的「{word[off]}」該讀 {want}，"
        f"但有 {sum(wrong.values())} 處讀成 {wrong}（對的 {counts.get(want, 0)} 處）"
    )
