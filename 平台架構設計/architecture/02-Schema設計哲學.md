# Schema 設計哲學（混合設計決策）

> 記錄日期：2026-02-13
> 來源：SCHEMA_DESIGN_DECISIONS.md
> 關鍵性：⭐⭐⭐⭐⭐（資料庫設計基礎）

---

## 📋 核心問題

**問題**：組織架構與課程結構應該用相同還是不同的設計模式？

**背景**：
- 組織架構（機構 → 學校 → 班級）相對穩定
- 課程結構（知識樹）需要極大彈性
- 兩者特性差異大，如何平衡？

---

## 🎯 設計選項對比

### 選項 A：完全統一節點設計

**概念**：所有階層關係都用同一套節點表

```sql
unified_nodes:
  - node_id
  - parent_id
  - node_type (organization | school | classroom | course | module)
  - metadata (JSONB)
```

**優點**：
- ✅ 設計極簡，只需一張表
- ✅ 擴展容易，新增類型不需改表

**缺點**：
- ❌ 類型不安全（組織、課程混在一起）
- ❌ 查詢效率低（需要大量過濾）
- ❌ 關聯模糊（外鍵無法使用）
- ❌ 業務邏輯複雜（需要應用層判斷）

---

### 選項 B：完全分離表設計

**概念**：每個實體都用獨立表

```sql
organizations:
  - org_id, org_name, ...

schools:
  - school_id, org_id, school_name, ...

classrooms:
  - classroom_id, school_id, classroom_name, ...

courses:
  - course_id, title, ...

modules:
  - module_id, course_id, title, ...

lessons:
  - lesson_id, module_id, title, ...
```

**優點**：
- ✅ 類型安全（每張表結構清晰）
- ✅ 查詢高效（索引優化明確）
- ✅ 關聯清晰（外鍵強制約束）

**缺點**：
- ❌ 擴展困難（新增層級需要新表）
- ❌ 課程結構僵化（無法自由調整層級）
- ❌ 維護成本高（多張表管理）

---

### 選項 C：混合設計 ✅（最終方案）

**概念**：組織用傳統表，課程用節點樹

```sql
-- 組織架構部分（分離表，穩定）
organizations:
  - org_id, org_name, org_type

schools:
  - school_id, organization_id

classrooms:
  - classroom_id, school_id, classroom_name

-- 課程結構部分（統一節點，彈性）
course_nodes:
  - node_id
  - organization_id, school_id, classroom_id (nullable 組合)
  - parent_id (自關聯)
  - path (ltree)
  - node_type (folder | course | module | lesson)
  - metadata (JSONB)
```

**優點**：
- ✅ 組織架構穩定高效（傳統表）
- ✅ 課程結構完全彈性（節點樹）
- ✅ 類型安全與彈性兼顧
- ✅ 符合業務特性

**缺點**：
- ⚠️ 設計略複雜（需要理解兩套模式）

---

## ✅ 最終決策：混合設計

### 決策理由

#### 1. 組織架構特性（適合傳統表）
- **穩定性**：機構、學校、班級結構基本不變
- **查詢頻繁**：大量權限檢查需要高效查詢
- **關聯明確**：機構 → 學校 → 班級是固定關係

#### 2. 課程結構特性（適合節點樹）
- **彈性需求**：教師需要自由調整課程結構
- **層級不定**：可能 3 層、5 層、7 層都有
- **動態擴展**：隨時新增/刪除/移動節點

---

## 🏗️ 實作設計

### 組織架構表（傳統設計）

#### `organizations` 機構表

```sql
CREATE TABLE organizations (
  org_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_name VARCHAR(100) NOT NULL,
  org_type VARCHAR(50) CHECK (org_type IN (
    'education_bureau',  -- 教育局
    'private_group',     -- 私立教育集團
    'chain',             -- 連鎖機構
    'single_school'      -- 單一學校
  )),
  contact_email VARCHAR(100),
  max_schools INT,       -- 學校數上限
  max_students INT,      -- 學生數上限
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_organizations_org_type ON organizations(org_type);
```

---

#### `schools` 學校表

```sql
CREATE TABLE schools (
  school_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(org_id) ON DELETE CASCADE,
  school_name VARCHAR(100) NOT NULL,
  principal_name VARCHAR(50),
  contact_email VARCHAR(100),
  address TEXT,
  student_count INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_schools_organization_id ON schools(organization_id);
```

**查詢範例**：
```sql
-- 查詢機構旗下所有學校
SELECT * FROM schools WHERE organization_id = :org_id;
```

---

#### `classrooms` 班級表

```sql
CREATE TABLE classrooms (
  classroom_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(school_id) ON DELETE CASCADE,
  classroom_name VARCHAR(50) NOT NULL,  -- 如「一年甲班」
  grade INT CHECK (grade BETWEEN 1 AND 6),
  academic_year INT,
  semester INT CHECK (semester IN (1, 2)),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_classrooms_school_id ON classrooms(school_id);
CREATE INDEX idx_classrooms_grade ON classrooms(grade);
```

**命名規範**：
- ✅ 使用 `classrooms`（避免 `classes` 保留字衝突）
- ✅ 使用 `classroom_id`（保持一致性）
- ✅ 使用 `classroom_name`（保持一致性）

---

### 課程結構表（節點樹設計）

#### `course_nodes` 課程節點表

```sql
CREATE TABLE course_nodes (
  node_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 租戶隔離（nullable 組合）
  organization_id UUID REFERENCES organizations(org_id) ON DELETE CASCADE,
  school_id UUID REFERENCES schools(school_id) ON DELETE CASCADE,
  classroom_id UUID REFERENCES classrooms(classroom_id) ON DELETE CASCADE,

  -- 樹狀結構
  parent_id UUID REFERENCES course_nodes(node_id) ON DELETE CASCADE,
  path LTREE NOT NULL,  -- 如：'org_A.school_X.classroom_Y.course_1.module_2'
  display_order INT DEFAULT 0,

  -- 節點類型
  node_type VARCHAR(20) CHECK (node_type IN (
    'folder',    -- 資料夾（純組織用）
    'course',    -- 課程
    'module',    -- 模組
    'lesson',    -- 課節
    'activity'   -- 學習活動
  )),

  node_subtype VARCHAR(20),  -- 進階分類（如：category | prerequisite）

  -- 彈性內容（JSONB）
  metadata JSONB DEFAULT '{}',
  -- 範例：
  -- {
  --   "title": "第一課：我的家",
  --   "description": "課程描述",
  --   "content": "課文內容",
  --   "difficulty_level": 2,
  --   "estimated_minutes": 30,
  --   "prerequisites": ["node_abc", "node_def"]
  -- }

  -- 版本控制
  source_template_id UUID REFERENCES course_nodes(node_id),
  source_version INT DEFAULT 1,
  current_version INT DEFAULT 1,

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),

  -- 約束：至少有一個租戶標識
  CHECK (
    organization_id IS NOT NULL OR
    (organization_id IS NULL AND school_id IS NULL AND classroom_id IS NULL)
  )
);

CREATE INDEX idx_course_nodes_org_id ON course_nodes(organization_id);
CREATE INDEX idx_course_nodes_school_id ON course_nodes(school_id);
CREATE INDEX idx_course_nodes_classroom_id ON course_nodes(classroom_id);
CREATE INDEX idx_course_nodes_parent_id ON course_nodes(parent_id);
CREATE INDEX idx_course_nodes_path ON course_nodes USING GIST(path);
CREATE INDEX idx_course_nodes_type ON course_nodes(node_type);
```

---

### ltree 路徑設計

#### 什麼是 ltree？

PostgreSQL 的 ltree 擴展，用於高效儲存和查詢樹狀結構。

```sql
-- 啟用 ltree
CREATE EXTENSION IF NOT EXISTS ltree;
```

#### 路徑範例

```
官方課程（Platform Level）:
  path = 'platform.course_001'
  path = 'platform.course_001.module_01'
  path = 'platform.course_001.module_01.lesson_01'

機構課程（Organization Level）:
  path = 'org_A.course_002'
  path = 'org_A.course_002.module_01'

學校課程（School Level）:
  path = 'org_A.school_X.course_003'
  path = 'org_A.school_X.course_003.module_01'

班級課程（Classroom Level）:
  path = 'org_A.school_X.classroom_Y.course_004'
  path = 'org_A.school_X.classroom_Y.course_004.module_01'
```

---

### 租戶隔離邏輯

#### 層級定義

| 層級 | organization_id | school_id | classroom_id | 可見範圍 |
|------|----------------|-----------|--------------|---------|
| **官方課程** | NULL | NULL | NULL | 所有機構可見 |
| **機構課程** | A | NULL | NULL | 機構 A 旗下所有學校可見 |
| **學校課程** | A | X | NULL | 學校 X 可見 |
| **班級課程** | A | X | Y | 班級 Y 可見 |

---

#### 查詢範例

**查詢班級可用的所有課程**：
```sql
SELECT * FROM course_nodes
WHERE (
  -- 官方課程
  (organization_id IS NULL AND school_id IS NULL AND classroom_id IS NULL)
  OR
  -- 機構課程
  (organization_id = :org_id AND school_id IS NULL AND classroom_id IS NULL)
  OR
  -- 學校課程
  (organization_id = :org_id AND school_id = :school_id AND classroom_id IS NULL)
  OR
  -- 班級課程
  (organization_id = :org_id AND school_id = :school_id AND classroom_id = :classroom_id)
)
AND node_type = 'course'
ORDER BY display_order;
```

**查詢課程的所有子節點**：
```sql
SELECT * FROM course_nodes
WHERE path <@ 'org_A.school_X.classroom_Y.course_004'::ltree
ORDER BY path;
```

**查詢父節點**：
```sql
SELECT * FROM course_nodes
WHERE node_id = (
  SELECT parent_id FROM course_nodes WHERE node_id = :current_node_id
);
```

---

## 📊 metadata (JSONB) 設計

### 為何使用 JSONB？

**優點**：
- ✅ 完全彈性（不同節點類型可有不同欄位）
- ✅ 無需修改 Schema（新增欄位不需 ALTER TABLE）
- ✅ 支援索引（GIN 索引）
- ✅ 支援查詢（WHERE metadata->>'title' = '...'）

**缺點**：
- ⚠️ 無 Schema 驗證（需應用層檢查）
- ⚠️ 欄位變更需要應用層遷移

---

### metadata 範例

#### Course 節點
```json
{
  "title": "第一課：我的家",
  "description": "學習家庭成員的稱呼",
  "content": "我有一個溫暖的家...",
  "content_with_bopomofo": "ㄨㄛˇ ㄧㄡˇ ㄧˊ ㄍㄜ˙ ㄨㄣ ㄋㄨㄢˇ ㄉㄜ˙ ㄐㄧㄚ...",
  "difficulty_level": 2,
  "grade": 1,
  "estimated_minutes": 30,
  "word_count": 120,
  "tags": ["家庭", "親情", "國小一年級"]
}
```

#### Module 節點
```json
{
  "title": "朗讀練習",
  "description": "練習朗讀課文",
  "module_type": "reading",
  "required_accuracy": 0.90,
  "required_speed": 80,
  "allow_skip": false
}
```

#### Lesson 節點
```json
{
  "title": "生字練習：清、情、晴",
  "lesson_type": "vocabulary",
  "words": [
    {"word": "清", "bopomofo": "ㄑㄧㄥ", "tone": 1},
    {"word": "情", "bopomofo": "ㄑㄧㄥˊ", "tone": 2},
    {"word": "晴", "bopomofo": "ㄑㄧㄥˊ", "tone": 2}
  ],
  "practice_mode": "stroke_order"
}
```

---

## 🎯 混合設計優勢總結

### 組織架構（傳統表）

| 特性 | 優勢 | 實際效益 |
|------|------|---------|
| **類型安全** | 強型別檢查 | 避免資料錯誤 |
| **查詢高效** | 索引優化明確 | 權限檢查快速 |
| **關聯清晰** | 外鍵強制約束 | 資料一致性高 |
| **SQL 友善** | JOIN 操作簡單 | 開發效率高 |

---

### 課程結構（節點樹）

| 特性 | 優勢 | 實際效益 |
|------|------|---------|
| **完全彈性** | 無限層級 | 適應不同教學需求 |
| **動態擴展** | 隨時調整結構 | 教師自由度高 |
| **路徑查詢** | ltree 高效 | 子樹查詢快速 |
| **版本控制** | source_template_id | 支援課程更新同步 |

---

## 🚧 常見陷阱與注意事項

### 陷阱 1：混淆組織與課程

**錯誤**：把班級當作課程節點
```sql
-- ❌ 錯誤
INSERT INTO course_nodes (node_type, ...) VALUES ('classroom', ...);
```

**正確**：班級用傳統表，課程用節點表
```sql
-- ✅ 正確
INSERT INTO classrooms (classroom_name, ...) VALUES ('一年甲班', ...);
INSERT INTO course_nodes (node_type, classroom_id, ...) VALUES ('course', :classroom_id, ...);
```

---

### 陷阱 2：忘記租戶隔離

**錯誤**：查詢時沒有過濾 organization_id
```sql
-- ❌ 危險！會查到所有機構的課程
SELECT * FROM course_nodes WHERE node_type = 'course';
```

**正確**：永遠帶上租戶過濾
```sql
-- ✅ 安全
SELECT * FROM course_nodes
WHERE node_type = 'course'
  AND (organization_id = :org_id OR organization_id IS NULL);
```

---

### 陷阱 3：path 更新不同步

**問題**：移動節點時忘記更新子節點的 path

**解決**：使用觸發器自動更新
```sql
CREATE OR REPLACE FUNCTION update_course_node_path()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.parent_id IS NULL THEN
    NEW.path = NEW.node_id::text::ltree;
  ELSE
    SELECT path || NEW.node_id::text INTO NEW.path
    FROM course_nodes WHERE node_id = NEW.parent_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_course_node_path
BEFORE INSERT OR UPDATE OF parent_id ON course_nodes
FOR EACH ROW EXECUTE FUNCTION update_course_node_path();
```

---

## 📚 相關文件

- [README.md](./README.md) - 架構總覽
- [01-平台層級設計.md](./01-平台層級設計.md) - 多租戶架構
- [03-課程結構設計.md](./03-課程結構設計.md) - 課程業務邏輯
- [04-多租戶實作.md](./04-多租戶實作.md) - RLS 實作

---

**文件用途**：
此文件定義資料庫 Schema 的核心設計哲學，說明為何採用混合設計以及如何正確實作。所有資料庫相關開發都必須遵循此設計原則。
