"""忠實度證明要錨在**現行**原稿上，而且漂掉的課只准變少。

為什麼這條鎖存在
----------------
Gate 8 的 `verify()` 做的是 `sha(yml) != rec["yaml_sha256"]` —— 它驗的是
**「我們的 yml 有沒有變」，從頭到尾沒有打開 DOCX**。所以它綠，只代表 yml 跟
當初立證時同一份；不代表那份 yml 對得上今天的教材。

2026-09-06 案主批次重新匯出了全部 179 個教師版檔案。一個月後實測：
**179 份證明裡有 174 份的 `docx_sha256` 對不上現行原稿**，而 Gate 8 全綠。
那個綠驗的是一份已經被取代的證據。

那次漂移已經在 main 上修完了（#3277）：2026-09-25 重新量測，179 份證明
全部對得上現行原稿、重新立證產生 0 個檔案變動。

⚠️ 但**修完不等於守住**。Gate 8 的綠跟「原稿有沒有換」無關，所以同樣的事
可以再發生一次而沒有任何紅燈。這條鎖補的就是那個缺口。

這條鎖守的是
------------
1. 每一份證明的 `docx_sha256` 要等於本機現行原稿的雜湊
2. 例外只有下面具名的 11 課，而且**只准變少** —— 修好一課就從清單移除一課

⛔ 不要用「把 11 課的證明也重新產一次」來讓這條綠：那會把 `status: fail` 寫進
證明，Gate 8 對它們變紅，而內容還是沒修。凍結不等於修好。
⛔ 也不要放寬成「數量 <= 11」而不具名：具名才知道是哪幾課、才有人去修。
"""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest
import yaml

REPO = Path(__file__).resolve().parents[2]
ATTEST_DIR = REPO / "specs" / "modules" / "fidelity"
SOT = REPO / "private" / "curriculum-source" / "_SOT"
LESSONS = REPO / "backend" / "data" / "lessons"

#: 錨在過期原稿上的課。**現在是空的，而且只准維持空的或變少。**
#:
#: 2026-09-25 實測：179 份證明全部對得上現行原稿（#3277 已在 main 上修完）。
#: 這條鎖存在不是因為現在有問題，是因為**這個綠沒有任何東西在守** ——
#: Gate 8 只比 yml 的雜湊，案主哪天再批次重匯一次原稿，它照樣全綠。
#: 2026-09-06 那次就是這樣，一個月後才有人去比，發現 174/179 錨在舊證據上。
KNOWN_DRIFTED: frozenset[str] = frozenset()


def _sha():
    spec = importlib.util.spec_from_file_location(
        "cfa", REPO / "scripts" / "content_fidelity_attest.py")
    m = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(m)
    except SystemExit:  # 腳本在 import 時可能想跑 main
        pass
    return m.sha


def _drive_path(uid: str) -> str | None:
    ly = LESSONS / uid / "v3" / "lesson.yml"
    if not ly.is_file():
        return None
    doc = yaml.safe_load(ly.read_text(encoding="utf-8")) or {}
    return (doc.get("source") or {}).get("drive_path")


def _mismatched() -> tuple[set[str], int]:
    """回 (雜湊對不上現行原稿的課, 實際比對過的課數)。"""
    sha = _sha()
    bad, checked = set(), 0
    for path in sorted(ATTEST_DIR.glob("L*.json")):
        uid = path.stem
        rec = json.loads(path.read_text(encoding="utf-8")).get("docx_sha256")
        if not rec:
            continue
        dp = _drive_path(uid)
        if not dp:
            continue
        f = SOT / dp
        if not f.is_file():        # 沒有本機快照就不是這條鎖能回答的事
            continue
        checked += 1
        if sha(f) != rec:
            bad.add(uid)
    return bad, checked


@pytest.mark.skipif(not SOT.is_dir(), reason="沒有本機原稿快照（private/ 不在這台機器上）")
def test_proofs_anchor_to_the_current_originals() -> None:
    bad, checked = _mismatched()

    # 正向對照：一課都沒比到的話，「沒有違規」什麼都不證明
    assert checked >= 150, (
        f"只比對到 {checked} 課 —— 預期 179 課左右。原稿快照不完整或 drive_path 壞了，"
        f"這條鎖現在是對空集合斷言"
    )

    unexpected = bad - KNOWN_DRIFTED
    assert not unexpected, (
        f"{sorted(unexpected)} 的忠實度證明錨在已經被取代的原稿上。\n"
        f"Gate 8 只比 yml 的雜湊、不開 DOCX，所以它會照樣綠 —— 那個綠驗的是"
        f"一份過期的證據。對現行原稿重新立證："
        f"`python3 scripts/content_fidelity_attest.py --uid <UID> --docx <原稿>`"
    )


@pytest.mark.skipif(not SOT.is_dir(), reason="沒有本機原稿快照")
def test_the_drifted_list_only_shrinks() -> None:
    """清單裡已經修好的課要移除 —— 否則它會慢慢變成一張沒人看的免死金牌。"""
    bad, _ = _mismatched()
    stale = KNOWN_DRIFTED - bad
    assert not stale, (
        f"{sorted(stale)} 已經對得上現行原稿了，請從 KNOWN_DRIFTED 移除。\n"
        f"留著等於給未來的漂移一個現成的藉口。"
    )
