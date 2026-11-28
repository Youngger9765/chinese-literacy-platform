"""能力估計（#4164）：題目難度校準、貝氏能力更新、年級起始值、8 級對照、準不準提示。"""

import math
import random

from app.services.ability.rasch import (
    LEVEL_LABELS,
    calibrate_items,
    grade_prior,
    level_for,
    precision_hint,
    update_ability,
)


def _simulate(n_students=300, true_b=None, seed=7):
    """用已知難度造答題資料，回頭驗證校準找得回來。"""
    rnd = random.Random(seed)
    true_b = true_b or {"easy": -1.0, "mid": 0.0, "hard": 1.2}
    rows = []
    for s in range(n_students):
        theta = rnd.gauss(0, 1)
        for item, b in true_b.items():
            p = 1 / (1 + math.exp(-(theta - b)))
            rows.append((f"s{s}", item, rnd.random() < p))
    return rows, true_b


def _simulate_long(n_students=400, n_items=10, seed=3):
    rnd = random.Random(seed)
    true_b = {f"q{k}": -1.5 + k * 3 / (n_items - 1) for k in range(n_items)}
    rows = []
    for s in range(n_students):
        theta = rnd.gauss(0, 1)
        for item, b in true_b.items():
            rows.append((f"s{s}", item, rnd.random() < 1 / (1 + math.exp(-(theta - b)))))
    return rows, true_b


def test_每人十題時校準的尺度接近真值():
    rows, true_b = _simulate_long()
    cal = calibrate_items(rows, min_n=30)
    mean_b = sum(true_b.values()) / len(true_b)
    xs = [b - mean_b for b in true_b.values()]
    ys = [cal[i].difficulty for i in true_b]
    slope = sum(x * y for x, y in zip(xs, ys)) / sum(x * x for x in xs)
    assert 0.92 < slope < 1.08, slope  # 沒校正時約 1.11 到 1.14
    assert max(abs(x - y) for x, y in zip(xs, ys)) < 0.45


def test_校準產出每題難度與標準誤_且順序對():
    rows, true_b = _simulate()
    cal = calibrate_items(rows, min_n=30)
    assert set(cal) == {"easy", "mid", "hard"}
    for item in cal.values():
        assert item.n == 300
        assert 0 < item.se < 0.5
    assert cal["easy"].difficulty < cal["mid"].difficulty < cal["hard"].difficulty
    # 回頭找得到真值（容許估計誤差）
    for name, b in true_b.items():
        assert abs(cal[name].difficulty - b) < 0.45, (name, cal[name].difficulty)


def test_筆數不足的題目不給難度():
    rows = [("a", "q1", True), ("b", "q1", False)]
    assert calibrate_items(rows, min_n=30) == {}


def test_全對全錯的題目也不會算出無限大():
    rows = [(f"s{i}", "allright", True) for i in range(40)]
    rows += [(f"s{i}", "mixed", i % 2 == 0) for i in range(40)]
    cal = calibrate_items(rows, min_n=30)
    assert math.isfinite(cal["allright"].difficulty)
    assert cal["allright"].difficulty < cal["mixed"].difficulty


def test_新生依年級給起始等級():
    g3, g6 = grade_prior(3), grade_prior(6)
    assert g6.mean > g3.mean
    assert level_for(g6.mean) >= level_for(g3.mean)
    assert 1 <= level_for(g3.mean) <= 8


def test_答對難題比答對簡單題能力上升更多():
    prior = grade_prior(4)
    easy = update_ability(prior.mean, prior.sd, [(-1.5, True)])
    hard = update_ability(prior.mean, prior.sd, [(1.5, True)])
    assert hard.mean - easy.mean > 0.1
    assert easy.mean > prior.mean


def test_答錯簡單題比答錯難題下降更多():
    prior = grade_prior(4)
    miss_easy = update_ability(prior.mean, prior.sd, [(-1.5, False)])
    miss_hard = update_ability(prior.mean, prior.sd, [(1.5, False)])
    assert miss_hard.mean - miss_easy.mean > 0.1
    assert miss_hard.mean < prior.mean


def test_做得越多越準_標準差變小():
    prior = grade_prior(4)
    few = update_ability(prior.mean, prior.sd, [(0.0, True)])
    many = update_ability(prior.mean, prior.sd, [(0.0, True), (0.5, False), (-0.5, True)] * 4)
    assert many.sd < few.sd - 0.1
    assert few.sd < prior.sd


def test_沒有作答資料時回傳先驗():
    prior = grade_prior(5)
    out = update_ability(prior.mean, prior.sd, [])
    assert (out.mean, out.sd) == (prior.mean, prior.sd)


def test_等級是八級且單調():
    assert len(LEVEL_LABELS) == 8
    levels = [level_for(t / 2) for t in range(-8, 9)]
    assert levels == sorted(levels)
    assert min(levels) == 1 and max(levels) == 8


def test_準不準提示_做完三課看得到等級與提示():
    assert "再做" in precision_hint(lessons_done=0, sd=1.0)
    hint3 = precision_hint(lessons_done=3, sd=0.7)
    assert "再做" in hint3 and "會更準" in hint3
    assert "已相當穩定" in precision_hint(lessons_done=12, sd=0.3)
