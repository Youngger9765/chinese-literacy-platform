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
  local token=""
  if command -v python3 >/dev/null 2>&1; then
    token="$(python3 "${repo_root}/scripts/iap_token.py" "$audience" 2>/dev/null || true)"
  fi
  if [ -n "$token" ]; then
    printf '%s\n' "$token"
    return 0
  fi
  _iap_token_via_gcloud "$audience"
}

# #3733 — GitHub runners have no google-auth Python package, so the python
# path above returns nothing there. Fall back to IAM Credentials signJwt via
# gcloud for the SA in IAP_SIGNING_SA_EMAIL (caller needs
# roles/iam.serviceAccountTokenCreator on that SA). Same claims shape as
# scripts/iap_token.py._build_claims (#3730: iss == sub == SA, aud == URL,
# lifetime <= 1h). Any failure -> print nothing (callers treat that as
# "no header"); the token only ever goes to stdout, never stderr.
_iap_token_via_gcloud() {
  local audience="$1" sa="${IAP_SIGNING_SA_EMAIL:-}"
  [ -n "$sa" ] || return 0
  command -v gcloud >/dev/null 2>&1 || return 0
  local tmp now
  tmp="$(mktemp -d)" || return 0
  now="$(date +%s)"
  printf '{"iss":"%s","sub":"%s","aud":"%s","iat":%d,"exp":%d}' \
    "$sa" "$sa" "$audience" "$now" "$((now + 3000))" > "$tmp/claims.json"
  if gcloud iam service-accounts sign-jwt "$tmp/claims.json" "$tmp/out.jwt" \
      --iam-account="$sa" >/dev/null 2>&1 && [ -s "$tmp/out.jwt" ]; then
    cat "$tmp/out.jwt"
    printf '\n'
  fi
  rm -rf "$tmp"
  return 0
}

