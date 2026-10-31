"""閱讀寶貝 —— 核心服務（#3780 第一階段）。

三組職責，呼應 docs/design/reading-babies/game-design.md 與 ability-indicators.md：

1. `record_station_evidence` —— 完成一個站時寫一筆 `StudentIndicatorEvidence`
   證據（取代 v1 的 `_award_word_baby_rewards`／`award_station_rewards`）。
   冪等分兩種（PRD §4 規則 3）：計分型態的站（first_try_accuracy／
   reading_fluency）`(student_id, lesson_uid, station)` 一旦出現
   `quality_passed=True` 就不再寫入新列；completion 型態的站（永遠不會
   `quality_passed=True`）一旦存在過任何一列就不再寫入新列（見
   `has_passed_evidence`／`has_any_evidence`）。寫入失敗重試，仍失敗記
   WARNING 並回傳 `None`——不得讓呼叫端（`save_step_progress`）500（PRD §9）。

2. `compute_lesson_growth` / `compute_atlas` —— 三階進化、碎片片數、下一步，
   全部從 `StudentIndicatorEvidence` 即時算（game-design.md §7.4：不另存
   「目前第幾階」這種會跟真相對不上的快取欄位）。**沒有任何時間相關的計算**
   ——這是刻意的設計不變量（game-design.md §6.2／§8 批次 5）：不看 created_at
   的新舊，只看「通過了沒」，所以 30 天沒登入也不會變。

3. `compute_classroom_indicator_heatmap` / `get_indicator_evidence_detail` ——
   老師端能力指標熱力表與逐課逐題鑽取（ability-indicators.md §5）。
"""
from __future__ import annotations

import logging
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Literal

from sqlalchemy.orm import Session

from . import reading_baby_config, reading_baby_quality
from ..models.reading_baby import StudentIndicatorEvidence
from ..models.school import Classroom, ClassroomStudent

logger = logging.getLogger(__name__)

Stage = Literal["not_encountered", "basic", "intermediate", "advanced"]

#: ability-indicators.md §3「老師端／學生端」都只讀這兩種訊號型態才算「可評量」
#: （completion 型態沒有對錯，不計入成長比例的分子分母，見 §3 表尾）。
_SCORED_SIGNAL_TYPES = {"first_try_accuracy", "reading_fluency"}


# ── 1. 寫入證據（取代 v1 的獎勵判定） ─────────────────────────────────────────

def has_passed_evidence(db: Session, *, student_id: int, lesson_uid: str, station: str) -> bool:
    """這一格 (student, lesson, station) 有沒有已經出現過 `quality_passed=True`
    的紀錄。用在計分型態的站（first_try_accuracy／reading_fluency）——允許
    通過之前重做多次（累積失敗紀錄給「連續 3 次建議」與「靠重做過關」用），
    一旦通過就不再重記（PRD §4 規則 3）。

    ⚠️ 這個函式本身就是 mutation 測試要打的「唯一鍵檢查」之一——拿掉這個
    early return，`record_station_evidence` 會在學生重做並再次通過同一站時，
    對同一格寫入第二筆 `quality_passed=True` 的紀錄。
    """
    return (
        db.query(StudentIndicatorEvidence.id)
        .filter_by(student_id=student_id, lesson_uid=lesson_uid, station=station, quality_passed=True)
        .first()
        is not None
    )


def has_any_evidence(db: Session, *, student_id: int, lesson_uid: str, station: str) -> bool:
    """這一格有沒有**任何**紀錄，不分通過與否。用在 completion 型態的站——
    那種站的 `quality_passed` 永遠是 False（沒有對錯可判），`has_passed_evidence`
    對它恆為 False，如果只靠那個檢查，completion 型態的站會在每一次 autosave
    （`lesson-intro` 設計上每次 step_progress 儲存都會嘗試一次，v1 時代的
    docstring 就提過「每 5 秒跳一次」的真實頻率）都再插入一筆，變成無上限
    成長的紀錄表，也違反 PRD §4 規則 3「同一站最多記一次」。completion 型態
    沒有「通過」這個狀態可以收斂，所以收斂條件換成「只要存在過一筆就夠」——
    那一筆就是「參與過」的完整證據，不需要重複的參與紀錄。
    """
    return (
        db.query(StudentIndicatorEvidence.id)
        .filter_by(student_id=student_id, lesson_uid=lesson_uid, station=station)
        .first()
        is not None
    )


def record_station_evidence(
    db: Session,
    *,
    student_id: int,
    lesson_uid: str,
    station: str,
    session_id: int | None = None,
    classroom_id: int | None = None,
    step_payload: dict | None = None,
    teacher_target_cpm: float | None = None,
    max_attempts: int = 2,
) -> StudentIndicatorEvidence | None:
    """完成一個站時呼叫一次。回傳新寫入的證據列；下列任一情況回傳 `None`
    （呼叫端 `learning_step_progress.py` 一律視為「這次沒有新東西要顯示」，
    絕不因為這裡回 None 或丟例外就讓整個 PUT 失敗）：

    - 這一課不在 179 課課綱對照裡（例如測試用的假 lesson）
    - 這個站這一課不量（不在 `lesson_indicators.json` 的 `stations` 裡，
      例如 `report`／`vocab-review`）
    - 這一格已經通過過了（冪等，見 `has_passed_evidence`）
    - 重試 `max_attempts` 次仍寫入失敗（記一次 WARNING）
    """
    lesson_meta = reading_baby_config.get_lesson_indicator(lesson_uid)
    if lesson_meta is None:
        return None

    station_meta = lesson_meta["stations"].get(station)
    if station_meta is None:
        return None

    if station_meta["signal_type"] == "completion":
        # completion 型態沒有「通過」這個狀態，冪等條件是「存在過一筆」。
        if has_any_evidence(db, student_id=student_id, lesson_uid=lesson_uid, station=station):
            return None
    elif has_passed_evidence(db, student_id=student_id, lesson_uid=lesson_uid, station=station):
        return None

    quality = reading_baby_quality.determine_quality(
        signal_type=station_meta["signal_type"],
        effective_grade=lesson_meta["effective_grade"],
        step_payload=step_payload,
        teacher_target_cpm=teacher_target_cpm,
    )

    source_ref = {"session_id": session_id}
    if isinstance(step_payload, dict) and step_payload:
        # best-effort：把送進來的原始作答資料一起存，老師端畫面三「哪幾題」
        # 鑽取時至少看得到當初判定依據的原始 payload（ability-indicators.md
        # §7.2 第 2 點：各站對錯格式不一，這裡誠實存「我們當時看到的東西」，
        # 不假裝有一組統一的題目 id 可以指）。
        source_ref["raw_step_data"] = step_payload

    mapping_version = reading_baby_config.get_mapping_version()

    last_exc: Exception | None = None
    for _attempt in range(max_attempts):
        row = StudentIndicatorEvidence(
            student_id=student_id,
            classroom_id=classroom_id,
            session_id=session_id,
            lesson_uid=lesson_uid,
            station=station,
            indicator_code=station_meta["indicator_code"],
            signal_type=quality.signal_type,
            quality_passed=quality.quality_passed,
            quality_score=quality.quality_score,
            items_total=quality.items_total,
            items_first_try_correct=quality.items_first_try_correct,
            items_correct_after_hint=quality.items_correct_after_hint,
            cpm=quality.cpm,
            accuracy=quality.accuracy,
            source_ref=source_ref,
            mapping_version=mapping_version,
        )
        try:
            with db.begin_nested():
                db.add(row)
                db.flush()
            return row
        except Exception as exc:  # noqa: BLE001 — 寫入失敗絕不能讓 API 500（PRD §9）
            last_exc = exc

    logger.warning(
        "reading-baby evidence write failed after %d attempt(s) "
        "(student_id=%s lesson_uid=%s station=%s): %s",
        max_attempts, student_id, lesson_uid, station, last_exc,
    )
    return None


# ── 2. 成長／進化（純函式核心 + DB 包裝） ────────────────────────────────────

@dataclass(frozen=True)
class NextStep:
    station: str
    station_label: str | None
    building: str | None
    indicator_code: str


@dataclass(frozen=True)
class LessonGrowth:
    lesson_uid: str
    title: str | None
    ability_family: str | None
    ability_family_name: str | None
    stage: Stage
    assessable_total: int
    assessable_passed: int
    progress_ratio: float
    fragments_count: int
    next_step: NextStep | None
    all_cleared: bool
    passed_stations: frozenset[str] = field(default_factory=frozenset)


def _station_label(station: str) -> str | None:
    # 目前沒有獨立的站中文名稱表——建築名稱（station_buildings.json）本身
    # 就是給學生看的顯示名稱（game-design.md §4.2 寶貝卡格式），這裡直接
    # 回傳建築名給前端用，不另建一份重複的「站名稱」對照。
    return reading_baby_config.get_station_building(station)


def _build_lesson_growth(
    lesson_uid: str, *, visited: bool, passed_stations: frozenset[str]
) -> LessonGrowth | None:
    """純函式核心：不碰 DB，只吃「這課有沒有被造訪過」＋「通過了哪些站」，
    回傳這一課的完整成長狀態。拆成純函式是為了讓 179 課回歸鎖（PRD 要求
    「全部 179 課都算得出階段」）可以用合成資料快速跑，不必每個案例都真的
    打 DB。"""
    lesson_meta = reading_baby_config.get_lesson_indicator(lesson_uid)
    if lesson_meta is None:
        return None

    assessable_stations: list[str] = lesson_meta["assessable_stations"]
    assessable_total = len(assessable_stations)
    assessable_passed_list = [s for s in assessable_stations if s in passed_stations]
    assessable_passed = len(assessable_passed_list)

    weight_total = sum(reading_baby_config.get_station_weight(s) for s in assessable_stations)
    weight_passed = sum(reading_baby_config.get_station_weight(s) for s in assessable_passed_list)
    ratio = (weight_passed / weight_total) if weight_total > 0 else 0.0

    thresholds = reading_baby_config.get_evolution_thresholds()
    if not visited:
        stage: Stage = "not_encountered"
    elif ratio >= thresholds["advanced_ratio"]:
        stage = "advanced"
    elif ratio >= thresholds["intermediate_ratio"]:
        stage = "intermediate"
    else:
        stage = "basic"

    all_cleared = assessable_total > 0 and assessable_passed == assessable_total

    next_step: NextStep | None = None
    if not all_cleared:
        for station in assessable_stations:
            if station not in passed_stations:
                indicator_code = lesson_meta["stations"][station]["indicator_code"]
                next_step = NextStep(
                    station=station,
                    station_label=_station_label(station),
                    building=reading_baby_config.get_station_building(station),
                    indicator_code=indicator_code,
                )
                break

    return LessonGrowth(
        lesson_uid=lesson_uid,
        title=lesson_meta.get("title"),
        ability_family=lesson_meta.get("ability_family"),
        ability_family_name=lesson_meta.get("ability_family_name"),
        stage=stage,
        assessable_total=assessable_total,
        assessable_passed=assessable_passed,
        progress_ratio=ratio,
        fragments_count=assessable_passed,
        next_step=next_step,
        all_cleared=all_cleared,
        passed_stations=frozenset(passed_stations),
    )


def _fetch_passed_and_visited(
    db: Session, *, student_id: int, lesson_uid: str | None = None
) -> tuple[set[str], dict[str, set[str]]]:
    """單次查詢撈出這個學生的全部證據，回傳 (有造訪的 lesson_uid 集合,
    {lesson_uid: 已通過的 station 集合})。`lesson_uid=None` 代表撈全部課
    （圖鑑頁用，避免 179 課各自查一次 DB 的 N+1）。"""
    query = db.query(StudentIndicatorEvidence).filter(
        StudentIndicatorEvidence.student_id == student_id
    )
    if lesson_uid is not None:
        query = query.filter(StudentIndicatorEvidence.lesson_uid == lesson_uid)

    visited: set[str] = set()
    passed_by_lesson: dict[str, set[str]] = defaultdict(set)
    for row in query.all():
        visited.add(row.lesson_uid)
        if row.quality_passed:
            passed_by_lesson[row.lesson_uid].add(row.station)
    return visited, passed_by_lesson


def compute_lesson_growth(db: Session, *, student_id: int, lesson_uid: str) -> LessonGrowth | None:
    """單課寶貝卡用（DB 包裝）。"""
    visited, passed_by_lesson = _fetch_passed_and_visited(db, student_id=student_id, lesson_uid=lesson_uid)
    return _build_lesson_growth(
        lesson_uid,
        visited=lesson_uid in visited,
        passed_stations=frozenset(passed_by_lesson.get(lesson_uid, set())),
    )


def compute_atlas(db: Session, *, student_id: int) -> list[LessonGrowth]:
    """179 課圖鑑用（DB 包裝，一次查詢）。"""
    visited, passed_by_lesson = _fetch_passed_and_visited(db, student_id=student_id)
    results: list[LessonGrowth] = []
    for lesson_uid in reading_baby_config.all_lesson_uids():
        growth = _build_lesson_growth(
            lesson_uid,
            visited=lesson_uid in visited,
            passed_stations=frozenset(passed_by_lesson.get(lesson_uid, set())),
        )
        if growth is not None:
            results.append(growth)
    return results


# ── 3. 老師端：能力指標熱力表與鑽取 ────────────────────────────────────────

@dataclass(frozen=True)
class IndicatorCell:
    student_id: int
    indicator_code: str
    status: Literal["not_assigned", "insufficient_data", "only_participated", "not_achieved", "achieved", "transferable"]
    passed_lesson_count: int
    total_items: int


@dataclass(frozen=True)
class HeatmapResult:
    classroom_id: int
    indicator_codes: list[str]
    student_ids: list[int]
    cells: list[IndicatorCell]


def _indicator_cell_status(rows: list[StudentIndicatorEvidence]) -> tuple[str, int, int]:
    """單一 (student, indicator_code) 的狀態判定。

    操作化選擇（ability-indicators.md §5.2 與 §4 第 2 點對「帶得走」給了
    兩種不同定義，一個是「同一指標≥2課」、一個是「同一家族另一課」——這裡
    選前者，因為熱力表的欄本來就是 indicator_code，跟欄位語意一致；此為
    工頭的操作化決定，不是另一位專家的原意，見 quality_thresholds.json
    `teacher_aggregate.transferable_note`）：

    - 完全沒有證據列 → not_assigned（沒指派過）
    - 有證據列但全部是 completion 型態（沒有對錯可判）→ only_participated
    - 有計分型態的證據列，但累積題數 < 門檻 → insufficient_data（資料不足）
    - 累積題數足夠：
        - ≥2 課 quality_passed=True → transferable（帶得走）
        - ≥1 課 quality_passed=True → achieved（達成）
        - 否則 → not_achieved（未達）
    """
    if not rows:
        return "not_assigned", 0, 0

    scored_rows = [r for r in rows if r.signal_type in _SCORED_SIGNAL_TYPES]
    if not scored_rows:
        return "only_participated", 0, 0

    # reading_fluency 沒有「題數」概念——每次嘗試算 1 個樣本點，跟
    # first_try_accuracy 的 items_total 一起累加成「累積首答題數」的門檻判斷
    # （ability-indicators.md §3「老師端的樣本下限」原文只針對選擇題寫，
    # 這裡把朗讀也併入同一把尺，避免朗讀類指標永遠卡在資料不足）。
    total_items = sum(r.items_total if r.items_total is not None else 1 for r in scored_rows)

    min_items = reading_baby_config.load_quality_thresholds()["teacher_aggregate"][
        "min_items_total_for_sufficient_data"
    ]
    if total_items < min_items:
        return "insufficient_data", 0, total_items

    passed_lessons = {r.lesson_uid for r in scored_rows if r.quality_passed}
    min_transferable = reading_baby_config.load_quality_thresholds()["teacher_aggregate"][
        "min_lessons_passed_for_transferable"
    ]
    if len(passed_lessons) >= min_transferable:
        return "transferable", len(passed_lessons), total_items
    if len(passed_lessons) >= 1:
        return "achieved", len(passed_lessons), total_items
    return "not_achieved", len(passed_lessons), total_items


def compute_classroom_indicator_heatmap(db: Session, *, classroom_id: int) -> HeatmapResult:
    """ability-indicators.md §5.2 畫面一：班級 × 能力指標熱力表。

    範圍選擇：用「這個班級目前的學生名冊」決定要看哪些學生，查詢**不**限定
    `StudentIndicatorEvidence.classroom_id == classroom_id`——自學（classroom_id
    為空）的證據也要算進這個學生的能力累積，不然換過班或自主練習的學習會
    在熱力表上憑空消失。`classroom_id` 欄位本身只用於 row 層級的歷史追溯，
    不是這裡篩選的依據。
    """
    student_ids = [
        row.student_id
        for row in db.query(ClassroomStudent.student_id).filter_by(classroom_id=classroom_id).all()
    ]
    if not student_ids:
        return HeatmapResult(classroom_id=classroom_id, indicator_codes=[], student_ids=[], cells=[])

    rows = (
        db.query(StudentIndicatorEvidence)
        .filter(StudentIndicatorEvidence.student_id.in_(student_ids))
        .all()
    )

    grouped: dict[tuple[int, str], list[StudentIndicatorEvidence]] = defaultdict(list)
    indicator_codes: set[str] = set()
    for row in rows:
        grouped[(row.student_id, row.indicator_code)].append(row)
        indicator_codes.add(row.indicator_code)

    cells: list[IndicatorCell] = []
    for student_id in student_ids:
        for indicator_code in sorted(indicator_codes):
            status, passed_count, total_items = _indicator_cell_status(
                grouped.get((student_id, indicator_code), [])
            )
            cells.append(
                IndicatorCell(
                    student_id=student_id,
                    indicator_code=indicator_code,
                    status=status,
                    passed_lesson_count=passed_count,
                    total_items=total_items,
                )
            )

    return HeatmapResult(
        classroom_id=classroom_id,
        indicator_codes=sorted(indicator_codes),
        student_ids=student_ids,
        cells=cells,
    )


@dataclass(frozen=True)
class EvidenceDetailItem:
    lesson_uid: str
    lesson_title: str | None
    station: str
    quality_passed: bool
    quality_score: float | None
    items_total: int | None
    items_first_try_correct: int | None
    cpm: float | None
    accuracy: float | None
    source_ref: dict | None
    created_at: str


def get_indicator_evidence_detail(
    db: Session, *, student_id: int, indicator_code: str
) -> list[EvidenceDetailItem]:
    """ability-indicators.md §5.4 畫面三：這個判斷是哪幾課、哪幾題撐起來的。"""
    rows = (
        db.query(StudentIndicatorEvidence)
        .filter_by(student_id=student_id, indicator_code=indicator_code)
        .order_by(StudentIndicatorEvidence.created_at)
        .all()
    )
    items: list[EvidenceDetailItem] = []
    for row in rows:
        lesson_meta = reading_baby_config.get_lesson_indicator(row.lesson_uid)
        items.append(
            EvidenceDetailItem(
                lesson_uid=row.lesson_uid,
                lesson_title=lesson_meta.get("title") if lesson_meta else None,
                station=row.station,
                quality_passed=row.quality_passed,
                quality_score=row.quality_score,
                items_total=row.items_total,
                items_first_try_correct=row.items_first_try_correct,
                cpm=row.cpm,
                accuracy=row.accuracy,
                source_ref=row.source_ref,
                created_at=row.created_at.isoformat() if row.created_at else "",
            )
        )
    return items


def student_is_in_classroom(db: Session, *, classroom_id: int, student_id: int) -> bool:
    return (
        db.query(ClassroomStudent.id)
        .filter_by(classroom_id=classroom_id, student_id=student_id)
        .first()
        is not None
    )


def teacher_owns_classroom(db: Session, *, classroom_id: int, teacher_id: int) -> bool:
    """⚠️ 這是 mutation 測試要打的「權限檢查」②——把這裡改成永遠回傳 True，
    `teacher_reading_baby.py` 的 403 測試必須變紅（見
    `tests/test_reading_baby_routes.py` 的權限測試＋mutation 驗證紀錄）。"""
    return (
        db.query(Classroom.id)
        .filter_by(id=classroom_id, teacher_id=teacher_id)
        .first()
        is not None
    )
