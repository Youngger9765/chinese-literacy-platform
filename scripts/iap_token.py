"""iap_token.py — IAP 通行證小工具 (#3719)

均一未來可能在 staging/preview 的 Cloud Run 服務前面加一層 IAP
(Google 身分驗證)。這支的工作：有服務帳號憑證、且設定了要瞄準的
audience 時，去要一張能通過 IAP 的 token；沒有就安靜地回傳 None ——
呼叫端據此決定要不要加這個 header。

用 `Proxy-Authorization` 而不是 `Authorization`：app 自己的 JWT 已經
佔用了 `Authorization`，IAP 官方文件 "Authenticating from a program"
明載接受這個替代 header
(https://cloud.google.com/iap/docs/authentication-howto)。

## 為什麼是「服務帳號自簽 JWT」，不是一般的 ID token

#3730 用一個丟棄式 canary 服務實測過（IAP 真的開著）：由 Google 代管
OAuth client 核發的一般 ID token（不管 audience 給 OAuth client ID、
服務網址、或 projects 路徑）一律被 IAP 拒絕，回 401
"Invalid JWT audience" —— Cloud Run 原生 IAP 整合背後是 Google 代管的
OAuth client，官方文件說明它不支援這種程式化核發的 token。

實測真的有效的做法：**服務帳號自己簽一張 JWT**——
`iss` = `sub` = 服務帳號 email，`aud` = 目標服務網址（完整網址、
網址加 `/`、或網址加 `/*` 都驗得過），`exp` 不超過 1 小時，放進
`Authorization` 或 `Proxy-Authorization` 都會通過 → 200。

兩種簽法，依環境自動選：
  1. 本機或有金鑰檔的環境（`GOOGLE_APPLICATION_CREDENTIALS` 指到一個
     服務帳號 JSON 金鑰）→ 直接用金鑰裡的私鑰簽（`google.auth.crypt`）。
  2. CI／沒有實體金鑰檔的環境（例如之後換成 Workload Identity
     Federation）→ 用現有的 ambient 憑證呼叫 IAM Credentials API，
     請 Google 代替那個服務帳號簽（`google.auth.iam.Signer`），
     不需要拿到私鑰本身。

這是唯一一份實作 —— bash 呼叫端 (`scripts/lib/iap-token.sh`) 透過
`python3 scripts/iap_token.py <audience>` 的 CLI 模式轉呼叫這裡，
不在 bash 裡重算一次；Node 那端 (`frontend/tests/e2e/utils/iapAuth.ts`)
用 `google-auth-library` 做同一件事（詳見該檔案的註解）。

這階段 IAP 還沒打開、沒有人設 IAP_AUDIENCE，所以 get_iap_token() 永遠
回傳 None —— 對呼叫端是零行為改變。

Usage (library)：
    from scripts.iap_token import iap_header, urlopen_with_iap
    headers = {**base_headers, **iap_header()}

Usage (CLI)：
    python3 scripts/iap_token.py <audience>   # 印出 bare token 或什麼都不印
"""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.request
from functools import lru_cache
from typing import Mapping

# 服務帳號自簽 JWT 的有效期上限。#3730 canary 實測這個值可行；拉更長
# 沒驗證過，寧可讓呼叫端更常重簽，也不要發一張沒試過時效的 token。
_MAX_TOKEN_LIFETIME_S = 3600


def _build_claims(audience: str, sa_email: str, now: int | None = None) -> dict[str, object]:
    """服務帳號自簽 JWT 的 claims。`iss`/`sub` 都是服務帳號 email（不是
    使用者）；`aud` 是目標服務網址本身，不是 OAuth client ID 或任何
    projects 路徑 —— 三者 canary 實測都驗得過，這裡固定用裸網址，
    呼叫端不用自己判斷要傳哪一種。
    """
    iat = now if now is not None else int(time.time())
    return {
        "iss": sa_email,
        "sub": sa_email,
        "aud": audience,
        "iat": iat,
        "exp": iat + _MAX_TOKEN_LIFETIME_S,
    }


def _encode(signer, claims: dict[str, object]) -> str:
    from google.auth import jwt as google_jwt

    token = google_jwt.encode(signer, claims)
    return token.decode("utf-8") if isinstance(token, bytes) else token


def _mint_via_key_file(key_path: str, audience: str) -> str | None:
    """有實體服務帳號金鑰檔時：直接用私鑰簽，不需要打任何 API。"""
    from google.auth.crypt import RSASigner

    with open(key_path, encoding="utf-8") as f:
        info = json.load(f)
    sa_email = info.get("client_email")
    if not sa_email:
        return None
    signer = RSASigner.from_service_account_file(key_path)
    return _encode(signer, _build_claims(audience, sa_email))


def _mint_via_iam_credentials(audience: str, sa_email: str | None = None) -> str | None:
    """沒有實體金鑰檔時：用現有的 ambient 憑證請 IAM Credentials API
    代簽（呼叫端的憑證需要對目標服務帳號有
    `roles/iam.serviceAccountTokenCreator`，或本身就是那個服務帳號）。
    """
    import google.auth
    from google.auth import iam as google_iam
    from google.auth.transport.requests import Request

    creds, _project = google.auth.default(
        scopes=["https://www.googleapis.com/auth/cloud-platform"]
    )
    request = Request()
    creds.refresh(request)
    email = (
        sa_email
        or getattr(creds, "service_account_email", None)
        or getattr(creds, "signer_email", None)
        or os.environ.get("IAP_SIGNING_SA_EMAIL")
    )
    if not email:
        return None
    signer = google_iam.Signer(request, creds, email)
    return _encode(signer, _build_claims(audience, email))


@lru_cache(maxsize=None)
def get_iap_token(audience: str | None = None) -> str | None:
    """要 (並快取) 一張瞄準 `audience` 的服務帳號自簽 JWT。

    任何要不到的情況一律回傳 None，不丟例外：沒設 audience、沒有可用
    憑證、簽章失敗。呼叫端必須把 None 當成「這次請求不帶 IAP header、
    照舊發送」—— 跟 IAP 還沒打開時的行為完全一樣。
    """
    aud = audience or os.environ.get("IAP_AUDIENCE", "")
    if not aud:
        return None
    try:
        key_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", "")
        if key_path and os.path.isfile(key_path):
            token = _mint_via_key_file(key_path, aud)
            if token:
                return token
        return _mint_via_iam_credentials(aud)
    except Exception:
        # 沒裝 google-auth 相關套件 / 沒有有效憑證 / 簽章 API 拒絕 ——
        # 安靜放棄，呼叫端走無 header 路徑
        return None


def iap_header(audience: str | None = None) -> dict[str, str]:
    """回傳 `{'Proxy-Authorization': 'Bearer <token>'}` 或 `{}`（不丟例外）。"""
    token = get_iap_token(audience)
    return {"Proxy-Authorization": f"Bearer {token}"} if token else {}


def urlopen_with_iap(
    url: str,
    *,
    data: bytes | None = None,
    headers: Mapping[str, str] | None = None,
    method: str | None = None,
    timeout: float = 60,
    audience: str | None = None,
):
    """`urllib.request.urlopen(url, ...)` 的直接替代品，差別只有自動帶上
    IAP header（有設定的話）。IAP 關閉時（現在）跟原本的呼叫完全等價。
    """
    merged = {**(headers or {}), **iap_header(audience)}
    if merged or method or data is not None:
        req = urllib.request.Request(url, data=data, headers=merged, method=method)
        return urllib.request.urlopen(req, timeout=timeout)  # noqa: S310
    return urllib.request.urlopen(url, timeout=timeout)  # noqa: S310


def main(argv: list[str]) -> int:
    """CLI：印出瞄準 AUDIENCE 的 bare token，要不到就什麼都不印（exit 0）。

    Usage: python3 scripts/iap_token.py <audience>
    """
    audience = argv[1] if len(argv) > 1 else None
    token = get_iap_token(audience)
    if token:
        print(token)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
