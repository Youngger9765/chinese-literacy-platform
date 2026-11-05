"""閱讀寶貝 —— `quality_passed` 判定（#3780 第一階段）。

依據 docs/design/reading-babies/ability-indicators.md §3「每個站量哪一條、
用什麼訊號、門檻多少」，以及 2026-10-31 工頭補充：`first_try_accuracy` 的門檻
不用沒有依據的單一 60%，改成依年級分三段、照學習扶助科技化評量的通過標準
（答對率，exam.tcte.edu.tw，見 `app/data/reading_baby/quality_thresholds.json`）：

    四年級以下 80%｜五、六年級 72%｜七年級以上 60%

⚠️ 這是**借用**學習扶助的篩選門檻當單站判定標準，不是學習扶助官方標準本身的
延伸——都是推論，上線前要用本平台真實作答資料重新校準（quality_thresholds.json
`_meta.note`／`first_try_accuracy.note` 已註明）。

本模組只做兩件事：
  1. 判定一次作答夠不夠格記一筆「成長」（`determine_quality`）
  2. 查某個年級該用哪一段門檻（`first_try_accuracy_threshold_pct`）

不碰資料庫、不管冪等——那是 `reading_baby_service.py` 的事。遊戲端（本文件的
消費者）只讀 `quality_passed`/`quality_score`，不重新計算正確率，呼應
game-design.md §2.1「判定在教學端做，遊戲端只讀結果」。

**資料來源的誠實揭露**：各站 `step_data` 的實際欄位形狀，
ability-indicators.md §3 本身列為「推論沿用／待確認」——例如
`vocab-definition` 的 `mcAnswers[].firstTryCorrect` 是「讀程式碼推得，
還沒對資料庫實查一筆」。本模組因此用「盡力嘗試多種已知形狀，抓不到就不發
quality_passed=true（fail-closed，不是 fail-crash）」的寬容策略，而不是
假裝某一種形狀就是唯一真相。抓不到資料時回傳 `quality_passed=False` 且
`items_total=None`，不拋例外——呼叫端（`learning_step_progress.py` 的 hook）
不能因為這裡判斷不了就讓整個 API 500。
"""
from __future__ import annotations

from dataclasses import dataclass

from . import reading_baby_config


@dataclass(frozen=True)
class QualitySignal:
    """`AbilityIndicatorSignal`（game-design.md §2.1）裡跟「判定」有關的那幾個欄位。

    `ability_id`／`student_id`／`lesson_uid`／`station` 不在這裡——那些是呼叫端
    （`reading_baby_service.record_station_evidence`）已經知道的 context，不是
    這個模組要判斷的東西。
    """

    signal_type: str
    quality_passed: bool
    quality_score: float | None = None
    items_total: int | None = None
    items_first_try_correct: int | None = None
    items_correct_after_hint: int | None = None
    cpm: float | None = None
    accuracy: float | None = None


def first_try_accuracy_threshold_pct(effective_grade: int) -> tuple[float, str]:
    """回傳 (通過百分比, 這段的標籤)。年級分段見模組 docstring。"""
    bands = reading_baby_config.load_quality_thresholds()["first_try_accuracy"]["grade_bands"]
    for band in bands:
        min_grade = band.get("min_grade")
        max_grade = band.get("max_grade")
        if min_grade is not None and effective_grade < min_grade:
            continue
        if max_grade is not None and effective_grade > max_grade:
            continue
        return band["threshold_pct"], band["label"]
    # 三段（<=4／5-6／>=7）理論上覆蓋所有整數年級；真的落到這裡代表設定檔被
    # 改壞了（例如三段之間留了缺口）——要讓它響，不要悄悄當成「沒過」。
    raise ValueError(f"quality_thresholds.json 的 first_try_accuracy.grade_bands 沒有涵蓋年級 {effective_grade}")


def _as_number(value) -> float | int | None:
    if isinstance(value, bool):  # bool 是 int 的子類別，先排除避免 True 被當 1
        return None
    if isinstance(value, (int, float)):
        return value
    return None


def _extract_reading_fluency(step_payload: dict) -> tuple[float, float] | None:
    """抓 cpm／accuracy。已知形狀（比照 `_maybe_append_full_reading_attempt` 對
    'full-reading' 的做法）：`{"result": {"cpm": N, "accuracy": M}}` 或攤平的
    `{"cpm": N, "accuracy": M}`。"""
    if not isinstance(step_payload, dict):
        return None
    candidates = []
    result = step_payload.get("result")
    if isinstance(result, dict):
        candidates.append(result)
    candidates.append(step_payload)

    for candidate in candidates:
        cpm = _as_number(candidate.get("cpm"))
        accuracy = _as_number(candidate.get("accuracy"))
        if cpm is not None and accuracy is not None:
            return float(cpm), float(accuracy)
    return None


def _extract_first_try_counts(step_payload: dict) -> tuple[int, int] | None:
    """抓 (items_total, items_first_try_correct)。見模組 docstring 的形狀清單。"""
    if not isinstance(step_payload, dict):
        return None

    result = step_payload.get("result")
    layers = [step_payload]
    if isinstance(result, dict):
        layers.append(result)

    # 1) 通用欄位（給未來新站／測試直接帶，也是最不會猜錯的形狀）
    for layer in layers:
        total = _as_number(layer.get("items_total"))
        correct = _as_number(layer.get("items_first_try_correct"))
        if total is not None and correct is not None and total > 0:
            return int(total), int(correct)

    # 2) firstTryResults: {score, total}（vocab-application 等）
    for layer in layers:
        ftr = layer.get("firstTryResults")
        if isinstance(ftr, dict):
            total = _as_number(ftr.get("total"))
            correct = _as_number(ftr.get("score"))
            if total is not None and correct is not None and total > 0:
                return int(total), int(correct)

    # 3) mcAnswers[]/dragDropAnswers[] 陣列，各自帶 firstTryCorrect（vocab-definition）
    #    兩種可能同時出現在同一層（選擇題+拖拉題混合），合併計算。
    total = 0
    correct = 0
    found_any = False
    for layer in layers:
        for key in ("mcAnswers", "dragDropAnswers"):
            arr = layer.get(key)
            if isinstance(arr, list):
                for item in arr:
                    if isinstance(item, dict) and "firstTryCorrect" in item:
                        found_any = True
                        total += 1
                        if item.get("firstTryCorrect"):
                            correct += 1
    if found_any and total > 0:
        return total, correct

    return None


def _extract_correct_after_hint(step_payload: dict) -> int | None:
    """靠重做/救援對話才答對的題數（老師端「靠重做過關」提醒用，
    ability-indicators.md §5.5）。目前已知形狀都沒有實查過，best-effort：
    有通用欄位就讀，讀不到回 None（不影響 quality_passed 判定）。"""
    if not isinstance(step_payload, dict):
        return None
    for layer in (step_payload, step_payload.get("result") if isinstance(step_payload.get("result"), dict) else {}):
        if not isinstance(layer, dict):
            continue
        value = _as_number(layer.get("items_correct_after_hint"))
        if value is not None:
            return int(value)
    return None


def determine_quality(
    *,
    signal_type: str,
    effective_grade: int,
    step_payload: dict | None,
    teacher_target_cpm: float | None = None,
) -> QualitySignal:
    """單一站、單次送出的判定。永遠不拋例外——抓不到資料就回「沒過」。"""
    thresholds = reading_baby_config.load_quality_thresholds()

    if signal_type == "completion":
        return QualitySignal(signal_type=signal_type, quality_passed=False)

    if signal_type == "reading_fluency":
        extracted = _extract_reading_fluency(step_payload or {})
        rf_config = thresholds["reading_fluency"]
        cpm_min = teacher_target_cpm if teacher_target_cpm is not None else rf_config["cpm_min"]
        accuracy_min = rf_config["accuracy_min_pct"]
        if extracted is None:
            return QualitySignal(signal_type=signal_type, quality_passed=False)
        cpm, accuracy = extracted
        passed = cpm >= cpm_min and accuracy >= accuracy_min
        return QualitySignal(
            signal_type=signal_type,
            quality_passed=passed,
            quality_score=accuracy,
            cpm=cpm,
            accuracy=accuracy,
        )

    if signal_type == "first_try_accuracy":
        counts = _extract_first_try_counts(step_payload or {})
        if counts is None:
            return QualitySignal(signal_type=signal_type, quality_passed=False)
        total, correct = counts
        threshold_pct, _label = first_try_accuracy_threshold_pct(effective_grade)
        min_items = thresholds["first_try_accuracy"]["min_items_for_partial_pass"]
        if total < min_items:
            passed = total > 0 and correct == total
        else:
            passed = (correct / total) * 100 >= threshold_pct
        score = (correct / total) * 100 if total else 0.0
        return QualitySignal(
            signal_type=signal_type,
            quality_passed=passed,
            quality_score=score,
            items_total=total,
            items_first_try_correct=correct,
            items_correct_after_hint=_extract_correct_after_hint(step_payload or {}),
        )

    # 未知 signal_type（設定檔以外的值）—— fail closed，不記成長，也不拋例外。
    return QualitySignal(signal_type=signal_type, quality_passed=False)
