#!/usr/bin/env bash
# iap-token.sh — IAP 通行證小工具，bash 版 (#3719)
#
# 均一未來可能在 staging/preview 的 Cloud Run 服務前面加一層 IAP
# (Google 身分驗證)。這支讓任何 bash 腳本/workflow 用同一套邏輯：
# 有憑證且設定了要瞄準的 audience 時，帶上一張服務帳號自簽的 JWT
# （#3730 canary 實測過：一般 Google 簽名的 ID token 會被 IAP 拒絕，
# 見 scripts/iap_token.py 開頭的說明）；沒設定就安靜地不帶 header ——
# 跟 IAP 還沒打開時行為完全一樣。
#
# 邏輯只有一份，寫在 scripts/iap_token.py —— 這支只是轉呼叫，不重算一次。
#
# Usage:
#   source scripts/lib/iap-token.sh
#   TOKEN=$(iap_token "$AUDIENCE")            # 空字串 = 不加 header
#   if [ -n "$TOKEN" ]; then
#     curl -H "Proxy-Authorization: Bearer $TOKEN" "$URL"
#   else
#     curl "$URL"
#   fi

iap_token() {
  local audience="${1:-${IAP_AUDIENCE:-}}"
  local repo_root
  repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
  if [ -z "$audience" ]; then
    return 0   # 沒設 audience：這階段的預期狀態，印空字串
  fi
  if ! command -v python3 >/dev/null 2>&1; then
    return 0   # 沒有 python3 可轉呼叫 —— 當沒有憑證，安靜放棄
  fi
  python3 "${repo_root}/scripts/iap_token.py" "$audience" 2>/dev/null || true
}

