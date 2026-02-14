# 資料庫 Schema 設計決策

> 記錄日期：2026-02-13
> 決策者：Young Tsai
> 用途：記錄 Schema 設計的核心決策與取捨

---

## 核心決策：混合設計方案

### 問題描述

所有階層關係（機構/學校/班級 + 課程結構）是否應該統一用「節點」(nodes) 設計？還是應該分離？

### 選項分析

#### 選項 A：完全統一節點設計

**概念**：所有階層用同一個 `nodes` 表

```sql
nodes:
  - node_id
  - parent_id (自關聯)
  - node_type (organization | school | class | course_category | course | module)
  - path (ltree)
  - metadata (JSONB)
```

**優勢**：
- ✅ 極度彈性（新增層級不需改 schema）
- ✅ 統一查詢邏輯
- ✅ 路徑查詢簡單（ltree）
- ✅ metadata 自由擴展

**劣勢**：
- ❌ 類型安全降低
- ❌ 查詢需大量 `WHERE node_type = 'xxx'`
- ❌ 索引效率不如專用表
- ❌ JOIN 複雜

---

#### 選項 B：完全分離表設計

**概念**：每個實體獨立表

```sql
organizations, schools, classes, courses, modules (各自獨立表)
```

**優勢**：
- ✅ 類型安全
- ✅ 查詢效率高
- ✅ 業務邏輯清晰
- ✅ ORM 友善

**劣勢**：
- ❌ 擴展性差
- ❌ 重複邏輯
- ❌ 跨層查詢麻煩

---

#### 選項 C：混合設計 ✅（最終決策）

**概念**：
- **組織架構**（機構/學校/班級）→ 分離表 + 少量 metadata
- **課程結構**（知識樹/課程/模組）→ 統一節點 + 彈性 metadata

### 決策：C（混合設計）✅

**一句話總結**：
- **組織層級用傳統表設計**（穩定、高效、類型安全）
- **知識樹用節點自由設計**（彈性、可擴展、用戶可自訂）

### 理由

**組織架構（機構/學校/班級）→ 傳統表設計**：
1. **穩定且有限**：教育體系的組織層級基本固定
2. **業務邏輯明確**：各層級有特定欄位需求（校長、班導師等）
3. **查詢頻繁**：效能優化很重要（權限檢查、統計報表）
4. **類型安全**：schema 強制檢查，減少錯誤

**課程結構（知識樹/課程/模組）→ 節點自由設計**：
1. **極度彈性**：每個學科的知識結構不同
2. **用戶可自訂**：老師/編輯需要自由組織
3. **查詢模式單純**：主要是樹狀遍歷
4. **擴展需求高**：未來可能有很多種組織方式

### 實作影響

#### 組織架構部分（分離表）

```sql
-- 機構表
organizations:
  - org_id (PK)
  - org_name
  - org_type (education_bureau | private_group | chain | single_school)
  - contact_email
  - contact_phone
  - metadata (JSONB, 非核心擴展欄位)
  - created_at
  - updated_at
  - status (active | inactive)

-- 學校表
schools:
  - school_id (PK)
  - organization_id (FK)
  - school_name
  - principal_name
  - contact_email
  - address
  - metadata (JSONB)
  - created_at
  - updated_at
  - status (active | inactive)

-- 班級表（使用 classrooms 避免 class 保留字衝突）
classrooms:
  - classroom_id (PK)
  - school_id (FK)
  - classroom_name
  - grade_level (1-12)
  - teacher_id (FK to users)
  - metadata (JSONB)
  - created_at
  - updated_at
  - status (active | inactive | archived)
```

**設計原則**：
- 核心欄位明確定義（類型安全）
- 非核心欄位用 JSONB metadata（保留彈性）
- 所有表包含 `organization_id`（直接或間接）以支援多租戶隔離

---

#### 課程結構部分（統一節點 + ltree）

```sql
-- 課程節點表（知識樹）
course_nodes:
  - node_id (PK)
  - organization_id (FK, 租戶隔離)
  - school_id (FK, nullable, 若為校級課程庫)
  - classroom_id (FK, nullable, 若為班級課程庫)
  - parent_id (自關聯, nullable for root)
  - path (ltree, 如: 'root.unit1.lesson1')
  - node_type (folder | course | module)
  - node_subtype (category | prerequisite | null)
  - name
  - description
  - order (排序)
  - metadata (JSONB, 完全彈性)
  - source_template_id (FK, 複製來源)
  - source_version
  - version
  - created_by (FK to users)
  - created_at
  - updated_at
  - status (draft | published | archived)

-- ltree 索引（加速路徑查詢）
CREATE INDEX course_nodes_path_idx ON course_nodes USING gist(path);
CREATE INDEX course_nodes_parent_id_idx ON course_nodes(parent_id);
```

**設計原則**：
- `node_type` 區分節點類型（資料夾、課程、模組）
- `node_subtype` 定義關係類型（分類 or 先修）
- `path` (ltree) 支援快速子樹查詢
- `metadata` 完全彈性，不同 node_type 可有不同欄位
- `source_template_id` + `source_version` 支援課程複製與版本追蹤

---

### 課程庫的層級設計

課程庫透過 `organization_id`, `school_id`, `class_id` 的 nullable 組合實現：

```
官方課程庫（Platform）:
  organization_id = NULL
  school_id = NULL
  classroom_id = NULL

機構課程庫:
  organization_id = <org_id>
  school_id = NULL
  classroom_id = NULL

校級課程庫:
  organization_id = <org_id>
  school_id = <school_id>
  classroom_id = NULL

班級課程庫:
  organization_id = <org_id>
  school_id = <school_id>
  classroom_id = <classroom_id>
```

**查詢範例**：

```sql
-- 查詢某機構的所有課程（包含官方）
SELECT * FROM course_nodes
WHERE organization_id = <org_id>
   OR organization_id IS NULL;

-- 查詢某學校的課程庫（包含機構、官方）
SELECT * FROM course_nodes
WHERE (organization_id = <org_id> AND school_id = <school_id>)
   OR (organization_id = <org_id> AND school_id IS NULL)
   OR organization_id IS NULL;

-- 查詢某班級的課程庫（包含校級、機構、官方）
SELECT * FROM course_nodes
WHERE (organization_id = <org_id> AND school_id = <school_id> AND classroom_id = <classroom_id>)
   OR (organization_id = <org_id> AND school_id = <school_id> AND classroom_id IS NULL)
   OR (organization_id = <org_id> AND school_id IS NULL)
   OR organization_id IS NULL;

-- 查詢某節點的所有子節點（ltree）
SELECT * FROM course_nodes
WHERE path <@ 'root.unit1';
```

---

### metadata 欄位使用規範

**組織架構的 metadata（有限使用）**：

```jsonb
-- organizations.metadata 範例
{
  "logo_url": "https://...",
  "timezone": "Asia/Taipei",
  "custom_fields": {...}
}

-- schools.metadata 範例
{
  "phone": "02-1234-5678",
  "website": "https://...",
  "student_count": 500
}

-- classes.metadata 範例
{
  "class_schedule": "週一至週五 8:00-16:00",
  "classroom": "A棟 3F-301"
}
```

**課程節點的 metadata（完全彈性）**：

```jsonb
-- node_type = 'folder', node_subtype = 'category'
{
  "icon": "📚",
  "color": "#4A90E2",
  "description": "單元一：我的家人"
}

-- node_type = 'folder', node_subtype = 'prerequisite'
{
  "unlock_condition": {
    "type": "sequential",
    "required_nodes": ["node_123", "node_124"]
  }
}

-- node_type = 'course'
{
  "difficulty": "easy",
  "estimated_minutes": 30,
  "tags": ["注音符號", "聲母"],
  "cover_image": "https://..."
}

-- node_type = 'module'
{
  "module_type": "reading_fluency",
  "content_id": "content_456",
  "ai_scoring_enabled": true,
  "passing_score": 80
}
```

---

## 實際案例參考

### Notion 的設計
- **Workspace/Member**：分離表（穩定）
- **Page hierarchy**：統一節點（彈性）

### GitHub 的設計
- **Organization/Team**：分離表（穩定）
- **Repository structure**：檔案樹（彈性）

### 我們的平台
- **Organization/School/Class**：分離表（穩定）
- **Course knowledge tree**：統一節點（彈性）

---

## 優勢總結

### 兼顧穩定與彈性
- 組織架構穩定、有類型安全
- 課程結構彈性、可自由擴展

### 查詢效能最佳化
- 組織架構用針對性索引
- 課程結構用 ltree GiST 索引

### 業務邏輯清晰
- 看 `organizations/schools/classes` 就知道組織關係
- 看 `course_nodes` 就知道這是彈性知識樹

### 未來擴展容易
- 組織架構要加新層級？加新表即可（但很少發生）
- 課程結構要加新類型？只需修改 `node_type` enum

---

## 與其他決策的關聯

### 與問題 0（平台架構層級設計）的關聯
- 實作「機構 → 學校 → 班級」的三層架構
- 支援多租戶隔離（organization_id）

### 與問題 5（知識樹設計）的關聯
- 實作 Notion-like 階層式知識樹
- 支援 category + prerequisite 雙模式
- 透過 `node_subtype` 欄位區分

### 與問題 2（課程更新機制）的關聯
- 透過 `source_template_id` + `source_version` 實現
- 支援版本追蹤與選擇性同步

---

## 命名規範與注意事項

### 避免保留字衝突

**使用 `classrooms` 而非 `classes`**：
- ✅ `classrooms` - 避免與程式語言保留字衝突
- ❌ `classes` - 在 Python, JavaScript, Java 等語言中是保留字

**其他需注意的命名**：
- ✅ `user_order` 而非 `order` (SQL 保留字)
- ✅ `group_name` 而非 `group` (SQL 保留字)
- ✅ `select_options` 而非 `select` (SQL 保留字)

**ID 命名一致性**：
- `classroom_id` (與表名一致)
- `organization_id`
- `school_id`
- `node_id`

---

## 變更記錄

| 日期 | 變更內容 | 變更者 |
|------|---------|--------|
| 2026-02-13 | 初版建立，決策採用混合設計方案 | Young Tsai |
| 2026-02-13 | **命名規範**：使用 `classrooms` 避免 `class` 保留字衝突 | Young Tsai |

---

**文件用途**：
此文件記錄 Schema 設計的核心決策，解釋為何採用「組織架構分離表 + 課程結構統一節點」的混合設計。所有資料庫實作都應遵循此決策。
