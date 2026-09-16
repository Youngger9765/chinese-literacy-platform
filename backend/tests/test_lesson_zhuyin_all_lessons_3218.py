"""每一課的注音對照表都要對 —— 跑全部 179 課（#3218）

## 為什麼是逐課而不是抽樣

Young 2026-09-15 明令：「我們不是用通用解，我們適用逐課客製化解法，
所以要有注音跑完所有課的 TDD」。

逐課客製化的意思是：每一課的答案是獨立固化的，所以**每一課都要獨立被驗**。
抽樣在這裡沒有意義 —— 抽樣只能發現「產生器壞了」，發現不了「第 87 課那一格錯了」。

## 五道斷言，每一道都逐課逐字跑

    ① 每一課都有表                      179/179
    ② 槽位陣列與課文字數對齊             #3175 的形狀：錯一格就整串位移
    ③ 每個破音字位置指到表說的那個字       防「表與課文不同步」
    ④ 每個讀音都在字型的合法集合裡         字型是台灣讀音權威，超出集合就是必錯
    ⑤ 後端查表結果逐字等於表              防「後端又自己算了一次」

## ⚠️ 為什麼一定要有第六個 class

①–⑤ 有一個隱蔽的空轉方式：**如果表是從後端產的，⑤ 恆為真。**
`TestTheLockHasTeeth` 把表改壞，那時 ⑤ 必須紅。沒有那一組，⑤ 什麼都不證明。
（同 feedback_my_headline_evidence_was_vacuous：判定式裡一個恆真的分支，
把「154/154」變成跟裁判是誰無關的數字。）
"""
from __future__ import annotations

import importlib.util
import json
import re
from pathlib import Path

import pytest

from app.services.lesson_zhuyin import lesson_zhuyin_table, zhuyin_for_text

BACKEND = Path(__file__).resolve().parents[1]
LESSONS = BACKEND / "data" / "lessons"
FONT = BACKEND.parent / "frontend" / "public" / "fonts" / "BpmfZihiSerif-Regular.ttf"
EXTRACTOR = BACKEND / "scripts" / "extract_font_readings.py"
_UID_RE = re.compile(r"^L\d+$")


def _uids() -> list[str]:
    return sorted(p.name for p in LESSONS.iterdir()
                  if p.is_dir() and _UID_RE.match(p.name)
                  and any(c.is_dir() and c.name.startswith("v") for c in p.iterdir()))


def _vdir(uid: str) -> Path:
    return max((c for c in (LESSONS / uid).iterdir()
                if c.is_dir() and c.name.startswith("v")), key=lambda c: c.name)


UIDS = _uids()


@pytest.fixture(scope="session")
def legal_readings() -> dict[str, set[str]]:
    """字型每個字的合法讀音集合 —— 台灣讀音權威，超出這個集合就是必錯"""
    from pypinyin.style.bopomofo import BopomofoConverter

    spec = importlib.util.spec_from_file_location("ex", EXTRACTOR)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    conv = BopomofoConverter()
    return {
        ch: {conv.to_bopomofo(re.sub(r"5$", "", r)) for r in slots.values()}
        for ch, slots in mod.build_reading_table(str(FONT)).items()
    }


def _raw(uid: str) -> dict:
    return json.loads((_vdir(uid) / "zhuyin.json").read_text(encoding="utf-8"))


# ── #3230 格式轉接：表改成 `ssz`（緊湊槽位字串）且不再存 poly ──────────────
#
# 這些測試問的問題沒變（「後端查到的逐字注音 == 表說的」），但它們原本直接讀
# `t["ss"]`（陣列）與 `t["poly"]`（每個破音字位置一筆 `{i,c,ss,b}`）。
# 那兩個欄位在 #3230 被拿掉了：槽位壓成一個字元一格的字串（53 MB → 8.3 MB），
# 注音改由 (字, 槽位) 經 `font_slot_readings.json` 推 —— 存一份就是第二個真相來源。
#
# 所以這裡把新格式還原成同樣的形狀，斷言一字不改。
def _ss(t: dict) -> list[str]:
    from app.services.lesson_zhuyin import unpack_slots
    return unpack_slots(t.get("ssz") or "")


def _u16(text: str) -> list[str]:
    from app.services.lesson_zhuyin import u16_chars
    return u16_chars(text)


def _poly(t: dict) -> list[dict]:
    """把 `ssz` 還原成舊的 poly 形狀（只含破音字位置）。"""
    from app.services.lesson_zhuyin import font_slot_readings
    slot_map = font_slot_readings()
    ss = _ss(t)
    out = []
    for i, ch in enumerate(_u16(t["text"])):
        readings = slot_map.get(ch)
        if not readings:
            continue
        out.append({"i": i, "c": ch, "ss": ss[i], "b": readings.get(ss[i])})
    return out


class TestEveryLessonHasATable:
    def test_有課就有表(self):
        missing = [u for u in UIDS if not (_vdir(u) / "zhuyin.json").is_file()]
        assert not missing, f"{len(missing)} 課沒有注音表：{missing[:10]}"

    def test_課數不是零(self):
        # 少了這條，上面那條在「一課都掃不到」時也會綠
        assert len(UIDS) > 100, f"只掃到 {len(UIDS)} 課 —— 掃描本身壞了"


@pytest.mark.parametrize("uid", UIDS)
class TestPerLesson:
    """⭐ 逐課跑：每一課各自是一個 test case，紅的時候會指名是哪一課"""

    def test_槽位與字數對齊(self, uid):
        for t in _raw(uid)["texts"]:
            assert len(_ss(t)) == t["n"] == len(_u16(t["text"])), (
                f"{uid} {t['section']} idx={t['idx']}：槽位 {len(t['ss'])}"
                f" / n={t['n']} / 字數 {len(t['text'])}"
            )

    def test_破音字位置指到對的字且有讀音(self, uid):
        """⚠️ 這條**擋不住整串位移** —— 產生器的 `i` 與 `c` 來自同一個 enumerate，
        所以 `text[i] == c` 恆為真。守 `ss` 的是下面那條。"""
        for t in _raw(uid)["texts"]:
            for r in _poly(t):
                assert _u16(t["text"])[r["i"]] == r["c"], (
                    f"{uid} {t['section']} i={r['i']}：表說「{r['c']}」"
                    f"實際是「{t['text'][r['i']]}」"
                )
                assert r["b"], f"{uid} i={r['i']}「{r['c']}」沒有讀音"

    def test_ss_的內容對得上_poly(self, uid, legal_readings):
        """⭐ `ss` 是**前端拿去渲染 ruby 的那個欄位**，這條守它的內容不只守長度。

        ## 為什麼非有不可（2026-09-15 對抗式複審實測）

        把 L0001 七段的 `ss` **整串右移一格**（就是 #3175 那個形狀，長度不變）→
        **729 條照樣全過**。原因：上面那條的 `text[i] == c` 恆為真，而
        `test_每個讀音都在字型的合法集合裡` 看的是 `poly[].b`，不是 `ss`。
        端點只回 `section/slug/idx/text/ss` —— 也就是**畫面上的答案一格都沒人守**。

        這條用 `poly` 當交叉來源：`ss[i]` 必須是 `poly` 裡那一筆記的槽位，
        而 `poly[].b` 已經被字型合法集合守過 → 兩者串起來就守住了 `ss` 的內容。
        """
        slot_re = re.compile(r"^(0000|ss\d{2})$")
        for t in _raw(uid)["texts"]:
            ss = _ss(t)
            for r in _poly(t):
                assert ss[r["i"]] == r["ss"], (
                    f"{uid} {t['section']} i={r['i']}「{r['c']}」"
                    f"ss={ss[r['i']]} 但 poly 說 {r['ss']} —— ss 與 poly 不同步"
                )
            for i, slot in enumerate(ss):
                assert slot is None or slot_re.match(slot), (
                    f"{uid} {t['section']} i={i} 槽位格式怪：{slot!r}"
                )

    def test_每個讀音都在字型的合法集合裡(self, uid, legal_readings):
        bad = []
        for t in _raw(uid)["texts"]:
            for r in _poly(t):
                legal = legal_readings.get(r["c"], set())
                if r["b"] not in legal:
                    bad.append(f"{t['section']} i={r['i']}「{r['c']}」={r['b']} 不在 {sorted(legal)}")
        assert not bad, f"{uid} 有 {len(bad)} 個讀音超出字型：{bad[:5]}"

    def test_後端查表逐字相符(self, uid):
        lesson_zhuyin_table.cache_clear()
        raw = _raw(uid)
        checked = 0
        for t in raw["texts"]:
            got = zhuyin_for_text(uid, t["text"])
            assert got is not None, f"{uid} 查不到 {t['section']} idx={t['idx']}"
            for r in _poly(t):
                checked += 1
                assert got.get(r["i"]) == r["b"], (
                    f"{uid} {t['section']} i={r['i']}「{r['c']}」"
                    f"表={r['b']} 後端={got.get(r['i'])}"
                )
        assert checked > 0 or not raw["texts"], f"{uid} 一個位置都沒比到"

    def test_空表必須是真的沒課文(self, uid):
        """⛔ 空表不准自動放行 —— 那是三道檢查同時看不見 10 課文言文的原因。

        ## 2026-09-15 對抗式複審實測

        產生器原本只收 `full_text_annotate`／`key_reading`／`multi_text_parts`，
        **10 課文言文的課文住在 `classical_text`** → 表整個是空的，
        55 段 / 5,201 字 / 1,281 個破音字位置全部靜靜走 fallback。

        而三道檢查全綠：`test_有課就有表` 只看檔案存在、上面那條有
        `or not raw["texts"]` 自動放行、`--check` 對空表重產還是空表（exit 0）。

        這條要求：表空 ⇒ **服務端給的段落也必須是 0**。
        L0136 是唯一合法的空表（只有 comprehension／spotlight／goal_box，沒有課文）。
        """
        raw = _raw(uid)
        if raw["texts"]:
            return
        from app.services.lesson_loader import get_lesson_by_id

        served = get_lesson_by_id(20000 + int(uid[1:])) or {}
        paragraphs = served.get("paragraphs") or []
        assert not paragraphs, (
            f"{uid} 的注音表是空的，但服務端給了 {len(paragraphs)} 段課文 —— "
            f"那些段落上不會有注音（或回去走 fallback 自己算）。"
            f"檢查 generate_lesson_zhuyin.collect_texts() 有沒有收到這一課的課文 section"
        )


class TestCoverageIsReal:
    """整體規模要對 —— 防「表都在但幾乎是空的」"""

    def test_破音字位置總數(self):
        total = sum(len(_poly(t)) for u in UIDS for t in _raw(u)["texts"])
        # 2026-09-15 實測 68,313。允許課文增修造成的浮動，但不允許塌掉
        assert total > 60000, f"只有 {total:,} 個破音字位置 —— 表幾乎是空的"

    def test_一不變調真的在表裡(self):
        """後端 pypinyin 結構上產不出變調 —— 表裡必須有，否則等於沒接到前端的答案"""
        found = set()
        for u in UIDS[:20]:
            for t in _raw(u)["texts"]:
                for r in _poly(t):
                    if r["c"] in "一不" and r["ss"] != "0000":
                        found.add((r["c"], r["b"]))
        assert len(found) >= 3, f"前 20 課只找到 {found} —— 變調沒進表"


class TestTheLockHasTeeth:
    """負向對照：表改壞，主斷言必須紅"""

    def test_改掉表之後後端會跟著變(self, monkeypatch):
        uid = UIDS[0]
        raw = _raw(uid)
        t = raw["texts"][0]
        first = _poly(t)[0]

        lesson_zhuyin_table.cache_clear()
        assert zhuyin_for_text(uid, t["text"])[first["i"]] == first["b"]

        # #3230：表不再存注音，只存槽位（注音由 (字, 槽位) 經字型推）。
        # 所以突變改的是**槽位**——這比改注音更接近真實失效路徑：
        # 一旦後端沒在讀 `ssz`，換了槽位它吐的還是舊注音。
        from app.services.lesson_zhuyin import font_slot_readings

        readings = font_slot_readings()[first["c"]]
        other = next(sl for sl in readings if sl != first["ss"])
        假 = json.loads(json.dumps(raw))
        z = list(假["texts"][0]["ssz"])
        z[first["i"]] = "." if other == "0000" else other[3]
        假["texts"][0]["ssz"] = "".join(z)
        monkeypatch.setattr("app.services.lesson_zhuyin._read_table", lambda u: 假)
        lesson_zhuyin_table.cache_clear()
        assert zhuyin_for_text(uid, t["text"])[first["i"]] == readings[other], (
            f"把槽位從 {first['ss']} 改成 {other} 之後後端還是回舊注音 —— 它沒在讀表"
        )
        lesson_zhuyin_table.cache_clear()


class TestHeConjunctionIsAdjudicated:
    """「和」的讀音由 `he_conjunction` 裁決，不由樣式表（#3218 / #3204）

    ## 為什麼需要這一組（2026-09-15 對抗式複審實測）

    第一版的表直接用出貨 processor 的答案，而它對「和」比 `he_conjunction`
    （jieba 斷詞 + 380 筆教育部例外 + 和自我指稱檢查）**差 26 個已驗位置**：

      表錯 4 處：和解 ×3（L0140）、耶和華（L0059）—— 兩者都在例外清單裡
      表漏 22 處：鄰居是標點／數字／拉丁字母時樣式對不到，jieba 對得到

    產生器現在多一層 `_adjudicate_he()`（雙向：在 he_positions → ㄏㄢˋ；
    不在且 processor 給 ㄏㄢˋ → ㄏㄜˊ，因為 ㄏㄢˋ **只有**連接詞這一個用法）。
    那一層改掉全庫 78 處。
    """

    def test_表與_he_conjunction_對全部的和完全一致(self):
        """⭐ 這條就是「表不准比被它取代的那條路差」。

        舊引擎（`_build_zhuyin_map`）對「和」用的就是 `_he_conjunction_positions`，
        所以兩邊在「和」上必須逐字相同。改動前實測 63 處不同。
        """
        # ⚠️ #3237：這裡原本拿 `_build_zhuyin_map()` 當 oracle —— 那是**消費端**不是權威。
        #    #3237 把它從「pypinyin 選擇器」改成純查表之後，它對「和」只會給
        #    ㄏㄢˋ（連接詞）或字型預設 ㄏㄜˊ，於是這條測試的尺自己變了。
        #    改成直接問權威 `_he_conjunction_positions()`。
        from app.services.he_conjunction import _he_conjunction_positions

        mismatches: list[str] = []
        total = 0
        for uid in UIDS:
            raw = _raw(uid)
            if not any("和" in t["text"] for t in raw["texts"]):
                continue
            lesson_zhuyin_table.cache_clear()
            for t in raw["texts"]:
                if "和" not in t["text"]:
                    continue
                got = zhuyin_for_text(uid, t["text"]) or {}
                he_pos = _he_conjunction_positions(t["text"])
                for i, ch in enumerate(_u16(t["text"])):
                    if ch != "和":
                        continue
                    total += 1
                    # 權威只回答一件事：這個位置是不是連接詞。
                    # 是 → 表必須是 ㄏㄢˋ。不是 → 表不可以是 ㄏㄢˋ（其他讀音由樣式表決定）。
                    is_conj = i in he_pos
                    tbl = got.get(i)
                    bad = (tbl != "ㄏㄢˋ") if is_conj else (tbl == "ㄏㄢˋ")
                    if bad:
                        ctx = "".join(_u16(t["text"])[max(0, i - 5):i + 6])
                        mismatches.append(
                            f"{uid} …{ctx}… 表={tbl} he_conjunction說{'是' if is_conj else '不是'}連接詞")
        lesson_zhuyin_table.cache_clear()
        assert total > 300, f"只比到 {total} 個「和」—— 測試空轉"
        assert not mismatches, (
            f"{len(mismatches)}/{total} 個「和」的位置表跟 he_conjunction 不一致，前 8：\n  "
            + "\n  ".join(mismatches[:8])
        )

    def test_複審點名的六個案例(self):
        """來自真實課文的具名案例 —— 兩個方向各有代表"""
        cases = [
            ("L0140", "個和解", "ㄏㄜˊ"),    # 例外清單：和解不是連接詞
            ("L0059", "耶和華", "ㄏㄜˊ"),    # 例外清單：專有名詞
            ("L0063", "」和「", "ㄏㄢˋ"),    # 鄰居是標點，樣式對不到
            ("L0012", "》和《", "ㄏㄢˋ"),    # 同上
            ("L0150", "8和2", "ㄏㄢˋ"),      # 鄰居是數字
            ("L0001", "和", None),            # 只求查得到，不指定（L0001 的和另有其意）
        ]
        checked = 0
        for uid, pat, want in cases:
            if want is None:
                continue
            lesson_zhuyin_table.cache_clear()
            table = lesson_zhuyin_table(uid) or {}
            found = False
            for text, readings in table.items():
                j = text.find(pat)
                if j < 0:
                    continue
                i = j + pat.index("和")
                assert readings.get(i) == want, (
                    f"{uid} …{text[max(0, i - 5):i + 6]}… 表={readings.get(i)} 應為 {want}"
                )
                found = True
                checked += 1
                break
            assert found, f"{uid} 找不到「{pat}」—— 案例過期了，要重新取樣"
        lesson_zhuyin_table.cache_clear()
        assert checked == 5, f"只驗到 {checked} 個案例"
