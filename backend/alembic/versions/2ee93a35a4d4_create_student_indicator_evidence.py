"""閱讀寶貝：建 student_indicator_evidence、刪文字寶貝 v1 三張表（#3780 第一階段）

Young 2026-10-31 核准建此表（任務指示原文：「Young 已同意建資料表
（2026-10-31 回覆：『同意建』）」；docs/design/reading-babies/*.md 兩份設計
文件 §7/§9 各自的草案在此合併成一張）。

這個 migration 同時做兩件事：

1. **刪除文字寶貝 v1 的三張表**（`student_word_baby_state`／
   `student_fragment_wallet`／`student_station_reward_log`，由
   f6185ba9cbf7 建立）—— game-design.md §0.2.1 已查證：這三張表只存在
   `feat/issue-3780-island-3d-lab` 這條未合併分支，`origin/main`／
   `origin/staging` 都沒有這套程式，所以沒有任何真實學生擁有過 v1 寶貝、
   沒有真實碎片庫存，刪表是刪除未上線程式碼，不是資料遷移。

   ⚠️ **工程判斷（刻意偏離設計文件 §5.2 的字面建議）**：game-design.md §5.2
   原本建議「整個刪除 f6185ba9cbf7 這個 migration 檔」。這裡**沒有照做**——
   這條分支已經部署過好幾輪 preview（PR #3783 的 CI 歷史可查），preview DB
   很可能已經把 `alembic_version` 推進到 f6185ba9cbf7；若直接刪掉那個
   revision 檔，下次 `alembic upgrade head` 會因為找不到 DB 記錄的那個
   revision 而失敗（`sqlalchemy-model-safety` skill Rule 5／6：head 要完整
   連續、DDL 要在共用環境安全重跑）。改成**接在它後面**的新 migration，
   在 `upgrade()` 裡把三張表砍掉——既達成「v1 表不該存在」的目的，又不破壞
   任何已經套用過 f6185ba9cbf7 的環境的 alembic 歷史鏈。

2. **建立 `student_indicator_evidence`**（唯一需要的新表，見
   `app/models/reading_baby.py` docstring）。

Revision ID: 2ee93a35a4d4
Revises: f6185ba9cbf7
Create Date: 2026-10-31 00:00:00.000000

"""
from typing import Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "2ee93a35a4d4"
down_revision: Union[str, None] = "f6185ba9cbf7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── 1. 刪除文字寶貝 v1 三張表（idempotent：IF EXISTS，shared preview DB
    #      上重跑這支 migration 要安全，見 sqlalchemy-model-safety skill Rule 6）──
    op.execute("DROP TABLE IF EXISTS student_station_reward_log")
    op.execute("DROP TABLE IF EXISTS student_fragment_wallet")
    op.execute("DROP TABLE IF EXISTS student_word_baby_state")

    # ── 2. 建立 student_indicator_evidence ──────────────────────────────────
    op.create_table(
        "student_indicator_evidence",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("student_id", sa.Integer(), nullable=False),
        sa.Column("classroom_id", sa.Integer(), nullable=True),
        sa.Column("session_id", sa.Integer(), nullable=True),
        sa.Column("lesson_uid", sa.String(20), nullable=False),
        sa.Column("station", sa.String(50), nullable=False),
        sa.Column("indicator_code", sa.String(16), nullable=False),
        sa.Column("signal_type", sa.String(24), nullable=False),
        sa.Column("quality_passed", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("quality_score", sa.Float(), nullable=True),
        sa.Column("items_total", sa.Integer(), nullable=True),
        sa.Column("items_first_try_correct", sa.Integer(), nullable=True),
        sa.Column("items_correct_after_hint", sa.Integer(), nullable=True),
        sa.Column("cpm", sa.Float(), nullable=True),
        sa.Column("accuracy", sa.Float(), nullable=True),
        sa.Column("source_ref", postgresql.JSONB(), nullable=True),
        sa.Column("mapping_version", sa.String(32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["student_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["classroom_id"], ["classrooms.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["session_id"], ["learning_sessions.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_student_indicator_evidence_student_id", "student_indicator_evidence", ["student_id"]
    )
    op.create_index(
        "ix_student_indicator_evidence_classroom_id", "student_indicator_evidence", ["classroom_id"]
    )
    op.create_index(
        "ix_student_indicator_evidence_session_id", "student_indicator_evidence", ["session_id"]
    )
    op.create_index(
        "ix_student_indicator_evidence_lesson_uid", "student_indicator_evidence", ["lesson_uid"]
    )
    op.create_index(
        "ix_student_indicator_evidence_indicator_code", "student_indicator_evidence", ["indicator_code"]
    )
    op.create_index(
        "ix_student_indicator_evidence_created_at", "student_indicator_evidence", ["created_at"]
    )
    op.create_index(
        "ix_student_indicator_evidence_student_lesson_station",
        "student_indicator_evidence",
        ["student_id", "lesson_uid", "station"],
    )
    op.create_index(
        "ix_student_indicator_evidence_student_indicator_created",
        "student_indicator_evidence",
        ["student_id", "indicator_code", "created_at"],
    )
    op.create_index(
        "ix_student_indicator_evidence_classroom_indicator",
        "student_indicator_evidence",
        ["classroom_id", "indicator_code"],
    )


def downgrade() -> None:
    op.drop_table("student_indicator_evidence")
    # 無法還原文字寶貝 v1 三張表——對應的 model/service/data 檔案已經整套從
    # 程式庫移除（game-design.md §5.2），沒有東西可以讓它們的結構「還原」回去
    # 有意義的狀態。這是刻意的資料遺失（Rule 7 的例外子句）。
    raise NotImplementedError(
        "文字寶貝 v1 三張表無法復原——v1 的 model/service/data 已整套從程式庫"
        "移除（見 game-design.md §5），downgrade 到 f6185ba9cbf7 之前的結構"
        "在這個狀態下沒有意義。真的需要回滾，請改用備份還原整個 schema。"
    )
