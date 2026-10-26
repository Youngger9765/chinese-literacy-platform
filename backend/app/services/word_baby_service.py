"""文字寶貝養成系統 — 核心服務：獎勵判定 / 餵食 / 查詢（#3780）。

🔒 **正式後端的獎勵判定用 `secrets`（CSPRNG），不沿用設計草案的決定性雜湊**
（security review 2026-10-26，design.md §15.1）。這份檔案的 `rng` 參數是給
**測試**注入假亂數源用的依賴注入（不是公開可預測的雜湊）——預設值
`secrets.SystemRandom()` 才是正式環境實際跑的路徑；測試用假 rng 讓結果可控，
假 rng 本身永遠不會出現在正式環境的呼叫路徑裡（呼叫端 `learning_step_progress.py`
不會傳 `rng` 參數，就是走預設值）。
"""
from __future__ import annotations

import secrets as _secrets_module
from datetime import datetime, timezone

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..models.word_baby import (
    StudentFragmentWallet,
    StudentStationRewardLog,
    StudentWordBabyState,
)
from . import word_baby_config as config
from .word_baby_care import compute_weaken_state, effective_hatch_credit


class _RandomSource:
    """型別提示用的 Protocol-lite——生產預設走 `secrets.SystemRandom()`
    （真 CSPRNG，`random()`/`choice()` 介面跟這裡用到的一致）。"""

    def random(self) -> float: ...  # noqa: D102
    def choice(self, seq): ...  # noqa: D102


def _default_rng() -> _RandomSource:
    return _secrets_module.SystemRandom()


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ── 獎勵判定（完成一個站時呼叫） ──────────────────────────────────────────

def award_station_rewards(
    db: Session,
    *,
    student_id: int,
    lesson_uid: str,
    station: str,
    now: datetime | None = None,
    rng: _RandomSource | None = None,
) -> StudentStationRewardLog:
    """完成一個站時呼叫——冪等：`student_station_reward_log` 的唯一鍵
    (student_id, lesson_uid, station) 已經有紀錄就直接回傳，不重算、不重發。

    這是整個獎勵系統「同一站只能發一次」的保證來源，不是靠 rng 的任何性質。
    """
    now = now or _now()
    rng = rng or _default_rng()

    existing = _get_existing_log(db, student_id, lesson_uid, station)
    if existing is not None:
        return existing

    # code-reviewer finding（2026-10-26）：這個 check-then-insert 中間有時間差——
    # 兩個幾乎同時的請求都可能在對方 commit 之前通過上面的 existing 檢查。整段
    # 判定（錢包加碎片、遭遇判定、抓到寶貝、最後寫 log）包進同一個 SAVEPOINT，
    # 輸掉比賽的那次呼叫（最後寫 log 時撞到唯一鍵）會把**這個 SAVEPOINT 範圍內
    # 的全部副作用**一起撤銷——不是只撤銷那筆 log，連「本來要加的碎片/抓到的
    # 寶貝」都撤銷，不然兩個同時的請求會讓錢包多算一次，即使只有一筆 log 紀錄。
    # 外層的整個 session／transaction（這次 HTTP 請求其他已經做的事，例如
    # step_progress 存檔）不受影響，因為 SAVEPOINT 的回滾範圍只到它自己。
    try:
        with db.begin_nested():
            log = _determine_and_insert_reward(
                db, student_id=student_id, lesson_uid=lesson_uid, station=station, now=now, rng=rng
            )
    except IntegrityError:
        existing = _get_existing_log(db, student_id, lesson_uid, station)
        if existing is not None:
            return existing
        raise  # 真的不是唯一鍵衝突造成的——不要吞掉非預期的錯誤
    return log


def _get_existing_log(
    db: Session, student_id: int, lesson_uid: str, station: str
) -> StudentStationRewardLog | None:
    return (
        db.query(StudentStationRewardLog)
        .filter_by(student_id=student_id, lesson_uid=lesson_uid, station=station)
        .first()
    )


def _determine_and_insert_reward(
    db: Session, *, student_id: int, lesson_uid: str, station: str, now: datetime, rng: _RandomSource
) -> StudentStationRewardLog:
    flavor = config.get_station_flavor(station)
    if flavor is None:
        # 這個站不在 15 種站對照表裡（資料缺口／非寶貝系統管轄範圍）——
        # 仍然寫一筆 log 保持冪等語意，不讓呼叫端每次都重新嘗試判定。
        log = StudentStationRewardLog(
            student_id=student_id, lesson_uid=lesson_uid, station=station,
            fragment_awarded=False, encounter_result="none",
        )
        db.add(log)
        db.flush()
        return log

    fragment_awarded = rng.random() < config.get_drop_probability(flavor)
    if fragment_awarded:
        _add_to_wallet(db, student_id, flavor, 1)

    encounter_result, encounter_baby_id = _roll_encounter(
        db, student_id=student_id, flavor=flavor, now=now, rng=rng
    )

    log = StudentStationRewardLog(
        student_id=student_id,
        lesson_uid=lesson_uid,
        station=station,
        fragment_awarded=fragment_awarded,
        fragment_flavor=flavor if fragment_awarded else None,
        encounter_result=encounter_result,
        encounter_baby_id=encounter_baby_id,
    )
    db.add(log)
    db.flush()
    return log


def _roll_encounter(
    db: Session, *, student_id: int, flavor: str, now: datetime, rng: _RandomSource
) -> tuple[str, str | None]:
    """回傳 (encounter_result, encounter_baby_id)。"""
    rarity_rates = config.load_encounters()["rarity_base_rates"]
    r = rng.random()
    acc = 0.0
    chosen_rarity = None
    for row in rarity_rates:
        acc += row["base_encounter_rate_per_station"]
        if r < acc:
            chosen_rarity = row["rarity"]
            break
    if chosen_rarity is None:
        return "none", None

    candidates = [
        bid for bid in config.babies_by_flavor()[flavor]
        if config.get_baby(bid)["rarity"] == chosen_rarity
    ]
    if not candidates:
        # 防呆：理論上每個稀有度在每個口味下都該有候選，真的沒有就當沒遭遇
        return "none", None

    owned_ids = {
        row.baby_id
        for row in db.query(StudentWordBabyState.baby_id).filter_by(student_id=student_id)
    }
    eligible = [bid for bid in candidates if bid not in owned_ids]

    if eligible:
        baby_id = rng.choice(eligible)
        _catch_baby(db, student_id=student_id, baby_id=baby_id, now=now)
        return "caught", baby_id

    # 全部候選都已擁有 → 退而求其次發補償碎片，記在重複遇到的那一隻身上
    dup_baby_id = rng.choice(candidates)
    state = (
        db.query(StudentWordBabyState)
        .filter_by(student_id=student_id, baby_id=dup_baby_id)
        .first()
    )
    if state is not None:
        state.duplicate_catch_count += 1
    bonus = config.load_fragments()["duplicate_catch_bonus"]["bonus_fragment_count"]
    _add_to_wallet(db, student_id, flavor, bonus)
    return "duplicate", dup_baby_id


def _add_to_wallet(db: Session, student_id: int, flavor: str, amount: int) -> None:
    wallet = (
        db.query(StudentFragmentWallet)
        .filter_by(student_id=student_id, flavor=flavor)
        .first()
    )
    if wallet is None:
        wallet = StudentFragmentWallet(student_id=student_id, flavor=flavor, quantity=0)
        db.add(wallet)
        db.flush()
    wallet.quantity += amount


def _catch_baby(db: Session, *, student_id: int, baby_id: str, now: datetime) -> StudentWordBabyState:
    state = StudentWordBabyState(
        student_id=student_id,
        baby_id=baby_id,
        stage_index=1,
        fed_current_stage=0,
        weaken_state="healthy",
        last_cared_at=now,
        caught_at=now,
    )
    db.add(state)
    db.flush()
    return state


# ── 照顧/孵化的 lazy evaluation（讀取時或照顧動作發生時都呼叫） ──────────

def _sync_care_state(
    db: Session, state: StudentWordBabyState, baby: dict, now: datetime, *, is_care_action: bool
) -> None:
    """讀取時或照顧動作發生時都呼叫——計算當下的虛弱狀態，並視情況把孵化天數
    的累積、甚至孵化完成（進入下一階段）寫回去。

    `is_care_action=False`（純讀取）：孵化天數的「新增量」只拿來算 live 顯示值，
    **不寫回** state.hatch_progress_days（否則連續多次讀取、`last_cared_at` 沒變，
    會重複累加同一段區間）——除非這次新增量剛好讓牠孵化完成，孵化本身是一次性
    的狀態轉換，發現了就寫回去，不管是不是因為讀取才發現的。
    `is_care_action=True`：這次呼叫本身就代表「有一個照顧動作發生」，累積量連同
    `last_cared_at = now` 一起寫回去，之後的評估從這個新基準重新算，不會跟這次
    重複計算。
    """
    care = config.load_care()
    paused_periods = care["paused_periods"]

    state.weaken_state = compute_weaken_state(
        state.last_cared_at,
        now,
        weaken_after_days=care["weaken_after_days"],
        deep_sleep_after_days=care["deep_sleep_after_days"],
        paused_periods=paused_periods,
    )

    if state.dormant_type is not None:
        credit = effective_hatch_credit(
            state.last_cared_at, now,
            weaken_after_days=care["weaken_after_days"],
            paused_periods=paused_periods,
        )
        live_hatch_progress = state.hatch_progress_days + credit

        stage = baby["stages"][state.stage_index - 1]
        required = stage["dormancy_after_this_stage"]["hatch_days"]
        if live_hatch_progress >= required:
            state.stage_index += 1
            state.dormant_type = None
            state.dormant_started_at = None
            state.hatch_progress_days = 0
            state.fed_current_stage = 0
            state.fed_by_flavor = None
        elif is_care_action:
            state.hatch_progress_days = live_hatch_progress

    if is_care_action:
        state.last_cared_at = now


# ── 餵食 ──────────────────────────────────────────────────────────────────

class BabyNotOwnedError(ValueError):
    pass


def feed_baby(
    db: Session, *, student_id: int, baby_id: str, now: datetime | None = None
) -> StudentWordBabyState:
    """把背包裡對的口味碎片盡量餵給這一隻（一次呼叫 = 貪婪餵到餵不動為止，
    不是每次只扣一片）。餵食本身是一次照顧動作，會重設虛弱時鐘。"""
    now = now or _now()

    # authz review 跟進（2026-10-26）：先驗證 baby_id 是不是一個真的存在的物種，
    # 再查有沒有擁有——順序對調之前，一個「根本不存在的物種」理論上會在下面
    # `config.get_baby` 回傳 None 時丟出裸 `ValueError`，路由層沒有攔它會變成
    # 500，不是乾淨的 4xx。現在不管「這個物種根本不存在」還是「存在但這個學生
    # 沒有」，呼叫端看到的都是同一種 BabyNotOwnedError（404），不會有第二種
    # 例外需要額外處理。
    baby = config.get_baby(baby_id)
    if baby is None:
        raise BabyNotOwnedError(f"unknown baby_id {baby_id}")

    state = (
        db.query(StudentWordBabyState)
        .filter_by(student_id=student_id, baby_id=baby_id)
        .first()
    )
    if state is None:
        raise BabyNotOwnedError(f"student {student_id} does not own baby {baby_id}")

    _sync_care_state(db, state, baby, now, is_care_action=True)

    if state.stage_index > baby["stage_count"] or state.dormant_type is not None:
        db.flush()
        return state  # 已經最終型態，或正在休眠——不吃

    stage = baby["stages"][state.stage_index - 1]
    wallet_rows = {
        w.flavor: w
        for w in db.query(StudentFragmentWallet).filter_by(student_id=student_id).all()
    }

    fbf = stage.get("fragments_by_flavor")
    if fbf:
        fed_by_flavor = dict(state.fed_by_flavor or {})
        changed = True
        while changed:
            changed = False
            for flavor, required in fbf.items():
                have = fed_by_flavor.get(flavor, 0)
                if have < required:
                    wallet = wallet_rows.get(flavor)
                    if wallet is not None and wallet.quantity > 0:
                        wallet.quantity -= 1
                        fed_by_flavor[flavor] = have + 1
                        changed = True
        state.fed_by_flavor = fed_by_flavor
        state.fed_current_stage = sum(fed_by_flavor.values())
        stage_done = all(fed_by_flavor.get(f, 0) >= req for f, req in fbf.items())
    else:
        need_total = stage["fragments_to_finish_stage"]
        diet = baby["diet_flavors"]
        while state.fed_current_stage < need_total:
            flavor_fed = next(
                (f for f in diet if wallet_rows.get(f) and wallet_rows[f].quantity > 0), None
            )
            if flavor_fed is None:
                break
            wallet_rows[flavor_fed].quantity -= 1
            state.fed_current_stage += 1
        stage_done = state.fed_current_stage >= need_total

    if stage_done:
        if stage["dormancy_after_this_stage"] is not None:
            state.dormant_type = stage["dormancy_after_this_stage"]["type"]
            state.dormant_started_at = now
            state.hatch_progress_days = 0
            state.fed_by_flavor = None
        else:
            state.stage_index = baby["stage_count"] + 1

    db.flush()
    return state


# ── 查詢「我的寶貝」 ────────────────────────────────────────────────────────

def get_my_pets(db: Session, *, student_id: int, now: datetime | None = None) -> dict:
    """組出「我的寶貝」頁要的資料：擁有的寶貝（含即時推算的虛弱狀態、是否剛
    孵化完成）、碎片背包、M/100 K/300 進度統計。讀取時就地推算並視情況寫回
    孵化完成的狀態（lazy evaluation，不用排程）。"""
    now = now or _now()

    states = db.query(StudentWordBabyState).filter_by(student_id=student_id).all()
    for state in states:
        baby = config.get_baby(state.baby_id)
        if baby is not None:
            _sync_care_state(db, state, baby, now, is_care_action=False)
    db.flush()

    wallet_rows = db.query(StudentFragmentWallet).filter_by(student_id=student_id).all()

    total_fragments_collected = sum(w.quantity for w in wallet_rows)  # 目前手上還有的，不是累計總量
    babies_payload = []
    for state in states:
        baby = config.get_baby(state.baby_id)
        if baby is None:
            continue
        babies_payload.append({
            "baby_id": state.baby_id,
            "name": baby["name"],
            "rarity": baby["rarity"],
            "stage_index": min(state.stage_index, baby["stage_count"]),
            "stage_count": baby["stage_count"],
            "fully_grown": state.stage_index > baby["stage_count"],
            "dormant_type": state.dormant_type,
            "weaken_state": state.weaken_state,
            "fed_current_stage": state.fed_current_stage,
            "caught_at": state.caught_at,
        })

    return {
        "babies": babies_payload,
        "babies_owned_count": len(babies_payload),
        "babies_total_species": len(config.load_babies()),
        "wallet": {w.flavor: w.quantity for w in wallet_rows},
        "fragments_in_wallet": total_fragments_collected,
    }
