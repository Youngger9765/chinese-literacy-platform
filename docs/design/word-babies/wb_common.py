"""
文字寶貝養成系統 — 共用的決定性雜湊工具。

兩支腳本（generate_config.py / simulate_balance.py）都 import 這份，確保用的是
同一套「決定性亂數」算法：同樣的 SEED ＋ 同樣的輸入 ＝ 永遠同樣的輸出。
⛔ 禁止在這整個系統的任何地方用 `random.random()` 或呼叫 LLM 決定內容
（呼應 PRD `docs/prd/2026-10-26-reading-island-3d-prd.md` §2 設計原則第 8 條）。

SEED 一旦定案上線後不可再改 —— 改了全部碎片/遭遇的分配都會重新洗牌。
"""

import hashlib

# 這個字串就是「固定 seed」本身。上線後鎖死，不可更動。
SEED = "word-baby-v1-2026-10-26"


def _digest(*parts: object) -> int:
    s = SEED + ":" + ":".join(str(p) for p in parts)
    return int(hashlib.sha256(s.encode("utf-8")).hexdigest(), 16)


def unit_interval(*parts: object) -> float:
    """回傳 [0, 1) 之間的決定性小數，同輸入同輸出。"""
    return (_digest(*parts) % 10_000_000) / 10_000_000


def pick_index(n: int, *parts: object) -> int:
    """從 0..n-1 決定性挑一個 index。"""
    if n <= 0:
        raise ValueError("n must be positive")
    return _digest(*parts) % n


def sort_key(*parts: object) -> int:
    """給「決定性洗牌」用的排序鍵——對一組候選值各自算一個 sort_key 再排序，
    等於一次決定性的洗牌，且不會因為 Python 版本或執行環境不同而變。"""
    return _digest(*parts)
