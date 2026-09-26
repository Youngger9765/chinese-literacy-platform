"""朗讀的及格速度線必須在**我們自己學生的中位數之下**（#3333）。

為什麼
------
原本是 150 字/分，而 prod `reading_history` 全文朗讀 47 筆的真實中位數是 **144**。
一條設在中位數之上的及格線，**按定義就是讓一半的孩子不及格** —— 這才是這張票的
缺陷，不是「沒有分年級」。

⛔ 分年級不是解法：`GRADE_CPM_DEFAULTS` 是 190~220，落在學生的 **p90**
   （≥190 只有 9/47 到得了）。接上去會讓通過數從 16 掉到 6，14 筆改判全部是
   「本來過、改完不過」。細節見 #3333 與 `personaConfig.ts` 的註解。

⚠️ 正確率那條線刻意不動：學生正確率中位數 98%，門檻 90 與 80 篩出同樣的 34 筆，
   動它是零效果的 churn。
"""
from __future__ import annotations

from app.schemas.assignment import DEFAULT_TARGET_ACCURACY, DEFAULT_TARGET_CPM

# prod `reading_history` where reading_type='full'（2026-09-26 實測，47 筆 / 19 人）
# ⚠️ 這幾個數字是**量出來的**，不是設計值。重新量過才可以改，並且要一併更新
#    `assignment.py` 的註解與 #3333。
OBSERVED = {"p10": 82, "p25": 101, "p50": 144, "p75": 176, "p90": 207, "n": 47}


def test_the_observed_numbers_are_self_consistent() -> None:
    """對照組：這組基準本身要單調，否則下面每一條都在跟壞數字比。"""
    seq = [OBSERVED[k] for k in ("p10", "p25", "p50", "p75", "p90")]
    assert seq == sorted(seq), seq
    assert OBSERVED["n"] > 20, "樣本太少，這組基準不該被當依據"


def test_the_pass_line_is_below_our_students_median() -> None:
    """核心：及格線不可以設在中位數之上。

    設在中位數之上 = 一半的孩子必然不及格，而這個產品服務的正是讀得慢的那群。
    """
    assert DEFAULT_TARGET_CPM < OBSERVED["p50"], (
        f"及格線 {DEFAULT_TARGET_CPM} ≥ 學生中位數 {OBSERVED['p50']} —— "
        "這條線按定義會讓一半的孩子不及格"
    )


def test_the_pass_line_is_not_so_low_that_everyone_passes() -> None:
    """反向：也不可以低到人人有獎，那樣老師派「這關要過」就沒有意義。

    p25 以下代表四分之三的紀錄都過得了 —— 那不是門檻是裝飾。
    """
    assert DEFAULT_TARGET_CPM > OBSERVED["p25"], (
        f"及格線 {DEFAULT_TARGET_CPM} ≤ p25 {OBSERVED['p25']} —— 幾乎人人都過，這條線沒有作用"
    )


def test_the_pass_line_is_not_the_grade_norm() -> None:
    """⛔ 釘住「不要改成分年級常模」這個結論。

    190~220 落在學生的 p90。有人把它搬過來，這條會紅並指向 #3333 的實測。
    """
    assert DEFAULT_TARGET_CPM < OBSERVED["p90"], (
        f"及格線 {DEFAULT_TARGET_CPM} 已經到學生的 p90（{OBSERVED['p90']}）—— "
        "那是分年級常模所在的位置，實測接上去通過數 16→6，14 筆全部是過→不過"
    )


def test_accuracy_line_is_untouched_because_it_is_not_the_binding_constraint() -> None:
    """正確率維持 90：實測它不是瓶頸（90 與 80 篩出同樣 34 筆）。

    這條在的作用是：有人順手把它一起動時，會被迫回來看 #3333 的實測。
    """
    assert DEFAULT_TARGET_ACCURACY == 90.0, (
        "正確率門檻動了。#3333 實測：學生正確率中位數 98%，設 90 或 80 是同樣的 "
        "34/47 —— 改它零效果。若有新資料支持，請一併更新 #3333 與 assignment.py 的註解"
    )


def test_the_constant_actually_reaches_the_student() -> None:
    """正向對照：這個常數要真的被 service 拿去組 `effective_cpm`。

    ⚠️ 我 2026-09-26 才剛因為改到沒有消費端的值白做一整輪（#3156 ④）。
    """
    from pathlib import Path

    repo = Path(__file__).resolve().parents[2]
    consumers = [
        p
        for p in (repo / "backend" / "app" / "services").glob("*.py")
        if "DEFAULT_TARGET_CPM" in p.read_text("utf-8")
    ]
    assert consumers, "沒有任何 service 讀這個常數 —— 改它到不了學生眼前"
    joined = "\n".join(p.read_text("utf-8") for p in consumers)
    assert "effective_cpm" in joined, "consumer 沒有把它組進 effective_cpm"
