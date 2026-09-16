"""注音相關的 code 與資料必須有 owner。(#3203)

## 為什麼需要這一道

`specs/modules/zhuyin/INTENT.md` 這份文件本身防不了復發 —— 下一個人在
前端的 zhuyin 目錄底下再加一支新檔，不會有任何東西提醒他登記，
而「沒有人在看這一塊的整體」正是 #3173／#3175／#3177／#3202／#3204 五張票的共同根因。

這條把它變成擋：**檔名或路徑看起來跟注音有關的檔，要嘛被 zhuyin module 擁有，
要嘛列在下面的豁免清單裡並寫明理由。** 兩者都不是 → 紅。

⚠️ 這條不驗「注音對不對」（那是 spec_tests 那幾支的事），只驗**有沒有主人**。
"""

from __future__ import annotations

import pathlib
import re
import subprocess

import fnmatch

import yaml

REPO = pathlib.Path(__file__).resolve().parents[2]
REGISTRY = REPO / "specs" / "registry.yaml"

#: 路徑或檔名命中這些詞，就算是「看起來跟注音有關」
_LOOKS_LIKE_ZHUYIN = re.compile(r"zhuyin|poyin|bopomo|he_conjunction|BpmfZihi", re.IGNORECASE)

#: 測試與 spec 自己不算（它們由 spec_tests 列，不是 owns_code）
_NOT_PRODUCTION = re.compile(r"__tests__|\.test\.|\.spec\.|/tests/|^specs/|^backend/specs/")

#: 刻意不歸 zhuyin module 的，每一筆要有理由。
#:
#: ⛔ 往這裡加東西之前先問：它真的不決定「一個字讀什麼音」嗎？
#:    如果它決定，那它屬於這個 module，不是豁免。
EXEMPT = {
    # ── 死碼（架構複審 2026-09-14 查實：全庫零 import）──
    "frontend/src/components/reading-steps/ZhuyinPhoneticGame.tsx": "注音配對遊戲，全庫零 import",
    "frontend/src/components/reading-steps/zhuyinGameEngine.ts": "同上，遊戲引擎",
    "frontend/src/components/reading-steps/zhuyinGameLogic.ts": "同上，遊戲邏輯",
    # ── UI／狀態，不決定讀音 ──
    "frontend/src/components/ui/ZhuyinToggle.tsx": "無／難字／全 三段開關，不決定讀音",
    # ⚠️ `ZhuyinContext.tsx` 原本在這裡，理由是「不決定讀音」——
    #    #3218 之後它**會**決定（查逐課對照表，查不到才回去算），所以移進 owns_code。
    "frontend/src/components/zhuyin/difficultSpanRenderer.tsx": "難字區間的渲染（#3022/#3185），吃已決定好的讀音",
    # ── 文件 ──
    "docs/audit/zhuyin-facts-2026-09-12.md": "稽核紀錄（⚠️ 對現在的 main 已過期，見 INTENT §1）",
    "docs/prd/zhuyin-single-source-of-truth.md": "PRD（⚠️ 同上，已過期）",
    "docs/qa/zhuyin-3202-changed-readings.md": "#3202 的影響面清單",
    "docs/research/zhuyin-teaching-strategies-special-education.md": "特教注音教學研究",
}


def _tracked_files() -> list[str]:
    """已追蹤 ＋ 已 staged ＋ 未追蹤（排除 gitignore）的檔。

    ⛔ 原本只有 `git ls-files` —— 那只看得到**已追蹤**的檔，所以這道門
    **結構上擋不住引進問題的那個 commit**：新加的注音檔在該次 commit 時還沒被追蹤，
    門是綠的；要到下一次 commit 才紅，而那時人已經走了。

    #3218 實際踩到：新增 `lesson_zhuyin.py`／`generate_lesson_zhuyin.py`／
    `zhuyinAnswers.ts` ＋ 179 個 `zhuyin.json`，這道門全綠。
    """
    seen: dict[str, None] = {}
    for args in (
        ["git", "ls-files", "-z"],                                  # 已追蹤
        ["git", "diff", "--cached", "--name-only", "-z"],            # 已 staged（含新增）
        ["git", "ls-files", "-z", "--others", "--exclude-standard"],  # 未追蹤、非 ignore
    ):
        out = subprocess.run(
            args, cwd=REPO, capture_output=True, text=True, check=True
        ).stdout
        for f in out.split("\0"):
            if f:
                seen[f] = None
    return list(seen)


def _zhuyin_module_owns() -> set[str]:
    data = yaml.safe_load(REGISTRY.read_text(encoding="utf-8"))
    modules = data.get("modules") or data
    if isinstance(modules, dict):
        modules = list(modules.values())
    for m in modules:
        if m.get("module") == "zhuyin":
            return set(m.get("owns_code") or []) | set(m.get("owns_data") or [])
    return set()


def _is_owned(path: str, owned: set[str]) -> bool:
    """owns_code/owns_data 允許 glob —— 179 個逐課注音表不可能逐筆列。"""
    if path in owned:
        return True
    return any("*" in o and fnmatch.fnmatch(path, o) for o in owned)


def test_the_zhuyin_module_is_registered() -> None:
    """前提：registry 裡真的有 zhuyin module。

    少了這條，下面那條會把「一個都沒擁有」跟「module 不存在」混在一起 ——
    而 #3203 的病就是後者（`specs/registry.yaml` 全文 `zhuyin` 0 次）。
    """
    owned = _zhuyin_module_owns()
    assert owned, "registry.yaml 裡沒有 module: zhuyin —— 那正是 #3203 的病本身"
    assert len(owned) > 8, f"zhuyin module 只擁有 {len(owned)} 個檔，看起來沒登記完"


def test_the_pattern_actually_matches_something() -> None:
    """正向對照：那個 pattern 真的抓得到東西。

    `git ls-files` 失敗或 pattern 打錯時，下面那條會變成「零個未擁有」而全綠 ——
    看起來跟「全部都有主人」一模一樣。
    """
    hits = [f for f in _tracked_files() if _LOOKS_LIKE_ZHUYIN.search(f)]
    assert len(hits) > 15, f"pattern 只命中 {len(hits)} 個檔 —— 查法壞了，下面那條會空轉"


def test_every_zhuyin_file_has_an_owner() -> None:
    """看起來跟注音有關的檔，要嘛被 zhuyin module 擁有，要嘛列在 EXEMPT 並寫明理由。"""
    owned = _zhuyin_module_owns()
    orphans = [
        f
        for f in _tracked_files()
        if _LOOKS_LIKE_ZHUYIN.search(f)
        and not _NOT_PRODUCTION.search(f)
        and not _is_owned(f, owned)
        and f not in EXEMPT
    ]
    assert not orphans, (
        f"{len(orphans)} 個跟注音有關的檔沒有主人 —— 請加進 "
        f"specs/modules/zhuyin/INTENT.md 的 owns_code/owns_data（然後跑 "
        f"`python specs/build_registry.py`），或加進本檔 EXEMPT 並寫明為什麼它不決定讀音：\n  "
        + "\n  ".join(orphans)
    )


def test_exemptions_still_exist() -> None:
    """豁免清單不可以有死指標。

    檔案被刪或改名之後留在 EXEMPT 裡 = 一條永遠不會命中的豁免，
    而它會讓人以為那個檔還被考慮過。
    """
    tracked = set(_tracked_files())
    gone = sorted(f for f in EXEMPT if f not in tracked)
    assert not gone, "EXEMPT 裡這些檔已經不存在了，請移除：\n  " + "\n  ".join(gone)
