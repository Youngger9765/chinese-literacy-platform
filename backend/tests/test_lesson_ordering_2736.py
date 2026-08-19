"""圖書館按 `lesson_uid` 排，不是按課次 —— 學生看到的第一課是第十課。

Young 打開圖書館問：為什麼第一課不是《贏得喝采的輸家》？

    圖書館順序          實際課次
    L0001 十秒的背後      G4-L10
    L0002 動物的生存妙招   G4-L11
    L0003 大自然的氣象…    G4-L12

`L0001` 剛好是四年級第 **10** 課，而 `G4-L1` 的《贏得喝采的輸家》躺在 `L0011`。
UID 是抽取的流水號，跟課本順序沒有關係。

課次一直都在 `grade_code` 裡（`G4-L10` ＝ 年級 4 課次 10），但那是一個要
parse 的字串，而且有三種系列：一般 `G4-L1`、文言文 `文-L1`、體育生 `體-L1`。
每個要排序的地方各自 parse 一次，就是它們遲早會排得不一樣的原因。

所以課次進 metadata 成為明確欄位，前端直接拿來排，不再自己拆字串。
"""
from __future__ import annotations

import pathlib
import sys

import yaml

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from app.services.lesson_loader import search_lessons  # noqa: E402

LESSONS = pathlib.Path(__file__).resolve().parent.parent / "data" / "lessons"


def _all():
    return search_lessons()


def test_every_lesson_declares_its_number():
    """每一課都要有課次，沒有例外 —— 有一課沒有，排序就會把它丟到某個角落。"""
    missing = [l.get("lesson_uid") for l in _all() if l.get("lesson_no") in (None, "")]
    assert not missing, f"{len(missing)} 課沒有課次：{missing[:10]}"


def test_every_lesson_declares_a_sortable_sequence():
    """課次有三種寫法（`10` / `文-1` / `體-1`），排序要用同一把尺。"""
    bad = [l.get("lesson_uid") for l in _all() if not isinstance(l.get("lesson_seq"), int)]
    assert not bad, f"{len(bad)} 課沒有可排序的 lesson_seq：{bad[:10]}"


def test_the_number_matches_the_lesson_code():
    """課次要跟課碼說的一致 —— 兩個地方各講各的，就是它們會漂移的起點。"""
    import re

    wrong = []
    for l in _all():
        m = re.match(r"^(?:G(\d+)|(文|體))-L(\d+)", str(l.get("grade_code") or ""))
        if not m:
            continue
        if str(l.get("lesson_no")) != str(int(m.group(3))):
            wrong.append((l.get("lesson_uid"), l.get("grade_code"), l.get("lesson_no")))
    assert not wrong, (
        "課次與課碼不符：\n" + "\n".join(f"  {u}: code={c} lesson_no={n}" for u, c, n in wrong[:8])
    )


def test_the_corpus_comes_back_in_curriculum_order():
    """`search_lessons()` **回傳時就已經排好**，呼叫端不必再排。

    ⚠️ 第一版這條測試自己跑了一次 `sorted(..., key=lambda x: x["lesson_seq"])`
    才取第一筆 —— 那是在測我寫在測試裡的排序，不是產品的。把
    `build_all_lessons` 的排序整個拿掉，它照樣綠。

    斷言要打在生產函式的輸出上，不是打在測試自己重排的複製品上。
    """
    got = [l.get("lesson_seq") for l in search_lessons()]
    assert got == sorted(got), (
        "回傳的順序不是課本順序 —— 前 6 筆："
        + ", ".join(
            f"{l.get('grade_code')}({l.get('lesson_seq')})" for l in search_lessons()[:6]
        )
    )


def test_grade_four_starts_with_the_first_lesson():
    """四年級**照原樣取第一筆**，要是《贏得喝采的輸家》。

    這是 Young 實際問的那一句。不在這裡排序 —— 排序是產品的責任，
    這條要驗的正是它有沒有盡到。
    """
    g4 = [l for l in search_lessons() if str(l.get("grade_code", "")).startswith("G4-")]
    assert g4, "找不到四年級的課 —— 這條在測空氣"
    assert g4[0]["title"] == "贏得喝采的輸家", (
        f"四年級第一課是《{g4[0]['title']}》（{g4[0].get('grade_code')}），不是課本的第一課"
    )


def test_the_series_is_named_not_inferred_from_a_prefix():
    """文言文/體育生是不同系列，要說出來，不要讓每個地方各自從課碼猜。"""
    series = {l.get("series") for l in _all()}
    assert None not in series, "有課沒有 series"
    assert series == {"一般", "文言文", "體育生"}, f"series 不如預期：{series}"
