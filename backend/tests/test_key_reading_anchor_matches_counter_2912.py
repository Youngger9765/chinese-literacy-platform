"""指令寫的段號不一定等於我們的段號 —— 用學習單累計欄的段界對齊校正。

L0007 的指令寫「從指定段落（五☞）開始朗讀」，我們照 5 取，得到 367 字，
而學習單累計欄末筆是 399。差 32 字一直查不出來源，直到把累計欄的**整串數字**
拿來跟段界比對：

    學習單累計欄  27 45 61 77 104 130 157 172 189 218 248 271 298 327 356 385 399
    從第 4 段起    33 78 131 173 190 272 400        ← 6 個段界落在數字上
    從第 5 段起    45 98 140 157 239 367 480        ← 只有 2 個

**印刷的「五」是我們的第 4 段。** 累計欄是第二個獨立見證人：☞ 說起點在哪，
段界對齊說那個段號有沒有錯位。兩個都來自同一張學習單，都不需要原稿 ——
`printed_char_marks` 150/150 課都已經轉錄進 yml。

⛔ 保守閘門：只有「現在對不上」且「換過去之後真的對得上」才校正。
   否則會把本來正確的課改壞（L0101 命中數會變高，但它現在已經對得上）。
"""
import glob
import pathlib

import yaml

REPO = pathlib.Path(__file__).resolve().parents[2]
TOLERANCE = 20
#: 這兩課的指令段號與我們的 idx 差一格，靠段界對齊查出來（2026-08-31）
CORRECTED = {"L0007": 399, "L0127": 341}


def _by_uid():
    out = {}
    for f in glob.glob(str(REPO / "backend/data/lessons/L*/v3/*key_reading*.yml")):
        doc = yaml.safe_load(pathlib.Path(f).read_text(encoding="utf-8")) or {}
        kr = doc.get("key_reading") or {}
        if kr.get("passage"):
            out.setdefault(pathlib.Path(f).parts[-3], []).append((doc, kr))
    return out


def test_the_two_shifted_lessons_now_match_their_worksheet():
    """L0007 與 L0127：校正前差 32 / 78 字，校正後應落在容差內。"""
    data = _by_uid()
    wrong = []
    for uid, target in CORRECTED.items():
        assert uid in data, f"{uid} 沒有 passage —— 量具壞了不是修好了"
        doc, kr = data[uid][0]
        gap = len(kr["passage"]) - target
        if abs(gap) > TOLERANCE:
            wrong.append(f"{uid} {len(kr['passage'])} 字 vs 學習單 {target}（差 {gap:+d}）")
    assert not wrong, "指令段號錯位的課還是對不上：" + "；".join(wrong)


def test_a_corrected_anchor_says_so_in_the_file():
    """校正過的課要留下痕跡 —— 否則下一個人會以為指令段號本來就是這個。"""
    data = _by_uid()
    silent = []
    for uid in CORRECTED:
        doc, kr = data[uid][0]
        if not kr.get("anchor_corrected_from"):
            silent.append(uid)
    assert not silent, (
        f"校正了段號卻沒有在檔案裡說：{silent} —— 要記 anchor_corrected_from")


def test_the_correction_did_not_touch_the_lessons_that_were_already_right():
    """⛔ 最重要的一條：本來就對得上的課不可以被校正碰到。

    L0101 的鄰居段命中數比較高，但它現在已經對得上 —— 校正它等於把好的改壞。
    """
    moved = sorted(uid for uid, rows in _by_uid().items()
                   for doc, kr in rows
                   if kr.get("anchor_corrected_from") and uid not in CORRECTED)
    assert not moved, f"校正動到了不該動的課：{moved}"


def test_the_corpus_did_not_get_worse():
    """棘輪：對得上的課數只能增加，不能因為這次校正變少。"""
    ok = sum(1 for rows in _by_uid().values() for doc, kr in rows
             if isinstance(kr.get("printed_counter_last"), int)
             and abs(len(kr["passage"]) - kr["printed_counter_last"]) <= TOLERANCE)
    assert ok >= 133, f"只有 {ok} 課對得上（校正前是 131，不該退步）"


# ── 閘門③ 的 unit test ──────────────────────────────────────────────
# 全庫沒有課走得到閘門③（真資料上 ②③ 同進退），所以整批 mutation 咬不到它 ——
# 拿掉 ③ 之後 150 課的產出一模一樣。只有合成輸入證明得了它有在擋。
import importlib.util as _il

_spec = _il.spec_from_file_location("krx", REPO / "scripts" / "extract_key_reading_v3.py")
KRX = _il.module_from_spec(_spec)
_spec.loader.exec_module(KRX)


def _corpus(lengths: dict) -> dict:
    return {i: "字" * n for i, n in lengths.items()}


def test_gate_1_leaves_a_lesson_that_already_reconciles_alone():
    """對得上的課一律不碰 —— 即使鄰居的段界命中更多。"""
    by = _corpus({1: 10, 2: 30, 3: 30, 4: 30})
    assert KRX.realign_anchor(2, by, [30, 60, 90]) is None


def test_gate_2_ignores_a_neighbour_that_is_only_marginally_better():
    """只多命中 1 個段界是雜訊，不足以推翻指令寫的段號。"""
    by = _corpus({1: 41, 2: 100, 3: 100})
    assert KRX.realign_anchor(2, by, [41, 300]) is None


def test_gate_3_refuses_a_neighbour_that_hits_more_marks_but_still_misses():
    """⭐ 這條就是整批 mutation 咬不到的那個形狀。

    鄰居的段界命中比較多（②過），但它累加起來離末筆一樣遠（③擋）——
    少了 ③ 就會把「命中多但一樣錯」的鄰居當成答案。
    """
    by = _corpus({1: 10, 2: 20, 3: 30, 4: 500})   # 從 1 起：10/30/60；從 2 起：20/50
    marks = [10, 30, 60, 900]                      # 末筆 900 兩邊都搆不到
    assert KRX.realign_anchor(2, by, marks) is None, "③ 沒擋住：命中多但一樣對不上"


def test_it_does_correct_when_all_three_gates_pass():
    """正向對照：三條都過就要真的校正，否則上面三條恆真。"""
    by = _corpus({1: 33, 2: 45, 3: 53, 4: 42, 5: 400})
    #  從 2 起：45 / 98 / 140 …離 173 遠；從 1 起：33 / 78 / 131 / 173 ← 全命中且對得上
    #  ⚠️ 數列要 ≥ MIN_MARKS_TO_REALIGN（4）個，否則會在第一道就 return None，
    #     那樣這條「正向對照」會因為錯的理由而綠 —— 我第一版就是這樣。
    assert KRX.realign_anchor(2, by, [33, 78, 131, 173]) == 1


def test_a_short_counter_is_never_used_to_move_an_anchor():
    """數列太短沒有鑑別力 —— 不准拿它動段號。"""
    by = _corpus({1: 33, 2: 45, 3: 53})
    assert KRX.realign_anchor(2, by, [33, 78]) is None
