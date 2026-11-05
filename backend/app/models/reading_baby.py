"""閱讀寶貝能力指標證據表（#3780 第一階段）。

依據：
  - docs/design/reading-babies/game-design.md §7（遊戲機制視角，單一表草案）
  - docs/design/reading-babies/ability-indicators.md §7（教學/評量視角，欄位草案）
  - Young 2026-10-31 回覆「同意建」核准建此表

合併兩份草案成**唯一一張表**，取代文字寶貝 v1 的三張表（`StudentWordBabyState`／
`StudentFragmentWallet`／`StudentStationRewardLog`，整套刪除，見 game-design.md §5）。

這張表只增不改（append-only），同時扮演三個角色，不需要再分表：
  (1) 冪等帳本 —— 同一 (student_id, lesson_uid, station) 一旦出現
      `quality_passed=True` 的紀錄，之後就不再寫入新的一列
      （見 `app/services/reading_baby_service.record_station_evidence`）
  (2) 寶貝階段／碎片片數即時投影 —— 每課 `assessable_stations` 的加權通過比例、
      `COUNT(quality_passed=True)` 片數，全部由這張表即時 SELECT 算，不另存
      「目前第幾階」這種會跟真相對不上的快取欄位（game-design.md §7.4）
  (3) 老師端能力指標熱力表與鑽取（ability-indicators.md §5）—— 依
      `indicator_code`/`classroom_id` 分組聚合，`source_ref` 回指原始作答紀錄
"""
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Index, Integer, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base


class StudentIndicatorEvidence(Base):
    """某學生在某課某站的一次能力指標判定證據。"""

    __tablename__ = "student_indicator_evidence"
    __table_args__ = (
        Index(
            "ix_student_indicator_evidence_student_lesson_station",
            "student_id",
            "lesson_uid",
            "station",
        ),
        Index(
            "ix_student_indicator_evidence_student_indicator_created",
            "student_id",
            "indicator_code",
            "created_at",
        ),
        Index(
            "ix_student_indicator_evidence_classroom_indicator",
            "classroom_id",
            "indicator_code",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    student_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # 自學（無班級）時為空——FK 不設 CASCADE：班級被刪不代表這筆學習證據要
    # 消失（PRD §9「寫入失敗不能讓學生的成長悄悄消失」的同一精神延伸到刪除）。
    classroom_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("classrooms.id", ondelete="SET NULL"), nullable=True, index=True
    )
    session_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("learning_sessions.id", ondelete="SET NULL"), nullable=True, index=True
    )

    # 內容樹課程 id（如 "L0001"），跟 `app/data/reading_baby/lesson_indicators.json`
    # 的 key 同一格式，不是 `LearningSession.story_slug`（兩者是不同編號系統，
    # 呼叫端要先轉換，沿用 word_baby 時代的既有慣例）。
    lesson_uid: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    # 15 種站 id 之一（如 "spotlight"），剝除 "#slug" 後綴的 base id。
    station: Mapped[str] = mapped_column(String(50), nullable=False)
    # 課綱學習表現代碼，例 "5-Ⅲ-6"（不是能力家族字母——家族由 lesson_uid 查設定
    # 檔即得，老師端要能以學習表現為軸排熱力表欄位，見 ability_id_rule）。
    indicator_code: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    # first_try_accuracy／reading_fluency／completion（quality_thresholds.json
    # 定義的三種訊號型態之一）。
    signal_type: Mapped[str] = mapped_column(String(24), nullable=False)

    quality_passed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    quality_score: Mapped[float | None] = mapped_column(Float, nullable=True)

    items_total: Mapped[int | None] = mapped_column(Integer, nullable=True)
    items_first_try_correct: Mapped[int | None] = mapped_column(Integer, nullable=True)
    items_correct_after_hint: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cpm: Mapped[float | None] = mapped_column(Float, nullable=True)
    accuracy: Mapped[float | None] = mapped_column(Float, nullable=True)

    # 回指原始作答紀錄，例 {"mcq_attempt_ids": [...]}、{"reading_attempt_id": ...}，
    # 老師端畫面三（哪幾題撐起這個判斷）靠它鑽取。
    source_ref: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    # 寫入當下用哪一版 lesson_indicators.json（reading_baby_config.get_mapping_version()），
    # 門檻改版後舊判定的依據仍然查得到，不會悄悄變。
    mapping_version: Mapped[str] = mapped_column(String(32), nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )

    student: Mapped["User"] = relationship("User")  # type: ignore[name-defined]
