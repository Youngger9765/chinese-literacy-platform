"""重生 manifest 的腳本不可以在無聲無息中把 150 筆砍成 5 筆。

2026-08-20 實際發生：照它檔頭第一個範例的用法跑

    python scripts/build_keypoints_qa_manifest.py

輸出是

    Wrote backend/data/curriculum_qa/keypoints_manifest.json
      lessons=5 unreviewed=1 display_only=0

退出碼 0、字面上寫著 Wrote、沒有任何失敗信號 ——
實際上 `git diff --stat` 是 `30 insertions, 4169 deletions`，**145 筆沒了**。

根因是 `main()` 幫使用者選了一個會毀資料的預設：

    if not args.smoke and not args.all:
        args.smoke = True          # ← 什麼都不帶 = 只跑 5 課，但寫進同一個檔

我是比對 `git show HEAD:` 的筆數才發現的。如果當時直接 commit，那 145 筆就沒了。

這裡鎖三件事：
1. 什麼都不帶要**報錯**，不要偷偷選一個會毀資料的模式
2. `--smoke` 不可以覆蓋正式 manifest
3. 就算明確要求全量，筆數大幅下降也要**擋下來**（fail-closed），除非 `--force`
"""
from __future__ import annotations

import pathlib
import sys

import pytest

REPO = pathlib.Path(__file__).resolve().parents[2]

# ⚠️ 不要在 module 層 `sys.path.insert` 再 import。
# 第一版那樣寫，單獨跑 5 條全過，但**跑全套時會讓另外兩條 spec 變紅** ——
# 插進 sys.path 改變了後續測試的模組解析（`scripts/` 底下有跟 app 同名的模組）。
# 用 spec_from_file_location 指名載入，不動任何全域狀態。
def _load_builder():
    import importlib.util

    path = REPO / "scripts" / "build_keypoints_qa_manifest.py"
    spec = importlib.util.spec_from_file_location("_kp_manifest_builder_under_test", path)
    mod = importlib.util.module_from_spec(spec)
    sys.path.insert(0, str(REPO / "backend"))
    try:
        spec.loader.exec_module(mod)
    finally:
        sys.path.pop(0)
    return mod


@pytest.fixture
def builder():
    """在測試裡才載入。

    ⚠️ 第一版在 module 層 `builder = _load_builder()`，於是**collection 階段**就
    執行了那支腳本 —— 它會連帶初始化 app 的 DB metadata，害
    `specs/test_stuck_detection_spec.py` 兩條期待 IntegrityError 的測試不再拋錯。
    單獨跑我這 5 條全過、跑全套才紅，而且不管我的檔在前在後都紅（因為壞在 collection）。
    """
    return _load_builder()


def test_no_flags_is_an_error_not_a_silent_smoke_run(builder, monkeypatch, capsys):
    """什麼都不帶 → 非零退出 + 說清楚要選哪個，**而且沒有寫任何檔**。"""
    wrote = []
    monkeypatch.setattr(builder, "_write", lambda *a, **k: wrote.append(a))
    monkeypatch.setattr(sys, "argv", ["build_keypoints_qa_manifest.py"])

    with pytest.raises(SystemExit) as exc:
        builder.main()

    assert exc.value.code != 0, "什麼都不帶卻成功結束 —— 那正是會毀資料的那條路"
    assert wrote == [], "什麼都不帶不可以寫檔"


def test_smoke_never_overwrites_the_real_manifest(builder, monkeypatch):
    """`--smoke` 只跑 5 課，寫進正式 manifest 就等於用子集覆蓋全集。"""
    targets = []

    def fake_write(manifest, snapshots, *, path=None, **kw):
        targets.append(path or builder.MANIFEST_PATH)

    monkeypatch.setattr(builder, "_write", fake_write)
    monkeypatch.setattr(builder, "build_manifest",
                        lambda **kw: ({"summary": {"total": 5, "unreviewed": 0,
                                                   "display_only": 0, "fail": 0},
                                       "lessons": [{}] * 5}, {}))
    monkeypatch.setattr(sys, "argv", ["x", "--smoke"])
    builder.main()

    assert targets, "--smoke 應該還是有輸出，只是不能是正式檔"
    assert all(pathlib.Path(t) != pathlib.Path(builder.MANIFEST_PATH) for t in targets), (
        f"--smoke 覆蓋了正式 manifest：{targets}"
    )


def test_a_big_drop_in_lesson_count_is_refused(builder, monkeypatch):
    """就算明確 `--all`，筆數掉一半以上也要擋 —— 那多半是語料沒載到，不是課變少了。"""
    monkeypatch.setattr(builder, "_write",
                        lambda *a, **k: pytest.fail("筆數暴跌卻還是寫檔了"))
    monkeypatch.setattr(builder, "_existing_lesson_count", lambda: 150)
    monkeypatch.setattr(builder, "build_manifest",
                        lambda **kw: ({"summary": {"total": 5, "unreviewed": 0,
                                                   "display_only": 0, "fail": 0},
                                       "lessons": [{}] * 5}, {}))
    monkeypatch.setattr(sys, "argv", ["x", "--all"])

    # `main()` 回非零（`__main__` 那層才轉成 SystemExit）——
    # 斷言回傳值，不要斷言它用哪個機制退出。
    assert builder.main() != 0, "筆數暴跌卻回 0 —— 呼叫端會以為成功"


def test_force_allows_a_deliberate_shrink(builder, monkeypatch):
    """真的要縮，帶 `--force` 就放行 —— 擋的是意外，不是意圖。"""
    wrote = []
    monkeypatch.setattr(builder, "_write", lambda *a, **k: wrote.append(True))
    monkeypatch.setattr(builder, "_existing_lesson_count", lambda: 150)
    monkeypatch.setattr(builder, "build_manifest",
                        lambda **kw: ({"summary": {"total": 5, "unreviewed": 0,
                                                   "display_only": 0, "fail": 0},
                                       "lessons": [{}] * 5}, {}))
    monkeypatch.setattr(sys, "argv", ["x", "--all", "--force"])
    builder.main()
    assert wrote, "帶了 --force 還是被擋 —— 那就變成擋意圖了"


def test_a_normal_full_run_is_not_blocked(builder, monkeypatch):
    """負向對照：筆數沒掉的全量重生必須照常通過，否則這幾條鎖只是把工具鎖死。"""
    wrote = []
    monkeypatch.setattr(builder, "_write", lambda *a, **k: wrote.append(True))
    monkeypatch.setattr(builder, "_existing_lesson_count", lambda: 150)
    monkeypatch.setattr(builder, "build_manifest",
                        lambda **kw: ({"summary": {"total": 150, "unreviewed": 0,
                                                   "display_only": 0, "fail": 0},
                                       "lessons": [{}] * 150}, {}))
    monkeypatch.setattr(sys, "argv", ["x", "--all"])
    builder.main()
    assert wrote
