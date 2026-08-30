"""一修（#2683）刪掉舊 regex 管線的資料目錄，但 code 裡的引用沒清乾淨。

#2751 原本報兩個症狀。2026-08-31 逐一復現：

  症狀 2「一條已註冊的路由指向已刪目錄，會直接 500」—— **不成立**。
     build_lab_index() → 175 課、`qa_report_available: False`（優雅降級）
     build_lab_detail() → 前 30 課全有內容，0 例外
     那個 service 已經改讀 v3，`_SCHEMA_DIR` 只剩 QA 報告與 keypoints 的
     選用路徑，找不到就回 None，不炸。

  症狀 1「51 個檔案仍指著已刪目錄」—— **真的，但剩 12 檔**（不是 51）。
     原本那個 51 是用「檔案內含 `_parsed`／`_online-schema` 字串」數的，
     會把 docstring、變數名、註解一起算進去。改成只認「像路徑的短字串」
     再逐一確認那個路徑存不存在，剩 **10 檔**（原本的 51 大了五倍）。

這條不是要求清零 —— 那些是 build 腳本的歷史引用，清掉要一支一支確認。
它是**棘輪**：只能變少。多一個就紅，代表有人又寫了一條指向不存在路徑的引用。
"""
import pathlib
import re

REPO = pathlib.Path(__file__).resolve().parents[2]
SCAN = ("backend/app", "scripts", "backend/specs", "backend/tests")
DEAD = ("_online-schema", "_parsed_2026-05-01")
#: 2026-08-31 實測值（逐檔列在下面）。⛔ 只准調降。
#: ⚠️ 上限要**等於**當下的實測值，不能留 slack —— 留一格 slack，
#:    新增一條死引用時它不會叫（我第一版設 12 而實際是 10，mutation 就咬不到）。
CEILING = 10

#: 只認「不含換行、夠短、像路徑」的字串 —— 否則會把整段 docstring 算進來
_PATHLIKE = re.compile(
    r'["\']([^"\'\n]{1,90}?(?:' + "|".join(DEAD) + r')[^"\'\n]{0,60}?)["\']')


def _files_pointing_at_missing_paths() -> dict:
    out = {}
    for d in SCAN:
        for f in (REPO / d).rglob("*.py"):
            try:
                s = f.read_text(encoding="utf-8")
            except Exception:
                continue
            for m in _PATHLIKE.finditer(s):
                v = m.group(1).strip()
                if not v or (" " in v and "/" not in v):
                    continue
                base = re.split(r"[*{]", v)[0].rstrip("/")
                if (REPO / base).exists():
                    continue
                out.setdefault(str(f.relative_to(REPO)), set()).add(v)
    return out


def test_dead_path_references_only_shrink():
    """⛔ 只能變少。多一個 = 有人又寫了指向不存在路徑的引用。"""
    hits = _files_pointing_at_missing_paths()
    assert len(hits) <= CEILING, (
        f"指向已刪目錄的檔案從 {CEILING} 變成 {len(hits)}：\n  "
        + "\n  ".join(f"{k} → {sorted(v)[0][:50]}" for k in sorted(hits) for v in [hits[k]]))


def test_the_scan_actually_finds_something():
    """正向對照：真的掃得到 —— 否則上面那條在 regex 壞掉時會靜靜地綠。

    這條也是本票的教訓：原本的 51 是用「檔案含這個字串」數的，
    連 docstring 都算，數字比實際大四倍。
    """
    hits = _files_pointing_at_missing_paths()
    assert hits, "一個都沒掃到 —— regex 可能壞了，或路徑判斷把所有東西都當成存在"


def test_the_existence_check_can_tell_the_difference():
    """正向對照之二：存在的路徑不可以被算進來。"""
    real = REPO / "backend" / "data" / "lessons"
    assert real.exists(), "拿來當對照的路徑自己不見了，這條測不了"
    hits = _files_pointing_at_missing_paths()
    for f, vals in hits.items():
        for v in vals:
            base = re.split(r"[*{]", v)[0].rstrip("/")
            assert not (REPO / base).exists(), f"{f} 的 {v} 其實存在，卻被算成 dead"
