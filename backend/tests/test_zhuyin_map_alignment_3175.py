"""#3175 —— 已退休（#3237）。這個檔留著當**退休紀錄**，不是還在跑的鎖。

## 它原本鎖什麼

`_build_zhuyin_map()` 曾經是一整套選擇器：pypinyin 挑音節、字型定聲調。
pypinyin 會把**連續的非中文**（數字、拉丁字母、連著的標點）塌成**一個**元素，
所以 `zip(target_text, bopomofo_list)` 從那一點開始整串位移：

    "民國2019年楊俊體育課"
        年 → ㄊㄧˇ（「體」的）· 楊 → ㄩˋ（「育」的）· 俊 → ㄎㄜˋ（「課」的）
        體育課 三個字完全沒有注音

服務端量到 **151 課有 135 課（89.4%）至少一段對不齊**，69.5% 的中文字落在位移點之後。
修法是「照長度消耗，不靠位置對齊」，這個檔就是那條鎖。

## 為什麼退休

#3237 把 `_build_zhuyin_map()` 從選擇器改成**純查表**（字型 single +
he_conjunction + 字型預設），pypinyin 整個移除。**那個 zip/長度消耗的機制不存在了** ——
現在是 `for i, ch in enumerate(u16_chars(text))`，一個字一格，沒有可以位移的東西。

## 意圖被誰接走

| 原本的意圖 | 接手的鎖 |
|---|---|
| 注音位置不可整串位移 | `test_served_text_all_in_table_3230.py` 的「槽位長度 == n == 課文 UTF-16 長度」＋ 產表 oracle（前端 `scripts/` 下那支跑出貨 processor 的 runner）的逐字身分守衛 |
| 中文字不可拿到非注音的 ruby | `test_fallback_is_lookup_not_selector_3237.py::test_沒有中文字就沒有注音` |
| 非 BMP 字之後不可位移 | `..._3237.py::test_位置用UTF16單位` |

## ⚠️ 這個檔裡不要寫「前端檔的完整路徑」

`test_cross_language_paths_are_in_the_ci_filter` 會掃**後端測試檔裡出現的前端路徑**，
要求它們都在 `pytest.yml` 的 paths-filter 裡（否則改那些前端檔的 PR 不會跑後端套件）。
所以在這裡寫 `frontend/...` 的完整路徑會弄紅那道門 —— 而改 workflow 需要
`workflow` scope 的 token。要提到前端檔就用文字描述，不要寫成路徑。

⭐ 同一個坑這系列踩了三次（workflow 註解、這裡 ×2）：
**這個 repo 的門會 regex 註解，註解裡的路徑是有負載的。**

## ⚠️ 這個檔為什麼不直接刪

`.github/workflows/pytest.yml` 的 `Run regression locks` 有一份**具名清單**列著這個路徑，
而改那個檔需要 `workflow` scope 的 token（本機的 gh token 沒有）。
刪檔會讓 CI 報 `file or directory not found` → exit 4。

⭐ 結果這樣更好：**退休的理由留在「有人會來找那支測試」的地方**，
而不是只留在某個 commit message 裡。
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
        f"接手 #3175 意圖的鎖不見了：{missing}\n"
        "要嘛把它們找回來，要嘛在這裡寫明新的接手者 —— 不要讓覆蓋無聲消失。"
    )


def test_the_old_selector_is_really_gone() -> None:
    """⛔ 負向對照：如果 pypinyin 哪天被加回去，這個退休就不再成立。"""
    src = (BACKEND / "app/routes/learning/learning_reading.py").read_text(encoding="utf-8")
    assert "lazy_pinyin" not in src, (
        "pypinyin 回到 learning_reading.py 了 —— 那 #3175 鎖的位移機制可能也回來了，"
        "請重新啟用這個檔的原始斷言（見 git history）"
    )
