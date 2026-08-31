"""學習單印了某大題、但那一節還沒抽出來 —— 派工單要照樣產得出來（#3011）。

新教材進來時本來就是這個狀態：`sections_present` 是學習單自己印的目錄（九個大題），
而模組檔是一節一節慢慢抽的。`build_one()` 原本在這種情況直接 `KeyError`：

    k = _module_seen[module]     # ← 只有「硬碟上有檔」的模組才有這個 key

而 `main()` 是**先全部算完再寫**（那是刻意的，避免寫出一半新一半舊的工作樹），
所以**一課炸掉 = 175 課的派工單全部沒產出**，畫面上只有一個 traceback。

2026-08-31 加 體-L12~L15 四課新教材時撞到：課文與念順順抽好了，其餘七節還沒，
於是整個 `build_lesson_manifest.py` 起不來。

判準：部分抽取的課要拿得到派工單，已抽好的那幾節要有代號，沒抽的那幾節
`slug` 是 null（誠實標示「還沒有」），而不是整支腳本倒掉。
"""
from __future__ import annotations

import pathlib
import sys

import yaml

REPO = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "scripts"))


def _build(tmp_path, present, files):
    vdir = tmp_path / "L9999" / "v3"
    vdir.mkdir(parents=True)
    (vdir / "lesson.yml").write_text(yaml.safe_dump(
        {"lesson_uid": "L9999", "version_id": "v3", "sections_present": present},
        allow_unicode=True), encoding="utf-8")
    for mod, slug in files:
        (vdir / f"{mod}.{slug}.yml").write_text(
            yaml.safe_dump({mod: {"slug": slug}}, allow_unicode=True), encoding="utf-8")
    import build_lesson_manifest as blm
    table = yaml.safe_load((REPO / "specs/modules/section-to-module.yml").read_text(encoding="utf-8"))
    return blm.build_one(vdir, table, {}, {}, [])


PRESENT = [{"no": "一", "name": "讀全文-做記號"}, {"no": "二", "name": "念順順"},
           {"no": "三", "name": "語詞我最棒"}]


def test_positive_control_fully_extracted_lesson_builds(tmp_path):
    """先證明這個組裝法在**全部都抽好**時真的產得出東西。"""
    man = _build(tmp_path, PRESENT, [("full_text_annotate", "aaa11"),
                                     ("key_reading", "bbb22"), ("vocab_definitions", "ccc33")])
    assert man is not None
    assert [s["slug"] for s in man["sections"]] == ["aaa11", "bbb22", "ccc33"]


def test_partial_extraction_still_produces_a_manifest(tmp_path):
    """只抽了兩節：派工單要出得來，第三節的 slug 是 null。"""
    man = _build(tmp_path, PRESENT, [("full_text_annotate", "aaa11"), ("key_reading", "bbb22")])
    assert man is not None, "部分抽取的課拿不到派工單 —— QR 代號會整批消失"
    got = {s["module"]: s["slug"] for s in man["sections"]}
    assert got["full_text_annotate"] == "aaa11"
    assert got["key_reading"] == "bbb22"
    assert got["vocab_definitions"] is None, "沒抽的那節不可以借用別人的代號"


def test_nothing_extracted_yet_is_also_survivable(tmp_path):
    """一節都還沒抽 —— 仍要有派工單（那正是它要派工的對象）。"""
    man = _build(tmp_path, PRESENT, [])
    assert man is not None
    assert all(s["slug"] is None for s in man["sections"])
    # `dispatch` = 「要派哪幾架飛機出去」，所以一節都沒抽時它**該列滿** ——
    # 那正是派工單的用途。空的是 `produced`（硬碟上真的有的）。
    assert man["dispatch"] == ["full_text_annotate", "key_reading", "vocab_definitions"]
    assert man["produced"] == []
