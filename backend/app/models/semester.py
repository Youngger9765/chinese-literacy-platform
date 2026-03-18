"""Semester model — school-scoped academic term with start/end dates.

Taiwan uses a two-semester system (上學期/下學期).
A school may have multiple semesters; at most one is is_active=True at a time.

Texts assigned to a classroom can optionally carry an expires_at derived from
`semester.end_date + grace_days` (default 7 days per PRD §742-756).
"""

from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base


class Semester(Base):
    __tablename__ = "semesters"
    __table_args__ = (
        # Each school can have at most one active semester.
        # Enforced at the application layer; the partial unique index below
        # is added as a belt-and-suspenders guard in Postgres but is optional
        # for in-memory SQLite tests.
        UniqueConstraint("school_id", "name", name="uq_semester_school_name"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    # Owning school (NULL = platform-wide default semester)
    school_id: Mapped[int | None] = mapped_column(
        ForeignKey("schools.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )

    # Human-readable name, e.g. "113學年度上學期"
    name: Mapped[str] = mapped_column(String(100), nullable=False)

    # Academic calendar dates
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date] = mapped_column(Date, nullable=False)

    # Expiry grace period in days after end_date (PRD §742-756 default: 7)
    grace_days: Mapped[int] = mapped_column(Integer, nullable=False, default=7)

    # Whether this is the currently active semester for its school
    is_active: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, index=True)

    created_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    # Relationships
    school: Mapped["School | None"] = relationship("School")  # type: ignore[name-defined]
    created_by: Mapped["User | None"] = relationship("User")  # type: ignore[name-defined]

    @property
    def expires_at_date(self) -> date:
        """Return the date on which texts linked to this semester expire."""
        from datetime import timedelta
        return self.end_date + timedelta(days=self.grace_days)
