"""文字寶貝養成系統 — 照顧/虛弱/孵化天數的純函式邏輯（#3780）。

Team-lead：「照顧和虛弱：不用排程，讀取時依 last_cared_at 推算目前狀態（lazy
evaluation）。寒暑假的規則照 care.json。」

這份檔案只放**純函式**（輸入時間戳、輸出狀態/天數，不碰 DB、不讀 config），
方便單獨測試；呼叫端（`word_baby_service.py`）負責讀 `care.json` 的實際門檻值
並把結果寫回/讀出 `StudentWordBabyState`。

⚠️ **已知的簡化**（跟 docs/design/word-babies/design.md §8 原始文字略有出入，
在這裡誠實記下來，不是沒看過設計文件）：design.md 描述「週六週日也不計入沒上線
天數」，隱含「平日跟假日的孵化天數可能分開算」。這裡的實作簡化成**只排除
paused_periods（寒暑假），週六週日照常計算**（跟平日一樣、正常累積孵化進度、
也正常計入沒上線天數）——這份文件在 2026-10-26 模擬腳本的驗證裡其實就是這樣
跑的（`simulate_balance.py` 的每日迴圈沒有排除週末），所以這裡是跟「已經驗證過
的那套平衡數字」保持一致，不是另外發明一套。寒暑假的排除（真正量體大、真正
必要的那個）有做對；週末這個簡化的影響很小（5 天虛弱門檻本來就比 2 天週末寬裕
很多），这里不為了它另外疊一層複雜度。
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone


def _as_utc(dt: datetime) -> datetime:
    """防呆：SQLite 測試環境下，`server_default=func.now()` 回填的時間戳讀回來
    是 naive（沒有 tzinfo）——即使欄位型別是 `DateTime(timezone=True)`，SQLite
    本身沒有真正的時區型別，這個宣告在它身上是沒作用的（Postgres 正式環境沒有
    這個問題，psycopg 讀回來一定帶 tzinfo）。這裡一律假設沒帶 tzinfo 的時間戳是
    UTC（整個系統只用 `datetime.now(timezone.utc)`，沒有別的時區來源），補上
    tzinfo 再做運算，避免 `TypeError: can't compare offset-naive and
    offset-aware datetimes` 這種跟『哪個環境建的這筆資料』有關、很難除錯的炸裂。
    """
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def _parse_md(md: str) -> tuple[int, int]:
    """'--07-01' -> (7, 1)"""
    m, d = md.lstrip("-").split("-")
    return int(m), int(d)


def is_in_paused_period(d: date, paused_periods: list[dict] | None) -> bool:
    """d 落不落在任一個 paused_period 裡（年份無關，只比對月-日，見 care.json 的
    '--MM-DD 代表每年都套用' 說明）。跨年份的區間（如寒假 1/15~2/20 不跨年、
    暑假 7/1~8/25 不跨年）用簡單的月-日比較即可，兩個預設區間都不跨年底。"""
    if not paused_periods:
        return False
    md = (d.month, d.day)
    for period in paused_periods:
        start = _parse_md(period["start"])
        end = _parse_md(period["end"])
        if start <= md <= end:
            return True
    return False


def effective_hatch_credit(
    old_cared_at: datetime,
    now: datetime,
    *,
    weaken_after_days: int,
    paused_periods: list[dict] | None = None,
) -> int:
    """共用公式：從 old_cared_at 到 now 之間，真正該計入孵化進度的天數。

    這一個函式同時服務兩種呼叫情境（design.md §8 要求兩者用同一套公式才會一致）：
    ① 讀取時的即時顯示（不寫回 DB，old_cared_at = 目前存的 last_cared_at）
    ② 真的發生照顧動作時要寫回的累積量（old_cared_at = 動作發生前存的 last_cared_at，
       now = 動作發生的時間，算完這次呼叫就會把 last_cared_at 更新成 now）

    規則：
    - 超過 old_cared_at + weaken_after_days 之後的天數不計入（「暫停」語意——
      學生消失很久，不會因此「倒賺」很多孵化天數）
    - 落在 paused_periods（寒暑假）裡的天數整天跳過，不計入也不會讓虛弱時鐘前進
    """
    old_cared_at = _as_utc(old_cared_at)
    now = _as_utc(now)
    if now <= old_cared_at:
        return 0

    boundary = old_cared_at + timedelta(days=weaken_after_days)
    end = min(now, boundary)
    if end <= old_cared_at:
        return 0

    count = 0
    cur = old_cared_at.date()
    end_date = end.date()
    one_day = timedelta(days=1)
    d = cur + one_day
    while d <= end_date:
        if not is_in_paused_period(d, paused_periods):
            count += 1
        d += one_day
    return count


def compute_weaken_state(
    last_cared_at: datetime,
    now: datetime,
    *,
    weaken_after_days: int,
    deep_sleep_after_days: int,
    paused_periods: list[dict] | None = None,
) -> str:
    """回傳 "healthy" / "weak" / "deep_sleep"——依「扣掉寒暑假之後的有效天數」
    跟兩個門檻比較，不是直接拿日曆天數比（否則暑假期間會被誤判虛弱，見
    design.md §8「寒暑假怎麼處理」）。"""
    last_cared_at = _as_utc(last_cared_at)
    now = _as_utc(now)
    if now <= last_cared_at:
        return "healthy"

    effective_days = _effective_elapsed_days(last_cared_at, now, paused_periods)
    if effective_days <= weaken_after_days:
        return "healthy"
    if effective_days <= deep_sleep_after_days:
        return "weak"
    return "deep_sleep"


def _effective_elapsed_days(
    start: datetime, end: datetime, paused_periods: list[dict] | None
) -> int:
    """不設 boundary 的版本（跟 effective_hatch_credit 不同——這裡要算「虛弱了
    多久」本身，不是「該記多少孵化天數」，所以不能先用 weaken_after_days 把自己
    截斷，否則 compute_weaken_state 永遠量不到超過門檻的情況）。"""
    if end <= start:
        return 0
    count = 0
    cur = start.date()
    end_date = end.date()
    one_day = timedelta(days=1)
    d = cur + one_day
    while d <= end_date:
        if not is_in_paused_period(d, paused_periods):
            count += 1
        d += one_day
    return count
