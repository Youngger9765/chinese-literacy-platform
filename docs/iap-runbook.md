# IAP 準備與開關手冊（#3719）

> 現狀（2026-11-16 更新：部署接線已備好、開關仍關）／原文 2026-10-24：staging 與所有 preview 服務都還是
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

**backend（Cloud Run invoker 驗證）**：同一個 `IAP_ENABLED` 開關（#3733
起）。打開時 backend **不會**被上原生 IAP，而是：先把 `roles/run.invoker`
授權給 `lingoleap-frontend-run`（frontend 執行身分）與 `github-actions`
（CI），再拿掉 `allUsers`（先給再收）。這一步有防呆：
`SAME_ORIGIN_PROXY_ENABLED` 不是 `'true'` 就直接失敗、不動任何 IAM——
因為同源代理沒開時瀏覽器會直接打 backend，鎖了就全站 403。

⚠️ 兩個開關要**一起**打開（`IAP_ENABLED` 與 `SAME_ORIGIN_PROXY_ENABLED`）；
部署接線（nginx＋sidecar 雙容器、CI 帶 invoker ID token、backend 部署就鎖）
已在 #3733 第二輪寫好（見下面「對 staging 真的打開」表）。開之前還要先給
一次性 IAM（同一段），並先在一個 preview 上走過一次。

## 回滾（關掉）

**正規做法**：兩個 workflow 把 `IAP_ENABLED` 改回 `'false'` merge。下一次部署：
backend 以 `--allow-unauthenticated` 部署（`allUsers` 回來）；frontend 若還開著
IAP，`（IAP_ENABLED 關時）…若還開著 IAP 就關掉` 那一步會 `--no-iap`（#3733 補上，
之前只改開關其實關不掉 frontend 的 IAP）。只有 frontend 有變動、backend job
被跳過時，frontend job 會先跑 `（IAP 開關為 false 時）backend 若被鎖著就先補回
allUsers`，再部署直接打 backend 的 frontend（資安審查補上）。

**立即手動（不等 CI）**：
- frontend：`gcloud beta run services update <frontend> --no-iap --region asia-east1 --project lingoleap-dev`
- backend：用目前的 image 重新部署並帶 `--allow-unauthenticated`
  （`gcloud run deploy <backend> --image <現在的 image> --allow-unauthenticated --region asia-east1 --project lingoleap-dev`，
  環境變數沿用），或 `add-iam-policy-binding --member=allUsers --role=roles/run.invoker`。
- 已授權的 `run.invoker`／IAP accessor binding 不會因此消失，只是暫時用不到。

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

## 對 staging 真的打開：步驟（程式接線已完成，開關仍預設關）

> 2026-11-16（#3733 第二輪）：部署流程的接線都已經寫進兩個 workflow，
> 並用「真的執行 workflow 的 run 腳本、假 gcloud/docker/curl 記錄參數」
> 的測試鎖住（`backend/tests/test_iap_open_wiring_3733.py`、
> `scripts/test_iap_token_sh.py`）。**兩個開關仍是 `'false'`**，今天的
> 部署行為不變。

| # | 項目 | 狀態 |
|---|---|---|
| 1 | proxy 開時 build＋push sidecar image（`invoker-sidecar:<tag>`） | ✅ |
| 2 | backend：`IAP_ENABLED` 開時部署就帶 `--no-allow-unauthenticated`（不再「先公開、下一步才鎖」）；之後的步驟授權 `run.invoker` 給 frontend 執行身分與 CI，再拿掉 `allUsers` | ✅ |
| 3 | frontend：proxy 開時改 `gcloud beta run deploy` nginx＋sidecar 雙容器（sidecar 探針 `/healthz`、`BACKEND_INVOKER_AUDIENCE`） | ✅ |
| 4 | backend：proxy 開時設 `FRONTEND_PROXY_SA`＋`BACKEND_AUDIENCE`（固定 `-958347263320` 網址，與 sidecar 的 audience 逐字相同） | ✅ |
| 5 | CI 打 backend（health、smoke、preview warm-up）：`google-github-actions/auth` 以 `token_format: id_token` 取 invoker ID token，放 `X-Serverless-Authorization`；不需新 IAM（`workloadIdentityUser` 已含 `getOpenIdToken`） | ✅ |
| 6 | CI 打 frontend：IAP 開時以 frontend 自己的網址當 aud 自簽 JWT；Runner 沒有 google-auth，`scripts/lib/iap-token.sh` 改為退回 `gcloud iam service-accounts sign-jwt` | ✅ |
| 7 | 把開關切回 `'false'` 時，若 frontend 還開著 IAP 就 `--no-iap`（`gcloud run deploy` 本身不會動 IAP 設定，舊版「改回 false 就恢復」其實不成立） | ✅ |
| 8 | `e2e-preview-check`（刻意不持有 GCP 憑證）在 IAP 開時跳過，不假裝測過 | ✅ |
| 9 | 順序（資安審查）：frontend 的 `gcloud beta run deploy` 本身就帶 `--iap`，新 revision 從第一秒就在 IAP 後面；之後的「開 IAP」步驟保留為冪等重設。舊版「先 `--allow-unauthenticated` 部署、下一步才 `--iap`」中間有匿名者經 nginx＋sidecar 打到已鎖 backend 的空窗 | ✅ |
| 10 | 順序（資安審查）：backend 服務已存在時，**部署前**先授權 `run.invoker` 給 frontend 執行身分與 CI（部署帶 `--no-allow-unauthenticated` 會立刻拿掉 `allUsers`）；第一次部署的 preview 沒有服務可綁就跳過，部署後那一步照舊冪等補授權。proxy 沒開就在這一步失敗，什麼都還沒部署 | ✅ |
| 11 | 反向檢查（資安審查）：IAP 開時**完全不帶憑證**打一次——backend `/api/health` 必須 403、frontend 根目錄必須 302／401／403（不可 200），否則 job 失敗。staging 在 `smoke-test` job、preview 在 frontend 健康檢查之後 | ✅ |
| 12 | 回滾（資安審查）：開關切回 `'false'` 時，frontend job 在部署非代理版 frontend **之前**先看 backend 的 IAM，沒有 `allUsers` 就補回 `run.invoker`（只動 frontend 時 backend job 會被跳過，否則 backend 會一直鎖著、全站 403）。已經是公開的（今天的正常狀態）就完全不寫 IAM | ✅ |

**開門前一次性要給的 IAM（要 Young 同意，workflow 本身不會做）**：
- `github-actions@` 對**自己**的 `roles/iam.serviceAccountTokenCreator`（CI 才簽得出 IAP 要的自簽 JWT）
- 每個開了 IAP 的 frontend 服務：`roles/iap.httpsResourceAccessor` 給 `github-actions@`（CI health）與要進來的人

**仍未接的**：`e2e-tests.yml`（打 staging 的 Playwright／QA 腳本）在 IAP 開時要能簽 JWT——同一個 tokenCreator 授權即可，但 workflow 還沒驗過。

**Firebase 兩個站已改成整站轉址**：`lingoleap-staging.web.app`／`lingoleap-dev.web.app` 每個路徑都 302 到 staging Cloud Run frontend（`firebase.json`）。Firebase rewrite 帶不了 invoker token，backend 一鎖 `/api` 就會 403，所以不再代理。`Verify Firebase sites` 改驗 302 與目的地，鎖在 `backend/tests/test_firebase_staging_redirect_3733.py`。

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

1. ~~Firebase Hosting rewrite 是否繞過 Cloud Run 本身的驗證~~ ——
   **2026-11-16 實測：不會繞過。** 拋棄式 Hosting site 兩條 rewrite：
   `/pub/**` → 公開的 hello 服務回 **200**（對照組，證明 rewrite 本身有效）；
   `/**` → `--no-allow-unauthenticated` 的 hello 服務回 **403 Forbidden**。
   測完 site 與兩個服務都已刪除。**後果**：backend 一鎖，所有 rewrite 到它的
   Firebase 站（staging 的 `lingoleap-staging.web.app`、`lingoleap-dev.web.app`）
   `/api`、`/assets`、`/q` 都會 403——它們不是保護的漏洞，但會壞掉。
   **已處理**：這兩個站改成整站 302 到 staging Cloud Run frontend（見上面
   「對 staging 真的打開」段末）。
2. **IAP 開通名單後台頁需要的 IAM 權限範圍太大**——PR #3724 的實作需要
   `roles/iap.admin` 才能讀取/寫入 IAP 存取名單，這個角色範圍比實際需要
   的大很多；應該改成自訂的、只能讀寫 IAP policy 的最小權限角色，目前
   還沒做，所以頁面顯示「尚未設定 IAP」。
3. ~~兩個丟棄式 canary 服務還留著~~ —— 已刪除：2026-11-15 查
   `gcloud run services list`（lingoleap-dev／asia-east1），
   `lingoleap-iap-canary`、`lingoleap-invoker-canary`、
   `lingoleap-frontend-invoker-canary` 都已不在清單上。
4. **staging QA 測試帳號的清理、唯讀 DB 角色**——跟 IAP 本身無關，是
   IAP 準備期間一併發現的既有技術債，還沒處理。
