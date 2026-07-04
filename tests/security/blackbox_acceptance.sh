#!/bin/bash
# ============================================================
# LingoLeap 黑白箱資安驗收測試（TDD / regression lock）
#   每條 = 一條資安要求，對應 OWASP Top 10 / WSTG test ID
#   綠(exit 0) = 交付碼符合資安門檻；紅(exit 1) = 有漏洞被重新引入
#
#   Stack: FastAPI + SQLAlchemy + PostgreSQL + Vertex AI Gemini / React + Vite
#
#   用法:
#     ./tests/security/blackbox_acceptance.sh              # 白箱靜態全檢（無需起站，CI 友善）
#     RUN_SEMGREP=1 ./tests/security/...sh                 # 加跑 semgrep 靜態掃碼（需網路抓 ruleset）
#     RUN_GITLEAKS=0 ./tests/security/...sh                # 跳過 gitleaks 歷史掃描（預設跑，~30s）
#     BASE_URL=http://localhost:8000 ./tests/security/...sh # 加測活站台（黑箱動態）；不設則跳過動態
#
#   ⚠️ 範圍界定（誠實）：
#     - 本 suite = 我方自測 + regression lock，非院方/客戶官方稽核，非真人 pentester 簽名
#     - 綠燈 = 對映的 WSTG 條目「自測通過」，不等於保證過官方稽核
#     - 完整 IDOR/授權矩陣（學生A讀學生B / org跨讀）需活站台 + 多角色 token → 動態段（BASE_URL）
#       未設 BASE_URL 時標 [DEFER]，靜態段只驗「授權機制存在且被引用」
# ============================================================
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BE="$ROOT/backend/app"
FE="$ROOT/frontend/src"
PASS=0; FAIL=0; DEFER=0
ok(){   PASS=$((PASS+1));  printf "  \033[32m✅ PASS\033[0m  [%s] %s\n" "$1" "$2"; }
no(){   FAIL=$((FAIL+1));  printf "  \033[31m❌ FAIL\033[0m  [%s] %s\n" "$1" "$2"; [ -n "${3:-}" ] && echo "          → $3"; }
skip(){ DEFER=$((DEFER+1)); printf "  \033[33m⏭  DEFER\033[0m [%s] %s\n" "$1" "$2"; [ -n "${3:-}" ] && echo "          → $3"; }
# grep helper: count matching lines, pycache/tests excluded
gc(){ grep -rnaE "$1" "${@:2}" 2>/dev/null | grep -vaE '__pycache__|/node_modules/' | wc -l | tr -d ' '; }

[ -d "$BE" ] || { echo "找不到後端: $BE"; exit 2; }
echo "════════ LingoLeap 黑白箱資安驗收：$ROOT ════════"

# ─────────────────────────────────────────────────────────────
echo; echo "── A07 身分驗證 Authentication ──"
# ATHN-01: JWT secret 空值在 prod fail-closed（防 dev-default secret 偽造 token，postmortem 5/16）
grep -qa 'JWT_SECRET_KEY must be set in production' "$BE/main.py" \
  && ok "A07 · WSTG-ATHN" "JWT secret 空值時 prod fail-closed（RuntimeError）" \
  || no "A07 · WSTG-ATHN" "prod 未擋空 JWT secret" "main.py 應 raise RuntimeError if not jwt_secret_key and not dev"
# ATHN-02: JWT 演算法 pin 死（list 形式）→ 防 alg-confusion / none 演算法
grep -qaE 'algorithms=\[settings\.jwt_algorithm\]' "$BE/auth/jwt.py" \
  && ok "A07 · WSTG-ATHN" "JWT decode 演算法 pin 為單一 list（防 alg-confusion）" \
  || no "A07 · WSTG-ATHN" "JWT decode 未 pin 演算法" "jwt.decode 必須帶 algorithms=[...]"
# ATHN-03: 沒有停用簽章驗證（verify_signature=False）在 auth 路徑
c=$(gc 'verify_signature["\x27]?\s*[:=]\s*False' "$BE/auth")
[ "$c" = 0 ] && ok "A07 · WSTG-ATHN" "auth 路徑無 verify_signature=False" \
  || no "A07 · WSTG-ATHN" "auth 有停用簽章驗證（$c 處）"
# ATHN-04: 密碼用 bcrypt（不可逆），且 password.py 無 md5/sha1
grep -qa 'bcrypt' "$BE/auth/password.py" && [ "$(gc '\b(md5|sha1)\b' "$BE/auth/password.py")" = 0 ] \
  && ok "A02 · WSTG-CRYP-04" "密碼雜湊用 bcrypt（無 md5/sha1）" \
  || no "A02 · WSTG-CRYP-04" "密碼雜湊非 bcrypt 或混用弱雜湊"
# ATHN-05: token 帶 exp（過期驗證，pyjwt 預設 verify_exp）
grep -qaE '"exp"' "$BE/auth/jwt.py" \
  && ok "A07 · WSTG-ATHN" "access token 帶 exp 過期時間" \
  || no "A07 · WSTG-ATHN" "token 未設 exp"
# ATHN-06: get_current_user 驗 is_active（停用帳號不得通過）
grep -qaE 'is_active == True' "$BE/auth/dependencies.py" \
  && ok "A07 · WSTG-ATHN" "current_user 驗 is_active（停用帳號擋下）" \
  || no "A07 · WSTG-ATHN" "current_user 未驗 is_active"

# ─────────────────────────────────────────────────────────────
echo; echo "── A01 存取控制 Broken Access Control（白箱：機制存在性）──"
# ATHZ-01: 集中式授權 policies 模組存在
[ -f "$BE/auth/policies.py" ] \
  && ok "A01 · WSTG-ATHZ" "集中式授權 policies.py 存在" \
  || no "A01 · WSTG-ATHZ" "缺集中授權模組（各 route 各寫易漏）"
# ATHZ-02: is_system_admin 與 is_admin 分離（org_admin 不得當全域 bypass → 防跨 org 洩漏）
grep -qa 'def is_system_admin' "$BE/auth/policies.py" \
  && ok "A01 · WSTG-ATHZ" "系統管理員/組織管理員權限分離（防跨組織讀取）" \
  || no "A01 · WSTG-ATHZ" "缺 is_system_admin 分離" "org_admin 當全域 bypass 會跨 org 洩漏個資"
# ATHZ-03: admin seed 端點被 require_role('system_admin') 守住
grep -qaE "require_role\([^)]*system_admin" "$BE/routes/admin_seed.py" \
  && ok "A01 · WSTG-ATHZ" "admin seed 端點需 system_admin 角色" \
  || no "A01 · WSTG-ATHZ" "admin seed 未 gate system_admin"
# ATHZ-04: require_role 工廠被實際使用於路由（抽樣：admin/roles/organizations）
c=$(gc 'require_role\(' "$BE/routes")
[ "$c" -ge 3 ] && ok "A01 · WSTG-ATHZ" "require_role 於 $c 處路由使用（RBAC 有落地）" \
  || no "A01 · WSTG-ATHZ" "require_role 使用過少（$c）——RBAC 可能未落地"
# ATHZ-05: 完整 IDOR 矩陣（學生A↔B / org 跨讀）需活站台多角色 token
skip "A01 · WSTG-ATHZ-04" "跨學生/跨班/跨組織 IDOR 完整矩陣 → 需 BASE_URL + 多角色 token（見動態段）"

# ─────────────────────────────────────────────────────────────
echo; echo "── A03 注入 Injection（白箱靜態）──"
# INPV-05: 無 f-string / .format / % 拼接進 SQL execute/text
c=$(gc '(execute|text)\(\s*(f["\x27]|["\x27].*%|.*\.format\()' "$BE")
[ "$c" = 0 ] && ok "A03 · WSTG-INPV-05" "無 f-string/format/% 拼接進 SQL（純 ORM/參數化）" \
  || no "A03 · WSTG-INPV-05" "有 $c 處疑似 SQL 字串拼接"
c=$(gc 'f["\x27](SELECT|INSERT|UPDATE|DELETE) ' "$BE")
[ "$c" = 0 ] && ok "A03 · WSTG-INPV-05" "無 f-string SQL 語句字面" \
  || no "A03 · WSTG-INPV-05" "有 $c 處 f-string SQL 語句"
# INPV-01: 前端無 dangerouslySetInnerHTML / eval（React 自動 escape）
if [ -d "$FE" ]; then
  c=$(grep -rnaE 'dangerouslySetInnerHTML|(^|[^.])\beval\(|new Function\(' "$FE" 2>/dev/null | grep -vaE '__tests__|\.test\.|/node_modules/' | wc -l | tr -d ' ')
  [ "$c" = 0 ] && ok "A03 · WSTG-INPV-01" "前端無 dangerouslySetInnerHTML/eval（XSS 面小）" \
    || no "A03 · WSTG-INPV-01" "前端有 $c 處危險 HTML/eval 注入面"
fi
# INPV: 公開上傳端點 lesson_id 白名單擋路徑注入 + magic-bytes 反 MIME 偽造
grep -qa '_LESSON_ID_RE.match' "$BE/routes/testset.py" && grep -qa '_audio_bytes_match_declared_mime' "$BE/routes/testset.py" \
  && ok "A03 · WSTG-INPV / BUSL" "testset 上傳：lesson_id 白名單 + magic-bytes 校驗" \
  || no "A03 · WSTG-INPV" "testset 上傳缺路徑白名單或 magic-bytes 校驗"

# ─────────────────────────────────────────────────────────────
echo; echo "── A04/A10 濫用防護 & LLM 端點 ──"
# 全域 per-IP rate limiting（讀/寫分流）
grep -qa 'GlobalRateLimitMiddleware' "$BE/main.py" && grep -qaE 'READ_LIMIT|WRITE_LIMIT' "$BE/main.py" \
  && ok "A04 · WSTG-BUSL" "全域 per-IP rate limiting（讀/寫分流）已掛" \
  || no "A04 · WSTG-BUSL" "缺全域 rate limiting"
# OMO / 上傳有 size cap（防記憶體/成本濫用）
c=$(gc 'MAX_AUDIO_BYTES|max.*file|MAX.*SIZE|too large' "$BE/routes/testset.py" "$BE/routes/omo/upload.py")
[ "$c" -ge 1 ] && ok "A04 · WSTG-BUSL" "上傳端點有 size cap（防資源濫用）" \
  || no "A04 · WSTG-BUSL" "上傳端點缺 size cap"

# ─────────────────────────────────────────────────────────────
echo; echo "── A05 安全設定錯誤 Security Misconfiguration ──"
# CONF: security headers middleware（CSP/X-Frame/nosniff/HSTS/referrer）
H="$BE/main.py"
grep -qa 'Content-Security-Policy' "$H" && grep -qa '"X-Frame-Options"' "$H" && grep -qa 'X-Content-Type-Options' "$H" && grep -qa 'Strict-Transport-Security' "$H" \
  && ok "A05 · WSTG-CONF-07" "安全標頭齊全（CSP/X-Frame/nosniff/HSTS）" \
  || no "A05 · WSTG-CONF-07" "安全標頭不齊"
# CONF: X-Frame-Options DENY + frame-ancestors none（防 clickjacking）
grep -qaE 'X-Frame-Options"\]\s*=\s*"DENY"' "$H" && grep -qa "frame-ancestors 'none'" "$H" \
  && ok "A05 · WSTG-CLNT-09" "clickjacking 防護（X-Frame DENY + frame-ancestors none）" \
  || no "A05 · WSTG-CLNT-09" "clickjacking 防護不足"
# CONF: CORS 非萬用字元
c=$(gc 'allow_origins=\[\s*["\x27]\*' "$H")
[ "$c" = 0 ] && grep -qa 'allow_origins=settings.origins_list' "$H" \
  && ok "A05 · WSTG-CONF-07" "CORS 明列 origin 白名單（非 *）" \
  || no "A05 · WSTG-CONF-07" "CORS 使用萬用字元或未白名單"
# CONF: prod 關閉 /docs /redoc（減少資訊洩漏）
grep -qaE 'docs_url=.*if _is_dev else None' "$H" \
  && ok "A05 · WSTG-CONF-05" "prod 關閉 /docs /redoc" \
  || no "A05 · WSTG-CONF-05" "prod 未關閉 API docs"
# CONF: 500 錯誤不洩漏 stack trace 給 client（回泛用訊息）
grep -qa '"detail": "Internal server error"' "$H" \
  && ok "A05 · WSTG-ERRH-01" "500 回泛用訊息（不洩 stack trace）" \
  || no "A05 · WSTG-ERRH-01" "500 可能洩漏內部細節"

# ─────────────────────────────────────────────────────────────
echo; echo "── A02/機密 敏感資料外洩 ──"
# CONF-04: .env / .gstack 已 gitignore
grep -qaE '^\.env' "$ROOT/.gitignore" && grep -qa 'gstack' "$ROOT/.gitignore" \
  && ok "A02 · WSTG-CONF-04" ".env / .gstack 已 gitignore（本機機密不入 git）" \
  || no "A02 · WSTG-CONF-04" ".env 或 .gstack 未 gitignore"
# CONF-04: git 歷史無 commit 過的機密（gitleaks 全史掃描）
if [ "${RUN_GITLEAKS:-1}" = 1 ] && command -v gitleaks >/dev/null 2>&1; then
  if gitleaks git "$ROOT" --config "$ROOT/.gitleaks.toml" --redact >/dev/null 2>&1; then
    ok "A02 · WSTG-CONF-04" "gitleaks 全 git 歷史無機密外洩"
  else
    no "A02 · WSTG-CONF-04" "gitleaks 在 git 歷史抓到機密" "gitleaks git . --config .gitleaks.toml 檢視"
  fi
else
  skip "A02 · WSTG-CONF-04" "gitleaks 歷史掃描（未裝或 RUN_GITLEAKS=0）"
fi

# ─────────────────────────────────────────────────────────────
echo; echo "── 白箱靜態掃碼（Semgrep OWASP，選用）──"
if [ "${RUN_SEMGREP:-0}" = 1 ] && command -v semgrep >/dev/null 2>&1; then
  tmp="$(mktemp)"
  semgrep scan --config p/owasp-top-ten --config p/python --metrics off \
    --severity ERROR --json --output "$tmp" "$BE" >/dev/null 2>&1
  n=$(python3 -c "import json,sys;print(len(json.load(open('$tmp')).get('results',[])))" 2>/dev/null || echo "?")
  rm -f "$tmp"
  [ "$n" = 0 ] && ok "A03/多項 · Semgrep" "Semgrep OWASP 0 個 ERROR 級發現" \
    || no "A03/多項 · Semgrep" "Semgrep 有 $n 個 ERROR 級發現"
else
  skip "Semgrep" "靜態掃碼（RUN_SEMGREP=1 開啟；需網路抓 ruleset）"
fi

# ─────────────────────────────────────────────────────────────
echo; echo "── 對抗複審發現（2026-07-04 appsec-pentest-reviewer；red→green 鎖，修好轉綠）──"
# HIGH-1a: entrypoint 不得無條件信任 XFF（--forwarded-allow-ips='*' → 限流全線可繞）
if grep -qaE "^[^#]*forwarded-allow-ips='\*'" "$ROOT/backend/entrypoint.sh" 2>/dev/null; then
  no "A07/A04 · WSTG-ATHN-03/BUSL-01" "HIGH-1: entrypoint --forwarded-allow-ips='*'（信任任意 XFF）" "改可信代理範圍/信任 hop 數"
else
  ok "A07/A04 · WSTG-ATHN-03" "entrypoint 未無條件信任 XFF"
fi
# HIGH-1c: per-user 限流 key 必須真的被設定（否則退化成可偽造的 per-IP）
c=$(gc 'request\.state\.user_id\s*=' "$BE")
[ "$c" -ge 1 ] && ok "A04 · WSTG-BUSL-01" "request.state.user_id 有被設定（per-user 限流生效）" \
  || no "A04 · WSTG-BUSL-01" "HIGH-1: request.state.user_id 從未設定 → per-user 限流退化成 per-IP" "auth dependency 解 JWT 後寫入 request.state.user_id"
# MED-1: 班級授權守衛不得用 is_admin 當全域 bypass（org_admin 會跨 org）
bad=$(python3 - "$BE/auth/policies.py" <<'PY'
import ast, sys
src = open(sys.argv[1]).read()
out = []
for n in ast.walk(ast.parse(src)):
    if isinstance(n, ast.FunctionDef) and n.name in ("require_classroom_owner", "require_classroom_member"):
        body = ast.get_source_segment(src, n) or ""
        if "is_admin(" in body and "is_system_admin(" not in body:
            out.append(n.name)
print(",".join(out))
PY
)
[ -z "$bad" ] && ok "A01 · WSTG-ATHZ-02" "班級授權守衛未用 is_admin 全域 bypass（org 隔離保住）" \
  || no "A01 · WSTG-ATHZ-02" "MED-1: $bad 用 is_admin bypass → org_admin 可跨 org 讀班級/作業/錄音" "改 is_system_admin + org scope（參 tenant._check_classroom_access）"
# MED-2: batch-eval（30×Gemini）需 role gate，不得任何登入者可觸發
grep -A10 'def testset_batch_eval' "$BE/routes/testset.py" 2>/dev/null | grep -qa 'require_role' \
  && ok "A04 · WSTG-BUSL-01" "batch-eval 有 role gate" \
  || no "A04 · WSTG-BUSL-01" "MED-2: batch-eval 無 role gate（任何學生可跑 30×Gemini 燒錢）" "加 require_role(admin/teacher)+AI 限流"
# MED-3: Google SSO 連結帳號前需驗「id_info 的 email_verified claim」（非只設定新帳號欄位）
grep -qaE 'id_info(\.get\(|\[)["'\'']?email_verified' "$BE/services/sso_login_service.py" \
  && ok "A07 · WSTG-ATHN-01" "SSO 讀取並驗 id_info.email_verified claim" \
  || no "A07 · WSTG-ATHN-01" "MED-3: SSO 未驗 id_info 的 email_verified claim（憑未驗 email 連結帳號）" "連結前 if not id_info.get('email_verified'): raise 401"

echo; echo "── Cursor 盲掃新增發現（2026-07-04；red→green 鎖）──"
# NEW-1: 全校成員/班級列舉端點需授權（org/school scope 或 require_role）
grep -A18 'def list_school_members' "$BE/routes/schools.py" 2>/dev/null | grep -qaE 'require_role|get_user_org_ids|resolve_user_org_ids|status_code=403' \
  && ok "A01 · WSTG-ATHZ-04" "list_school_members 有授權/scope 檢查" \
  || no "A01 · WSTG-ATHZ-04" "NEW-1: schools 成員列舉零授權（任何登入者撈全校 email）" "加 org/school membership 檢查"
# NEW-2: create_classroom 需驗 caller 對該 school 的 org membership
grep -A28 'def create_classroom' "$BE/routes/classrooms/classroom_crud.py" 2>/dev/null | grep -qaE 'get_user_org_ids|resolve_user_org_ids|organization_id|is_system_admin' \
  && ok "A01 · WSTG-ATHZ-02" "create_classroom 有 school→org membership 檢查" \
  || no "A01 · WSTG-ATHZ-02" "NEW-2: 任何教師可在別 org 的 school 建班（只驗 school 存在）" "驗 caller 對該 school 的 org"
# NEW-4: semester 寫入守衛不得用 is_admin 全域 bypass
bad4=$(python3 - "$BE/routes/semesters.py" <<'PY'
import ast, sys
src = open(sys.argv[1]).read()
out = []
for n in ast.walk(ast.parse(src)):
    if isinstance(n, ast.FunctionDef) and n.name == "_require_school_write_access":
        body = ast.get_source_segment(src, n) or ""
        if "is_admin(" in body and "is_system_admin(" not in body:
            out.append(n.name)
print(",".join(out))
PY
)
[ -z "$bad4" ] && ok "A01 · WSTG-ATHZ-02" "semester 寫入守衛未用 is_admin 全域 bypass" \
  || no "A01 · WSTG-ATHZ-02" "NEW-4: $bad4 用 is_admin bypass → org_admin 對任意 school 建/改 semester" "改 is_system_admin + org scope"

# ─────────────────────────────────────────────────────────────
# 黑箱動態（需 BASE_URL 指向本機起好的站台；⛔ 勿指向雲端正式站燒錢）
if [ -n "${BASE_URL:-}" ]; then
  echo; echo "── 黑箱動態（活站台 ${BASE_URL}）──"
  code(){ curl -s -o /dev/null -w '%{http_code}' "$@"; }
  # health 200
  [ "$(code "$BASE_URL/api/health")" = 200 ] && ok "動態 · health" "健康檢查 200" || no "動態 · health" "健康檢查非 200"
  # 未帶 token 讀受保護端點 → 401
  pc=$(code "$BASE_URL/${PROTECTED_PATH:-api/auth/me}")
  { [ "$pc" = 401 ] || [ "$pc" = 403 ]; } && ok "A01 · 動態 ATHZ" "受保護端點未授權回 $pc" || no "A01 · 動態 ATHZ" "受保護端點未授權回 $pc（應 401/403）"
  # 偽造 JWT → 401（token 由片段 runtime 組出，source 不留 JWT 字面）
  b64(){ printf '%s' "$1" | base64 | tr -d '=' | tr '/+' '_-'; }
  fake_jwt="$(b64 '{"alg":"HS256","typ":"JWT"}').$(b64 '{"sub":"1"}').forged"
  fc=$(code -H "Authorization: Bearer $fake_jwt" "$BASE_URL/${PROTECTED_PATH:-api/auth/me}")
  { [ "$fc" = 401 ] || [ "$fc" = 403 ]; } && ok "A07 · 動態 ATHN" "偽造 JWT 被拒（$fc）" || no "A07 · 動態 ATHN" "偽造 JWT 未被拒（$fc）"
  # 安全標頭出現在活回應
  hdr=$(curl -sI "$BASE_URL/api/health")
  echo "$hdr" | grep -qi 'x-frame-options: DENY' && echo "$hdr" | grep -qi 'strict-transport-security' \
    && ok "A05 · 動態 CONF" "活站台回安全標頭（X-Frame DENY + HSTS）" || no "A05 · 動態 CONF" "活站台缺安全標頭"
  # CORS 不反射惡意 Origin
  acao=$(curl -s -o /dev/null -D - -H "Origin: https://evil.example" "$BASE_URL/api/health" | grep -i 'access-control-allow-origin' | grep -c 'evil.example')
  [ "$acao" = 0 ] && ok "A05 · 動態 CORS" "不反射未白名單 Origin" || no "A05 · 動態 CORS" "反射惡意 Origin（CORS 錯設）"
  # testset 上傳偽造 MIME → 400/415
  sc=$(printf 'notaudio' | curl -s -o /dev/null -w '%{http_code}' -F "contributor_name=probe" -F "lesson_id=G6-L22" -F "version=correct" -F "audio=@-;type=audio/wav;filename=x.wav" "$BASE_URL/api/testset/upload")
  { [ "$sc" = 400 ] || [ "$sc" = 415 ]; } && ok "A03 · 動態 INPV" "偽造 MIME 上傳被拒（$sc）" || no "A03 · 動態 INPV" "偽造 MIME 上傳未被拒（$sc）"
else
  echo; echo "  (未設 BASE_URL → 跳過黑箱動態；本機起站後：BASE_URL=http://localhost:8000 再執行)"
fi

# ─────────────────────────────────────────────────────────────
echo; echo "════════════════════════════════════════"
echo "結果： $PASS 通過 / $FAIL 失敗 / $DEFER 延後"
[ "$FAIL" = 0 ] && { echo -e "\033[32m✅ 通過現階段黑白箱資安門檻\033[0m（註：我方自測，非官方稽核；完整 IDOR 需動態段）"; exit 0; } \
                || { echo -e "\033[31m❌ 有未達門檻項，見上方 FAIL\033[0m"; exit 1; }
