"""
文字寶貝養成系統 — 共用的決定性雜湊工具。

兩支腳本（generate_config.py / simulate_balance.py）都 import 這份，確保用的是
同一套「決定性亂數」算法：同樣的 SEED ＋ 同樣的輸入 ＝ 永遠同樣的輸出。

🔒 **這份工具只給「設計草案內容生成」與「平衡模擬」用，範圍不包含正式後端的獎勵判定**
（2026-10-26 security review）：repo 是 PUBLIC，SEED 是寫死的字串，正式後端如果沿用
這套雜湊去決定「某學生某站有沒有掉碎片／遇到寶貝」，任何讀得到原始碼的人都能離線算出
結果——稀有度與驚喜感形同虛設。正式後端的獎勵判定必須用 `secrets`（CSPRNG）在伺服器端
當場擲骰，見 `design.md` §15／`backend/app/services/word_baby_service.py` 的實作。
這份雜湊可以放心用在**不隨學生而變、公開也沒差**的內容生成：100 隻的名字/稀有度/飲食/
進化階段設定、`simulate_balance.py` 的平衡試算（只是離線調參數的工具，不影響任何真學生）。

⛔ 禁止在「內容生成」與「模擬」這兩個用途之外，用 `random.random()` 或呼叫 LLM 決定內容
（呼應 PRD `docs/prd/2026-10-26-reading-island-3d-prd.md` §2 設計原則第 8 條）。

SEED 一旦定案上線後不可再改 —— 改了全部碎片/遭遇的分配都會重新洗牌（僅影響這份設計草案
產生的內容設定，不影響正式後端——正式後端已經不讀這個 SEED）。
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
