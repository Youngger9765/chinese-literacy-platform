# IAP 準備與開關手冊（#3719）

> 現狀（2026-10-24）：`IAP_ENABLED` 預設 `'false'`，staging 與所有 preview
> 服務都還是 `--allow-unauthenticated`，跟這份文件存在之前完全一樣。
> 這份文件描述的是「準備好、還沒打開」的狀態，不是已經在運作的狀態。
> #3725／#3728／#3729 三個 PR 都已經 merge 進 staging；#3719（這份文件
> 對應的準備工作母票）跟 #3730（下面「已實測驗證」那段的 canary 子票）
> 都還開著，#3730 是因為下面「已知落差」那一塊還沒解決——**那一塊沒解
> 決之前，不可以對 staging 真的上鎖**。

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

## IAP 認證方式：已實測驗證（#3730）

下面這段不是推論，是 2026-10-24 真的建了一個丟棄式服務
（`lingoleap-iap-canary`，Google 官方 hello 映像，沒有程式、沒有金鑰、
不對外），開了 Cloud Run 原生 IAP，實測三件事之後得到的結果：

| 測試 | 結果 |
|---|---|
| 匿名連線（完全不帶憑證） | 302 轉向 Google 登入頁 —— 被擋，符合預期 |
| 帶一般 Google 簽名 ID token（`gcloud auth print-identity-token`），audience 試過 OAuth client ID／服務網址／projects 路徑三種 | **一律 401 "Invalid JWT audience"**，不管放在 `Authorization` 還是 `Proxy-Authorization`，三種 audience 都一樣 |
| 帶**服務帳號自簽的 JWT**（`iss` = `sub` = 服務帳號 email，`aud` = 服務網址，`exp` 不超過 1 小時） | **200**，`Authorization` 或 `Proxy-Authorization` 都通過；`aud` 用服務網址本身、網址加 `/`、或網址加 `/*` 三種寫法都驗得過 |

**結論**：上面「自動化要做什麼」原本假設的「Google 簽名的一般 ID
token」這條路**走不通**——Cloud Run 原生 IAP 整合背後是 Google 代管的
OAuth client，不支援這種程式化核發的 token，不管 audience 怎麼填都會被
拒。真正要用的是**服務帳號自己簽的 JWT**，簽法依環境分兩種：

1. 本機或有實體金鑰檔的環境（`GOOGLE_APPLICATION_CREDENTIALS` 指到一個
   服務帳號 JSON 金鑰）→ 直接用金鑰裡的私鑰本機簽，不打任何網路請求。
2. CI／沒有實體金鑰檔的環境（例如 Workload Identity Federation）→ 請
   IAM Credentials API 用系統代管金鑰代簽（Python 用
   `google.auth.iam.Signer`；Node 用 `gcloud iam service-accounts
   sign-jwt --iam-account=<SA>`，這支子指令一律透過 IAM Credentials
   API 簽，不需要拿到私鑰本身）。

`scripts/iap_token.py`／`scripts/lib/iap-token.sh`／
`frontend/tests/e2e/utils/iapAuth.ts` 三份實作（見下面「自動化要做
什麼」）已經按這個結論重寫，單元測試鎖著 claims 的形狀（`iss`/`sub` 是
服務帳號 email、`aud` 是目標網址本身、效期不超過 1 小時）不會漂走。

Canary 服務目前還留著（供下次驗證用），驗證完會刪掉；不是正式環境的
一部分，不影響任何真實服務。

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
瀏覽器登入，要帶上面「已實測驗證」那段確認有效的**服務帳號自簽
JWT**，放進 `Proxy-Authorization` header（app 自己的 JWT 已經佔用
`Authorization`，IAP 官方文件 "Authenticating from a program" 載明接受
這個替代 header）。這一層（#3719／#3725 的工具，#3730 之後依實測結果
重寫過一次）建好並接線後，`IAP_AUDIENCE` 這個 secret/環境變數現在誰都
沒設，所以目前是零行為改變：

- `scripts/iap_token.py`（Python 版本，供 `content_evidence_gate.py`、
  `story_structure_qa.py`、`spotlight_faithfulness_check.py`、
  `health-check.sh`、`run-load-test.sh`、`locustfile.py`、
  `backend/scripts/verify_*.py` 使用；有金鑰檔用 `google.auth.crypt`
  本機簽，沒有就用 `google.auth.iam.Signer` 請 IAM Credentials API 代簽）
- `scripts/lib/iap-token.sh`（bash 版本，轉呼叫上面那支）
- `frontend/tests/e2e/utils/iapAuth.ts`（Node/Playwright 版本，已接進
  `playwright.config.ts` 的 `extraHTTPHeaders`，以及每一支自己開瀏覽器
  context 或自己發 `fetch()` 的 spec；有金鑰檔用 `node:crypto` 本機簽，
  沒有就呼叫 `gcloud iam service-accounts sign-jwt --iam-account=<SA>`
  代簽）
- CI workflow（`e2e-tests.yml`、`staging-deploy.yml`、
  `preview-deploy.yml`）已經有 `google-github-actions/auth@v2` 步驟，
  跑完之後 ambient 的 service account 身分就在，上面兩支工具的「沒有
  金鑰檔」分支可以直接用；只差設定 `IAP_AUDIENCE` 這個 secret，以及
  （若走 IAM Credentials 代簽路徑）確認該工作流程的服務帳號對自己有
  `roles/iam.serviceAccountTokenCreator`。

> 狀態（2026-10-24）：#3725／#3728／#3729 三個 PR 都已經 merge 進
> staging。這份文件描述的就是 staging 現在的狀態。

真的要開 IAP 之前，`IAP_AUDIENCE` 要設成什麼值，以及 frontend 自己的
nginx 同源代理在 backend 也開 IAP 之後，nginx 這一跳要怎麼帶自己的
IAP 憑證——後者**還沒有解決**，列在下面「已知落差」。

## 已知落差（誠實列出，還沒解決）

Cloud Run 原生 IAP 整合保護的是「所有打到這個服務的流量」，不只是瀏覽器
——包括同一個專案裡另一個 Cloud Run 服務對它發的請求。也就是說：如果
frontend 跟 backend **兩個都**開了 IAP，frontend 自己的 nginx 同源代理
要把請求轉給 backend 時，那一跳本身也需要一張有效的憑證——而且照上面
「已實測驗證」的結論，**不是隨便一張 ID token 就行，必須是服務帳號自簽
的 JWT**。純 nginx（`nginx:alpine`，沒有額外模組）完全沒有能力做這件
事：它不能呼叫 Google 的簽署 API，也沒有私鑰可以自己簽。這不是這份
文件或 #3719／#3725 其他 PR 解決掉的問題，是**接下來真的要對 backend
上鎖之前必須先驗證／設計的一塊**，也是 #3730 還留著沒關的原因。
**這一塊沒解決之前不可以對 staging 真的上鎖**——即使已經驗過「自簽
JWT 能通過 IAP」，也只驗了「外部呼叫端自己簽」這條路，不是「nginx 幫
使用者的瀏覽器流量轉送」這條路，兩者不是同一回事。可能的方向（還沒
選定）：

- 只在 backend 開 IAP，frontend 維持 `--allow-unauthenticated`
  （貼近「只有正式使用者會用到的網址公開」原始需求字面意思，
  因為使用者走的其實是 Firebase Hosting 網址，不是 frontend 的
  `*.run.app`；**但「Firebase rewrite 是否真的繞過 Cloud Run 本身的
  IAM/IAP 檢查」這一條本身也還是依官方文件推論，尚未實測驗證**，選這
  條路之前要先驗證這個前提）
- 幫 nginx 加一個會自己要／簽 token 的 sidecar／init container（例如
  定期呼叫 IAM Credentials API 簽好、寫進一個 nginx 讀得到的檔案，
  nginx 設定改成把檔案內容當 header 值送出）
- 把 nginx 換成一支薄的應用程式（能呼叫 IAM Credentials API 或讀本機
  金鑰自簽），而不是純靜態 nginx

這一塊、以及上面提到的 Firebase rewrite 前提，在正式對 staging 上鎖之
前都需要補一輪驗證，結果會補回這份文件。

#3731（通行證快取沒有過期機制）已經修掉：兩個語言現在都在硬性 1 小時
過期前 15 分鐘（45 分鐘進去）主動重簽，重簽那次剛好失敗的話會先用舊的
頂著（但不超過硬性過期），不會讓長跑程序突然開始收到 401。
