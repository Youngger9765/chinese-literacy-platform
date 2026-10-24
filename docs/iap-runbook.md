# IAP 準備與開關手冊（#3719）

> 現狀（2026-10-24）：staging 與所有 preview 服務都還是
> `--allow-unauthenticated`，跟這份文件存在之前完全一樣——**這份文件描述
> 的是「整條路徑已經在丟棄式 canary 上驗證過、還沒對任何真實環境打開」的
> 狀態**。#3719／#3725／#3728／#3729／#3730／#3731／#3733 都已經完成並
> merge 進 staging；本文件第「對 staging 真的打開」段落是**尚未執行**的
> 步驟清單，不是已發生的事。

## 為什麼要做這件事

均一要求：只有正式使用者會用到的網址公開，其他內部入口都先過身分驗證。
LingoLeap 目前 staging／preview 的 frontend 跟 backend 兩個 Cloud Run
服務都是直接公開的（`*.run.app`），而「正式會用到的網址」其實是
Firebase Hosting 那層（`lingoleap-staging.web.app` /
`lingoleap-dev.web.app`）——它透過 Firebase 的 serverless rewrite 連去
Cloud Run。**這一條（Firebase rewrite 是否真的繞過 Cloud Run 本身的
IAM/IAP 檢查）目前是依官方文件推論，還沒有實測驗證過**，列在下面
「已知落差」。

## 最終架構（2026-10-24 定案，#3733 修正）

最早的規劃是 frontend 跟 backend **都**上 Cloud Run 原生 IAP，但這留下一
個解不開的洞：frontend 自己的 nginx 同源代理轉送到 backend 那一跳，
nginx 沒辦法簽自己的 JWT。修正後、且**已經在丟棄式 canary 上完整實測
通過**的架構：

| 服務 | 驗證機制 | 給誰用 |
|---|---|---|
| **frontend** | Cloud Run 原生 **IAP** | 真人用均一 `@junyiacademy.org` Google 帳號互動登入；CI 用服務帳號自簽 JWT |
| **backend** | Cloud Run 本身的「需要驗證」機制（**不是**原生 IAP）——拿掉 `allUsers` invoker，只把 `roles/run.invoker` 授權給 frontend 的執行身分和 CI 的服務帳號 | frontend 自己的 nginx（透過下面的 sidecar）；CI 直接打 backend 時用一般 Google ID token |

backend 為什麼不走原生 IAP：Cloud Run 原生 IAP 整合背後是 Google 代管的
OAuth client，只接受服務帳號自簽的 JWT（見下面「frontend 認證方式」），
而 nginx 完全沒有能力做這件事——沒有私鑰，也不能打 IAM Credentials API。
改用 Cloud Run 本身「需要驗證」的 invoker 機制後，呼叫端只要跟
**metadata server** 要一張一般的 Google ID token（不用簽章、不用 IAM
Credentials API、不用任何額外的 IAM 授權），這件事一支十幾行的 stdlib-only
Python 小程式就做得到——那就是 `scripts/run_invoker_token.py`，跑成
frontend 旁邊的一個 **sidecar 容器**，由 nginx 的 `auth_request` 去問它
要 token，再用 `X-Serverless-Authorization`（不是 `Authorization`，那個
app 自己在用）轉給 backend。

查證過官方文件
(https://docs.cloud.google.com/run/docs/authenticating/service-to-service)：
呼叫端身分需要目標服務的 `roles/run.invoker`；「若兩個 header 都給，只認
`X-Serverless-Authorization`」且會在轉給 app 之前把簽章拿掉，app 完全
看不到也不用管這個 header。

## 一步打開（目前的開關位置）

**frontend（IAP）**：

| 環境 | 檔案 | 開關 |
|---|---|---|
| 所有 PR preview | `.github/workflows/preview-deploy.yml` | `env.IAP_ENABLED` |
| staging（常駐） | `.github/workflows/staging-deploy.yml` | `env.IAP_ENABLED` |

把對應檔案裡的 `IAP_ENABLED: 'false'` 改成 `IAP_ENABLED: 'true'`，推一個
PR／merge 進 staging，部署腳本就會在 frontend 這個 Cloud Run 服務上開啟
IAP（`gcloud beta run services update --iap`）。這一步**只決定「這個服務
要不要過 IAP」**，不決定「誰能進去」——誰能進去是下面「開發人員／外部
審查者要做什麼」那一段的事，是另一條獨立的 IAM 機制。

**backend（Cloud Run invoker 驗證）**：目前**沒有**對應的 `IAP_ENABLED`
式開關——這條路線沒有被寫進部署流程，只在丟棄式 canary 上手動驗證過（見
下面「對 staging 真的打開：完整步驟（尚未執行）」）。要在 staging 上打開
backend 的這層保護，需要走那段清單裡的步驟，不是改一個環境變數。

## 回滾（關掉）

**frontend**：把 `IAP_ENABLED` 改回 `'false'`，merge。下一次部署就會是
`--allow-unauthenticated` 的狀態——IAP 本身的 on/off 是 Cloud Run 服務的
一個設定值，不是另外架的基礎設施，關掉不會留下殘留資源要清。

**backend**：`gcloud run services update <service> --allow-unauthenticated`
即可退回公開狀態；已經授權的 `run.invoker` binding 不會因此消失，只是
暫時用不到，真的要清乾淨再另外 `remove-iam-policy-binding`。

## frontend 認證方式：已實測驗證（#3730）

下面這段不是推論，是 2026-10-24 真的建了一個丟棄式服務
（`lingoleap-iap-canary`，Google 官方 hello 映像，沒有程式、沒有金鑰、
不對外），開了 Cloud Run 原生 IAP，實測三件事之後得到的結果：

| 測試 | 結果 |
|---|---|
| 匿名連線（完全不帶憑證） | 302 轉向 Google 登入頁 —— 被擋，符合預期 |
| 帶一般 Google 簽名 ID token，audience 試過 OAuth client ID／服務網址／projects 路徑三種 | **一律 401 "Invalid JWT audience"**，不管放在 `Authorization` 還是 `Proxy-Authorization`，三種 audience 都一樣 |
| 帶**服務帳號自簽的 JWT**（`iss` = `sub` = 服務帳號 email，`aud` = 服務網址，`exp` 不超過 1 小時） | **200**，`Authorization` 或 `Proxy-Authorization` 都通過；`aud` 用服務網址本身、網址加 `/`、或網址加 `/*` 三種寫法都驗得過 |

真正要用的是**服務帳號自己簽的 JWT**，簽法依環境分兩種（`scripts/iap_token.py`
／`scripts/lib/iap-token.sh`／`frontend/tests/e2e/utils/iapAuth.ts` 已按此
實作，單元測試鎖著 claims 的形狀不會漂走）：

1. 本機或有實體金鑰檔的環境 → 直接用金鑰裡的私鑰本機簽，不打任何網路請求。
2. CI／沒有實體金鑰檔的環境 → 請 IAM Credentials API 用系統代管金鑰代簽
   （Python 用 `google.auth.iam.Signer`；Node 用
   `gcloud iam service-accounts sign-jwt --iam-account=<SA>`）。

快取有 TTL（#3731）：45 分鐘進去就主動重簽，不是簽好就用到天荒地老；
重簽那次剛好失敗會先用舊的頂著（不超過硬性 1 小時過期）。

## backend 認證方式：Cloud Run run.invoker + sidecar（已實測驗證，#3733）

2026-10-24 用一對丟棄式 canary 服務完整驗證過整條路徑：

- `lingoleap-invoker-canary`（backend 角色，hello 映像，
  `--no-allow-unauthenticated`，只把 `roles/run.invoker` 授權給測試用
  的服務帳號）
- `lingoleap-frontend-invoker-canary`（frontend 角色，真的 nginx +
  `run_invoker_token.py` sidecar 這組 image，開了原生 IAP）

實測結果：

| 測試 | 結果 |
|---|---|
| 匿名直接打 backend canary | 403 |
| 匿名打 frontend canary | 302 轉 Google 登入 |
| 匿名打 frontend canary 的 `/api/` | 302 轉 Google 登入（同源代理也在 IAP 後面） |
| 服務帳號自簽 JWT 直接打 backend canary，放 `X-Serverless-Authorization` | 401 → **~2 分鐘 IAM propagation 後變 200**（`run.invoker` binding 生效需要等傳播，不是立即的） |
| 服務帳號自簽 JWT 打 frontend canary（走 IAP） | 200（回 `index.html`） |
| 同一張 JWT 打 frontend canary 的 `/api/` | **200**，內容是 backend 的頁面——nginx 的 `auth_request` 問 sidecar 要到一張 Cloud Run ID token，轉成 `X-Serverless-Authorization` 給 backend，backend 接受 |

⚠️ 用工具驗證 302 時注意：`urllib`／某些 HTTP client 預設會自動跟隨
redirect 到 Google 登入頁，該頁本身回 200，容易誤判成「沒被擋」。要用
`curl -D- -o /dev/null`（不跟隨 redirect）或明確檢查最終落地網址，才看得
到真正的 302。

### sidecar 的安全加固（自動化安全審查發現，已修）

sidecar（`scripts/run_invoker_token.py --serve`）一開始綁 `0.0.0.0`
被自動化安全審查標成 MEDIUM（「未驗證的 token 核發端點對所有介面開
放」）。雖然 Cloud Run 本身只會把 ingress 容器的 port 暴露給外部、sidecar
的 port 理論上連不到，但加了深度防禦：

- 只有**呼叫端真的是 loopback**（`127.0.0.1`/`::1`，即 nginx 在同一個
  Cloud Run 實例裡打 `127.0.0.1`）才會發 token
- 非 loopback 呼叫端打 `/` 一律 **403**，且**完全不會嘗試核發 token**
- 新增 `/healthz`（任何呼叫端都回 200、不帶 token）給 Cloud Run 的
  startup/liveness probe 用——探針永遠不會碰到核發 token 的邏輯
- Dockerfile 拿掉 `EXPOSE 8081`（純文件性質，但少一個「這個 port 本來就
  該開」的暗示）

**部署這個 sidecar 時，startup probe 務必指向 `/healthz`，不是 `/`**
（下面的指令已經這樣寫）。

### 驗證過的部署指令

兩個映像都必須是 **`linux/amd64`**——在 arm64 Mac 上本機建置會產生
arm64 或 multi-arch index，Cloud Run 會直接拒絕部署
（`Container manifest type ... must support amd64/linux`）。確認方式：
`docker buildx imagetools inspect <image> --format '{{json .Image.Platform}}'`
要印出 `{"architecture":"amd64","os":"linux"}`。

```bash
# frontend image：Dockerfile 的 npm build 階段在本機 QEMU 模擬下會讓
# esbuild 的原生二進位當掉（已知的一類失敗，不是偶發）——用 Cloud Build
# 的真 amd64 worker 蓋過去，不要用本機 buildx 模擬：
gcloud builds submit --config=cloudbuild-frontend.yaml --project=lingoleap-dev frontend/
# cloudbuild-frontend.yaml 裡用 `docker build --build-arg BACKEND_INTERNAL_URL=... \
#   --build-arg BACKEND_INVOKER_SIDECAR_PORT=8081 -t <tag> .`（gcloud builds submit
# 本身不支援 --build-arg，要包一層 cloudbuild.yaml）

# sidecar image：純 stdlib Python，沒有 npm build 階段，本機 buildx 模擬沒問題：
docker buildx build --platform linux/amd64 \
  -f scripts/invoker-sidecar/Dockerfile \
  -t asia-east1-docker.pkg.dev/lingoleap-dev/lingoleap/invoker-sidecar:<tag> \
  --push .

# backend（Cloud Run invoker 驗證，不開 IAP）：
gcloud run deploy <backend-service> \
  --project=lingoleap-dev --region=asia-east1 \
  --image=<backend-image> \
  --no-allow-unauthenticated

gcloud run services add-iam-policy-binding <backend-service> \
  --project=lingoleap-dev --region=asia-east1 \
  --member="serviceAccount:<frontend-runtime-sa>" \
  --role="roles/run.invoker"
# 同樣的 binding 也要給 CI 直接打 backend 用的服務帳號（verify_*.py、
# health-check.sh 等）。授權後等 ~2 分鐘再測，propagation 不是立即的。

# frontend（nginx + sidecar 雙容器，開 IAP）：
gcloud beta run deploy <frontend-service> \
  --project=lingoleap-dev --region=asia-east1 \
  --iap \
  --container=frontend \
    --image=<frontend-image> \
    --port=8080 \
    --depends-on=sidecar \
  --container=sidecar \
    --image=<sidecar-image> \
    --update-env-vars=BACKEND_INVOKER_AUDIENCE=<backend-service-url> \
    --startup-probe=httpGet.port=8081,httpGet.path=/healthz,periodSeconds=2,failureThreshold=3
```

⚠️ 兩個用法上的坑，都已經踩過：
- `gcloud run deploy ... --container=X ...` 時，**所有非 container 層級
  的 flag（`--project`/`--region`/`--iap`）必須寫在第一個 `--container`
  之前**，不然整個指令直接失敗（gcloud 自己的 `--help` 原文：「you must
  specify all non-container-level flags before the container-level
  flags」）。
- 給 sidecar 容器設環境變數要用 **`--update-env-vars`，不是那個會
  整組覆寫環境變數的旗標**——本機有一支 `gcloud` 防護 hook 直接擋下
  整組覆寫的用法：那個用法會把服務**現有的所有環境變數**（含
  `DATABASE_URL`、各種 secret）一次清空，只留這次指定的幾個，
  2026-04-18 staging 就因為這樣被清空 `DATABASE_URL` 炸過一次 500。
  用「只更新指定幾個 key、其他環境變數原封不動」的那個旗標
  （`--update-env-vars`）才安全，效果一樣達到、不會動到其他變數。

## 對 staging 真的打開：完整步驟（⚠️ 尚未執行，只是清單）

> 以下是「如果要在 staging 上真的打開這整套保護」該做的事，**目前一項
> 都還沒做**。寫在這裡是為了下次要做的時候不用重新設計一次，不是已完成
> 的紀錄。

1. 把 `.github/workflows/staging-deploy.yml` 的 frontend build 步驟加上
   `BACKEND_INVOKER_SIDECAR_PORT` build-arg（目前只有
   `BACKEND_INTERNAL_URL`），並新增一個 sidecar image 的 build+push 步驟
   （參考上面驗證過的 `cloudbuild-frontend.yaml` 做法，CI 環境是原生
   amd64 runner，不會撞到本機 QEMU 的 esbuild 當機問題，可以直接
   `docker build` 不用額外繞路）。
2. 把 `staging-deploy.yml` 的 backend 部署步驟從
   `--allow-unauthenticated` 改成 `--no-allow-unauthenticated`，並加一步
   `add-iam-policy-binding` 把 `roles/run.invoker` 授權給 staging
   frontend 的執行身分（預設運算服務帳號，或自訂的 runtime SA）和跑
   `verify_*.py`／health-check 的 CI 服務帳號。
3. 把 frontend 的部署步驟改成 `gcloud beta run deploy` 的雙容器語法（見
   上面驗證過的指令），`--iap` 這個開關沿用既有的 `IAP_ENABLED` 環境變數
   機制（`.github/workflows/staging-deploy.yml` 裡已經有這段，只是目前
   `IAP_ENABLED` 預設 `'false'`）。
4. 確認 CI 本身打 staging 的腳本（`verify_qr_manifest.py`、
   `verify_lesson_audio.py`、`health-check.sh`、`run-load-test.sh`、
   `locustfile.py`）要從「直接打 backend 公開網址」改成用
   `scripts/run_invoker_token.py` 的 `invoker_header()` 取得 ID token，
   放進 `X-Serverless-Authorization`；Playwright 測試打 frontend 的部分
   維持用 `scripts/iap_token.py`／`iapAuth.ts` 的自簽 JWT 不變。
5. 先在**一個 PR preview**上走完整套（不是直接對 staging 動手），把
   「backend 認證方式」那張實測表的幾項（匿名兩邊都擋、frontend 用自簽
   JWT 進得去、經 frontend 轉送到 backend 也進得去）在真實 CI 環境（不是
   本機 canary）重跑一次，確認一樣成立。
6. 只有在上一步全部通過之後，才能把同樣的改動 merge 進
   `staging-deploy.yml`，對 staging 真的生效。
7. 完成後刪掉兩個丟棄式 canary 服務（`lingoleap-iap-canary`、
   `lingoleap-invoker-canary`、`lingoleap-frontend-invoker-canary`）。

## 開發人員要做什麼

**用瀏覽器操作（人）**：用自己的 `@junyiacademy.org` Google 帳號登入即可。
IAP 對瀏覽器走的是互動式 Google 登入，只要帳號屬於 `junyiacademy.org`
網域，就會在一次性的網域授權底下自動放行，不需要個別加人。backend 不會
有獨立的登入畫面——所有真人流量都是先進 frontend（過 IAP），再由
frontend 的 sidecar 代為認證到 backend，使用者感覺不到這一層。

**外部審查者（沒有 junyiacademy.org 帳號的人）**：需要個別、限時授權。
#3720（「IAP 開通名單：後台唯讀管理頁」，PR #3724，已 merge）把這一塊
蓋好了：

- `scripts/iap-grant.sh <email> <期限如 7d> "<姓名>" [--service=...]`
  ——開通，走 `gcloud beta iap web` 這組指令，幫這個人綁定
  `roles/iap.httpsResourceAccessor`，附一個到期時間的 IAM 條件，到期
  自動失效。**拒絕對正式環境服務下手**（硬寫死 staging/preview 的服務
  名稱）。
- `scripts/iap-list.sh [--service=...]` ——列出目前名單（唯讀）。
- 後台管理頁（`/admin/iap-allowlist`）給管理員看同一份資料。

這兩支腳本跟後台頁面現在都能跑，但實際讀/寫 GCP IAM 需要執行者的
gcloud 帳號已有對應權限（後台頁面讀取那端額外需要授權，PR #3724 的
說明寫著這個權限**目前還沒授予**，所以頁面現在會顯示「尚未設定
IAP」——這是預期狀態，不是 bug；見下面「已知落差」關於這個權限範圍
太大的問題）。

## 自動化要做什麼（已經接好的部分）

Headless 的自動化（CI、Playwright、本機 QA 腳本）沒辦法走 IAP 的互動式
瀏覽器登入：

- **打 frontend**（過 IAP）：帶服務帳號自簽 JWT，放
  `Proxy-Authorization`。`scripts/iap_token.py`（Python）／
  `scripts/lib/iap-token.sh`（bash）／`frontend/tests/e2e/utils/iapAuth.ts`
  （Node，已接進 `playwright.config.ts` 的 `extraHTTPHeaders`）。
- **打 backend**（Cloud Run invoker 驗證，不是 IAP）：帶一般 Google ID
  token，放 `X-Serverless-Authorization`。`scripts/run_invoker_token.py`
  的 `invoker_header()`／`get_invoker_token()`，供
  `content_evidence_gate.py`、`story_structure_qa.py`、
  `spotlight_faithfulness_check.py`、`health-check.sh`、
  `run-load-test.sh`、`locustfile.py`、`backend/scripts/verify_*.py`
  使用。這支直接跟 Cloud Run 的 metadata server 要 token，不需要簽章、
  不需要 IAM Credentials API，只需要呼叫端的身分對目標服務有
  `roles/run.invoker`。

兩層都是**零行為改變**：`IAP_AUDIENCE`／`BACKEND_INVOKER_AUDIENCE` 現在
誰都沒設，兩支工具的頂層函式都先檢查這個，沒設就直接回 `None`／`{}`，
完全不會嘗試打任何網路請求。

CI workflow（`e2e-tests.yml`、`staging-deploy.yml`、`preview-deploy.yml`）
已經有 `google-github-actions/auth@v2` 步驟，跑完之後 ambient 的服務帳號
身分就在，兩支工具「沒有金鑰檔」的分支可以直接用。

## 已知落差（誠實列出，還沒解決）

1. **Firebase Hosting rewrite 是否真的繞過 Cloud Run 本身的 IAM/IAP
   檢查**——目前只是依官方文件推論，沒有實測驗證過。如果「只在 backend
   開保護、frontend 維持公開」這條路線未來要考慮，必須先驗證這個前提；
   目前採用的架構（frontend 也上 IAP）不依賴這個假設成立，所以不是
   立即的阻塞點，但文件裡只要還留著這個前提就該標注清楚。
2. **IAP 開通名單後台頁需要的 IAM 權限範圍太大**——PR #3724 的實作需要
   `roles/iap.admin` 才能讀取/寫入 IAP 存取名單，這個角色範圍比實際需要
   的大很多；應該改成自訂的、只能讀寫 IAP policy 的最小權限角色，目前
   還沒做，所以頁面顯示「尚未設定 IAP」。
3. **兩個丟棄式 canary 服務還留著**（`lingoleap-iap-canary`、
   `lingoleap-invoker-canary`、`lingoleap-frontend-invoker-canary`）——
   確認上面「對 staging 真的打開」的步驟不再需要參考這幾個服務之後即可
   刪除，不是正式環境的一部分，不影響任何真實服務。
4. **staging QA 測試帳號的清理、唯讀 DB 角色**——跟 IAP 本身無關，是
   IAP 準備期間一併發現的既有技術債，還沒處理。
