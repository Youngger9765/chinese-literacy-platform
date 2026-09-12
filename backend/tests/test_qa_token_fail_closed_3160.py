"""QA 看板的 token 閘門要 fail-closed（#3160）。

## 為什麼

`require_qa_token` 的 docstring 第一行寫「fail-closed shared-secret gate」，
但實作是 secret 沒設就 `return`（放行），而 `QA_TOOLS_SHARED_SECRET` 在三份
deploy workflow 裡**都沒設**。所以閘門恆開。

實測（未認證 GET，2026-09-11）：

| 端點 | prod | staging |
|---|---|---|
| `/api/spotlight-qa/reviews` | 200, count 0 | 200, **count 2** |
| `/api/keypoints-qa/reviews`  | 200, count 0 | 200, **count 1** |

staging 的回應帶 `reviewer` 欄位，很可能是老師與實習生本名。帶一個亂的
`x-qa-token` 也是 200，所以是閘門開著、不是猜中 token；而同一台後端的
`/api/classrooms` 回 401，所以不是整台都開。

## 這裡的取捨

原始設計（module docstring）確實把這些看板當成「無認證、靜態頁、人工測試用」。
所以這不是有人忘了設，是選配的加固從沒啟用，而 `reviewer` 欄位後來帶進了真名。

改成 fail-closed **會讓那些看板在 staging 上停止工作**，直到有人把
`QA_TOOLS_SHARED_SECRET` 設進 workflow。我判斷「內部 QA 工具暫時壞掉」
比「公開洩漏老師與實習生姓名」便宜得多。

本機開發（沒有 `K_SERVICE`）維持開著，不然沒人能在本機跑看板。
"""
import pytest
from fastapi import HTTPException

from app.config import settings
import app.auth.qa_tools as qa_tools


def _reload(monkeypatch, **env):
    """Set env + secret for one test, without reloading any module.

    ⛔ The first version of this helper called `importlib.reload` on
    `app.config` and `app.auth.qa_tools`. Do not go back to that. Reloading
    `app.config` replaces the `settings` object, so every other test module
    that did `from app.config import settings` at import time keeps a handle on
    the old one and its patches stop reaching the code under test.

    That is not theoretical: it passed locally (I ran a subset) and failed in
    CI on the full suite, taking `test_spotlight_qa` and `test_keypoints_qa`
    down with it -- 503 where they assert 403. Single-run green, batch red.

    The reload was never needed anyway. `require_qa_token` reads both
    `settings.qa_tools_shared_secret` and `os.environ["K_SERVICE"]` inside the
    function body, so monkeypatching reaches it at call time.
    """
    for k in ("ENVIRONMENT", "K_SERVICE"):
        monkeypatch.delenv(k, raising=False)
    secret = env.pop("QA_TOOLS_SHARED_SECRET", "")
    for k, v in env.items():
        monkeypatch.setenv(k, v)
    monkeypatch.setattr(settings, "qa_tools_shared_secret", secret)
    # qa_tools imported `settings` by value at module import; same object, but be
    # explicit so a future refactor of that import does not silently skip the patch.
    monkeypatch.setattr(qa_tools.settings, "qa_tools_shared_secret", secret)
    # The "open gate" warning is logged once per process; reset so each test is
    # independent of ordering.
    monkeypatch.setattr(qa_tools, "_warned_open", False, raising=False)
    return qa_tools


class TestSecretNotSet:
    """secret 沒設時的行為 —— 這是現在真實的部署狀態"""

    @pytest.mark.parametrize("env", ["production", "staging", "preview"])
    def test_denied_on_cloud_run_when_secret_missing(self, monkeypatch, env):
        """⭐ 已部署的環境沒設 secret → 拒絕。這是 #3160 的核心。"""
        qa = _reload(monkeypatch, ENVIRONMENT=env, K_SERVICE="svc")
        with pytest.raises(HTTPException) as e:
            qa.require_qa_token(x_qa_token=None)
        assert e.value.status_code == 404, "應回 404（此部署不提供看板）而非 401（憑證錯）"

    def test_denied_when_environment_unset_but_on_cloud_run(self, monkeypatch):
        """workflow 忘了設 ENVIRONMENT 也要拒絕 —— 跟 config.py 同樣的 fail-closed"""
        qa = _reload(monkeypatch, K_SERVICE="svc")
        with pytest.raises(HTTPException):
            qa.require_qa_token(x_qa_token=None)

    def test_a_bogus_token_does_not_help(self, monkeypatch):
        """帶亂 token 也不准通 —— 實測 prod 上現在帶亂 token 是 200"""
        qa = _reload(monkeypatch, ENVIRONMENT="staging", K_SERVICE="svc")
        with pytest.raises(HTTPException):
            qa.require_qa_token(x_qa_token="garbage")

    def test_local_dev_stays_open(self, monkeypatch):
        """本機（沒有 K_SERVICE）維持開著，否則沒人能在本機跑看板"""
        qa = _reload(monkeypatch)
        assert qa.require_qa_token(x_qa_token=None) is None


class TestSecretSet:
    """secret 有設時的既有行為，不可退化"""

    def test_matching_token_allowed(self, monkeypatch):
        qa = _reload(monkeypatch, ENVIRONMENT="staging", K_SERVICE="svc",
                     QA_TOOLS_SHARED_SECRET="demo1234")
        assert qa.require_qa_token(x_qa_token="demo1234") is None

    def test_wrong_token_401(self, monkeypatch):
        qa = _reload(monkeypatch, ENVIRONMENT="staging", K_SERVICE="svc",
                     QA_TOOLS_SHARED_SECRET="demo1234")
        with pytest.raises(HTTPException) as e:
            qa.require_qa_token(x_qa_token="changeme")
        assert e.value.status_code == 401

    def test_missing_token_401(self, monkeypatch):
        qa = _reload(monkeypatch, ENVIRONMENT="staging", K_SERVICE="svc",
                     QA_TOOLS_SHARED_SECRET="demo1234")
        with pytest.raises(HTTPException) as e:
            qa.require_qa_token(x_qa_token=None)
        assert e.value.status_code == 401

    def test_secret_set_works_on_local_dev_too(self, monkeypatch):
        """有設 secret 就一律驗，不因為在本機而放寬"""
        qa = _reload(monkeypatch, QA_TOOLS_SHARED_SECRET="demo1234")
        with pytest.raises(HTTPException):
            qa.require_qa_token(x_qa_token=None)


def test_docstring_no_longer_lies(monkeypatch):
    """docstring 說 fail-closed，實作就必須 fail-closed。

    這條存在的理由：原本的實作與它自己的第一行說明相反，而那個矛盾活了下來，
    因為沒有任何東西在比對兩者。
    """
    qa = _reload(monkeypatch, ENVIRONMENT="production", K_SERVICE="svc")
    doc = (qa.require_qa_token.__doc__ or "")
    assert "fail-closed" in doc.lower() or "fail closed" in doc.lower()
    # 正向對照：docstring 讀到了
    assert len(doc) > 50
    with pytest.raises(HTTPException):
        qa.require_qa_token(x_qa_token=None)


class TestRefusalIsNotAnError:
    """拒絕要用 WARNING 記一次，不是每次請求都 ERROR（#3166）。

    #3160 上線時寫成每次拒絕都 `logger.error`。結果部署後兩分鐘就觸發了
    「LingoLeap Backend Errors」警報策略 —— 而觸發它的是我自己驗證用的兩次 curl。

    「secret 沒設」在一個沒人在用看板的服務上是**預期而無害**的狀態，不需要叫醒任何人，
    而且任何掃描器碰到那些路徑都會敲同一個鈴。**會在無害條件下響的警報，會訓練人忽略警報**
    —— 跟誤報的門是同一種病。

    ⚠️ **這一組鎖是必要但不充分的。** 它們只管應用層的 log 等級。部署後實測應用層
    確實零筆 ERROR，而警報照樣又響了一次 —— 因為觸發它的 ERROR 來自 Cloud Run 的
    請求 log（5xx 自動標 ERROR），跟這裡記什麼等級無關。真正讓它安靜的是把狀態碼
    移出 5xx，見 `TestDisabledIsNotAServerError`（#3169）。

    留著這組鎖的理由：log 等級仍然不該是 ERROR，而且它記錄了「只修 log 不夠」這件事。
    """

    def test_refusal_logs_warning_not_error(self, monkeypatch, caplog):
        import logging

        qa = _reload(monkeypatch, ENVIRONMENT="production", K_SERVICE="svc")
        monkeypatch.setattr(qa, "_warned_closed", False, raising=False)
        with caplog.at_level(logging.WARNING):
            with pytest.raises(HTTPException):
                qa.require_qa_token(x_qa_token=None)
        levels = {r.levelno for r in caplog.records}
        assert logging.WARNING in levels, "沒有記下任何 WARNING —— 那就完全沒有訊號了"
        assert logging.ERROR not in levels, (
            "用 ERROR 記錄 —— 那會觸發警報策略，而這個條件是預期的"
        )

    def test_only_logged_once_per_process(self, monkeypatch, caplog):
        """第二次以後不再記錄。否則掃描器一掃就是一串。"""
        import logging

        qa = _reload(monkeypatch, ENVIRONMENT="production", K_SERVICE="svc")
        monkeypatch.setattr(qa, "_warned_closed", False, raising=False)
        with caplog.at_level(logging.WARNING):
            for _ in range(5):
                with pytest.raises(HTTPException):
                    qa.require_qa_token(x_qa_token=None)
        qa_records = [r for r in caplog.records if "QA board" in r.getMessage()]
        assert len(qa_records) == 1, f"記了 {len(qa_records)} 次，應該只有 1 次"

    def test_still_refuses_every_time(self, monkeypatch):
        """只記一次，但**每一次**都要拒絕。

        正向對照：如果為了少記 log 而改成只擋第一次，那就等於沒擋。
        """
        qa = _reload(monkeypatch, ENVIRONMENT="production", K_SERVICE="svc")
        monkeypatch.setattr(qa, "_warned_closed", False, raising=False)
        for i in range(5):
            with pytest.raises(HTTPException) as e:
                qa.require_qa_token(x_qa_token=None)
            # pytest.raises 已經證明它拒絕了 —— 這條檢查的是「用哪個碼拒絕」。
            # 訊息要講狀態碼，講「沒有拒絕」會讓看到紅燈的人去追一個不存在的問題（#3188）。
            assert e.value.status_code == 404, (
                f"第 {i+1} 次拒絕用的是 {e.value.status_code}，應為 404"
                "（5xx 會被 Cloud Run 標成 severity=ERROR 觸發警報，見 #3169）"
            )


class TestDisabledIsNotAServerError:
    """刻意停用要回 4xx，不可回 5xx（#3169）。

    ## 為什麼這條鎖存在

    `#3166` 把拒絕時的 `logger.error` 改成每 process 一次的 `logger.warning`。
    那個修復本身有效 —— 部署後實測應用層（`stderr` log）零筆 ERROR。

    但警報還是響了，因為**觸發它的 ERROR 不是應用層產生的**：

        logName:  projects/lingoleap-dev/logs/run.googleapis.com%2Frequests
        severity: ERROR
        httpRequest.status: 503

    Cloud Run 會把每一筆 **5xx 的請求 log** 自動標成 `severity=ERROR`，
    而警報政策 `LingoLeap Backend Errors` 的條件是
    `severity>=ERROR`，沒有路徑例外也沒有狀態碼例外。

    所以**狀態碼本身就是警報來源**，跟 logger 等級無關。
    改 log 等級永遠修不掉這件事 —— 我上次修到了錯的層。

    實測（prod，過去 24 小時 `httpRequest.status=503`）共 4 筆，
    全部 User-Agent 是 `curl/8.6.0`，也就是全部是我自己的驗證動作；
    沒有任何真實使用者流量走這兩條路徑。

    ## 判斷

    `QA_TOOLS_SHARED_SECRET` 現在是刻意不設的，所以「看板停用」是**預期的當前狀態**。
    用 5xx 回報預期狀態 = 警報在正常狀態下持續響 = 訓練人忽略警報。

    ⚠️ 只改「刻意停用」這一種。GCS 真的掛掉仍然是 5xx（見下方正向對照），
    那是真故障，該叫。
    """

    def test_disabled_is_not_a_5xx(self, monkeypatch):
        """⭐ 核心：停用的狀態碼不能落在 5xx —— 那個範圍就是警報的觸發條件。

        這條斷言故意寫成「不在 5xx」而不是只寫「等於 404」，
        因為會響警報的是整個 5xx 範圍，不是某個特定數字。
        """
        qa = _reload(monkeypatch, ENVIRONMENT="production", K_SERVICE="svc")
        monkeypatch.setattr(qa, "_warned_closed", False, raising=False)
        with pytest.raises(HTTPException) as e:
            qa.require_qa_token(x_qa_token=None)
        code = e.value.status_code
        assert not (500 <= code < 600), (
            f"回了 {code}，落在 5xx —— Cloud Run 會把它標成 severity=ERROR，"
            "而警報政策看的就是 severity>=ERROR。停用是預期狀態，不是伺服器故障。"
        )

    def test_disabled_returns_404(self, monkeypatch):
        """契約：停用回 404（這個部署不提供 QA 看板）。"""
        qa = _reload(monkeypatch, ENVIRONMENT="production", K_SERVICE="svc")
        monkeypatch.setattr(qa, "_warned_closed", False, raising=False)
        with pytest.raises(HTTPException) as e:
            qa.require_qa_token(x_qa_token=None)
        assert e.value.status_code == 404, e.value.detail

    def test_body_says_why_so_404_is_diagnosable(self, monkeypatch):
        """回應本體要講原因 —— 否則 404 跟「打錯路徑」完全分不開。

        這不是形式要求。驗證這次修復時我先後打錯三次路徑，
        每次都拿到 404，而我讀成了別的意思。**狀態碼相同的兩種情況，
        只有本體能區分**，所以驗證一律要看本體。
        """
        qa = _reload(monkeypatch, ENVIRONMENT="production", K_SERVICE="svc")
        monkeypatch.setattr(qa, "_warned_closed", False, raising=False)
        with pytest.raises(HTTPException) as e:
            qa.require_qa_token(x_qa_token=None)
        detail = str(e.value.detail)
        assert "QA_TOOLS_SHARED_SECRET" in detail, (
            f"本體沒有指出是哪個設定缺失：{detail!r} —— 那這個 404 無法診斷"
        )
        assert "disabled" in detail.lower(), f"本體沒說是停用：{detail!r}"

    def test_real_storage_failure_is_still_5xx(self):
        """正向對照：GCS 真的掛掉仍然回 5xx。

        這條在證明上面那個改動**只縮到了「刻意停用」**。
        少了它，把停用改成 404 的同一個改動也可能順手把真故障靜音掉，
        而那才是真正該叫醒人的情況。
        """
        import os as _os
        from unittest.mock import patch

        from fastapi.testclient import TestClient

        from app.config import settings as _settings
        from app.main import app

        client = TestClient(app)
        env = {
            "ENVIRONMENT": "development",
            "QA_TOOLS_SHARED_SECRET": "demo1234",
        }
        with patch.dict(_os.environ, env, clear=False), patch.object(
            _settings, "qa_tools_shared_secret", "demo1234"
        ), patch("app.routes.spotlight_qa._get_gcs_bucket", return_value=None):
            r = client.post(
                "/api/spotlight-qa/save",
                json={
                    "reviewer": "x",
                    "tool_version": 2,
                    "lessons": [{"lesson_code": "G6-L22"}],
                },
                headers={"x-qa-token": "demo1234"},
            )
        assert 500 <= r.status_code < 600, (
            f"GCS 掛掉回了 {r.status_code} —— 真故障必須留在 5xx 才會觸發警報。"
            f" body={r.text[:200]}"
        )
