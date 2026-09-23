"""AI 限流的預算必須逐端點分開（#3300）。

## 為什麼這條鎖存在

prod 實測（30 天）：`POST /api/learning/sessions/:id/exit-ticket/generate`
53 次呼叫裡 **5 次回 429（9.4%）** —— 學生按出場券被擋掉。

不是因為他重複產生了 5 次出場券。`make_ai_rate_limit_dependency()` 產生的每一個
dependency（不論宣告 5 還是 10）都寫進**同一個** module-level `ai_rate_limiter`，
而 key 是 `ai:{get_client_key(request)}` —— **不含端點、也不含層級**。
目前掛在這顆共用水桶上的端點有 15 支（comprehension×3、reading evaluate/transcribe、
mcq-rescue×2、save-audio、learning-strategy、vocab×2、comprehension-score、
ai-analysis×2、teacher-reports、exit-ticket）。

真實流程裡「重點朗讀 → 理解題 → 生字 → 出場券」是同一個 session 內幾十秒的連續動作，
前面幾步（reading evaluate/transcribe 常一次 attempt 打 2–3 次）很容易在 60 秒內
把共用桶用掉，於是學生**第一次**打出場券就 429。

⚠️ TTS 是唯一有獨立 store 的（`tts_rate_limiter`），它的註解寫得很清楚：
   「isolated from the shared ai_rate_limiter so that TTS bursts do NOT consume
   the socratic/comprehension/reading quota」。其餘 15 支從來沒有這層隔離。

⚠️ #3171 的測試檔註解**已經寫出了**這個共用 key 的事實，但它把那當成「測試之間要重設
   限流器」的問題處理，沒有發現真實使用者也共用同一顆桶。

## 為什麼測限流器與 dependency，不走 HTTP

要鎖的性質是「**預算是不是逐端點分開**」。直接對 dependency 斷言是決定性的：不需要 auth、
不呼叫 LLM、不吃真的時間窗，所以這條鎖自己不會變成另一支 flake（同 #3171 的理由）。

⛔ key 必須用**模板化路徑**（`/sessions/{session_id}/…`）而不是真實路徑 ——
   真實路徑含 session id，會讓每個 session 各自一桶，等於沒有限流，而且 key 無限長大。
"""
import pytest
from fastapi import HTTPException

from app.auth.rate_limiter import ai_rate_limiter, make_ai_rate_limit_dependency


class _Route:
    def __init__(self, path: str):
        self.path = path


class _FakeRequest:
    """最小的 Request 替身：限流只用到 route、client 與 state/headers。"""

    def __init__(self, route_path: str, user_id: int = 7):
        self.scope = {"route": _Route(route_path)}
        self._route_path = route_path

        class _C:
            host = "10.0.0.1"

        self.client = _C()
        self.headers = {}

        class _S:
            pass

        self.state = _S()
        self.state.user_id = user_id

    @property
    def url(self):
        class _U:
            path = self._route_path
        u = _U()
        u.path = self._route_path
        return u


_EXIT_TICKET = "/api/learning/sessions/{session_id}/exit-ticket/generate"
_TRANSCRIBE = "/api/reading/transcribe"


@pytest.fixture(autouse=True)
def _clean():
    ai_rate_limiter._store.clear()
    yield
    ai_rate_limiter._store.clear()


def test_one_endpoint_exhausting_its_budget_does_not_block_another():
    """把 transcribe 的額度打爆，出場券的**第一次**呼叫仍然要通過。

    這就是 prod 那 9.4% 的形狀：學生不是重複按出場券，是前面的步驟用掉了配額。
    """
    strict = make_ai_rate_limit_dependency(max_requests=5, window_seconds=60)
    loose = make_ai_rate_limit_dependency(max_requests=10, window_seconds=60)

    # 前面的步驟（同一個學生）把 transcribe 打到上限
    for i in range(10):
        loose(_FakeRequest(_TRANSCRIBE))

    # 學生接著第一次按出場券 —— 不該被擋
    try:
        strict(_FakeRequest(_EXIT_TICKET))
    except HTTPException as e:
        pytest.fail(
            f"出場券的第一次呼叫被擋掉了（HTTP {e.status_code}）—— "
            f"預算跟其他端點共用，這正是 prod 那 5/53 個 429"
        )


def test_the_same_endpoint_is_still_limited():
    """對照組：逐端點分開之後，**同一支端點**照樣要限得住。

    少了這一條，把 key 改成「每次呼叫都不同」也會讓上面那條變綠 —— 那等於沒有限流。
    """
    strict = make_ai_rate_limit_dependency(max_requests=5, window_seconds=60)
    for i in range(5):
        strict(_FakeRequest(_EXIT_TICKET))
    with pytest.raises(HTTPException) as got:
        strict(_FakeRequest(_EXIT_TICKET))
    assert got.value.status_code == 429


def test_the_key_uses_the_templated_path_not_the_concrete_one():
    """不同 session 的同一支端點必須共用同一顆桶。

    ⛔ 用真實路徑（含 session id）當 key 的話，換一個 session 就換一顆桶 ——
       限流形同虛設，而且 key 會無限長大。
    """
    strict = make_ai_rate_limit_dependency(max_requests=5, window_seconds=60)
    for i in range(5):
        strict(_FakeRequest(_EXIT_TICKET))
    # 同一支端點、同一個學生、不同 session → 仍該被擋
    with pytest.raises(HTTPException):
        strict(_FakeRequest(_EXIT_TICKET))
    keys = [k for k in ai_rate_limiter._store if "exit-ticket" in k]
    assert len(keys) == 1, f"應該只有一顆桶，實際 {len(keys)}：{keys}"
