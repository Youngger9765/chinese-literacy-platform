"""一課沒有 spotlight.yml，不可以讓整批測試收集不起來。

`pytest tests` 在乾淨的 checkout 上**跑不起來**：

    tests/test_spotlight_to_lesson_content.py:55: in <module>
    app/services/spotlight_to_lesson_content.py:915: in sample_uids
    FileNotFoundError: .../data/lessons/L0011/v3/spotlight.yml
    !!! Interrupted: 1 error during collection !!!
    3529 tests collected, 1 error

3529 個測試被一個檔擋住。而且是在**模組載入時**炸的，所以不是「那一支紅」，是整批不跑。

根因：`sample_uids()` 的 docstring 已經寫明「抽取出 0 個 block 的課要跳過 ——
那是登記在案的內容缺口」，但它 `load_spotlight()` **之前沒有先確認檔案在不在**。
L0011 是 #2781 盤出「真的沒有聚光燈」的那 7 課之一，連檔案都沒有，於是直接拋。

⚠️ 為什麼主 checkout 看不到：那台機器上有一份**未被 git 追蹤**的
`L0011/v3/spotlight.yml`（本機產生的）。所以這個 bug 只在乾淨的 worktree 現形 ——
「能不能跑測試」取決於這台機器剛好有什麼。
"""
from __future__ import annotations

import pathlib

from app.services import spotlight_to_lesson_content as mod


def test_a_lesson_with_no_spotlight_file_is_skipped_not_fatal(tmp_path, monkeypatch):
    """一課有 spotlight、一課完全沒有 —— 只回有的那個，不可以拋。"""
    has = tmp_path / "L0001" / "v3"
    has.mkdir(parents=True)
    (has / "spotlight.yml").write_text(
        "spotlight:\n  blocks:\n    - kind: paragraph\n      text: 有內容\n",
        encoding="utf-8",
    )
    missing = tmp_path / "L0002" / "v3"
    missing.mkdir(parents=True)          # 目錄在、spotlight.yml 不在（L0011 就是這樣）

    monkeypatch.setattr(mod, "LESSONS_ROOT", tmp_path)
    uids = mod.sample_uids()

    assert uids == ["L0001"], f"沒有 spotlight 的課應該被跳過，拿到 {uids}"


def test_the_real_corpus_can_be_sampled_without_blowing_up():
    """正向對照：對真實語料跑一次，而且真的取到東西。

    少了「取到東西」這半，`sample_uids()` 回空陣列時這條也會綠 ——
    那種綠只代表它沒拋，不代表它有用。
    """
    uids = mod.sample_uids(limit=5)
    assert len(uids) > 0, "真實語料取不到任何一課 —— 這條測試沒在測東西"
    for u in uids:
        assert (pathlib.Path(mod.LESSONS_ROOT) / u).is_dir(), u


def test_the_module_under_test_can_be_imported():
    """那支測試是在 module 層呼叫 sample_uids 的，所以 import 得起來才算修好。"""
    import importlib

    m = importlib.import_module("tests.test_spotlight_to_lesson_content")
    assert m is not None
