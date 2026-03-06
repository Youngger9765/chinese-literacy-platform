# PRD - 機構層級管理系統

> Product Requirements Document — Organization Hierarchy Management
> Version 1.0 | 2026-03-04
> GitHub Issue: #223

---

## 1. 執行摘要

### 產品概述

本文件定義 LingoLeap 國語文閱讀學習平台的**機構層級管理系統**。目前平台架構為扁平的 School → Teacher → Classroom → Student，無法支持「機構採購」（B2B）場景。本系統在現有的學校/班級/教師/學生架構之上，加入「機構（Organization）」層級，實現多校管理、權限分級、點數/授權集中管理。

### 與現有 PRD 的關係

| 文件 | 範圍 | 狀態 |
|------|------|------|
| `PRD-SCHOOL-CLASS-STUDENT.md` | 學校/班級/教師/學生 CRUD、Auth、CSV 匯入、報表 | 規劃中 |
| **本文件** | 機構層級、多校管理、RBAC、點數/授權管理 | 規劃中 |

**依賴關係**：本文件依賴 `PRD-SCHOOL-CLASS-STUDENT.md` 的 Auth 系統和基礎 CRUD。機構層級是在學校管理之上的擴展層。

### 範圍

**在範圍內**：
- 機構（Organization）CRUD
- 機構 → 學校 的歸屬關係
- 機構層級角色（org_owner, org_admin）
- 教師-機構/教師-學校 多對多關聯
- 機構層級點數/授權管理（教師授權數、AI 點數池）
- 機構管理後台 UI
- 向下相容（無機構的獨立教師仍可正常使用）

**不在範圍內**：
- 金流整合（TapPay / 綠界 — 另開 PRD）
- Email 通知系統
- 機構間資料遷移
- 多語系（i18n）

### 參考實作

Duotopia（`github.com/Youngger9765/duotopia`）已實作 85-90% 的機構層級系統，本文件參考其架構設計，並根據 LingoLeap 的需求進行調整。

---

## 2. 商業背景

### 為什麼需要機構層級？

| 場景 | 現在（無機構） | 未來（有機構） |
|------|----------------|----------------|
| 補習班買 10 位教師授權 | 無法集中管理 | 機構擁有者統一管理 |
| 學校 5 個年級各 1 位教師 | 各自獨立，無法看全校數據 | school_admin 看全校報表 |
| 教育局採購 10 校 | 無法實現 | 一個機構下 10 個學校 |
| 教師離職 | 資料跟著帳號走 | 機構保留資料，移轉給新教師 |

### 目標用戶

1. **機構擁有者（org_owner）** — 補習班老闆、學校校長、教育局承辦人
2. **機構管理員（org_admin）** — 教務主任、IT 管理員、語拓邦專案服務人員
3. **學校管理員（school_admin）** — 各校聯絡人
4. **教師（teacher）** — 第一線使用者（與現有角色相同）

### 銷售流程

```
語拓邦業務 → 與機構簽約 → 語拓邦 Admin 在後台建立機構
    → 設定擁有者 + 教師授權數 + 點數
    → 擁有者登入管理後台
    → 建立學校 → 指派教師 → 教師建班級/匯學生
```

---

## 3. 層級架構

### 3.1 完整層級

```
平台 (LingoLeap)
  ├── 獨立教師（無機構，向下相容）
  │     └── 班級 → 學生
  │
  └── 機構 (Organization)
        └── 學校 (School)
             └── 班級 (Classroom)
                  ├── 教師 (Teacher)
                  └── 學生 (Student)
                       └── 學習紀錄 (LearningSession)
```

### 3.2 角色層級

| 角色 | 代碼 | 層級 | 說明 |
|------|------|------|------|
| 系統管理員 | `system_admin` | 平台 | LingoLeap 團隊，可管理所有機構 |
| 機構擁有者 | `org_owner` | 機構 | 每機構 1 人，最高權限 |
| 機構管理員 | `org_admin` | 機構 | 可多人，管理機構日常事務 |
| 學校管理員 | `school_admin` | 學校 | 各校聯絡人 |
| 教師 | `teacher` | 學校/班級 | 教學使用者 |
| 學生 | `student` | 班級 | 學習使用者 |

### 3.3 角色指派規則

- 一位教師可以同時在**多個機構**擔任不同角色
- 一位教師可以同時在**多個學校**擔任不同角色
- 角色是**累加**的：同一人可以是 school_admin + teacher
- `org_owner` 每機構只能有 **1 位**
- `org_admin` 每機構可以有**多位**

---

## 4. 資料模型

### 4.1 新增資料表

以下為需要新增的資料表，現有的 `schools`, `teachers`, `classrooms`, `classroom_students`, `students` 表保持不變，僅需加欄位。

#### organizations（機構）

| 欄位 | 型態 | 說明 |
|------|------|------|
| id | UUID (PK) | 主鍵 |
| name | VARCHAR(100) | 機構名稱（唯一識別） |
| display_name | VARCHAR(200) | 顯示名稱 |
| description | TEXT | 描述 |
| tax_id | VARCHAR(20) | 統一編號（active 唯一） |
| contact_email | VARCHAR(200) | 聯絡 Email |
| contact_phone | VARCHAR(50) | 聯絡電話 |
| address | TEXT | 地址 |
| is_active | BOOLEAN | 啟用狀態 |
| teacher_limit | INTEGER | 教師授權上限（NULL=無限） |
| total_points | INTEGER | 總點數 |
| used_points | INTEGER | 已使用點數 |
| subscription_start_date | TIMESTAMP | 訂閱開始 |
| subscription_end_date | TIMESTAMP | 訂閱結束 |
| settings | JSONB | 機構設定 |
| created_at | TIMESTAMP | 建立時間 |
| updated_at | TIMESTAMP | 更新時間 |

#### teacher_organizations（教師-機構關聯）

| 欄位 | 型態 | 說明 |
|------|------|------|
| id | INTEGER (PK) | 主鍵 |
| teacher_id | INTEGER (FK) | → teachers.id |
| organization_id | UUID (FK) | → organizations.id |
| role | VARCHAR(50) | 角色：org_owner / org_admin / teacher |
| is_active | BOOLEAN | 啟用狀態 |
| created_at | TIMESTAMP | 建立時間 |
| updated_at | TIMESTAMP | 更新時間 |

**約束**：UNIQUE(teacher_id, organization_id)

#### teacher_schools（教師-學校關聯）

| 欄位 | 型態 | 說明 |
|------|------|------|
| id | INTEGER (PK) | 主鍵 |
| teacher_id | INTEGER (FK) | → teachers.id |
| school_id | INTEGER (FK) | → schools.id |
| roles | JSONB | 角色陣列：["school_admin", "teacher"] |
| is_active | BOOLEAN | 啟用狀態 |
| created_at | TIMESTAMP | 建立時間 |
| updated_at | TIMESTAMP | 更新時間 |

**約束**：UNIQUE(teacher_id, school_id)

#### organization_points_log（機構點數使用記錄）

| 欄位 | 型態 | 說明 |
|------|------|------|
| id | INTEGER (PK) | 主鍵 |
| organization_id | UUID (FK) | → organizations.id |
| teacher_id | INTEGER (FK) | → teachers.id（誰用的） |
| points_used | INTEGER | 使用點數 |
| feature_type | VARCHAR(50) | 功能類型（ai_comprehension, ai_assessment...） |
| description | TEXT | 描述 |
| created_at | TIMESTAMP | 使用時間 |

### 4.2 現有資料表異動

#### schools 表新增欄位

| 欄位 | 型態 | 說明 |
|------|------|------|
| organization_id | UUID (FK, nullable) | → organizations.id（NULL = 獨立學校） |
| display_name | VARCHAR(200) | 顯示名稱 |
| description | TEXT | 描述 |
| contact_email | VARCHAR(200) | 聯絡 Email |
| contact_phone | VARCHAR(50) | 聯絡電話 |
| address | TEXT | 地址 |
| is_active | BOOLEAN | 啟用狀態（default: true） |
| settings | JSONB | 學校設定 |
| updated_at | TIMESTAMP | 更新時間 |

> **向下相容**：`organization_id` 為 nullable，現有無機構的學校不受影響。

#### teachers 表新增欄位

| 欄位 | 型態 | 說明 |
|------|------|------|
| is_admin | BOOLEAN | 系統管理員標記 |
| phone | VARCHAR(20) | 電話 |

> **向下相容**：現有 `school_id` 欄位保留，作為「主要學校」的快捷關聯。機構下的教師透過 `teacher_schools` 表管理多校歸屬。

### 4.3 ER 圖

```
┌─────────────────────┐
│   organizations     │
│                     │
│ id (UUID, PK)       │
│ name                │
│ teacher_limit       │
│ total_points        │
│ used_points         │
└──────────┬──────────┘
           │ 1:N
           ▼
┌─────────────────────┐        ┌─────────────────────────┐
│      schools        │        │  teacher_organizations  │
│                     │        │                         │
│ id (PK)             │        │ teacher_id (FK)         │
│ organization_id(FK) │◄───    │ organization_id (FK)    │
│ name                │        │ role                    │
└──────────┬──────────┘        └─────────────────────────┘
           │ 1:N
           ▼
┌─────────────────────┐        ┌─────────────────────────┐
│    classrooms       │        │    teacher_schools      │
│                     │        │                         │
│ id (PK)             │        │ teacher_id (FK)         │
│ teacher_id (FK)     │        │ school_id (FK)          │
│ name                │        │ roles (JSONB)           │
└──────────┬──────────┘        └─────────────────────────┘
           │ N:M
           ▼
┌─────────────────────┐
│     students        │
│                     │
│ id (PK)             │
│ name                │
└─────────────────────┘
```

---

## 5. 權限矩陣（RBAC）

### 5.1 完整權限矩陣

| 操作 | system_admin | org_owner | org_admin | school_admin | teacher | student |
|------|:---:|:---:|:---:|:---:|:---:|:---:|
| **機構管理** |
| 建立機構 | O | - | - | - | - | - |
| 查看機構列表 | O（全部） | O（自己的） | O（自己的） | - | - | - |
| 編輯機構 | O | O | O | - | - | - |
| 刪除機構 | O | O | - | - | - | - |
| **學校管理** |
| 建立學校（機構下） | O | O | O | - | - | - |
| 查看學校列表 | O | O | O | O（本校） | O（本校） | - |
| 編輯學校 | O | O | O | O（本校） | - | - |
| 刪除學校 | O | O | O | - | - | - |
| **教師管理** |
| 指派教師到機構 | O | O | O | - | - | - |
| 指派教師到學校 | O | O | O | O（本校） | - | - |
| 移除教師 | O | O | O | - | - | - |
| 變更教師角色 | O | O | O | O（本校內） | - | - |
| **班級管理** |
| 建立班級 | O | O | O | O | O（自己的） | - |
| 查看班級 | O | O（機構內） | O（機構內） | O（本校） | O（自己的） | O（自己的） |
| **學生管理** |
| 查看學生（全機構） | O | O | O | - | - | - |
| 查看學生（全校） | O | O | O | O | - | - |
| 查看學生（班級內） | O | O | O | O | O | - |
| **報表/數據** |
| 機構儀表板 | O | O | O | - | - | - |
| 學校儀表板 | O | O | O | O | - | - |
| 班級報表 | O | O | O | O | O | - |
| **點數/授權** |
| 查看點數餘額 | O | O | O | - | - | - |
| 查看點數使用記錄 | O | O | O | - | - | - |
| 設定教師授權數 | O | - | - | - | - | - |

### 5.2 權限實作方式

**Phase 1（簡化版）**：使用程式碼內的角色判斷
```python
# 簡單角色檢查
def require_role(allowed_roles: list[str]):
    async def checker(current_user: Teacher = Depends(get_current_teacher)):
        user_role = get_user_role(current_user)
        if user_role not in allowed_roles:
            raise HTTPException(403, "Permission denied")
        return current_user
    return checker
```

**Phase 2（完整版）**：引入 Casbin RBAC
- 使用 Casbin 策略引擎
- Domain 隔離：`org-{uuid}`, `school-{id}`
- 策略定義在 `casbin_policy.csv`
- 啟動時從 DB 同步角色

> **建議**：Phase 1 先做簡單角色檢查，MVP 驗證後再升級 Casbin。

---

## 6. API 設計

### 6.1 機構 CRUD

| Method | Endpoint | 說明 | 權限 |
|--------|----------|------|------|
| POST | `/api/organizations` | 建立機構 | system_admin |
| GET | `/api/organizations` | 列出機構 | system_admin / org_owner / org_admin |
| GET | `/api/organizations/{org_id}` | 機構詳情 | 機構成員 |
| PUT | `/api/organizations/{org_id}` | 編輯機構 | org_owner / org_admin |
| DELETE | `/api/organizations/{org_id}` | 刪除機構（soft delete） | org_owner |

### 6.2 機構-學校管理

| Method | Endpoint | 說明 | 權限 |
|--------|----------|------|------|
| POST | `/api/organizations/{org_id}/schools` | 在機構下建立學校 | org_owner / org_admin |
| GET | `/api/organizations/{org_id}/schools` | 列出機構下的學校 | 機構成員 |

### 6.3 機構-教師管理

| Method | Endpoint | 說明 | 權限 |
|--------|----------|------|------|
| POST | `/api/organizations/{org_id}/teachers` | 指派教師到機構 | org_owner / org_admin |
| GET | `/api/organizations/{org_id}/teachers` | 列出機構教師 | 機構成員 |
| PUT | `/api/organizations/{org_id}/teachers/{teacher_id}` | 變更教師角色 | org_owner / org_admin |
| DELETE | `/api/organizations/{org_id}/teachers/{teacher_id}` | 移除教師 | org_owner / org_admin |

### 6.4 學校-教師管理

| Method | Endpoint | 說明 | 權限 |
|--------|----------|------|------|
| POST | `/api/schools/{school_id}/teachers` | 指派教師到學校 | org_owner / org_admin / school_admin |
| GET | `/api/schools/{school_id}/teachers` | 列出學校教師 | 學校成員 |
| PUT | `/api/schools/{school_id}/teachers/{teacher_id}` | 變更教師學校角色 | org_owner / org_admin / school_admin |
| DELETE | `/api/schools/{school_id}/teachers/{teacher_id}` | 移除教師 | org_owner / org_admin |

### 6.5 機構統計/儀表板

| Method | Endpoint | 說明 | 權限 |
|--------|----------|------|------|
| GET | `/api/organizations/{org_id}/dashboard` | 機構儀表板 | org_owner / org_admin |
| GET | `/api/organizations/{org_id}/statistics` | 機構統計（教師數等） | org_owner / org_admin |
| GET | `/api/organizations/{org_id}/points/logs` | 點數使用記錄 | org_owner / org_admin |

### 6.6 系統管理員

| Method | Endpoint | 說明 | 權限 |
|--------|----------|------|------|
| POST | `/api/admin/organizations` | Admin 建立機構 | system_admin |
| GET | `/api/admin/organizations` | Admin 列出所有機構 | system_admin |
| GET | `/api/admin/teachers/lookup?email=xxx` | 用 email 查教師 | system_admin |

---

## 7. 前端頁面

### 7.1 新增頁面

| 頁面 | 路由 | 說明 | 使用者 |
|------|------|------|--------|
| 機構管理 | `/teacher/organizations` | 機構列表 + CRUD | org_owner / org_admin |
| 機構詳情 | `/teacher/organizations/:orgId` | 機構下的學校列表 | 機構成員 |
| 機構儀表板 | `/teacher/organizations/:orgId/dashboard` | 統計數據 | org_owner / org_admin |
| Admin 機構管理 | `/admin/organizations` | 系統管理員建立/管理機構 | system_admin |

### 7.2 現有頁面修改

| 頁面 | 修改內容 |
|------|----------|
| Sidebar | 根據角色動態顯示「機構管理」選項 |
| 學校列表 | 增加機構篩選 |
| 教師頁面 | 顯示所屬機構 breadcrumb |

### 7.3 麵包屑導航

```
機構管理 > [機構名稱] > [學校名稱] > [班級名稱]
```

學生端：
```
[機構名稱] > [學校名稱] > [班級名稱]
```

---

## 8. 向下相容

### 8.1 原則

**現有無機構的教師/學校不受任何影響。**

| 場景 | 處理方式 |
|------|----------|
| 現有學校無 organization_id | `organization_id = NULL`，正常運作 |
| 現有教師無機構角色 | 只有基礎 `teacher` 權限，與現在相同 |
| 未來教師加入機構 | 建立 `teacher_organizations` 記錄 |
| 獨立教師建班級 | 與現在完全相同，不需要機構 |

### 8.2 遷移策略

1. **新增表不動舊表**：`organizations`, `teacher_organizations`, `teacher_schools`, `organization_points_log` 都是全新表
2. **舊表只加 nullable 欄位**：`schools.organization_id` 為 nullable
3. **不改現有 API 行為**：現有 API 不受影響，新功能用新 endpoint
4. **漸進式遷移**：機構簽約後，Admin 把學校掛到機構下

---

## 9. 點數/授權系統

### 9.1 教師授權

| 設定 | 說明 |
|------|------|
| `teacher_limit` | 機構可使用的教師帳號數上限 |
| NULL | 無限制（特殊合約） |
| 計算方式 | 計算 `teacher_organizations` 中 is_active=true 的數量 |
| 超限處理 | 指派教師時檢查，超限則拒絕 |

### 9.2 AI 點數

| 設定 | 說明 |
|------|------|
| `total_points` | 機構購買的總點數 |
| `used_points` | 已使用點數 |
| 剩餘點數 | `total_points - used_points` |
| 扣點時機 | AI 功能呼叫時（蘇格拉底對話、朗讀評估等） |
| 扣點紀錄 | 寫入 `organization_points_log` |
| 點數耗盡 | 提示購買，暫停 AI 功能 |

### 9.3 定價（參考）

| 品項 | 單價 |
|------|------|
| 1 年期教師授權（1 位） | NT$3,000 |
| 2 年期教師授權（1 位） | NT$5,520 |
| 100k AI 點數（首購優惠） | NT$6,000 |
| 100k AI 點數（常規） | NT$7,200 |
| 50k AI 點數 | NT$5,400 |

> 定價細節參考 Duotopia `ORGANIZATION_PLAN_SUMMARY.md`

---

## 10. 實作順序

### Phase 1：DB Schema + 基礎 API（Week 1-2）

- [ ] 建立 Organization model + migration
- [ ] 建立 TeacherOrganization, TeacherSchool 關聯表
- [ ] schools 表加 organization_id
- [ ] 機構 CRUD API
- [ ] 基礎角色檢查

### Phase 2：機構-學校-教師管理 API（Week 3-4）

- [ ] 機構下建立/管理學校 API
- [ ] 教師指派到機構/學校 API
- [ ] 教師角色管理 API
- [ ] 教師授權數檢查

### Phase 3：前端 UI（Week 5-6）

- [ ] 機構管理頁面（CRUD）
- [ ] 機構詳情頁（學校列表）
- [ ] Sidebar 角色判斷
- [ ] Admin 機構建立頁面

### Phase 4：點數系統 + 儀表板（Week 7-8）

- [ ] 點數扣除邏輯
- [ ] 點數使用記錄
- [ ] 機構儀表板
- [ ] 點數餘額顯示

### Phase 5：RBAC 升級（視需求）

- [ ] 引入 Casbin
- [ ] 策略定義
- [ ] DB 同步機制

---

## 11. 測試策略

### 單元測試

- Organization CRUD
- TeacherOrganization 角色管理
- 教師授權數限制
- 點數扣除邏輯

### 整合測試

- 完整流程：建立機構 → 建學校 → 指派教師 → 教師建班級
- 向下相容：無機構教師仍可正常操作
- 權限檢查：各角色只能做被授權的事

### E2E 測試

- Admin 建立機構流程
- 機構擁有者管理學校流程
- 教師在機構內操作流程

---

## 附錄 A：Duotopia vs LingoLeap 差異

| 面向 | Duotopia | LingoLeap（規劃） |
|------|----------|------------------|
| ORM | SQLAlchemy Classic（Column） | SQLAlchemy 2.0（Mapped） |
| ID 型態 | UUID（Organization/School） + Integer（Teacher/Student） | 待定（建議 Organization 用 UUID，其餘保持 Integer） |
| 權限引擎 | Casbin（從 Phase 1 就用） | Phase 1 用程式碼判斷，Phase 2+ 再評估 Casbin |
| 訂閱系統 | Teacher 層級訂閱 + Organization 層級點數 | Organization 層級為主 |
| 前端狀態 | Zustand + persistence | 待定（建議 Zustand） |
| Classroom-School 關聯 | 透過 classroom_schools 中間表 | 直接在 classrooms 表加 school_id（更簡單） |

## 附錄 B：名詞對照

| 中文 | 英文 | DB 表名 |
|------|------|---------|
| 機構 | Organization | organizations |
| 學校 | School | schools |
| 班級 | Classroom | classrooms |
| 教師 | Teacher | teachers |
| 學生 | Student | students |
| 機構擁有者 | Org Owner | role: org_owner |
| 機構管理員 | Org Admin | role: org_admin |
| 學校管理員 | School Admin | role: school_admin |
| 教師授權 | Teacher License | teacher_limit |
| AI 點數 | AI Points | total_points / used_points |
