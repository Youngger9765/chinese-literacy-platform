# LingoLeap 黑白箱資安驗收報告 — 2026-07-04

> **範圍界定（誠實，先講）**
> - 本報告 = **我方自測 + regression lock**，依 OWASP WSTG/Top10 方法論在**本機**執行
> - **不等於**院方/客戶官方稽核，**不等於**真人 pentester 簽名認證
> - 綠燈 = 對映的 WSTG 條目「自測通過」，不保證通過官方稽核
> - 全程 LOCAL：靜態 grep + Semgrep + gitleaks + in-process TestClient 動態測試 + 獨立對抗複審 agent；**未**對雲端正式站台燒錢掃描

## 目前 gate 狀態：🔴 RED — 未通過（有 1 HIGH + 3 MED 待修）

> 底子做得比一般案子好（認證/授權/注入/機密大面積乾淨），但獨立對抗複審抓到 **1 個真 HIGH + 3 個 MED**，修好前**不建議送官方稽核**。

## 受測標的
- Repo：`chinese-literacy-platform`（LingoLeap）— 國小/國中中文閱讀學習平台
- 後端：FastAPI + SQLAlchemy + PostgreSQL + Vertex AI Gemini（`backend/app/`，140+ endpoints）
- 前端：React 19 + Vite + Tailwind（`frontend/src/`）
- 角色：學生 / 教師 / admin（system_admin / org_admin / school-scoped）

## 工具鏈
| 面向 | 工具 | 版本 | 結果 |
|------|------|------|------|
| 白箱靜態掃碼 | Semgrep（owasp-top-ten + python + javascript + secrets）| 1.168.0 | 0 ERROR（1 WARNING = 誤報）|
| 機密外洩 | gitleaks（全 git 歷史 + 本機檔）| 8.30.1 | git 歷史 **0**；本機檔 4（全 gitignored）|
| 動態行為 | FastAPI TestClient（in-process，sqlite）| — | 10 pass / 1 xfail（xfail = 鎖住 MED-1 待修）|
| 靜態驗收 | `tests/security/blackbox_acceptance.sh` | — | **23 PASS / 5 FAIL / 2 DEFER（exit 1）** |
| 獨立對抗複審 | `appsec-pentest-reviewer` agent（assume-guilty 白箱）| — | 1 HIGH + 3 MED + 5 LOW；大面積綠 |

## 結果總覽
- **無** SQL injection / 命令注入 / SSRF / 硬編 secret / committed secret
- 認證底子好：JWT 演算法 pin 死、prod secret fail-closed、bcrypt cost 12、密碼重設 token 一次性無 oracle
- 授權大面積有擋：學生資料 IDOR 三層 ownership、org scope（users/organizations）正確、角色指派限 system_admin
- **但** 有 1 HIGH（限流全線可繞）+ 3 MED（跨 org 班級越權 / LLM 燒錢 / SSO 未驗 email_verified）待修

## 🔴 待修發現（對抗複審，已逐條對 code 獨立驗證）

### HIGH-1 — 所有流量限制可被偽造 X-Forwarded-For 繞過
`WSTG-ATHN-03`（弱鎖定）/ `WSTG-BUSL-01`（反自動化）/ CWE-307, CWE-799
- **影響**：per-IP 限流是登入暴力破解、AI 燒錢、匿名灌檔的唯一防線。攻擊者每次換一個假 `X-Forwarded-For`，計數器歸零 → 三條防線全失效。學生帳號由教師建（有預設密碼）→ 可無限猜密碼接管童帳號 + 個資。
- **證據（三個疊加，均已驗）**：
  - `backend/entrypoint.sh:51` — `--forwarded-allow-ips='*'`（無條件信任任何人的 XFF，官方明文警告勿用）
  - `backend/app/main.py:263` — `ip = forwarded_for.split(",")[0]`（取最左 = 攻擊者可控；Cloud Run 把真 IP 接在後面）
  - `backend/app/auth/rate_limiter.py:107-113` — `get_client_key` 讀 `request.state.user_id`，但**全 repo grep 證實此值從未被設定** → per-user 限流靜默退化成 per-IP
- **修法**：(a) `--forwarded-allow-ips` 收窄可信代理範圍/hop 數；(b) 取 XFF **最右可信一跳**非 `[0]`；(c) auth dependency 解 JWT 後真的寫入 `request.state.user_id`
- **red→green**：登入端點連打 11 次、每次不同 `X-Forwarded-For: 9.9.9.N` → 修前第 11 次仍 200/401（繞過=紅）、修後回 429（綠）；AI 端點同法

### MED-1 — org_admin 可跨組織讀別家班級 / 作業 / 學生錄音
`WSTG-ATHZ-02`（BOLA）/ CWE-639, CWE-863
- **影響**：A 機構管理員可聽 B 機構小朋友朗讀錄音、改 B 機構作業。單機構期影響小，**多機構一上線 = 跨客戶個資外洩**。
- **證據（同 bug 兩實作、只修一處）**：
  - `backend/app/auth/policies.py:17-35` `is_admin()` 只比角色名（含 org_admin），**無 org scope**——docstring 自己警告勿當全域 bypass
  - `backend/app/auth/policies.py:99-131` `require_classroom_owner/member`（org-scope 敏感情境）卻 `if is_admin(...): return`
  - 傳播：`classrooms/helpers.py` → `assignments.py` → `teacher_audio_replay.py`（聽學生錄音）、`co_teaching.py`
  - 正確對照：`backend/app/dependencies/tenant.py:165-235` 有把 org_admin 鎖在 `school.organization_id in user_org_admin_ids`
- **修法**：`require_classroom_owner/member` 把 `is_admin` 換 `is_system_admin` 全域 bypass + org_admin 走 school→org scope（複用 `tenant._check_classroom_access`，砍重複實作）
- **red→green**：已鎖 `test_idor_org_admin_cannot_read_cross_org_classroom`（現 xfail strict：斷言 403、目前回 200）；修好轉 xpass→移除 marker

### MED-2 — LLM 端點可被登入者濫用燒錢
`A04:2021` / `A10`（LLM 資源濫用）/ `WSTG-BUSL-01`
- **證據**：
  - `backend/app/routes/testset.py:303-311` `/testset/batch-eval` 任何登入者（含學生）可觸發、單次跑最多 30 筆 Gemini，**無** role gate、無 AI 限流
  - `backend/app/routes/stories.py:614-619` `/stories/{id}/structure/grade` 呼叫 AI 無 AI 限流、非 cache
  - teacher_analytics/alerts/dashboard/reports/cross_text 多個 AI 端點無 `ai_limit_*`
  - 對照做對：`tts.py:99/161` 用真 per-user `tts_rate_limit`
- **修法**：修好 HIGH-1（per-user key 生效）後，`batch-eval` 加 `require_role(admin/teacher)`+AI 限流；其餘 AI 端點補 `ai_limit_*`
- **red→green**：學生 token 連打 `/testset/batch-eval` 12 次 → 修前每次跑（紅）、修後第 11 次 429/403（綠）

### MED-3 — Google 登入用 email 連結帳號但未驗 `email_verified`
`WSTG-ATHN-01` / `A07:2021` / CWE-287
- **證據**：`backend/app/services/sso_login_service.py:53-57` 有驗 audience（綠）；但 `resolve_google_user:100-102` 直接 `filter(User.email == email)` 連結既有帳號，**全程未讀 `id_info.get("email_verified")`**（該檔 4 處 email_verified 全是註解/設定新帳號欄位，非驗 claim）
- **現實性**：消費者 Gmail email_verified 恆 true，實際利用門檻高 → defense-in-depth，但修一行值得
- **修法**：連結/建立帳號前 `if not id_info.get("email_verified"): raise 401`

## 🟡 LOW（Hardening）
- **LOW-1** OMO 上傳只驗 header MIME 不驗 magic bytes（`omo_upload_validator.py:42`）— 與 testset 不一致；已登入+私有 bucket，風險有限。修：比照 testset 加前導位元組
- **LOW-2** 登入 timing 使用者列舉（`auth.py:185` user 不存在時短路不跑 bcrypt）— 修：user None 也跑 dummy bcrypt
- **LOW-3** `is_dev` 偵測不一致：`main.py:69` 用較弱的 ENVIRONMENT 預設（docs_url + 空 JWT 警告用它），`config.py:54` 才有 K_SERVICE fail-safe；目前 `deploy.yml:76` 設 ENVIRONMENT=production 擋住 → LOW。修：main.py 統一用 `settings.is_dev`
- **LOW-4** org_admin 可查任一使用者角色列表跨 org（`roles.py:158-190` 無 org scope）— 修：比照 `users.py:290-297`
- **LOW-5** `/api/tts/mapping/{lesson_id}` 匿名可讀（`tts.py:188`）— 無 PII，資訊性可不修
- **LOW-6** 本機 `backend/.env` 含實際 AZURE_SPEECH_KEY（gitignored 且從未 commit，非 git 洩漏）— 確認是否仍需/輪替

## 🟢 已驗乾淨（assume-guilty 下實際驗過，附證據）
JWT 演算法 pin（`jwt.py:25`）｜JWT prod fail-closed（`main.py:72`）｜bcrypt cost 12｜無 SQLi（全 ORM，`text()` 僅靜態）｜無命令注入（list 形式無 shell=True）｜無 SSRF（host 硬編/config）｜學生資料 IDOR 三層 ownership｜RBAC org scope（users/orgs）｜角色指派限 system_admin｜testset 公開上傳（白名單+magic bytes+8MB cap+fail-closed）｜GCS 全私有+SignBlob 10min｜無 committed secret｜security headers 齊全｜500 不洩 stack｜密碼重設 token 一次性無 oracle｜SSO audience 有驗｜CORS 具名非 wildcard｜prod docs 關｜IP 未用於授權

## WSTG 覆蓋（動態實測）
| WSTG | 檢查 | 證據 | 判定 |
|------|------|------|------|
| ATHN | 未授權 / 偽造 JWT / alg=none → 401 | 動態測試 3 條 | ✅ |
| CONF-07 | 安全標頭 / CORS 不反射惡意 origin | 動態測試 | ✅ |
| INPV/BUSL | 上傳偽造 MIME / 路徑注入 → 400 | 動態測試 3 條 | ✅ |
| ATHZ-04 | 教師 B 不能讀教師 A 班級 | B→403 / owner→200 / 匿名→401 | ✅ |
| ATHZ-04 | org_admin 不能跨 org 讀使用者 | 跨→403 / 同→200 / sysadmin→200 | ✅ |
| ATHZ-02 | org_admin 不能跨 org 讀班級 | **現 xfail（回 200，MED-1）** | 🔴 待修 |

## Regression Lock（怎麼重複跑）
```bash
# 白箱靜態全檢（含對抗複審 red→green 鎖，現 exit 1）
./tests/security/blackbox_acceptance.sh
RUN_SEMGREP=1 ./tests/security/blackbox_acceptance.sh    # 加 Semgrep

# 動態行為 + IDOR（in-process，全本機）
cd backend && python -m pytest tests/security/test_dynamic_security.py -v
```
產出檔（committed = regression lock）：
- `tests/security/blackbox_acceptance.sh` — WSTG-mapped 靜態 gate（含 5 條待修鎖）
- `backend/tests/security/test_dynamic_security.py` — 動態 + IDOR gate（10 pass + 1 xfail=MED-1）

## 送稽核就緒度清單
- [ ] **必修** HIGH-1：`forwarded-allow-ips` 收窄 + XFF 取信任 hop + 落實 `request.state.user_id`（header-rotation 測試紅轉綠）
- [ ] **必修** MED-1：`require_classroom_owner/member` 改 `is_system_admin`+org scope（xfail 轉綠）
- [ ] **建議** MED-2：`batch-eval` role gate + AI 端點補限流
- [ ] **建議** MED-3：SSO 加 `email_verified` 檢查
- [ ] LOW-1~6 排待辦
- [ ] 本次為**靜態+in-process**，尚缺：staging 跑 `testssl.sh`（TLS 層）、`pip-audit`/`safety`（依賴 CVE）、關鍵繞過的動態 curl 實證
- [ ] **需真人簽名背書上線時，這關要找真人資安顧問**——本報告是第一線自測，非最終背書

## 對抗複審 verdict（已整合）
`appsec-pentest-reviewer` agent 獨立 assume-guilty 白箱審查（221k tokens / 51 tool calls / 13.5 min），抓到主 agent 漏的 HIGH-1（entrypoint XFF）+ MED-1（policies vs tenant 兩實作只修一處）。我逐條對真實 code 驗證後全部確認為真（見上）。**教訓：最貴的洞常是「同件事兩套實作只修一套」+「防線的前提假設沒成立」（限流以為擋 IP，但 IP 本身可偽造）**——已各配 red→green 測試，看紅轉綠即可，不必讀 code。
