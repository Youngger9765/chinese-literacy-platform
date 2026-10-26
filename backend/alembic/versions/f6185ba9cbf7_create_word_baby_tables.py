"""create word baby pet system tables (#3780)

See docs/design/word-babies/schema-proposal.md for the design rationale.
Young approved creating these 3 tables (relayed via team-lead, 2026-10-26).

Three tables, each a different grain:
- student_word_baby_state    — (student, baby) pair: which species owned, stage
- student_fragment_wallet    — (student, flavor) pair: fragment inventory
- student_station_reward_log — (student, lesson, station) triple: idempotency
  ledger so a station's reward roll only ever happens once

Content config (100 species roster, flavor tables, encounter rates, care
timing) is NOT stored here — it lives in app/data/word_babies/*.json,
loaded by app/services/word_baby_config.py. These tables only hold the
per-student state that changes over time.

Revision ID: f6185ba9cbf7
Revises: 988d8bc90428
Create Date: 2026-10-26 00:00:00.000000

"""
from typing import Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "f6185ba9cbf7"
down_revision: Union[str, None] = "988d8bc90428"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "student_word_baby_state",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("student_id", sa.Integer(), nullable=False),
        sa.Column("baby_id", sa.String(20), nullable=False),
        sa.Column("caught_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("stage_index", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("fed_current_stage", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("fed_by_flavor", postgresql.JSONB(), nullable=True),
        sa.Column("dormant_type", sa.String(20), nullable=True),
        sa.Column("dormant_started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("hatch_progress_days", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("weaken_state", sa.String(20), nullable=False, server_default="healthy"),
        sa.Column("last_cared_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("duplicate_catch_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(),
            onupdate=sa.func.now(), nullable=False,
        ),
        sa.ForeignKeyConstraint(["student_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("student_id", "baby_id", name="uq_student_word_baby"),
    )
    op.create_index(
        "ix_student_word_baby_state_student_id", "student_word_baby_state", ["student_id"]
    )
    op.create_index(
        "ix_student_word_baby_state_baby_id", "student_word_baby_state", ["baby_id"]
    )

    op.create_table(
        "student_fragment_wallet",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("student_id", sa.Integer(), nullable=False),
        sa.Column("flavor", sa.String(20), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(),
            onupdate=sa.func.now(), nullable=False,
        ),
        sa.ForeignKeyConstraint(["student_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("student_id", "flavor", name="uq_student_flavor"),
        # security review finding (2026-10-27)：應用層的「餵食不會扣成負的」
        # 檢查只在單一請求的 read-modify-write 之間有效——兩個同時的餵食請求
        # 各自讀到「夠扣」的快照，就可能一起把它扣成負的（race）。DB 層再補
        # 一道 CheckConstraint 當最後防線：就算應用層邏輯有漏洞，資料庫本身
        # 也不接受 quantity < 0 的寫入。這個 migration 還沒套用到任何環境
        # （2026-10-26 才建），直接改這個檔案本身，不另開一個新 migration。
        sa.CheckConstraint("quantity >= 0", name="ck_student_fragment_wallet_quantity_nonneg"),
    )
    op.create_index(
        "ix_student_fragment_wallet_student_id", "student_fragment_wallet", ["student_id"]
    )

    op.create_table(
        "student_station_reward_log",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("student_id", sa.Integer(), nullable=False),
        sa.Column("lesson_uid", sa.String(20), nullable=False),
        sa.Column("station", sa.String(50), nullable=False),
        sa.Column("fragment_awarded", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("fragment_flavor", sa.String(20), nullable=True),
        sa.Column("encounter_result", sa.String(20), nullable=False, server_default="none"),
        sa.Column("encounter_baby_id", sa.String(20), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["student_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "student_id", "lesson_uid", "station", name="uq_student_lesson_station"
        ),
    )
    op.create_index(
        "ix_student_station_reward_log_student_id", "student_station_reward_log", ["student_id"]
    )


def downgrade() -> None:
    op.drop_table("student_station_reward_log")
    op.drop_table("student_fragment_wallet")
    op.drop_table("student_word_baby_state")
