"""文字寶貝養成系統 — 查詢與餵食 API（#3780）。

    GET  /learning/students/{student_id}/word-babies          — 我的寶貝（查詢）
    POST /learning/students/{student_id}/word-babies/{id}/feed — 餵食

權限（team-lead 明令）：
- **查詢**：照既有的 `verify_student_access`——本人、任課老師、連結的家長都能看
- **餵食**：只有本人能做（比查詢更嚴——這是會改變狀態的動作，不開放老師/家長代操作）

⛔ 這兩支路由本身不含任何獎勵判定邏輯（掉碎片/遇到寶貝）——那是完成一個站時
由 `learning_step_progress.py` 呼叫 `word_baby_service.award_station_rewards()`
觸發的，不是靠這裡的查詢/餵食 API 觸發。
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ...auth.dependencies import get_current_user
from ...database import get_db
from ...models.user import User
from ...services import word_baby_config, word_baby_service
from ._helpers import verify_student_access

router = APIRouter()


class WordBabySummary(BaseModel):
    baby_id: str
    name: str
    rarity: str
    stage_index: int
    stage_count: int
    fully_grown: bool
    dormant_type: str | None
    weaken_state: str
    fed_current_stage: int
    # 前端 /lab 寶貝卡「蛋/繭/冬眠倒數」用（2026-10-27）：None = 現在不是
    # 休眠狀態，否則是還要幾個有效天數才孵化。
    hatch_days_remaining: int | None = None
    # review finding（2026-10-27 第三輪）：史詩/傳說（12 隻，fragments_by_flavor
    # 結構化餵食）每個口味各自有獨立配額，共用的 fed_current_stage 加總數字
    # 看不出「哪個口味已經餵滿、哪個還缺」——前端要靠這個欄位才能正確判斷
    # 餵食按鈕該不該亮（舊版只看錢包總和 > 0，對已經餵滿其中一個口味、只剩
    # 另一個口味缺貨的情況會誤判成可以按，按下去後端其實扣不到東西）。
    # None = 這隻寶貝這個階段是共用池（常見/少見/稀有），不適用此欄位。
    fed_by_flavor: dict[str, int] | None = None


class MyWordBabiesResponse(BaseModel):
    babies: list[WordBabySummary]
    babies_owned_count: int
    babies_total_species: int
    wallet: dict[str, int]
    fragments_in_wallet: int


class FeedBabyResponse(BaseModel):
    baby_id: str
    stage_index: int
    stage_count: int
    fully_grown: bool
    dormant_type: str | None
    weaken_state: str
    fed_current_stage: int


@router.get(
    "/learning/students/{student_id}/word-babies",
    response_model=MyWordBabiesResponse,
    summary="查詢我的文字寶貝（#3780）",
)
def get_my_word_babies(
    student_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    verify_student_access(student_id, current_user, db)
    # security review finding（2026-10-27）：孵化完成這種一次性狀態轉換只有
    # 學生本人讀取才該落地——老師/家長恰好先讀到不該搶先寫進 DB。
    result = word_baby_service.get_my_pets(
        db, student_id=student_id, viewer_is_student=(current_user.id == student_id)
    )
    db.commit()  # 只有本人讀取時 get_my_pets 才真的弄髒了東西；非本人讀取這裡是 no-op
    return result


@router.post(
    "/learning/students/{student_id}/word-babies/{baby_id}/feed",
    response_model=FeedBabyResponse,
    summary="餵食一隻文字寶貝（#3780）",
)
def feed_word_baby(
    student_id: int,
    baby_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # 比 verify_student_access 更嚴：只有本人能餵，老師/家長不行（team-lead 明令）。
    if current_user.id != student_id:
        raise HTTPException(status_code=403, detail="只有學生本人能餵食自己的寶貝")

    try:
        state = word_baby_service.feed_baby(db, student_id=student_id, baby_id=baby_id)
    except word_baby_service.BabyNotOwnedError:
        raise HTTPException(status_code=404, detail="你還沒有這隻寶貝")

    baby = word_baby_config.get_baby(baby_id)
    db.commit()
    return FeedBabyResponse(
        baby_id=state.baby_id,
        stage_index=min(state.stage_index, baby["stage_count"]),
        stage_count=baby["stage_count"],
        fully_grown=state.stage_index > baby["stage_count"],
        dormant_type=state.dormant_type,
        weaken_state=state.weaken_state,
        fed_current_stage=state.fed_current_stage,
    )
