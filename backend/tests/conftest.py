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
