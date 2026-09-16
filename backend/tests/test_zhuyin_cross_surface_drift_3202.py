"""#3202 跨畫面漂移棘輪 —— 已退休（#3237）。留著當**退休紀錄**，不是還在跑的鎖。

## 它原本鎖什麼

注音以前有兩個來源：前端的 `polyphonicProcessor.ts`（樣式表 + 變調 + 狀態機）
與後端的 `_build_zhuyin_map()`（pypinyin + 字型 + 規則）。兩邊對同一段課文會挑不同音 ——
全庫 **7,682 / 65,754 個破音字位置（11.7%）**不一致。

這個檔把「哪幾句兩個表面挑不同音」凍結成棘輪：多了紅、少了也紅。
它的價值是在只能修一半的年代，至少讓分歧不再長大。

## 為什麼退休

#3218 把答案固化成逐課表、#3230 把覆蓋率做到 100%、#3237 把兩套執行期選擇器都移除。
**現在只有一個來源** —— 「兩個表面挑不同音」這件事不再可能發生，
所以它凍結的那個量恆為 0，棘輪沒有東西可以守。

## 意圖被誰接走

| 原本的意圖 | 接手的鎖 |
|---|---|
| 前後端讀音不可分歧 | 結構上不可能（一個來源）。後端讀表由 `test_lesson_zhuyin_all_lessons_3218.py`（1,083 條）守；前端不選由 `frontend/src/context/__tests__/noRuntimeSelector3237.test.tsx` 守 |
| 服務端每段文字都要有答案 | `test_served_text_all_in_table_3230.py`（45,606 個字串、MISS 0） |
| fallback 不可以變成第二套引擎 | `test_fallback_is_lookup_not_selector_3237.py`（含「不准再 import pypinyin」的結構鎖） |

## ⚠️ 這個檔為什麼不直接刪

`.github/workflows/pytest.yml` 提到這個路徑，而 `test_every_backend_test_named_in_ci_exists`
是對**整份 YAML 做 regex**，連註解裡的路徑也算具名清單 —— 檔案不在就紅。
而改 workflow 需要 `workflow` scope 的 token（本機的 gh token 沒有）。

⭐ 結果這樣更好：退休的理由留在「有人會來找那支測試」的地方。
"""

from __future__ import annotations

from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]


def test_successor_locks_exist() -> None:
    """⭐ 退休不等於覆蓋消失 —— 接手的鎖必須真的在。

    ⛔ 這條不是裝飾：一個空的退休檔會讓「這裡曾經有鎖」變成純文字，
    而下一個人刪掉接手者時沒有任何東西會叫。
    """
    successors = [
        BACKEND / "tests/test_served_text_all_in_table_3230.py",
        BACKEND / "tests/test_fallback_is_lookup_not_selector_3237.py",
    ]
    missing = [str(p.relative_to(BACKEND)) for p in successors if not p.exists()]
    assert not missing, (
        f"接手 #3202 意圖的鎖不見了：{missing}\n"
        "要嘛把它們找回來，要嘛在這裡寫明新的接手者 —— 不要讓覆蓋無聲消失。"
    )


def test_the_old_selector_is_really_gone() -> None:
    """⛔ 負向對照：如果 pypinyin 哪天被加回去，這個退休就不再成立。"""
    src = (BACKEND / "app/routes/learning/learning_reading.py").read_text(encoding="utf-8")
    assert "lazy_pinyin" not in src, (
        "pypinyin 回到 learning_reading.py 了 —— 那就又有第二個讀音來源，"
        "#3202 鎖的『跨畫面漂移』會重新變成真的。請重新啟用這個檔的原始斷言（見 git history）"
    )
