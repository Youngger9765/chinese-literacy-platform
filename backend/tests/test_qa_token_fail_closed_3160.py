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
import importlib

import pytest
from fastapi import HTTPException


def _reload(monkeypatch, **env):
    for k in ("ENVIRONMENT", "K_SERVICE", "QA_TOOLS_SHARED_SECRET"):
        monkeypatch.delenv(k, raising=False)
    for k, v in env.items():
        monkeypatch.setenv(k, v)
    import app.config as config_module
    importlib.reload(config_module)
    import app.auth.qa_tools as qa
    importlib.reload(qa)
    return qa


class TestSecretNotSet:
    """secret 沒設時的行為 —— 這是現在真實的部署狀態"""

    @pytest.mark.parametrize("env", ["production", "staging", "preview"])
    def test_denied_on_cloud_run_when_secret_missing(self, monkeypatch, env):
        """⭐ 已部署的環境沒設 secret → 拒絕。這是 #3160 的核心。"""
        qa = _reload(monkeypatch, ENVIRONMENT=env, K_SERVICE="svc")
        with pytest.raises(HTTPException) as e:
            qa.require_qa_token(x_qa_token=None)
        assert e.value.status_code == 503, "應回 503（設定缺失）而非 401（憑證錯）"

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
