"""TDD：閱讀寶貝核心服務（#3780 第一階段）。

涵蓋 PRD §10 的 Given/When/Then 驗收條件：遇見/成長/冪等/三階進化/防沉迷。
"""
import datetime
import sys
import os
import uuid

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models import Base
from app.models.user import Role, User
from app.models.school import School, Classroom, ClassroomStudent  # noqa: F401
from app.models.reading_baby import StudentIndicatorEvidence
from app.services import reading_baby_config, reading_baby_service as svc


engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)


@event.listens_for(engine, "connect")
def _set_sqlite_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=OFF")  # 這支只測服務邏輯，不測 FK 完整性
    cursor.close()


TestingSessionLocal = sessionmaker(bind=engine)


@pytest.fixture(scope="module", autouse=True)
def _setup_db():
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture()
def db():
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.rollback()
        session.query(StudentIndicatorEvidence).delete()
        session.commit()
        session.close()


_ALL_LESSON_UIDS = reading_baby_config.all_lesson_uids()
_SAMPLE_LESSON_UID = _ALL_LESSON_UIDS[0]  # L0001 — grade 4, 5 assessable stations
_SAMPLE_LESSON_META = reading_baby_config.get_lesson_indicator(_SAMPLE_LESSON_UID)


class TestRecordStationEvidenceBasics:
    def test_unknown_lesson_returns_none(self, db):
        result = svc.record_station_evidence(
            db, student_id=1, lesson_uid="NOT-A-REAL-LESSON", station="spotlight"
        )
        assert result is None

    def test_unknown_station_for_a_real_lesson_returns_none(self, db):
        # "report" 是結算頁，不量指標 —— lesson_indicators.json 裡沒有這個站
        result = svc.record_station_evidence(
            db, student_id=1, lesson_uid=_SAMPLE_LESSON_UID, station="report"
        )
        assert result is None

    def test_completion_station_writes_a_row_with_quality_passed_false(self, db):
        result = svc.record_station_evidence(
            db, student_id=1, lesson_uid=_SAMPLE_LESSON_UID, station="lesson-intro"
        )
        assert result is not None
        assert result.quality_passed is False
        assert result.signal_type == "completion"

    def test_passing_first_try_accuracy_station_writes_passed_row(self, db):
        result = svc.record_station_evidence(
            db,
            student_id=2,
            lesson_uid=_SAMPLE_LESSON_UID,
            station="spotlight",
            step_payload={"firstTryResults": {"score": 5, "total": 5}},
        )
        assert result is not None
        assert result.quality_passed is True
        assert result.indicator_code == _SAMPLE_LESSON_META["stations"]["spotlight"]["indicator_code"]

    def test_mapping_version_is_stamped_on_the_row(self, db):
        result = svc.record_station_evidence(
            db, student_id=3, lesson_uid=_SAMPLE_LESSON_UID, station="lesson-intro"
        )
        assert result.mapping_version == reading_baby_config.get_mapping_version()


class TestIdempotency:
    """PRD §4 規則 3：同一站最多記一次，重做不會多拿。"""

    def test_once_passed_a_second_pass_does_not_create_a_new_row(self, db):
        student_id = 10
        payload = {"firstTryResults": {"score": 5, "total": 5}}
        first = svc.record_station_evidence(
            db, student_id=student_id, lesson_uid=_SAMPLE_LESSON_UID, station="spotlight", step_payload=payload
        )
        assert first is not None and first.quality_passed is True

        second = svc.record_station_evidence(
            db, student_id=student_id, lesson_uid=_SAMPLE_LESSON_UID, station="spotlight", step_payload=payload
        )
        assert second is None

        rows = (
            db.query(StudentIndicatorEvidence)
            .filter_by(student_id=student_id, lesson_uid=_SAMPLE_LESSON_UID, station="spotlight", quality_passed=True)
            .all()
        )
        assert len(rows) == 1

    def test_a_failed_attempt_can_still_be_followed_by_a_passing_attempt(self, db):
        """失敗不鎖站——沒通過之前，重做要能繼續被記錄、最後通過的那次才算數
        （PRD §2.3：允許重做累積到通過，只有『已經通過』之後才不再重記）。"""
        student_id = 11
        failing = {"firstTryResults": {"score": 1, "total": 5}}
        passing = {"firstTryResults": {"score": 5, "total": 5}}

        first = svc.record_station_evidence(
            db, student_id=student_id, lesson_uid=_SAMPLE_LESSON_UID, station="spotlight", step_payload=failing
        )
        assert first is not None and first.quality_passed is False

        second = svc.record_station_evidence(
            db, student_id=student_id, lesson_uid=_SAMPLE_LESSON_UID, station="spotlight", step_payload=passing
        )
        assert second is not None and second.quality_passed is True

        passed_rows = (
            db.query(StudentIndicatorEvidence)
            .filter_by(student_id=student_id, lesson_uid=_SAMPLE_LESSON_UID, station="spotlight", quality_passed=True)
            .count()
        )
        assert passed_rows == 1

    def test_completion_type_station_is_recorded_only_once_ever(self, db):
        """`lesson-intro`（以及重點表／做記號等 completion 型態站）永遠不會有
        `quality_passed=True`，如果冪等檢查只看『有沒有通過過』，這種站會在
        每一次 autosave（v1 時代就是每 5 秒一次）都再插入一筆——這裡鎖住
        『completion 型態只要存在過一筆，之後一律跳過』這個不變量。"""
        student_id = 15
        first = svc.record_station_evidence(
            db, student_id=student_id, lesson_uid=_SAMPLE_LESSON_UID, station="lesson-intro"
        )
        assert first is not None

        for _ in range(5):
            again = svc.record_station_evidence(
                db, student_id=student_id, lesson_uid=_SAMPLE_LESSON_UID, station="lesson-intro"
            )
            assert again is None

        count = (
            db.query(StudentIndicatorEvidence)
            .filter_by(student_id=student_id, lesson_uid=_SAMPLE_LESSON_UID, station="lesson-intro")
            .count()
        )
        assert count == 1

    def test_no_negative_feedback_on_failure(self, db):
        """PRD §2.3「沒有懲罰」：失敗的紀錄本身就是 quality_passed=False，
        沒有任何扣分欄位——這裡鎖住『寫入的列沒有負向分數』這個不變量。"""
        result = svc.record_station_evidence(
            db,
            student_id=12,
            lesson_uid=_SAMPLE_LESSON_UID,
            station="spotlight",
            step_payload={"firstTryResults": {"score": 0, "total": 5}},
        )
        assert result.quality_passed is False
        assert (result.quality_score or 0) >= 0


class TestWriteFailureDoesNotRaise:
    """monkeypatch `db.flush` 直接會連 `has_passed_evidence` 的查詢（SQLAlchemy
    autoflush 內部也呼叫 `session.flush()`）一起打到，所以這裡先把冪等檢查
    短路掉（已經在 TestIdempotency 另外鎖過），只隔離測『寫入本身失敗』這件事。
    """

    def test_persistent_write_failure_returns_none_and_logs_warning(self, db, monkeypatch, caplog):
        monkeypatch.setattr(svc, "has_passed_evidence", lambda *a, **k: False)
        monkeypatch.setattr(svc, "has_any_evidence", lambda *a, **k: False)

        def _boom(*args, **kwargs):
            raise RuntimeError("simulated DB failure")

        monkeypatch.setattr(db, "flush", _boom)
        with caplog.at_level("WARNING"):
            result = svc.record_station_evidence(
                db, student_id=99, lesson_uid=_SAMPLE_LESSON_UID, station="lesson-intro"
            )
        assert result is None
        assert any("reading-baby evidence write failed" in rec.message for rec in caplog.records)

    def test_transient_write_failure_recovers_on_retry(self, db, monkeypatch):
        monkeypatch.setattr(svc, "has_passed_evidence", lambda *a, **k: False)
        monkeypatch.setattr(svc, "has_any_evidence", lambda *a, **k: False)
        calls = {"n": 0}
        real_flush = db.flush

        def _flaky_flush(*args, **kwargs):
            calls["n"] += 1
            if calls["n"] == 1:
                raise RuntimeError("simulated transient failure")
            return real_flush(*args, **kwargs)

        monkeypatch.setattr(db, "flush", _flaky_flush)
        result = svc.record_station_evidence(
            db, student_id=98, lesson_uid=_SAMPLE_LESSON_UID, station="lesson-intro", max_attempts=2
        )
        assert result is not None
        # 確切呼叫次數是 SQLAlchemy session 內部機制的實作細節（begin_nested／
        # autoflush 可能各自再呼叫一次 flush），這裡只鎖「真的失敗過至少一次、
        # 而且最終還是成功」這個行為，不鎖死次數。
        assert calls["n"] >= 2


class TestLessonGrowthPureFunction:
    """`_build_lesson_growth` 不碰 DB，拿合成資料測三階進化規則。"""

    def test_not_visited_lesson_has_not_encountered_stage(self):
        growth = svc._build_lesson_growth(_SAMPLE_LESSON_UID, visited=False, passed_stations=frozenset())
        assert growth.stage == "not_encountered"

    def test_visited_with_zero_passed_is_basic(self):
        growth = svc._build_lesson_growth(_SAMPLE_LESSON_UID, visited=True, passed_stations=frozenset())
        assert growth.stage == "basic"

    def test_half_weighted_passed_is_intermediate(self):
        # L0001 assessable: key-passage-reading(1.0) vocab-definition(0.5)
        # vocab-application(0.5) spotlight(1.0) comprehension(1.0) → total weight 4.0
        # passing key-passage-reading + spotlight = 2.0/4.0 = 50% → intermediate
        growth = svc._build_lesson_growth(
            _SAMPLE_LESSON_UID,
            visited=True,
            passed_stations=frozenset({"key-passage-reading", "spotlight"}),
        )
        assert growth.stage == "intermediate"

    def test_all_assessable_passed_is_advanced(self):
        all_assessable = frozenset(_SAMPLE_LESSON_META["assessable_stations"])
        growth = svc._build_lesson_growth(_SAMPLE_LESSON_UID, visited=True, passed_stations=all_assessable)
        assert growth.stage == "advanced"
        assert growth.all_cleared is True
        assert growth.next_step is None

    def test_next_step_picks_first_unpassed_station_in_lesson_order(self):
        growth = svc._build_lesson_growth(_SAMPLE_LESSON_UID, visited=True, passed_stations=frozenset())
        assert growth.next_step.station == _SAMPLE_LESSON_META["assessable_stations"][0]

    def test_unknown_lesson_returns_none(self):
        assert svc._build_lesson_growth("NOT-REAL", visited=True, passed_stations=frozenset()) is None


class TestAllLessonsComputeAStage:
    """PRD §10 批次 2 驗收 5：『Given 179 課，Then 每課都算得出進化階段，
    不存在算不出來的課』—— 回歸鎖。"""

    @pytest.mark.parametrize("lesson_uid", _ALL_LESSON_UIDS)
    def test_every_lesson_computes_a_stage_without_blowing_up(self, lesson_uid):
        for passed_fraction in (0.0, 0.5, 1.0):
            meta = reading_baby_config.get_lesson_indicator(lesson_uid)
            assessable = meta["assessable_stations"]
            assert len(assessable) > 0, f"{lesson_uid} has zero assessable stations"
            n_pass = int(len(assessable) * passed_fraction)
            passed = frozenset(assessable[:n_pass])
            growth = svc._build_lesson_growth(lesson_uid, visited=True, passed_stations=passed)
            assert growth is not None
            assert growth.stage in {"not_encountered", "basic", "intermediate", "advanced"}


class TestMonotonicNonDecrease:
    """PRD §10 驗收 15：系統中不存在任何會讓已達成的成長或階段減少的路徑。"""

    @pytest.mark.parametrize("lesson_uid", _ALL_LESSON_UIDS[:30])
    def test_adding_more_passed_stations_never_decreases_progress_ratio(self, lesson_uid):
        meta = reading_baby_config.get_lesson_indicator(lesson_uid)
        assessable = meta["assessable_stations"]
        subset = frozenset(assessable[: len(assessable) // 2])
        superset = frozenset(assessable)
        g_subset = svc._build_lesson_growth(lesson_uid, visited=True, passed_stations=subset)
        g_superset = svc._build_lesson_growth(lesson_uid, visited=True, passed_stations=superset)
        assert g_superset.progress_ratio >= g_subset.progress_ratio
        assert g_superset.fragments_count >= g_subset.fragments_count

    def test_no_code_path_subtracts_from_an_existing_passed_row(self):
        """靜態不變量檢查：`record_station_evidence` 只 INSERT，從不 UPDATE／
        DELETE 既有列——這是『不會倒退』的結構性保證，不是靠跑時狀態湊出來的。"""
        import inspect

        source = inspect.getsource(svc.record_station_evidence)
        assert "db.delete(" not in source
        assert ".update(" not in source


class TestThirtyDaysNoLoginDoesNotChangeProgress:
    """PRD §10 驗收 14：30 天沒登入，寶貝外觀與進度不變。"""

    def test_aging_the_evidence_rows_does_not_change_computed_growth(self, db):
        student_id = 20
        svc.record_station_evidence(
            db,
            student_id=student_id,
            lesson_uid=_SAMPLE_LESSON_UID,
            station="spotlight",
            step_payload={"firstTryResults": {"score": 5, "total": 5}},
        )
        db.commit()

        growth_before = svc.compute_lesson_growth(db, student_id=student_id, lesson_uid=_SAMPLE_LESSON_UID)

        # 模擬「30 天沒有任何新學習行為」：把既有列的 created_at 往前推 40 天，
        # 不新增、不刪除任何一筆。
        old_time = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=40)
        db.query(StudentIndicatorEvidence).filter_by(student_id=student_id).update({"created_at": old_time})
        db.commit()

        growth_after = svc.compute_lesson_growth(db, student_id=student_id, lesson_uid=_SAMPLE_LESSON_UID)

        assert growth_after.stage == growth_before.stage
        assert growth_after.progress_ratio == growth_before.progress_ratio
        assert growth_after.fragments_count == growth_before.fragments_count


class TestAtlas:
    def test_atlas_covers_all_179_lessons(self, db):
        atlas = svc.compute_atlas(db, student_id=30)
        assert len(atlas) == 179
        assert {g.lesson_uid for g in atlas} == set(_ALL_LESSON_UIDS)

    def test_atlas_reflects_recorded_evidence_for_the_right_lesson_only(self, db):
        svc.record_station_evidence(
            db,
            student_id=31,
            lesson_uid=_SAMPLE_LESSON_UID,
            station="spotlight",
            step_payload={"firstTryResults": {"score": 5, "total": 5}},
        )
        db.commit()
        atlas = {g.lesson_uid: g for g in svc.compute_atlas(db, student_id=31)}
        assert atlas[_SAMPLE_LESSON_UID].stage != "not_encountered"
        other_uid = [u for u in _ALL_LESSON_UIDS if u != _SAMPLE_LESSON_UID][0]
        assert atlas[other_uid].stage == "not_encountered"


class TestTeacherHeatmapAndDrilldown:
    @pytest.fixture()
    def classroom_with_student(self, db):
        unique = uuid.uuid4().hex[:8]
        school = School(name=f"Test School {unique}")
        db.add(school)
        db.flush()
        teacher = User(email=f"teacher-{unique}@example.com", password_hash="x", name="T")
        other_teacher = User(email=f"other-teacher-{unique}@example.com", password_hash="x", name="OT")
        student = User(email=f"student-{unique}@example.com", password_hash="x", name="S")
        db.add_all([teacher, other_teacher, student])
        db.flush()
        classroom = Classroom(school_id=school.id, teacher_id=teacher.id, name="Class A")
        db.add(classroom)
        db.flush()
        db.add(ClassroomStudent(classroom_id=classroom.id, student_id=student.id))
        db.commit()
        return {
            "classroom_id": classroom.id,
            "teacher_id": teacher.id,
            "other_teacher_id": other_teacher.id,
            "student_id": student.id,
        }

    def test_teacher_owns_classroom_is_true_for_owner(self, db, classroom_with_student):
        assert svc.teacher_owns_classroom(
            db, classroom_id=classroom_with_student["classroom_id"], teacher_id=classroom_with_student["teacher_id"]
        )

    def test_teacher_owns_classroom_is_false_for_non_owner(self, db, classroom_with_student):
        assert not svc.teacher_owns_classroom(
            db,
            classroom_id=classroom_with_student["classroom_id"],
            teacher_id=classroom_with_student["other_teacher_id"],
        )

    def test_heatmap_shows_not_assigned_before_any_evidence(self, db, classroom_with_student):
        result = svc.compute_classroom_indicator_heatmap(db, classroom_id=classroom_with_student["classroom_id"])
        assert result.student_ids == [classroom_with_student["student_id"]]
        assert result.cells == []  # no evidence yet → no indicator columns at all

    def test_heatmap_shows_achieved_after_one_passed_lesson(self, db, classroom_with_student):
        student_id = classroom_with_student["student_id"]
        classroom_id = classroom_with_student["classroom_id"]
        svc.record_station_evidence(
            db,
            student_id=student_id,
            lesson_uid=_SAMPLE_LESSON_UID,
            station="spotlight",
            classroom_id=classroom_id,
            step_payload={"firstTryResults": {"score": 5, "total": 5}},
        )
        db.commit()
        result = svc.compute_classroom_indicator_heatmap(db, classroom_id=classroom_id)
        indicator_code = _SAMPLE_LESSON_META["stations"]["spotlight"]["indicator_code"]
        cell = next(c for c in result.cells if c.indicator_code == indicator_code and c.student_id == student_id)
        assert cell.status == "achieved"

    def test_heatmap_counts_self_study_evidence_without_classroom_id(self, db, classroom_with_student):
        """自學（classroom_id 為空）的證據也要算進班級熱力表，見
        `compute_classroom_indicator_heatmap` docstring。"""
        student_id = classroom_with_student["student_id"]
        classroom_id = classroom_with_student["classroom_id"]
        svc.record_station_evidence(
            db,
            student_id=student_id,
            lesson_uid=_SAMPLE_LESSON_UID,
            station="spotlight",
            classroom_id=None,
            step_payload={"firstTryResults": {"score": 5, "total": 5}},
        )
        db.commit()
        result = svc.compute_classroom_indicator_heatmap(db, classroom_id=classroom_id)
        assert len(result.cells) > 0

    def test_drilldown_lists_the_lessons_and_stations_behind_the_verdict(self, db, classroom_with_student):
        student_id = classroom_with_student["student_id"]
        svc.record_station_evidence(
            db,
            student_id=student_id,
            lesson_uid=_SAMPLE_LESSON_UID,
            station="spotlight",
            step_payload={"firstTryResults": {"score": 5, "total": 5}},
        )
        db.commit()
        indicator_code = _SAMPLE_LESSON_META["stations"]["spotlight"]["indicator_code"]
        detail = svc.get_indicator_evidence_detail(db, student_id=student_id, indicator_code=indicator_code)
        assert len(detail) == 1
        assert detail[0].lesson_uid == _SAMPLE_LESSON_UID
        assert detail[0].station == "spotlight"
        assert detail[0].quality_passed is True

    def test_insufficient_data_status_below_sample_threshold(self, db, classroom_with_student):
        student_id = classroom_with_student["student_id"]
        classroom_id = classroom_with_student["classroom_id"]
        # 題數 1 < min_items_total_for_sufficient_data(3)，且 1 題全對會直接算過
        # （<3 題全對規則）——改用「題數不足但沒過」的組合，確定落在
        # insufficient_data 而不是 achieved：用 2 題、1 題對（不是全對，不會
        # 觸發 <3 全對過關），但樣本數 2 < 3 門檻。
        svc.record_station_evidence(
            db,
            student_id=student_id,
            lesson_uid=_SAMPLE_LESSON_UID,
            station="vocab-definition",
            classroom_id=classroom_id,
            step_payload={"firstTryResults": {"score": 1, "total": 2}},
        )
        db.commit()
        result = svc.compute_classroom_indicator_heatmap(db, classroom_id=classroom_id)
        indicator_code = _SAMPLE_LESSON_META["stations"]["vocab-definition"]["indicator_code"]
        cell = next(c for c in result.cells if c.indicator_code == indicator_code and c.student_id == student_id)
        assert cell.status == "insufficient_data"
