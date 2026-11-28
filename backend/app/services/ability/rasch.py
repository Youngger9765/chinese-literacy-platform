"""能力估計（#4164）：Rasch 單參數模型。

- 題目難度：離線用「每題第一次作答」校準（calibrate_items）
- 學生能力：每次作答後做貝氏更新（update_ability），新生以年級起始值當先驗
- 等級：切成 8 級的「參考 PISA 閱讀分級的自家等級」，不是 PISA 分數，也沒做錨定；
  與 108 課綱的對照是推論

尺度說明：難度與能力都是 logit，0 代表答對機率五成。難度表以本批資料的平均為 0，
所以只在同一批校準內可比，換一批資料要重新校準。
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Iterable, Sequence

THETA_BOUND = 4.0

# 8 級的切點（logit）。名稱刻意不用 PISA 的級別名，避免被讀成官方分數
LEVEL_CUTS: tuple[float, ...] = (-2.0, -1.2, -0.5, 0.1, 0.7, 1.3, 2.0)
LEVEL_LABELS: tuple[str, ...] = (
    "第 1 級：認得字詞",
    "第 2 級：讀懂句子",
    "第 3 級：抓住段落重點",
    "第 4 級：整理文章大意",
    "第 5 級：連結前後文",
    "第 6 級：推論與比較",
    "第 7 級：評估與整合",
    "第 8 級：挑戰進階文本",
)


def _p(theta: float, b: float) -> float:
    return 1.0 / (1.0 + math.exp(-(theta - b)))


@dataclass(frozen=True)
class ItemCalibration:
    difficulty: float
    se: float
    n: int


@dataclass(frozen=True)
class AbilityEstimate:
    mean: float
    sd: float


def grade_prior(grade: int) -> AbilityEstimate:
    """新生還沒作答時的起始值：依年級給，標準差大代表很不確定。"""
    g = min(9, max(1, int(grade)))
    return AbilityEstimate(mean=(g - 4) * 0.35, sd=1.0)


def level_for(theta: float) -> int:
    """把能力值對到 1 到 8 級。"""
    return 1 + sum(1 for cut in LEVEL_CUTS if theta >= cut)


def update_ability(
    prior_mean: float, prior_sd: float, observations: Sequence[tuple[float, bool]]
) -> AbilityEstimate:
    """貝氏更新（高斯先驗，取後驗眾數）。observations 是 (題目難度, 是否答對)。"""
    if not observations:
        return AbilityEstimate(prior_mean, prior_sd)
    prior_prec = 1.0 / (prior_sd * prior_sd)
    theta = prior_mean
    for _ in range(50):
        grad = -(theta - prior_mean) * prior_prec
        info = prior_prec
        for b, correct in observations:
            p = _p(theta, b)
            grad += (1.0 if correct else 0.0) - p
            info += p * (1 - p)
        step = grad / info
        theta = max(-THETA_BOUND, min(THETA_BOUND, theta + step))
        if abs(step) < 1e-6:
            break
    info = prior_prec + sum(_p(theta, b) * (1 - _p(theta, b)) for b, _ in observations)
    return AbilityEstimate(mean=theta, sd=1.0 / math.sqrt(info))


def calibrate_items(
    responses: Iterable[tuple[str, str, bool]], *, min_n: int = 30, iterations: int = 30
) -> dict[str, ItemCalibration]:
    """離線校準：responses 是 (學生, 題目, 第一次是否答對)。

    聯合最大概似（JMLE）。每位學生題數少時難度估計會偏大（模擬：每人 10 題約大 11 到
    14%，每人 3 題約大 7 到 27%），教科書校正是乘 (L-1)/L（L 為每位學生平均題數）。
    本模組只在 L >= 8 時套用：模擬中 L=10 校正後斜率回到約 1.0，L=3 時因為全對全錯
    往內縮已抵掉一部分，再校正會低估。所以 L < 8 的資料，難度只能當順序參考，不能當
    絕對值。筆數低於 min_n 的題目不給難度；全對或全錯的題目用 0.5 的修正計數避免無限大。
    """
    by_item: dict[str, list[tuple[str, bool]]] = {}
    by_student: dict[str, list[tuple[str, bool]]] = {}
    for student, item, correct in responses:
        by_item.setdefault(item, []).append((student, bool(correct)))
        by_student.setdefault(student, []).append((item, bool(correct)))

    items = {i: rows for i, rows in by_item.items() if len(rows) >= min_n}
    if not items:
        return {}

    b = {i: 0.0 for i in items}
    theta = {s: 0.0 for s in by_student}
    for _ in range(iterations):
        for s, rows in by_student.items():
            used = [(i, c) for i, c in rows if i in b]
            if not used:
                continue
            score = sum(1.0 for _, c in used if c)
            score = min(max(score, 0.5), len(used) - 0.5)  # 全對全錯的學生往內縮
            t = theta[s]
            for _ in range(10):
                ps = [_p(t, b[i]) for i, _ in used]
                info = sum(p * (1 - p) for p in ps)
                step = (score - sum(ps)) / max(info, 1e-9)
                t = max(-THETA_BOUND, min(THETA_BOUND, t + max(-1.0, min(1.0, step))))
            theta[s] = t
        for i, rows in items.items():
            n = len(rows)
            score = min(max(sum(1.0 for _, c in rows if c), 0.5), n - 0.5)
            d = b[i]
            for _ in range(10):
                ps = [_p(theta[s], d) for s, _ in rows]
                info = sum(p * (1 - p) for p in ps)
                step = (sum(ps) - score) / max(info, 1e-9)
                d = max(-THETA_BOUND, min(THETA_BOUND, d + max(-1.0, min(1.0, step))))
            b[i] = d
        mean_b = sum(b.values()) / len(b)
        b = {i: v - mean_b for i, v in b.items()}

    avg_len = sum(len(r) for r in by_student.values()) / len(by_student)
    shrink = (avg_len - 1) / avg_len if avg_len >= 8 else 1.0
    out: dict[str, ItemCalibration] = {}
    for i, rows in items.items():
        d = b[i] * shrink
        info = sum(_p(theta[s], d) * (1 - _p(theta[s], d)) for s, _ in rows)
        out[i] = ItemCalibration(difficulty=d, se=1.0 / math.sqrt(max(info, 1e-9)), n=len(rows))
    return out


def precision_hint(lessons_done: int, sd: float) -> str:
    """給學生看的「準不準」提示。sd 夠小才說穩定，否則告訴他再做幾課會更準。"""
    if sd <= 0.35 and lessons_done >= 8:
        return "已相當穩定，可以放心當作你現在的閱讀等級"
    remaining = max(1, 8 - lessons_done)
    return f"還在估計中，再做 {remaining} 課會更準"
