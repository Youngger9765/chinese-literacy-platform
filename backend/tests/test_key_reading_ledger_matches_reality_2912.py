"""沒有念順順的課，總帳本要**逐課寫清楚**，而且分得出兩種完全不同的原因。

2026-08-31 之前這一節寫著：

    count: 28
    status: 不是缺口 —— 那個課型本身沒有這個練習
    why_28_is_not_a_gap: 逐份檢查過 DOCX，那 28 份完全沒有「念順順」或「重點朗讀」字樣

**那句話是錯的。** 重新逐份掃原稿：18 份確實沒有，10 份有 —— 文言文那一軌把這個
大題印成「請用計時器，朗讀原文」，只找「念順順／重點朗讀」會整批漏掉
（跟 spotlight 那次「品格聚光燈／文言文聚光燈」漏抓同一個形狀）。

於是 10 課學習單上有這個大題、學生在平台上看不到，被一句「不是缺口」蓋住。

這條鎖不看原稿（CI 沒有 private/），它守的是**帳本與出貨資料一致** ——
有課掉出念順順而帳本沒記，或帳本記了某課其實有，都要紅。
"""
import glob
import pathlib

import yaml

REPO = pathlib.Path(__file__).resolve().parents[2]
LEDGER = REPO / "backend/data/curriculum_qa/content_known_gaps.yaml"


def _shipped_with_passage() -> set:
    out = set()
    for f in glob.glob(str(REPO / "backend/data/lessons/L*/v3/*key_reading*.yml")):
        doc = yaml.safe_load(pathlib.Path(f).read_text(encoding="utf-8")) or {}
        if (doc.get("key_reading") or {}).get("passage"):
            out.add(pathlib.Path(f).parts[-3])
    return out


def _all_lessons() -> set:
    return {pathlib.Path(p).parts[-3]
            for p in glob.glob(str(REPO / "backend/data/lessons/L*/v3/_manifest.yml"))}


def _ledger_buckets() -> dict:
    led = yaml.safe_load(LEDGER.read_text(encoding="utf-8")) or {}
    w = led.get("key_reading_withheld") or {}
    return {k: {r["lesson_uid"] for r in (w.get(k) or {}).get("lessons") or []}
            for k in ("not_on_the_worksheet", "on_the_worksheet_but_not_served")}


def test_every_lesson_without_a_passage_is_named_in_the_ledger():
    """⛔ 掉出念順順卻沒被逐課寫進帳本 = 靜靜消失，沒有人會發現。"""
    missing = _all_lessons() - _shipped_with_passage()
    recorded = set().union(*_ledger_buckets().values())
    unlisted = sorted(missing - recorded)
    assert not unlisted, (
        f"{len(unlisted)} 課沒有念順順卻不在總帳本裡：{unlisted[:10]}")


def test_the_ledger_does_not_claim_a_lesson_is_missing_when_it_is_not():
    """反向：帳本說某課沒有，但它其實出貨了 —— 帳本過時，一樣要紅。"""
    stale = sorted(set().union(*_ledger_buckets().values()) & _shipped_with_passage())
    assert not stale, f"帳本說這些課沒有念順順，但它們有：{stale[:10]}"


def test_the_two_causes_are_kept_apart():
    """⭐ 這條就是原本那句錯話的形狀：把「來源沒有」跟「有但沒服務」合起來說。

    第二桶是真缺口（學生看不到學習單上有的東西），不可以被算成「不是缺口」。
    """
    b = _ledger_buckets()
    overlap = b["not_on_the_worksheet"] & b["on_the_worksheet_but_not_served"]
    assert not overlap, f"同一課同時記在兩桶：{sorted(overlap)}"
    assert b["on_the_worksheet_but_not_served"], (
        "第二桶是空的 —— 要嘛真的補好了（那要一起更新這條），"
        "要嘛又被合併回『不是缺口』了")


def test_the_real_gap_says_how_to_close_it():
    """真缺口要寫得出「怎麼補」，否則它只是被記下來然後被忘掉。"""
    led = yaml.safe_load(LEDGER.read_text(encoding="utf-8")) or {}
    b = (led.get("key_reading_withheld") or {}).get("on_the_worksheet_but_not_served") or {}
    for field in ("status", "what", "why_not_fixed_yet", "how_to_close", "how_verified"):
        assert str(b.get(field) or "").strip(), f"真缺口那一節少了 {field}"


def test_the_gate_is_measuring_something():
    """正向對照：真的有課被量到。"""
    assert len(_all_lessons()) >= 170, "課數不對，量具可能壞了"
    assert len(_shipped_with_passage()) >= 140, "有 passage 的課太少"
