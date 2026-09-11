"""模組層限流器必須在每支測試之前重設（#3171）。

## 為什麼這條鎖存在

`conftest.py` 的 `pytest_runtest_setup` 會在每支測試前重設限流器，但原本只重設了
五個模組層實例裡的三個。漏掉的兩個之中，`ai_rate_limiter` 讓 PR #3170 的 CI 紅在
一支跟那個 PR 毫無關係的測試上：

    FAILED tests/test_teacher_api.py::TestTeacherSessionReportReviewContract
           ::test_generate_ai_comment_uses_cached_comment_without_second_model_call
    E   AssertionError: {"detail":"AI endpoint rate limit exceeded. Please wait before retrying."}
    E   assert 429 == 200

同一份 code 在本機全套跑是綠的（3981 passed / 0 failed）。

`ai_rate_limiter` 是**模組層全域**，key 是 `ai:{get_client_key(request)}`，而在
TestClient 底下那個 key 對整套測試是同一個 —— 所以幾千支測試共用同一個預算。
那支失敗的測試打的端點掛 `ai_limit_5_per_min`（5 次／分鐘）而它自己就要連打兩次，
於是**只要前一分鐘內任何別的測試碰過任何 AI 限流端點，它就 429**。

不是某個 PR 弄壞的，是誰動到執行順序或耗時就會中獎。這種隨機紅燈比沒有燈更糟 ——
紅的地方跟改動無關，看的人第一反應是「CI 又壞了」而不是「我弄壞了什麼」。

## 這裡為什麼測限流器本身，不走 HTTP 端點

要鎖的性質是「**那個全域物件在測試之間是乾淨的**」，不是某條路由的行為。直接對限流器
斷言可以是決定性的：不需要 auth、不會呼叫 LLM、不吃真的時間窗，也就不會自己變成
另一支 flake。走端點反而會把這條鎖的紅綠綁在別人的路由設定上。

## 這組是順序相依的配對，順序不可以調換

`test_a_*` 先把額度打爆，`test_b_*` 期待乾淨。pytest 在同一個檔案裡按定義順序跑，
所以 `a` 一定先於 `b`。⛔ 不要改名字破壞這個順序，也不要把它們合成一支 ——
合成一支之後 conftest 的重設就只會在那一支之前跑一次，**鎖的東西就變了**。
"""
import pytest

from app.auth.rate_limiter import ai_rate_limiter, tts_rate_limiter

AI_KEY = "ai:isolation-probe-3171"
TTS_KEY = "ai:tts:user:987654"
BUDGET = 5
WINDOW = 60


class TestAiRateLimiterIsolation:
    def test_a_exhaust_the_ai_budget(self):
        """先把額度打爆。順帶當正向對照：限流器真的會擋，這條鎖才不是空的。"""
        allowed = [ai_rate_limiter.check(AI_KEY, BUDGET, WINDOW) for _ in range(BUDGET)]
        assert all(allowed), f"前 {BUDGET} 次應該全部放行，實際 {allowed}"
        assert ai_rate_limiter.check(AI_KEY, BUDGET, WINDOW) is False, (
            "第 6 次沒有被擋 —— 限流器本身壞了，那下一支測試的綠什麼都不證明"
        )

    def test_b_next_test_starts_with_a_clean_ai_limiter(self):
        """⭐ 核心：上一支把額度打爆，這一支必須拿到乾淨的限流器。

        沒有 conftest 的重設，這裡會回 False —— 那正是 #3170 撞到的形狀。
        """
        assert ai_rate_limiter.check(AI_KEY, BUDGET, WINDOW) is True, (
            "上一支測試耗掉的額度漏進來了 —— conftest 的 pytest_runtest_setup "
            "沒有重設 ai_rate_limiter。任何在同一分鐘內碰 AI 端點的測試都會隨機 429"
        )


class TestTtsRateLimiterIsolation:
    """`tts_rate_limiter` 是同一個形狀，只是還沒中獎 —— 一起鎖，不要只修咬到人的那個。"""

    def test_a_exhaust_the_tts_budget(self):
        allowed = [tts_rate_limiter.check(TTS_KEY, BUDGET, WINDOW) for _ in range(BUDGET)]
        assert all(allowed), f"前 {BUDGET} 次應該全部放行，實際 {allowed}"
        assert tts_rate_limiter.check(TTS_KEY, BUDGET, WINDOW) is False, "限流器本身沒擋"

    def test_b_next_test_starts_with_a_clean_tts_limiter(self):
        assert tts_rate_limiter.check(TTS_KEY, BUDGET, WINDOW) is True, (
            "conftest 沒有重設 tts_rate_limiter"
        )


def test_every_module_level_limiter_is_reset_by_conftest():
    """盤點鎖：新增一個模組層限流器而忘了在 conftest 重設，這裡要紅。

    上面兩組鎖的是「這兩個實例乾淨」。這一條鎖的是「**清單沒有變長**」——
    否則下一個被加進來的限流器會重演同一齣，而沒有任何測試會叫。
    """
    import os
    import re

    app_dir = os.path.join(os.path.dirname(__file__), "..", "app")
    found = {}
    for root, dirs, files in os.walk(app_dir):
        dirs[:] = [d for d in dirs if d != "__pycache__"]
        for f in files:
            if not f.endswith(".py"):
                continue
            path = os.path.join(root, f)
            with open(path, encoding="utf-8") as fh:
                for line in fh:
                    m = re.match(r"^(\w*rate_limiter\w*)\s*=\s*\w*RateLimiter\(", line.strip())
                    if m:
                        found[m.group(1)] = os.path.relpath(path, app_dir)

    conftest = os.path.join(os.path.dirname(__file__), "conftest.py")
    with open(conftest, encoding="utf-8") as fh:
        conftest_src = fh.read()

    missing = {n: p for n, p in found.items() if f"{n}.reset()" not in conftest_src}
    assert not missing, (
        "這些模組層限流器沒有被 conftest 的 pytest_runtest_setup 重設，"
        f"會讓無關的測試隨機 429：{missing}"
    )
    # 正向對照：掃法真的找得到東西。回 0 個實例代表 regex 壞了，而那會讓上面恆綠。
    assert len(found) >= 4, f"只找到 {len(found)} 個限流器實例 —— 掃法壞了，這條鎖是空的：{found}"
