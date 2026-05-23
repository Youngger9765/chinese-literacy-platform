# PM Dogfood Round 2 — 2026-05-23

**Environment**: staging
**Coverage**: 補 Round 1 漏跑的 5 個 flow（admin / OMO / onboarding / parent / secondary surfaces）
**Screenshots**: 22 圖 in `/tmp/pm-dogfood-r2/`
**Trigger**: Young 4 個問號「PM 完整體驗都有跑完嗎？？」 → confirm Round 1 only covered student happy path + assignment lifecycle, missing 5 personas/flows

---

## Coverage delta vs Round 1

| Flow | Round 1 | Round 2 |
|---|---|---|
| 學生 12 step learning | ✅ | — |
| 教師派作業 → 批改 lifecycle | ✅ | — |
| **管理員王管理員** | ❌ | ✅ |
| **OMO 拍照識別** | ❌ | ✅ |
| **教師建班 + 學生 join code onboarding** | ❌ | ✅ |
| **家長 ParentLink** | ❌ | ✅（部分）|
| **Toolbox / Library / Learning History 深測** | 截圖無深測 | ✅ |

---

## P0 critical breaks (Round 2)

### 1. CSP 阻擋 blob: 圖片（影響 OMO + 任何 client-side image preview）

Console error:
```
Loading the image 'blob:https://.../d2d2a617-e2d7-4e62-96b1-162f830d199c' violates
Content Security Policy directive: "img-src 'self' data: https:". The action has been blocked.
```

Fix: backend/Cloud Run CSP header 需加 `blob:` 進 `img-src` directive。

### 2. Admin 角色 onboarding 把管理員當教師

王管理員第一次登入流程：
1. Modal terms「我同意使用條款」（4 checkbox 含「我確認建立的班級及學生確實與實體教學一致」）— admin **不會建班/上傳課文**，這個 modal 不該對 admin 出現
2. 過了 modal 後 **第二道 terms 頁** 顯示「教師承諾」+「教師帳號 王管理員」+ 4 個 checkbox「我確認上傳的課文來自學校合法採購的教科書」等

兩道條款 = onboarding 重複 + 角色判斷錯誤。Admin 應該看 admin-specific 條款（或跳過 teacher 條款）。

screenshot: `02-terms-modal.png` `03-after-accept.png`

### 3. AdminDashboard React render error

Console:
```
react_render_error: Cannot read properties of undefined (reading 'length')
  at hr (AdminDashboard-B_iZA-CV.js:12:14048)
  at useMemo (...)
```

Trigger: click 系統管理 sub-menu（TTS 句子稽核 / 角色管理 / 使用者管理）切換時。Component 有條件 `.length` 訪問 undefined 變數。Error boundary fallback OK 但 React tree crash。

### 4. Admin 視角的「班級管理」顯示 0 班

王管理員（系統管理員）進「班級管理」→「共 0 個班級 / 尚未建立班級」+ CTA「建立你的第一個班級」。

期望：admin 看到全平台所有班級（朗朗教育基金會旗下 2 校的班級 — 至少 Bulk驗證 2026-05-16 / 三年甲班 / 五年乙班 / 七年甲班 / PM Dogfood R2 班）。實際：query 走 teacher-scope（只看 admin 自己建的班）。

screenshot: `12-class-mgmt.png`

### 5. 使用者管理 列出真實 Gmail PII（seed data 污染）

王管理員 → 使用者管理：
- Jay Tzeng / **jay.tzeng@gmail.com**
- Kuanweilu / **kuanweilu@gmail.com**
- 其他用 @test.com 格式

Seed data 混了真實 Gmail 帳號 — staging demo 時管理員 demo 會看到別人的 email。

Fix: seed script 統一用 `@test.com` 或 `@demo.lingoleap.local`。

screenshot: `11-user-mgmt.png`

### 6. 王管理員 同時被 assign 教師 role

`使用者管理` 顯示王管理員角色: `系統管理員` + `機構管理員` + **`教師`** — 解釋了為什麼 onboarding 第二道顯示「教師承諾」。Admin 不該預設 teacher role（除非該 admin 本身也教課）。

---

## P1 friction (Round 2)

### Onboarding

1. **加入班級成功沒 toast** — 學生輸入 join code → submit → 跳回 /student → sidebar 數字沒立刻更新 → 學生不確定加入成功。需自己點「班級作業」看新班才能驗證。
2. **教師建班成功沒 toast** — 建班後直接出現在列表，沒 modal/banner 確認。
3. **DOM 有 2 個 terms modal 同時存在**（admin onboarding 第一道）— 第二個 hidden 但仍在 DOM tree（@e7-e11 + popover-child），interactive ref 抓得到但 click timeout。CSS visibility 沒清乾淨。

### OMO

4. **OMO 沒擋下「上傳非學習單」case** — Sample 上傳了一張課文書頁（不是學生填寫的學習單），identifier 仍識別 G6-L03（confidence 0.95）+ 從 YAML 預載 10 題 + 全部 grader「作答區空白」給 0 分。應該 pre-check「這張看起來是書本 / 沒作答區，請重拍學習單」。
5. **OMO Result 沒顯示 identifier 多候選 + 信心度** — Raw response 有 `candidates: [{lesson_id:3, conf:0.95}, {lesson_id:11, conf:0.9}]`，前端只用第一個，學生無法 dispute「不是這課」。
6. **「批改有誤?」按鈕無 visible reasoning** — Backend response 含 reasoning field（『學生在選項 B 上畫了一個圈』等），UI 沒展開 reasoning 段，學生看不到批改邏輯。

### Admin

7. **TTS 句子稽核 / 角色管理 / 使用者管理 切換不穩** — 切完一個再切下一個有 chance 觸發 AdminDashboard render crash（見 P0 #3）。

### 多 UI

8. **學生小明出現在「七年甲班」** — 三年級學生加入七年級班 + Round 1 也指出小明練 4-8 年級課文 = seed data persona drift（這是 demo 而非 prod，但會混淆 demo story）。

---

## P2 product opportunities

1. **Admin 全平台 metrics dashboard** — 目前 admin 主視窗只顯示「從左側樹狀結構選擇機構或學校」placeholder。缺：今日活躍 / 本週作業數 / 教師活躍度 / 預警學生數 等 platform-wide insight。
2. **Admin 點數使用紀錄** — 機構 detail 有「點數使用紀錄: 共 0 筆 / 尚無使用紀錄」panel，但無 onboarding 教 admin 點數是什麼、怎麼補。Empty state 應該解釋產品概念 + 提供 CTA。
3. **OMO confidence UI** — Score 90% 用 ✓ / 60-90% 用 ⚠️ / <60% 用 ✗，搭配「再拍一次」CTA。Round 1 也提同樣 pattern。
4. **學習紀錄 自學紀錄 tab** — 顯示但測試帳號是空，需 seed 一筆自學完成的紀錄才能 demo。

---

## Parent Portal 狀態

- ✅ Schema: `ParentStudentLink` model 完整（`backend/app/models/parent_link.py`）
- ✅ Backend: `/api/parents/invite-codes` + `/api/parents/link` endpoints 上線（curl 回 405 表示 route 已 register）
- ✅ Frontend: `ParentDashboard.tsx` 元件存在（`frontend/src/pages/parent/`）
- ❌ **Feature flag**: staging build 沒設 `VITE_PARENT_PORTAL_ENABLED=true` → AppRoutes 不 register `/parent` route → goto `/parent` 自動 redirect 回 `/student`

要 demo parent flow：加 `VITE_PARENT_PORTAL_ENABLED=true` 進 `staging-deploy.yml` env vars 重新 deploy。

---

## Strong points found in Round 2

### Admin
- ✅ 機構 → 學校 tree navigation 直覺
- ✅ 角色管理列出 8 個 role + scope 標籤（platform / 機構 / 學校）— 清楚
- ✅ 使用者管理 search + filter + 一鍵管理角色
- ✅ Sidebar 切「管理員 ↔ 老師」combobox — 同帳號雙身分切換流暢
- ✅ 機構 detail 含「使用中 / 學校數 / 建立日期」基本資訊 panel

### Onboarding
- ✅ 教師建班只要「名稱 + 年級」最小欄位
- ✅ Join code 顯示大字 + 一鍵複製 + 重生
- ✅ Hint copy「把此代碼給學生，他們從首頁「加入班級」輸入即可加入」清楚指引

### OMO
- ✅ Identifier 識別精準（G6-L03 confidence 0.95，正確）
- ✅ Grader vision 結果 truthful — 看到空白就標空白，沒謊報
- ✅ Backend response 結構完整（candidates / answers with reasoning / ai_confidence / position / crop_image_url）
- ✅ 上傳 → upload 201 → 自動 redirect 結果頁
- ✅ 拍照 + 從相簿選擇兩個入口

### Secondary surfaces
- ✅ 練習工具箱：選課文 × 選工具 雙軸選擇，直覺
- ✅ 學習紀錄：作業回顧 / 自學紀錄 tab + 過往作業 timeline
- ✅ 圖書館：課文 cover image grid + 年級篩選

---

## Top 5 to fix before 5/16 demo

1. **🔴 [P0] CSP 加 blob:** — 一個 deploy.yml / nginx config 改動，影響 OMO 全功能 + 任何 client image preview
2. **🔴 [P0] Admin onboarding terms 重複 + 角色錯誤** — admin 看 admin 條款（一道），不要看 teacher 條款
3. **🔴 [P0] AdminDashboard `.length` undefined crash** — 加 `?.length ?? 0` null guard，補 react-error-boundary
4. **🔴 [P0] Admin 班級管理 query 改 platform-scope** — 系統管理員應該看到所有班級不是自己建的
5. **🟡 [P1] OMO 「非學習單」detection** — Pre-check vision「圖中有作答區嗎」，沒有 → 提示重拍，不假裝批改 0 分

---

## Appendix: file refs

- Admin sidebar: `frontend/src/pages/admin/AdminTreeSidebar.tsx` + AdminDashboard.tsx
- OMO: `frontend/src/pages/omo/OmoPage.tsx` + `frontend/src/components/omo/OmoResultPage.tsx`
- Join class: `frontend/src/pages/JoinClassroomPage.tsx`
- Parent: `frontend/src/pages/parent/ParentDashboard.tsx`（feature flag off）
- Toolbox: `frontend/src/pages/student/...`（待查實際 path）
- Backend OMO: `backend/app/routes/omo.py`（split per #1770）
- Backend parent: `backend/app/routes/parents.py` + `models/parent_link.py`
- CSP config: `backend/app/main.py`（找 `Content-Security-Policy` header）

22 screenshots: `/tmp/pm-dogfood-r2/{admin,omo,onboarding,parent}/` + root
