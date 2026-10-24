# IAP 準備與開關手冊（#3719）

> 現狀（2026-10-23）：`IAP_ENABLED` 預設 `'false'`，staging 與所有 preview
> 服務都還是 `--allow-unauthenticated`，跟這份文件存在之前完全一樣。
> 這份文件描述的是「準備好、還沒打開」的狀態，不是已經在運作的狀態。

## 為什麼要做這件事

均一要求：只有正式使用者會用到的網址公開，其他內部入口都先過 IAP
（Google 身分驗證）。LingoLeap 目前 staging／preview 的 frontend 跟
backend 兩個 Cloud Run 服務都是直接公開的（`*.run.app`），而「正式會用到
的網址」其實是 Firebase Hosting 那層（`lingoleap-staging.web.app` /
`lingoleap-dev.web.app`）——它透過 Firebase 的 serverless rewrite 連去
Cloud Run。**這一條（Firebase rewrite 是否真的繞過 Cloud Run 本身的
IAM/IAP 檢查）目前是依官方文件推論，還沒有實測驗證過**——打開 IAP
之前，這點需要跟下面「已知落差」的 canary 實驗一起驗證，不要只憑這份
文件的說法就假設它一定成立。

## 一步打開（目前的開關位置）

| 環境 | 檔案 | 開關 |
|---|---|---|
| 所有 PR preview | `.github/workflows/preview-deploy.yml` | `env.IAP_ENABLED` |
| staging（常駐） | `.github/workflows/staging-deploy.yml` | `env.IAP_ENABLED` |

把對應檔案裡的 `IAP_ENABLED: 'false'` 改成 `IAP_ENABLED: 'true'`，推一個
PR／merge 進 staging，部署腳本就會在 backend 跟 frontend 兩個 Cloud Run
服務上開啟 IAP（`gcloud beta run services update --iap`，Cloud Run 原生
整合，不需要另外架 HTTPS Load Balancer）。這一步**只決定「這個服務要不
要過 IAP」**，不決定「誰能進去」——誰能進去是下面「開發人員／外部審查者
要做什麼」那一段的事，是另一條獨立的 IAM 機制。

## 回滾（關掉）

把同一行改回 `IAP_ENABLED: 'false'`，merge。下一次部署就會是
`--allow-unauthenticated` 的狀態——IAP 本身的 on/off 是 Cloud Run 服務
的一個設定值，不是另外架的基礎設施，關掉不會留下殘留資源要清。已經核准
過的 IAP 存取名單（下面那段）不會因為關閉 IAP 而消失，只是暫時用不到。

## 開發人員要做什麼

**用瀏覽器操作（人）**：用自己的 `@junyiacademy.org` Google 帳號登入即可。
IAP 對瀏覽器走的是互動式 Google 登入（跳轉到 accounts.google.com，登入
一次後是 session cookie），只要帳號屬於 `junyiacademy.org` 網域，就會
在一次性的網域授權底下自動放行，不需要個別加人。

**外部審查者（沒有 junyiacademy.org 帳號的人，例如客戶端的審查者）**：
需要個別、限時授權。#3720（「IAP 開通名單：後台唯讀管理頁」，PR #3724，
已 merge）已經把這一塊蓋好了：

- `scripts/iap-grant.sh <email> <期限如 7d> "<姓名>" [--service=...]`
  ——開通，預設同時開 staging 的 frontend + backend，`--service=` 可以
  另外/改開某個 PR preview 服務；**拒絕對正式環境服務下手**（硬寫死
  `lingoleap-frontend`/`lingoleap-backend` 這兩個正式環境的確切名稱）；
  走 `gcloud beta iap web` 這組指令，幫這個人綁定
  `roles/iap.httpsResourceAccessor`，並附一個到期時間的 IAM 條件，
  到期自動失效，不用另外寫一次「撤銷」。
- `scripts/iap-list.sh [--service=...]` ——列出目前名單（唯讀）。
- 後台管理頁（`/admin/iap-allowlist`，前端
  `frontend/src/pages/admin/IapAllowlistPanel.tsx`，後端
  `backend/app/routes/admin_iap_allowlist.py`）給管理員看同一份資料，
  均一帳號彙總成一行「均一帳號：全部開通」，過期的外部人員顯示提醒
  ＋一鍵複製「給 IT 的資訊」。資料來源就是 GCP 的 IAM policy 本身，
  沒有另外的資料庫表。

這兩支腳本跟後台頁面現在都能跑，但實際讀/寫 GCP IAM 需要執行者的 gcloud
帳號已有對應權限（後台頁面讀取那端額外需要 `roles/iap.admin` 授權給
backend 的執行身分，PR #3724 的說明寫著這個權限**目前還沒授予**，所以
頁面現在會顯示「尚未設定 IAP」——這是預期狀態，不是 bug）。

## 自動化要做什麼（已經接好的部分）

Headless 的自動化（CI、Playwright、本機 QA 腳本）沒辦法走 IAP 的互動式
瀏覽器登入，要改用 Google 簽名的 ID token，放進 `Proxy-Authorization`
header（app 自己的 JWT 已經佔用 `Authorization`，IAP 官方文件
"Authenticating from a program" 載明接受這個替代 header）。這一層
（#3719 的另兩個 PR，見下方狀態）建好並接線後，`IAP_AUDIENCE` 這個
secret/環境變數現在誰都沒設，所以目前是零行為改變：

- `scripts/iap_token.py`（Python 版本，供 `content_evidence_gate.py`、
  `story_structure_qa.py`、`spotlight_faithfulness_check.py`、
  `health-check.sh`、`run-load-test.sh`、`locustfile.py`、
  `backend/scripts/verify_*.py` 使用）
- `scripts/lib/iap-token.sh`（bash 版本，轉呼叫上面那支）
- `frontend/tests/e2e/utils/iapAuth.ts`（Node/Playwright 版本，已接進
  `playwright.config.ts` 的 `extraHTTPHeaders`，以及每一支自己開瀏覽器
  context 或自己發 `fetch()` 的 spec）
- CI workflow（`e2e-tests.yml`、`staging-deploy.yml`、
  `preview-deploy.yml`）已經有 `google-github-actions/auth@v2` 步驟可以
  要到這張 token，只差設定 `IAP_AUDIENCE` 這個 secret。

> 狀態（2026-10-23）：上面這層目前分別在 PR #3725（token 小工具）跟
> #3728（frontend 同源代理 /api、/assets、/q）兩個 PR 裡，**尚未 merge**。
> 這份文件假設它們都已經 merge 之後的狀態；若還沒，先去確認那兩個 PR
> 的狀態再照做。

真的要開 IAP 之前，`IAP_AUDIENCE` 要設成什麼值，以及 frontend 自己的
nginx 同源代理在 backend 也開 IAP 之後，nginx 這一跳要怎麼帶自己的
IAP 憑證——這兩點**還沒有實測驗證過**，列在下面「已知落差」。

## 已知落差（誠實列出，還沒解決）

Cloud Run 原生 IAP 整合保護的是「所有打到這個服務的流量」，不只是瀏覽器
——包括同一個專案裡另一個 Cloud Run 服務對它發的請求。也就是說：如果
frontend 跟 backend **兩個都**開了 IAP，frontend 自己的 nginx 同源代理
要把請求轉給 backend 時，那一跳本身也需要一張有效的 IAP 憑證。純
nginx（`nginx:alpine`，沒有額外模組）沒辦法自己跟 Google 要一張 ID
token 並附上去——這不是這份文件或 #3719 其他 PR 解決掉的問題，是
**接下來真的要開 IAP 之前必須先驗證／設計的一塊**。可能的方向（還沒選定）：

- 只在 backend 開 IAP，frontend 維持 `--allow-unauthenticated`
  （貼近「只有正式使用者會用到的網址公開」原始需求字面意思，
  因為使用者走的其實是 Firebase Hosting 網址，不是 frontend 的
  `*.run.app`）
- 幫 nginx 加一個會自己要 token 的 sidecar／init container
- 把 nginx 換成一支薄的應用程式（能呼叫 Cloud Run metadata server
  要 token），而不是純靜態 nginx

這一塊、以及上面「為什麼要做這件事」提到的 Firebase rewrite 是否真的
繞過 Cloud Run IAM 檢查這兩點，在正式打開 IAP 之前需要一輪獨立的驗證
（throwaway canary 服務，不影響任何真實環境），結果會補回這份文件。
