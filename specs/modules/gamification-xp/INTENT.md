---
spec_id: gamification.xp.level_progression
module: gamification-xp
title: 遊戲化 XP — XP 獎勵、等級計算、streak 加成
stability: active
canonical_source: backend/app/models/gamification.py
owns_code:
  - backend/app/models/gamification.py
  - backend/app/services/gamification_service.py
owns_data: []
spec_tests:
  - backend/specs/test_gamification_xp_spec.py
related_issues: []
source_meetings:
  - docs/meetings/2026-05-01-experts-review.md
last_reviewed: 2026-06-02
owner: young
---

# Gamification XP — 等級計算與 XP 獎勵規格

> 給**人**讀的 spec。機器契約在 `backend/specs/test_gamification_xp_spec.py`。
> 改 `gamification.py` 的 `LEVEL_THRESHOLDS` / `XP_REWARDS` / `xp_to_level()` 前先讀這份。

## 1. 這個 module 在管什麼

`backend/app/models/gamification.py` 定義了：
- `XP_REWARDS`：各種學習行為的 XP 獎勵金額
- `LEVEL_THRESHOLDS`：從 Level 1 到 Level 10 的累積 XP 門檻
- `xp_to_level(total_xp)`：純函式，給定累積 XP 回傳 1-based 等級
- `level_progress(total_xp)`：給定累積 XP 回傳完整等級進度資訊

## 2. XP 獎勵表（`XP_REWARDS`）

| 事件 | XP |
|------|-----|
| `session_complete` | 20 |
| `accuracy_70` | 10 |
| `accuracy_90` | 20 |
| `comprehension_pass` | 10 |
| `streak_bonus` | 5（每天） |
| `first_story` | 30 |
| `vocab_practice` | 5 |
| `step_complete` | 3 |
| `strategy_exercise_complete` | 10 |
| `all_steps_complete` | 25 |
| `daily_first_login` | 3 |

## 3. 等級門檻（`LEVEL_THRESHOLDS`）

| Level | 所需累積 XP |
|-------|------------|
| 1（初學者）| 0 |
| 2（求知者）| 100 |
| 3（閱讀者）| 250 |
| 4（探索者）| 500 |
| 5（思考者）| 800 |
| 6（朗讀家）| 1200 |
| 7（文字匠）| 1700 |
| 8（智慧者）| 2300 |
| 9（文學人）| 3000 |
| 10（國文之星）| 4000 |

等級是**累積 XP** 決定的（不是本次 XP），所以等級永遠**單調不遞減**：
XP 增加 → 等級只可能維持或升高，絕不會降低。

## 4. 不可打破的行為（機器驗的）

1. **XP 非負**：`award_xp()` 只能加 XP，不能加負數（`xp_earned` 必須 ≥ 0）
2. **等級單調性**：`xp_to_level(x2) >= xp_to_level(x1)` when `x2 >= x1`
3. **Level 1 是起點**：`xp_to_level(0) == 1`
4. **Level 10 是天花板**：`xp_to_level(999999) == 10`（永遠不超過 10）
5. **門檻邊界**：`xp_to_level(LEVEL_THRESHOLDS[i]) == i + 1`（恰好達到門檻就升級）

## 5. `level_progress()` 回傳結構

```python
{
    "level": int,            # 1–10
    "level_name": str,       # 中文名稱
    "total_xp": int,         # 輸入值
    "current_level_xp": int, # 本等級已累積 XP（= total_xp - current_threshold）
    "next_level_xp": int | None,  # 下一等級門檻（Level 10 時為 None）
    "xp_to_next": int,       # 還差多少 XP 升級（Level 10 時為 0）
    "progress_pct": int,     # 本等級進度百分比 0–100
}
```

## 6. 允許 / 禁止的改動

✅ **允許**
- 調整單一 `XP_REWARDS` 數值（學生 dashboard 端不儲存個別獎勵金額，只儲存累積 XP）
- 改 `LEVEL_NAMES` 的中文名稱
- 加新 XP reward key（只加不減，不影響已有計算）

⛔ **禁止（會破壞契約）**
- 讓任何 `XP_REWARDS` 值變成負數
- 讓 `LEVEL_THRESHOLDS` 失去單調遞增性（Level 3 門檻 > Level 4 門檻）
- 讓 `xp_to_level()` 在 XP 相同時回傳不確定值

## 7. Open questions

- `xp_to_level()` 在 `total_xp < 0` 時會回傳 Level 1（因為 0 ≥ 0 的 threshold 判斷）。
  這個邊界行為沒有被明確文件化，但因為 XP 永遠非負，不應發生。
- 現在沒有「降級」機制；若未來想做，需要在此 spec 說明例外。
