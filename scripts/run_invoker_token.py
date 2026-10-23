"""run_invoker_token.py — Cloud Run service-to-service invoker token (#3733)

均一未來可能把 backend 鎖起來，但走的**不是**原生 IAP（見
`scripts/iap_token.py` 開頭對那條路的完整說明）—— 2026-10-24 架構修正：
backend 改用 Cloud Run 本身的「需要驗證」機制：拿掉 `allUsers` invoker，
只把 `roles/run.invoker` 授權給呼叫端的身分（frontend 的執行身分、CI 的
服務帳號）。這條路比原生 IAP 簡單很多，查證過官方文件
(https://docs.cloud.google.com/run/docs/authenticating/service-to-service)：

- 呼叫端只要跟 **metadata server** 要一張一般的 Google ID token（不是自簽
  JWT）——不需要簽章、不需要呼叫 IAM Credentials API、不需要
  `roles/iam.serviceAccountTokenCreator`。本機跑這支（非 Cloud Run 環境）
  要不到 metadata server 很正常，會安靜回 None。
- 帶的 header 是 **`X-Serverless-Authorization`**，不是 `Authorization`
  —— app 自己的 JWT 已經佔用了 `Authorization`；官方文件明載「若兩個
  header 都給，只認 X-Serverless-Authorization」，且會在轉給 app 之前把
  簽章拿掉，app 完全看不到也不用管這個 header。
- 呼叫端的身分需要目標服務的 `roles/run.invoker`（標準、常見的 Cloud Run
  IAM 授權，不是 IAP 專屬的 `roles/iap.httpsResourceAccessor`）。

frontend 仍然維持原生 IAP（真人用均一 Google 帳號互動登入那條路不受
影響）——這支只管 frontend 的 nginx 同源代理轉送到 backend 的那一跳。

快取策略跟 #3731 一致（per-audience、有 TTL、重簽前主動更新、重簽失敗時
用還沒硬性過期的舊 token 頂著），但**過期時間不是我們自己定的常數**——
這裡的 token 是 metadata server 核發的一般 Google ID token，直接解碼它
自己的 `exp` claim（不驗簽章，我們信任的是本機 metadata server 這個
trust boundary 本身，不是 token 的簽章），避免寫死一個「它的效期應該是
多久」的假設、未來 Google 改變預設值時悄悄跟現實脫節。

> ⚠️ 2026-10-24 寫這支的時候，#3731（`scripts/iap_token.py` 的 TTL 快取）
> 還在 PR #3732、尚未 merge 進這支所在的分支——上面提到的「#3731 一致」
> 是指**邏輯對齊**（概念上同一套快取策略），不是說這支真的 import 了
> 那支（它沒有，兩支完全獨立）。#3732 merge 後讀 `scripts/iap_token.py`
> 應該會看到一模一樣的快取結構，不會覺得這段話對不上眼前的檔案。

這階段 IAP/invoker 都還沒打開，沒有人設 `BACKEND_INVOKER_AUDIENCE`，所以
`get_invoker_token()` 永遠回傳 None —— 對呼叫端是零行為改變。

Usage (library)：
    from scripts.run_invoker_token import invoker_header
    headers = {**base_headers, **invoker_header(audience)}

Usage (sidecar server，給 nginx `auth_request` 打)：
    BACKEND_INVOKER_AUDIENCE=https://backend.run.app SIDECAR_PORT=8081 \
        python3 scripts/run_invoker_token.py --serve
"""

from __future__ import annotations

import base64
import json
import os
import sys
import time
import urllib.request

_METADATA_IDENTITY_URL = (
    "http://metadata.google.internal/computeMetadata/v1/instance/"
    "service-accounts/default/identity"
)

# #3731 的同一個政策：硬性過期前這麼多秒就主動重簽（不是等到真的過期）。
_REFRESH_MARGIN_S = 900

# 測試用的時鐘切換點——mock 這個名字，不要 mock stdlib 的 time.time 本身。
# ⚠️ 跟 scripts/iap_token.py 刻意不一樣：這裡比的是 token 自己的 `exp`
# （絕對的 epoch 時間戳），所以要用 wall clock（`time.time`）；iap_token.py
# 比的是「簽署那一刻到現在過了多久」，那個只關心經過時間、不關心牆上時鐘
# 被調過沒有，所以用 monotonic clock（`time.monotonic`）才對。兩邊選的
# 時鐘不同不是疏漏，是跟各自比較的對象配對。
_now = time.time

# audience -> (token, token 自己的 exp claim)。沒人設 audience 時永遠是空的。
_token_cache: dict[str, tuple[str, int]] = {}


def _decode_exp(id_token: str) -> int:
    """讀出 JWT payload 裡的 `exp`，不驗簽章——這裡信任的是本機 metadata
    server 這個 trust boundary，不是去重新驗證 Google 自己簽的東西。
    """
    payload_b64 = id_token.split(".")[1]
    padded = payload_b64 + "=" * (-len(payload_b64) % 4)
    payload = json.loads(base64.urlsafe_b64decode(padded))
    return int(payload["exp"])


def _fetch_from_metadata_server(audience: str) -> str:
    req = urllib.request.Request(
        f"{_METADATA_IDENTITY_URL}?audience={audience}",
        headers={"Metadata-Flavor": "Google"},
    )
    with urllib.request.urlopen(req, timeout=5) as resp:  # noqa: S310
        return resp.read().decode("utf-8").strip()


def _is_within_refresh_window(exp: int) -> bool:
    return _now() < (exp - _REFRESH_MARGIN_S)


def _is_within_hard_expiry(exp: int) -> bool:
    return _now() < exp


def get_invoker_token(audience: str | None = None) -> str | None:
    """要 (並快取，有 TTL) 一張瞄準 `audience` 的 Cloud Run invoker ID
    token。任何要不到的情況一律回傳 None，不丟例外：沒設 audience、不在
    Cloud Run 環境裡（metadata server 連不到）、token 格式解不出 exp。
    """
    aud = audience or os.environ.get("BACKEND_INVOKER_AUDIENCE", "")
    if not aud:
        return None

    cached = _token_cache.get(aud)
    if cached is not None and _is_within_refresh_window(cached[1]):
        return cached[0]

    try:
        token = _fetch_from_metadata_server(aud)
        exp = _decode_exp(token)
    except Exception:
        # metadata server 連不到（本機開發/非 Cloud Run 環境）、回應格式
        # 不是預期的 JWT——當作這次沒要到，看看有沒有舊的能頂著
        if cached is not None and _is_within_hard_expiry(cached[1]):
            print(
                f"run_invoker_token: re-fetch failed for {aud}, falling back "
                f"to a token that hasn't hard-expired yet",
                file=sys.stderr,
            )
            return cached[0]
        if cached is not None:
            _token_cache.pop(aud, None)
        return None

    _token_cache[aud] = (token, exp)
    return token


def invoker_header(audience: str | None = None) -> dict[str, str]:
    """回傳 `{'X-Serverless-Authorization': 'Bearer <token>'}` 或 `{}`
    （不丟例外）。故意不用 `Authorization`——app 自己的 JWT 佔用那個。
    """
    token = get_invoker_token(audience)
    return {"X-Serverless-Authorization": f"Bearer {token}"} if token else {}


def _reset_token_cache_for_tests() -> None:
    _token_cache.clear()


get_invoker_token.cache_clear = _reset_token_cache_for_tests  # type: ignore[attr-defined]


# ---------------------------------------------------------------------------
# Sidecar HTTP server — this is what nginx's `auth_request` directive talks
# to. It never blocks the real request on a miss: it always replies 200 (so
# `auth_request` always lets the outer request proceed), and only attaches
# the `X-Invoker-Token` response header when a token was actually available.
# `auth_request_set` on the nginx side reads that header (or gets an empty
# string if absent) and `proxy_set_header X-Serverless-Authorization` passes
# it through to backend. No token available -> empty header -> backend sees
# an unauthenticated request, same as today (IAP/invoker both still off).
# ---------------------------------------------------------------------------


def _build_server(port: int):
    import http.server

    class _Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802 (BaseHTTPRequestHandler's own naming convention)
            token = get_invoker_token()
            self.send_response(200)
            if token:
                self.send_header("X-Invoker-Token", token)
            self.end_headers()

        def log_message(self, format: str, *args: object) -> None:  # noqa: A002
            # 這是內部 sidecar，不是面向使用者的服務——安靜一點，不要把
            # nginx 每次 auth_request 的子請求都洗進 Cloud Run log。
            pass

    # ⚠️ 綁 0.0.0.0，不要綁 127.0.0.1——canary 實測過(2026-10-24)綁
    # 127.0.0.1 時 Cloud Run 的 startup probe 連不上（3 次
    # ERROR_CONNECTION_FAILED），換成 0.0.0.0 才過。這是容器化服務的標準
    # 慣例：只綁 loopback 對「平台層的健康檢查從哪個角度連進來」這件事
    # 太脆弱，綁所有介面才確定涵蓋得到。
    return http.server.HTTPServer(("0.0.0.0", port), _Handler)  # noqa: S104


def main(argv: list[str]) -> int:
    """CLI:
        python3 scripts/run_invoker_token.py <audience>   # 印出 bare token
        python3 scripts/run_invoker_token.py --serve      # 常駐當 sidecar
                                                           # (讀 SIDECAR_PORT 環境變數，預設 8081)
    """
    if len(argv) > 1 and argv[1] == "--serve":
        # 故意不讀 `PORT`：那個名字在 Cloud Run 整套生態裡有特別意義
        # （平台會為 ingress 容器注入），用它當 sidecar 自己的聽波通道
        # 有被平台注入值悄悄覆蓋的風險——改用一個 Cloud Run 不會
        # 特別處理的名字，避免跟平台自己的約定扒上。
        port = int(os.environ.get("SIDECAR_PORT", "8081"))
        # 故意用 print(..., flush=True)：Python 對非-tty 的 stdout 預設是
        # full-buffered，容器裡不 flush 就不會出現在 Cloud Run log——
        # 上一輪 canary 實測就是因為這樣，連「有沒有啟動過」都分不出來。
        print(f"run_invoker_token sidecar listening on 0.0.0.0:{port}", flush=True)
        _build_server(port).serve_forever()
        return 0
    audience = argv[1] if len(argv) > 1 else None
    token = get_invoker_token(audience)
    if token:
        print(token)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
