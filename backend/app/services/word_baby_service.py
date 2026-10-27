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

from sqlalchemy import update as sa_update
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


#: 必須跟 `StudentStationRewardLog.station` 的 `String(50)` 欄寬一致
#: （app/models/word_baby.py）——這裡重複宣告一份常數，不是從 model 讀
#: column.type.length，因為這是「業務規則該在哪一層擋」的問題（見下方
#: award_station_rewards 的用法），不是單純避免寫死數字。
_STATION_COLUMN_MAX_LENGTH = 50


# ── 獎勵判定（完成一個站時呼叫） ──────────────────────────────────────────

def award_station_rewards(
    db: Session,
    *,
    student_id: int,
    lesson_uid: str,
    station: str,
    now: datetime | None = None,
    rng: _RandomSource | None = None,
) -> StudentStationRewardLog | None:
    """完成一個站時呼叫——冪等：`student_station_reward_log` 的唯一鍵
    (student_id, lesson_uid, station) 已經有紀錄就直接回傳，不重算、不重發。

    這是整個獎勵系統「同一站只能發一次」的保證來源，不是靠 rng 的任何性質。

    **無效 station 回傳 `None`，不寫任何 log 列**（security review finding，
    2026-10-27）：舊版本對「不在 15 種站對照表裡」的 station 仍然寫一筆
    `fragment_awarded=False` 的 log，理由是「保持冪等」——但一個從沒發生過
    的無效站根本沒有東西需要保持一致，寫這筆 log 只是留下噪音，還可能讓
    呼叫端誤以為這個 station「已經判定過」。兩種無效一視同仁走同一條路：
    (a) 字串長度超過 DB 欄位上限（`String(50)`，惡意/亂丟的 client 可能送
    任意長字串，要在碰到 DB 之前就擋掉，不是讓它截斷或炸錯）；
    (b) 不在 `word_baby_config` 的 15 站對照表裡。
    """
    now = now or _now()
    rng = rng or _default_rng()

    if len(station) > _STATION_COLUMN_MAX_LENGTH:
        return None
    if config.get_station_flavor(station) is None:
        return None

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
    # `award_station_rewards`（唯一呼叫端）已經在呼叫這裡之前擋掉長度超限
    # 跟不在 15 站對照表裡的 station，所以這裡的 flavor 保證不是 None——
    # 不再需要「無效站也寫一筆 log」的分支（security review finding，
    # 2026-10-27：那個分支已經被判定為不該存在，見上層函式的 docstring）。
    flavor = config.get_station_flavor(station)
    assert flavor is not None, (
        f"_determine_and_insert_reward 只能在 station={station!r} 已通過"
        f" award_station_rewards 的有效性檢查後呼叫"
    )

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
    """把 `amount` 片碎片加進這個學生這個口味的背包。

    **用資料庫端的原子加法，不用 Python 端的 read-modify-write**（security
    review finding，2026-10-27）：舊版本先 `.query().first()` 讀出目前
    quantity，在 Python 把它加 amount，等 flush/commit 才真正送出 UPDATE——
    兩個幾乎同時的請求可能都在對方 commit 之前讀到同一個舊值，後 commit 的
    那個會用自己算出來的字面值覆蓋掉前一個已經寫入的結果，其中一次加法就
    這樣遺失了。改成 `UPDATE ... SET quantity = quantity + :amount`：這個
    算式在 UPDATE 陳述式**本身**裡求值，用的是這個陳述式真正執行當下資料庫
    裡的值，不是 Python 這邊某個時間點快照下來的舊值——兩個請求不管誰先誰
    後，最後都會正確疊加，不會有一個被另一個蓋掉。
    """
    wallet = (
        db.query(StudentFragmentWallet)
        .filter_by(student_id=student_id, flavor=flavor)
        .first()
    )
    if wallet is None:
        # 第一次拿到這個口味——先建一列、立刻 flush，讓它在 DB 裡有實體列
        # 可以被下面的原子 UPDATE 命中。兩個請求同時都想第一次建這個口味列
        # 的話，會在這裡的 flush 撞 UniqueConstraint(student_id, flavor)
        # 丟 IntegrityError——這個函式的唯一呼叫端（`award_station_rewards`
        # 整段判定）已經包在外層的 `db.begin_nested()` + `except IntegrityError`
        # 復原機制裡，不是這個函式自己要處理的範圍。
        wallet = StudentFragmentWallet(student_id=student_id, flavor=flavor, quantity=0)
        db.add(wallet)
        db.flush()

    db.execute(
        sa_update(StudentFragmentWallet)
        .where(
            StudentFragmentWallet.student_id == student_id,
            StudentFragmentWallet.flavor == flavor,
        )
        .values(quantity=StudentFragmentWallet.quantity + amount)
    )
    # 上面這行是直接送 SQL，不經過 ORM 的屬性追蹤——`wallet` 這個 Python
    # 物件手上的 quantity 現在是執行前的舊快照。把它標記為過期，下次誰在
    # 這個 session 裡存取 `wallet.quantity` 時會強制重新查一次，不會沿用
    # 這個已經跟不上的值。
    db.expire(wallet, ["quantity"])


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
    db: Session,
    state: StudentWordBabyState,
    baby: dict,
    now: datetime,
    *,
    is_care_action: bool,
    persist: bool = True,
) -> dict:
    """讀取時或照顧動作發生時都呼叫——計算當下的虛弱狀態，並視情況把孵化天數
    的累積、甚至孵化完成（進入下一階段）寫回去。回傳算出來的「當下顯示值」，
    不管有沒有寫回 DB 呼叫端都該用這個，不要再去讀 `state.*`（`persist=False`
    時 `state.*` 不會被更新，繼續讀它會拿到舊值）。

    `is_care_action=False`（純讀取）：孵化天數的「新增量」只拿來算 live 顯示值，
    **不寫回** state.hatch_progress_days（否則連續多次讀取、`last_cared_at` 沒變，
    會重複累加同一段區間）——除非這次新增量剛好讓牠孵化完成，孵化本身是一次性
    的狀態轉換，發現了就寫回去，不管是不是因為讀取才發現的。
    `is_care_action=True`：這次呼叫本身就代表「有一個照顧動作發生」，累積量連同
    `last_cared_at = now` 一起寫回去，之後的評估從這個新基準重新算，不會跟這次
    重複計算。

    `persist`（security review finding，2026-10-27）：是否把算出來的狀態轉換
    真的寫進 `state` 物件（進而落到 DB）。**查詢「我的寶貝」這支 API 本人、
    任課老師、連結的家長都能看**（`verify_student_access`），但孵化完成這種
    一次性狀態轉換**只有本人的讀取才該觸發落地**——老師或家長恰好先讀到、
    不該搶先把學生自己還沒看到的孵化結果寫進 DB。`persist=False` 時這裡只
    計算、回傳 live 顯示值，完全不碰 `state.*` 的任何屬性，確保呼叫端即使
    手滑忘記檢查也不會不小心把它 flush/commit 出去。
    """
    care = config.load_care()
    paused_periods = care["paused_periods"]

    weaken_state = compute_weaken_state(
        state.last_cared_at,
        now,
        weaken_after_days=care["weaken_after_days"],
        deep_sleep_after_days=care["deep_sleep_after_days"],
        paused_periods=paused_periods,
    )

    stage_index = state.stage_index
    dormant_type = state.dormant_type
    dormant_started_at = state.dormant_started_at
    hatch_progress_days = state.hatch_progress_days
    fed_current_stage = state.fed_current_stage
    fed_by_flavor = state.fed_by_flavor
    # 前端「蛋/繭/冬眠倒數」用（2026-10-27）：還要幾個有效天數才孵化。
    # None = 現在不是休眠狀態（含「這次讀取剛好孵化完成」——孵化完成那一刻
    # dormant_type 已經清掉，不該再顯示一個孵化前的倒數字）。
    hatch_days_remaining: int | None = None

    if dormant_type is not None:
        credit = effective_hatch_credit(
            state.last_cared_at, now,
            weaken_after_days=care["weaken_after_days"],
            paused_periods=paused_periods,
        )
        live_hatch_progress = hatch_progress_days + credit

        stage = baby["stages"][stage_index - 1]
        required = stage["dormancy_after_this_stage"]["hatch_days"]
        if live_hatch_progress >= required:
            stage_index += 1
            dormant_type = None
            dormant_started_at = None
            hatch_progress_days = 0
            fed_current_stage = 0
            fed_by_flavor = None
        else:
            hatch_days_remaining = required - live_hatch_progress
            if is_care_action:
                hatch_progress_days = live_hatch_progress

    if persist:
        state.weaken_state = weaken_state
        state.stage_index = stage_index
        state.dormant_type = dormant_type
        state.dormant_started_at = dormant_started_at
        state.hatch_progress_days = hatch_progress_days
        state.fed_current_stage = fed_current_stage
        state.fed_by_flavor = fed_by_flavor
        if is_care_action:
            state.last_cared_at = now

    return {
        "weaken_state": weaken_state,
        "stage_index": stage_index,
        "dormant_type": dormant_type,
        "dormant_started_at": dormant_started_at,
        "hatch_progress_days": hatch_progress_days,
        "fed_current_stage": fed_current_stage,
        "fed_by_flavor": fed_by_flavor,
        "hatch_days_remaining": hatch_days_remaining,
    }


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

    # security review finding（2026-10-27）：餵食會先讀這隻寶貝跟整個錢包的
    # 目前狀態，再用 Python 迴圈判斷扣多少、要不要進化——這整段判斷中間，
    # 如果同一個學生從另一個請求（例如開兩個分頁同時按餵食）也在跑同一段
    # 邏輯，兩邊各自讀到「扣之前」的快照，可能兩邊都判定「扣得動」，實際上
    # 背包只夠一邊扣。`with_for_update()` 讓這兩筆列在 Postgres 正式環境下
    # 用真正的資料庫列鎖排隊——第二個請求的查詢會等第一個請求 commit 之後
    # 才拿到最新的值，不會兩邊都拿到同一份舊快照。（SQLite 測試環境下這個
    # 呼叫是靜默 no-op，不影響測試結果——已經直接測過，見
    # TestFeedBabyUsesRowLockingInProduction。）
    state = (
        db.query(StudentWordBabyState)
        .filter_by(student_id=student_id, baby_id=baby_id)
        .with_for_update()
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
        for w in db.query(StudentFragmentWallet)
        .filter_by(student_id=student_id)
        .with_for_update()
        .all()
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

def get_my_pets(
    db: Session, *, student_id: int, viewer_is_student: bool, now: datetime | None = None
) -> dict:
    """組出「我的寶貝」頁要的資料：擁有的寶貝（含即時推算的虛弱狀態、是否剛
    孵化完成）、碎片背包、M/100 K/300 進度統計。讀取時就地推算，**只有本人
    讀取才會把孵化完成等狀態轉換寫回去**（lazy evaluation，不用排程）。

    `viewer_is_student`（security review finding，2026-10-27）：這支查詢本人、
    任課老師、連結的家長都能呼叫（路由層的 `verify_student_access`），但孵化
    完成這種一次性狀態轉換不該被「剛好是老師或家長先讀到」搶先寫進 DB——
    只有 `viewer_is_student=True`（學生讀自己的資料）才會真的 persist；老師
    /家長讀取只計算正確的 live 顯示值，不碰 DB 的任何一列。回傳的 payload
    內容對兩種情況完全一樣（顯示值永遠是當下算出來的最新值），差別只在
    DB 有沒有被寫入。
    """
    now = now or _now()

    states = db.query(StudentWordBabyState).filter_by(student_id=student_id).all()
    live_by_row_id = {
        state.id: _sync_care_state(
            db, state, baby, now, is_care_action=False, persist=viewer_is_student
        )
        for state in states
        if (baby := config.get_baby(state.baby_id)) is not None
    }
    if viewer_is_student:
        db.flush()

    wallet_rows = db.query(StudentFragmentWallet).filter_by(student_id=student_id).all()

    total_fragments_collected = sum(w.quantity for w in wallet_rows)  # 目前手上還有的，不是累計總量
    babies_payload = []
    for state in states:
        baby = config.get_baby(state.baby_id)
        if baby is None:
            continue
        live = live_by_row_id[state.id]
        babies_payload.append({
            "baby_id": state.baby_id,
            "name": baby["name"],
            "rarity": baby["rarity"],
            "stage_index": min(live["stage_index"], baby["stage_count"]),
            "stage_count": baby["stage_count"],
            "fully_grown": live["stage_index"] > baby["stage_count"],
            "dormant_type": live["dormant_type"],
            "weaken_state": live["weaken_state"],
            "fed_current_stage": live["fed_current_stage"],
            "hatch_days_remaining": live["hatch_days_remaining"],
            "fed_by_flavor": live["fed_by_flavor"],
            "caught_at": state.caught_at,
        })

    return {
        "babies": babies_payload,
        "babies_owned_count": len(babies_payload),
        "babies_total_species": len(config.load_babies()),
        "wallet": {w.flavor: w.quantity for w in wallet_rows},
        "fragments_in_wallet": total_fragments_collected,
    }
