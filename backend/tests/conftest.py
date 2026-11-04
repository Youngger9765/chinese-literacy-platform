import pytest
import os as _os
import sys as _sys
# 讓 `from _module_files import ...` 在任何 rootdir 下都找得到（#2916）。
# tests/ 不是 package，pytest 的 rootdir 會變，靠相對 import 不穩。
_sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__)))

"""
Shared test configuration.

Patches PostgreSQL-specific column types (JSONB) to SQLite-compatible types (JSON)
before table creation, so all tests can use SQLite in-memory databases.

Also patches server_default values that contain PostgreSQL-specific syntax (::jsonb casts)
which SQLite cannot parse, and mirrors PostgreSQL partial-index predicates to
SQLite partial indexes.
"""
import json
import sys
import os

# Allow running pytest from the repo root or from backend/
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlalchemy import JSON
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.schema import DefaultClause
from app.models import Base
# One implementation, shared with specs/conftest.py — see that module's docstring
# for what happened when there were two.
from test_support.sqlite_compat import _apply_sqlite_metadata_patches


_original_create_all = Base.metadata.create_all


def _create_all_with_sqlite_patches(*args, **kwargs):
    _apply_sqlite_metadata_patches()
    return _original_create_all(*args, **kwargs)


Base.metadata.create_all = _create_all_with_sqlite_patches

# Run once at import time, before any test creates tables.
_apply_sqlite_metadata_patches()


# ── #3838 AI kill switch — default ON for the test suite ───────────────────
# Production defaults to OFF (AI_FEATURES_ENABLED absent = disabled, see
# app/services/ai_feature_flag.py) — a security-incident response so Vertex
# AI is never called unless an operator explicitly opts back in. Tests
# default to ON so the many existing test files that mock
# generate_structured_response / genai.Client and assert on the AI code
# path's *behaviour* keep exercising that code, instead of getting a
# blanket 503 from a kill switch they were never written to know about.
# Tests that specifically exercise the kill switch itself
# (test_ai_killswitch_3838.py) override this per-test with their own
# monkeypatch.setenv/delenv, which takes precedence within that test.
@pytest.fixture(autouse=True)
def _ai_features_enabled_by_default(monkeypatch):
    monkeypatch.setenv("AI_FEATURES_ENABLED", "true")


def pytest_runtest_setup(item):
    """Reset rate limiters before each test (including module-scoped fixtures).

    Using a hook instead of a fixture ensures the reset happens before
    module-scoped fixtures that call /api/auth/register.
    """
    from app.routes.auth import rate_limiter
    rate_limiter.reset()
    # Also reset the global per-IP rate limiter so tests don't hit 429
    try:
        from app.auth.rate_limiter import general_rate_limiter
        general_rate_limiter.reset()
    except (ImportError, AttributeError):
        pass
    try:
        from app.routes.classrooms.classroom_crud import join_preview_rate_limiter
        join_preview_rate_limiter.reset()
    except (ImportError, AttributeError):
        pass
    try:
        from app.routes.classrooms.classroom_junyi_import import _junyi_import_rate_limiter
        _junyi_import_rate_limiter.reset()
    except (ImportError, AttributeError):
        pass
    # #3171: ai_rate_limiter / tts_rate_limiter 原本漏在這裡之外。
    #
    # ai_rate_limiter 是模組層全域，key 是 `ai:{get_client_key(request)}`，而在
    # TestClient 底下那個 key 對整套測試是同一個 —— 所以幾千支測試共用同一個預算。
    # 它讓 PR #3170 的 CI 紅在一支跟那個 PR 毫無關係的測試上：老師端
    # generate-ai-comment 掛 ai_limit_5_per_min（5 次／分鐘）而它自己要連打兩次，
    # 於是前一分鐘內任何別的測試碰過 AI 端點就 429。同一份 code 本機全套是綠的。
    #
    # 不是某個 PR 弄壞的，是誰動到執行順序或耗時就會中獎 —— 而紅的地方跟改動無關，
    # 看的人第一反應會是「CI 又壞了」。
    #
    # tts_rate_limiter 是同一個形狀、只是還沒中獎，所以一起補，不要只補咬到人的那個。
    # 盤點鎖在 tests/test_rate_limiter_isolation_3171.py，新增限流器忘了補這裡會紅。
    try:
        from app.auth.rate_limiter import ai_rate_limiter, tts_rate_limiter
        ai_rate_limiter.reset()
        tts_rate_limiter.reset()
    except (ImportError, AttributeError):
        pass
    try:
        # #3551: per-user join-code-guessing guard — same #3171 shape, same fix.
        from app.routes.live_quiz import _join_rate_limiter
        _join_rate_limiter.reset()
    except (ImportError, AttributeError):
        pass


# ── 測試不准打真的 GCS ──────────────────────────────────────────────────────
# test_omo_upload / test_omo_dedup 直接打 /api/omo/upload，而那條路會把圖片
# 真的傳上 GCS —— socket 稽核量到 80 次對外連線（142.250.x / 173.194.x），
# 每一次都在寫真的 bucket。這些測試在乎的是去重與狀態機，不是儲存本身。
#
# 三個入口都要擋：upload 綁 _upload_to_gcs、lifecycle 綁 _get_signed_url，
# 以及 upload 之後 background_tasks 排的 _run_identification —— 那支會真的
# 送圖去 Gemini 辨識。擋掉前兩個之後仍有 20 次外連，就是它。
# patch 打在**綁名字的那個模組**，不是 services.omo_storage —— 打後者不會
# 影響已經 import 進去的名字（這輪已經因為同一件事踩過三次）。
@pytest.fixture(autouse=True)
def _no_real_gcs():
    from unittest.mock import patch

    with patch("app.routes.omo.upload._upload_to_gcs",
               side_effect=lambda uid, upload_id, attempt, idx, data, mime:
                   f"{uid}/{upload_id}/{attempt}/{idx}.jpg"), \
         patch("app.routes.omo.lifecycle._get_signed_url",
               return_value="https://example.invalid/signed-test-url"), \
         patch("app.routes.omo.upload._run_identification", return_value=None):
        yield


# ── 測試一律不准對外連線 ────────────────────────────────────────────────────
# 稽核量到 23 支測試共發出 91 次對外連線（Gemini / GCS / Google TTS）。每一次
# 都在花錢、都會 flaky，而且有些測試**是靠真的呼叫成功才綠的** —— CI 沒有憑證
# 所以在那裡是紅的，那個綠是假的（實例：TTS regenerate 靠本機 ADC 打真 Google）。
#
# 擋板讓這件事不可能再發生：連出去就當場失敗，訊息指名是哪一支。要測外部服務
# 的行為就 mock 它；真的需要連線的測試自己標 @pytest.mark.allow_network。
_ALLOWED_HOST_PREFIXES = ("127.", "::1", "localhost")


@pytest.fixture(autouse=True)
def _no_outbound_network(request):
    import socket

    if request.node.get_closest_marker("allow_network"):
        yield
        return

    real_connect = socket.socket.connect

    def guarded(sock, address):
        host = str(address[0]) if isinstance(address, tuple) and address else ""
        if host and not host.startswith(_ALLOWED_HOST_PREFIXES):
            raise AssertionError(
                f"{request.node.nodeid} tried to reach {host} — tests must not "
                f"call real services. Mock it, or mark the test "
                f"@pytest.mark.allow_network if the call is the point."
            )
        return real_connect(sock, address)

    socket.socket.connect = guarded
    try:
        yield
    finally:
        socket.socket.connect = real_connect


# ── 測試不准寫入正式的例句快取檔（Issue #3803）──────────────────────────────
# app.services.example_sentence_cache 模組層的 `_cache_path` 預設指向
# backend/data/example_sentence_cache.json —— 那是隨部署上線的正式資料檔。
# 任何測試打中 /learning/sentence-practice/example-sentences 的 cache miss
# 路徑、又沒有把 get_cached/set_cached 整組 mock 掉（例如
# tests/test_sentence_practice.py::TestExampleSentences::
# test_example_sentences_returns_two_sentences），set_cached 就會把 AI mock
# 回的假例句寫進這個正式檔。
#
# 每個測試一律先把 `_cache_path` 轉到這次測試自己的 tmp 檔，測試本身與它呼叫
# 到的任何路由都只碰得到這個 tmp 檔。不做 teardown 復原——下一個測試的
# setup 會在它開始前就再轉一次，正式路徑沒有曝光的空檔。
@pytest.fixture(autouse=True)
def _isolated_example_sentence_cache(tmp_path):
    from app.services import example_sentence_cache as _esc

    _esc._reset(path=str(tmp_path / "example_sentence_cache_test.json"))
    yield


# ── 正式的例句快取檔跑完整套測試後內容不能變（Issue #3803）─────────────────
# backend/data/example_sentence_cache.json 會隨部署上線。它是
# app.services.example_sentence_cache 模組層 `_cache_path` 的預設值，任何
# 測試只要打中 cache miss 又沒有把 get_cached/set_cached 導去別的路徑，就會
# 把假例句寫進這個正式檔 —— 跑完 `git status` 看得到它被改，有人
# `git add -A` 就會把測試資料部署上線。
#
# 這是 session 範圍的回歸鎖：記住套件開跑前的 hash，全部測試跑完再比一次。
# 任何測試（含未來新增的）只要讓這個檔案變動，這裡就會跑完整套後才失敗——
# 不靠記得幫每一支新測試都做隔離。
@pytest.fixture(scope="session", autouse=True)
def _example_sentence_cache_file_untouched():
    import hashlib

    from app.services import example_sentence_cache as _esc

    cache_path = _esc.DEFAULT_CACHE_PATH

    def _hash():
        if not os.path.exists(cache_path):
            return None
        with open(cache_path, "rb") as f:
            return hashlib.sha256(f.read()).hexdigest()

    before = _hash()
    yield
    after = _hash()
    assert after == before, (
        "backend/data/example_sentence_cache.json changed during the test "
        f"run (sha256 before={before}, after={after}). This file ships with "
        "deploys — tests must never write to it (Issue #3803)."
    )
