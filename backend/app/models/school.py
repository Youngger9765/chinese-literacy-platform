from datetime import datetime
from typing import Literal

from sqlalchemy import (
    String,
    Integer,
    Boolean,
    JSON,
    DateTime,
    ForeignKey,
    UniqueConstraint,
    Index,
    text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .base import Base

# Valid roles for ClassroomTeacher junction table.
# "assistant" is the legacy value (pre-#3820); existing rows are backfilled to
# "editor" by migration co01te02viewer03. Keep accepting it nowhere in new code.
ClassroomTeacherRole = Literal["primary", "editor", "viewer"]

# Invitation lifecycle for a co-teaching relationship. There is no persisted
# "rejected" state — rejecting an invite is the invitee DELETE-ing their own
# still-pending row (same action as leaving), mirroring 均一's "reject = remove
# self from the pending list" pattern (#3820 PRD §3).
ClassroomTeacherStatus = Literal["pending", "accepted"]


class School(Base):
    __tablename__ = "schools"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    domain: Mapped[str | None] = mapped_column(String(255), nullable=True, unique=True, index=True)
    organization_id: Mapped[str | None] = mapped_column(
        ForeignKey("organizations.id"), nullable=True, index=True
    )
    display_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    address: Mapped[str | None] = mapped_column(String(500), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(20), nullable=True)
    admin_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id"), nullable=True, index=True
    )
    join_code: Mapped[str | None] = mapped_column(String(20), unique=True, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    # MOE school directory import (#3804 §4.2). All nullable — pre-existing
    # domain-auto-created / manually-created schools keep moe_school_code=NULL
    # forever unless someone explicitly maps them later (out of scope this
    # round, see PRD §4.2 "Young 的問題 2 答覆"). NULL != NULL under the
    # unique index, so many legacy rows can coexist with it.
    moe_school_code: Mapped[str | None] = mapped_column(
        String(20), unique=True, nullable=True, index=True
    )
    # Raw bracketed code from the source "縣市名稱" column, kept for
    # provenance only — NOT a stable county key (臺北市 alone spans
    # [31]-[42], 高雄市 spans [51]-[61]; see backend/data/moe_schools/README.md).
    # Directory search filters on county_name text, not this field.
    county_code: Mapped[str | None] = mapped_column(String(10), nullable=True)
    county_name: Mapped[str | None] = mapped_column(String(50), nullable=True, index=True)
    # "elementary" | "junior_high" | "senior_high" — tagged from which MOE
    # source file the row came from, not guessed from the name (a name like
    # "○○國中(小)" would be ambiguous to parse).
    school_level: Mapped[str | None] = mapped_column(String(20), nullable=True, index=True)
    is_public: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    # Allowed email domains for teacher registration (issue #407).
    # If set to a non-empty list, only teachers whose email domain appears in this list
    # may join this school.  Stored as JSON list of lowercase domain strings,
    # e.g. ["school.edu.tw", "mail.school.edu.tw"].
    # When None or [] there is no domain restriction.
    allowed_email_domains: Mapped[list | None] = mapped_column(JSON, nullable=True)
    settings: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    # Relationships
    organization: Mapped["Organization | None"] = relationship("Organization")
    admin_user: Mapped["User | None"] = relationship("User")
    classrooms: Mapped[list["Classroom"]] = relationship("Classroom", back_populates="school")


class Classroom(Base):
    __tablename__ = "classrooms"
    __table_args__ = (
        Index(
            "uq_classrooms_teacher_junyi_class",
            "teacher_id",
            "junyi_class_id",
            unique=True,
            postgresql_where=text("junyi_class_id IS NOT NULL"),
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    school_id: Mapped[int] = mapped_column(ForeignKey("schools.id"), nullable=False, index=True)
    teacher_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    junyi_class_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    grade: Mapped[int | None] = mapped_column(Integer, nullable=True)
    join_code: Mapped[str | None] = mapped_column(String(8), unique=True, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    # Issue #3586 (PK mode): per-classroom feature toggles the teacher
    # controls, e.g. {"pk_human": true}. One JSON blob instead of one
    # column per feature so a future class-level toggle never needs
    # another migration -- read it through
    # services/pk/classroom_features.get_classroom_feature(), which
    # supplies the default for any key not present (an empty '{}' class
    # is NOT the same as "everything off"; each key has its own default).
    feature_settings: Mapped[dict] = mapped_column(
        JSON, nullable=False, server_default=text("'{}'")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # Relationships
    school: Mapped["School"] = relationship("School", back_populates="classrooms")
    teacher: Mapped["User"] = relationship("User", foreign_keys="[Classroom.teacher_id]")
    classroom_students: Mapped[list["ClassroomStudent"]] = relationship(
        "ClassroomStudent", back_populates="classroom"
    )
    classroom_teachers: Mapped[list["ClassroomTeacher"]] = relationship(
        "ClassroomTeacher", back_populates="classroom", cascade="all, delete-orphan"
    )


class ClassroomStudent(Base):
    __tablename__ = "classroom_students"
    __table_args__ = (UniqueConstraint("classroom_id", "student_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    classroom_id: Mapped[int] = mapped_column(ForeignKey("classrooms.id"), nullable=False, index=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    enrolled_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # Relationships
    classroom: Mapped["Classroom"] = relationship("Classroom", back_populates="classroom_students")
    student: Mapped["User"] = relationship("User")


class ClassroomTeacher(Base):
    """Junction table: many teachers per classroom.

    The primary teacher (owner) is always the one stored in Classroom.teacher_id.
    This table tracks additional co-teachers with role='primary' (owner),
    'editor' (full read/write parity with owner except co-teacher management
    and classroom deletion), or 'viewer' (read-only; #3820).

    ``status`` is the invitation lifecycle: a row starts 'pending' when invited
    and only counts as classroom membership (read access, let alone write)
    once it is 'accepted' by the invitee. There is no persisted 'rejected'
    state -- rejecting / revoking / leaving are all a DELETE of the row.
    """

    __tablename__ = "classroom_teachers"
    __table_args__ = (UniqueConstraint("classroom_id", "teacher_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    classroom_id: Mapped[int] = mapped_column(
        ForeignKey("classrooms.id", ondelete="CASCADE"), nullable=False, index=True
    )
    teacher_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    # "primary" = owner, "editor" = full read/write co-teacher, "viewer" = read-only
    role: Mapped[str] = mapped_column(String(20), nullable=False, default="editor")
    # "pending" until the invitee accepts, then "accepted". See class docstring.
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="accepted", server_default="accepted"
    )
    accepted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    invited_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    invited_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # Relationships
    classroom: Mapped["Classroom"] = relationship("Classroom", back_populates="classroom_teachers")
    teacher: Mapped["User"] = relationship("User", foreign_keys=[teacher_id])
    inviter: Mapped["User | None"] = relationship("User", foreign_keys=[invited_by])


class ClassroomText(Base):
    __tablename__ = "classroom_texts"
    __table_args__ = (UniqueConstraint("classroom_id", "text_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    classroom_id: Mapped[int] = mapped_column(
        ForeignKey("classrooms.id", ondelete="CASCADE"), nullable=False, index=True
    )
    text_id: Mapped[str] = mapped_column(String(50), nullable=False)
    assigned_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id"), nullable=True, index=True
    )
    assigned_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    # Auto-cleanup fields — set expires_at when assigning a text with a semester end date.
    # The cleanup job soft-deletes rows where expires_at < now() and deleted_at is NULL.
    expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Relationships
    classroom: Mapped["Classroom"] = relationship("Classroom")
    assigner: Mapped["User | None"] = relationship("User")
