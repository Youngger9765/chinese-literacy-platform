"""iap_token.py — IAP 通行證小工具 (#3719)

均一未來可能在 staging/preview 的 Cloud Run 服務前面加一層 IAP
(Google 身分驗證)。這支的工作：有服務帳號/使用者憑證、且設定了要瞄準
的 audience 時，去要一張 Google 簽的 ID token；沒有就安靜地回傳
None —— 呼叫端據此決定要不要加這個 header。

用 `Proxy-Authorization` 而不是 `Authorization`：app 自己的 JWT 已經
佔用了 `Authorization`，IAP 官方文件 "Authenticating from a program"
明載接受這個替代 header
(https://cloud.google.com/iap/docs/authentication-howto)。

這階段 IAP 還沒打開、沒有人設 IAP_AUDIENCE，所以 get_iap_token() 永遠
回傳 None —— 對呼叫端是零行為改變。等 IAP 真的打開時，只要設一個
IAP_AUDIENCE（IAP OAuth client ID 或服務網址），這支就會開始運作，
不必再改任何呼叫端的程式碼。

這是唯一一份實作 —— bash 呼叫端 (`scripts/lib/iap-token.sh`) 透過
`python3 scripts/iap_token.py <audience>` 的 CLI 模式轉呼叫這裡，
不在 bash 裡重算一次。

Usage (library)：
    from scripts.iap_token import iap_header, urlopen_with_iap
    headers = {**base_headers, **iap_header()}

Usage (CLI)：
    python3 scripts/iap_token.py <audience>   # 印出 bare token 或什麼都不印
"""

from __future__ import annotations

import os
import subprocess
import sys
import urllib.request
from functools import lru_cache
from typing import Mapping


@lru_cache(maxsize=None)
def get_iap_token(audience: str | None = None) -> str | None:
    """要 (並快取) 一張瞄準 `audience` 的 Google 簽名 ID token。

    任何要不到的情況一律回傳 None，不丟例外：沒設 audience、沒裝
    gcloud、沒有有效憑證。呼叫端必須把 None 當成「這次請求不帶
    IAP header、照舊發送」—— 跟 IAP 還沒打開時的行為完全一樣。
    """
    aud = audience or os.environ.get("IAP_AUDIENCE", "")
    if not aud:
        return None
    try:
        out = subprocess.run(
            ["gcloud", "auth", "print-identity-token", f"--audiences={aud}"],
            capture_output=True,
            text=True,
            timeout=10,
            check=True,
        )
    except Exception:
        # 沒裝 gcloud / 沒登入 / token 要不到 —— 安靜放棄，呼叫端走無 header 路徑
        return None
    token = out.stdout.strip()
    return token or None


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
