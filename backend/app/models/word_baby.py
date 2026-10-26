"""文字寶貝養成系統 DB models（#3780）。

設計來源：docs/design/word-babies/schema-proposal.md（team-lead 已確認維持 3 張表，
Young 已核准建表）。物種內容（100 隻的名字/稀有度/飲食/進化階段設定）**不在**這幾張
表裡——那些是不會因學生而變的靜態內容，走 `app/services/word_baby_config.py` 從
`app/data/word_babies/*.json` 讀，版控在 repo 裡；這幾張表只存「某個學生」跟「某個
物種/某個站」之間**會隨時間變化**的狀態。

三張表：
- StudentWordBabyState    — 這個學生擁有的每一隻寶貝，現在養到哪
- StudentFragmentWallet   — 這個學生手上還有幾片碎片沒餵
- StudentStationRewardLog — 這個「課×站」格子，這個學生到底領過沒（idempotency 帳本）
"""
from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base


class StudentWordBabyState(Base):
    """這個學生擁有的每一隻寶貝，現在養到第幾階段、有沒有在休眠/虛弱。

    沒抓過的寶貝不會有列——抓到才新增一列，不是 100 隻先建好空列。
    """

    __tablename__ = "student_word_baby_state"
    __table_args__ = (
        UniqueConstraint("student_id", "baby_id", name="uq_student_word_baby"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    student_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # 對應 app/data/word_babies/babies.json 裡的 "id" 欄位（如 "wb-001"）。
    # 物種定義（名字/稀有度/飲食/進化階段）不存這裡，是靜態內容設定。
    baby_id: Mapped[str] = mapped_column(String(20), nullable=False, index=True)

    caught_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # 目前第幾個進化階段（1=小寶、2=中寶…）。超過該物種的 stage_count 代表已經完全長大、
    # 不再休眠也不再要求餵食——設計刻意不用一個獨立的 is_final 布林欄位，用數字本身跟
    # 物種設定（stage_count）比較就夠，查詢時從 config 讀 stage_count 比對。
    stage_index: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    # 本階段已經餵了幾片正確口味碎片（累計）——常見/少見/稀有共用一個池子的進度；
    # 史詩/傳說的結構化餵食（文言文配額很小、其餘由常見口味扛）另外用 fed_by_flavor
    # 記每個口味餵了多少，這一欄在那種情況下存兩者加總，方便前端畫單一進度條。
    fed_current_stage: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # 史詩/傳說專用：{"文言文": 1, "語文基礎": 2} 這種每個口味各自餵了多少。
    # 其餘稀有度（共用池子）這欄是 None。見 design.md §6「史詩/傳說為什麼文言文跟
    # 常見口味要分開算」。
    fed_by_flavor: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    # 休眠型態：None（還沒進入下一次休眠）／"egg"／"cocoon"／"hibernation"。
    # ⛔ 不用 "dead"/"dying" 這類字——系統紅線是永遠不能出現死亡語意（PRD/team-lead 明令）。
    dormant_type: Mapped[str | None] = mapped_column(String(20), nullable=True)
    dormant_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # 休眠期間累積的「有效照顧天數」（已經扣掉落在寒暑假/虛弱期間的天數）。
    # 孵化判定：hatch_progress_days >= 該階段 hatch_days 就孵化成下一階段。
    hatch_progress_days: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # 虛弱狀態：healthy／weak／deep_sleep。這欄本身是 lazy evaluation 算出來寫回的
    # 快取值（算的時候才更新），不是每天排程去改——見 word_baby_service.py 的
    # `evaluate_care_state()`。
    weaken_state: Mapped[str] = mapped_column(String(20), nullable=False, default="healthy")

    # 最後一次「照顧動作」發生的時間（完成任何站，或主動餵食這一隻）。
    # 虛弱/深眠的判定、孵化天數的「有效天數」都是拿現在時間跟這個比，不用每天掃全表。
    last_cared_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # 重複捕捉到同一隻的次數，純紀錄用（可以做「你遇過這隻 N 次」的小彩蛋），
    # 不影響任何養成判定邏輯。
    duplicate_catch_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    student: Mapped["User"] = relationship("User")  # type: ignore[name-defined]


class StudentFragmentWallet(Base):
    """這個學生手上還有幾片碎片沒餵——背包，5 種口味各自獨立庫存。"""

    __tablename__ = "student_fragment_wallet"
    __table_args__ = (
        UniqueConstraint("student_id", "flavor", name="uq_student_flavor"),
        # security review finding（2026-10-27）：跟 migration f6185ba9cbf7 的
        # CheckConstraint 對應——DB 層最後防線，擋應用層 race condition 漏網
        # 把數量扣成負的。
        CheckConstraint("quantity >= 0", name="ck_student_fragment_wallet_quantity_nonneg"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    student_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # 五個口味家族之一（語文基礎／閱讀理解／朗讀表達／書寫紀錄／文言文），
    # 對應 app/data/word_babies/fragments.json 的 flavor_families。不用資料庫
    # 層級的 ENUM type（改口味名字要 ALTER TYPE，跟平台其他 status/role 欄位
    # 的慣例一致，用 String + 應用層驗證）。
    flavor: Mapped[str] = mapped_column(String(20), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    student: Mapped["User"] = relationship("User")  # type: ignore[name-defined]


class StudentStationRewardLog(Base):
    """這個「課×站」格子，這個學生到底領過沒——idempotency 帳本。

    唯一鍵 (student_id, lesson_uid, station) 本身就是整個獎勵系統「同一站只判定一次」
    的保證；正式後端用 `secrets`（CSPRNG）擲骰一次、寫進這張表就不再重算
    （security review 2026-10-26，見 design.md §15.1：**不**靠雜湊的決定性來保證
    結果穩定，是靠這張表的唯一鍵）。
    """

    __tablename__ = "student_station_reward_log"
    __table_args__ = (
        UniqueConstraint("student_id", "lesson_uid", "station", name="uq_student_lesson_station"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    student_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # 內容樹的課程 id（如 "L0001"），不是 LearningSession.story_slug——
    # 兩者是不同的編號系統，呼叫端要先轉換（見 word_baby_service.py 的說明）。
    lesson_uid: Mapped[str] = mapped_column(String(20), nullable=False)
    # PRD §5.1 的 15 種站 id 之一（如 "vocab-definition"）。
    station: Mapped[str] = mapped_column(String(50), nullable=False)

    fragment_awarded: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    fragment_flavor: Mapped[str | None] = mapped_column(String(20), nullable=True)

    # none／caught／duplicate
    encounter_result: Mapped[str] = mapped_column(String(20), nullable=False, default="none")
    encounter_baby_id: Mapped[str | None] = mapped_column(String(20), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    student: Mapped["User"] = relationship("User")  # type: ignore[name-defined]
