"""迷城密室的獨立持久狀態

本模組不依賴 pk、league 或 live_quiz 的資料表，只會單向讀取
live_quiz 的出題 adapter 與 escape_room StoryPack adapter 的內容。這讓
任一既有模式移除時，不會改變迷城密室已開始局次的 frozen snapshot。
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class EscapeRoomRun(Base):
    __tablename__ = "escape_room_runs"
    __table_args__ = (
        Index("ix_escape_room_runs_student_id", "student_id"),
        CheckConstraint("scope_type IN ('lesson','grade_pool')", name="ck_escape_room_scope_type"),
        CheckConstraint(
            "result IN ('in_progress','escaped','not_this_time','abandoned')",
            name="ck_escape_room_result",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    scope_type: Mapped[str] = mapped_column(String(20), nullable=False)
    scope_ref: Mapped[str] = mapped_column(String(50), nullable=False)
    story_pack_key: Mapped[str | None] = mapped_column(String(48), nullable=True)
    # MVP has one chapter. A stable default keeps the unlock query extensible
    # without claiming that StoryPack already has a chapter schema.
    chapter_key: Mapped[str | None] = mapped_column(String(48), nullable=True, server_default="default")
    chambers_snapshot: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    gate_snapshot: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    mist_distance: Mapped[int] = mapped_column(Integer, nullable=False, server_default="50")
    teammates_state: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    abilities_used: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    result: Mapped[str] = mapped_column(String(20), nullable=False, server_default="in_progress")
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
