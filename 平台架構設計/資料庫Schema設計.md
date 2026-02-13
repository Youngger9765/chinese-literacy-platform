# 資料庫 Schema 設計

> **目標**: PostgreSQL 完整 Schema,支援多租戶、課程管理、作業提交、AI 評分
>
> **原則**: 資料主權 (所有核心資料都在我們手上)、可擴展性、高效查詢

---

## 📊 Schema 總覽

```
組織架構層 (Multi-Tenancy):
├─ platforms (平台)
├─ organizations (教育機構)
├─ schools (學校)
├─ classrooms (班級)
├─ teachers (教師)
└─ students (學生)

課程內容層 (Hierarchical):
├─ course_nodes (課程節點) - ltree
├─ learning_materials (教材)
├─ vocabulary (生字)
└─ assignments (作業)

學習記錄層 (Transactional):
├─ submissions (提交記錄)
├─ submission_files (提交檔案)
├─ scores (評分記錄)
├─ learning_progress (學習進度)
└─ student_achievements (成就)

外部整合層 (Sync):
├─ github_sync_logs (GitHub 同步記錄)
├─ classroom_sync_logs (Classroom 同步記錄)
└─ webhook_events (Webhook 事件)
```

---

## 1️⃣ 組織架構層 (Multi-Tenancy)

### 1.1 Platforms (平台)

```sql
CREATE TABLE platforms (
  platform_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  subdomain VARCHAR(100) UNIQUE NOT NULL, -- e.g., 'demo', 'taipei-edu'
  config JSONB DEFAULT '{}', -- 平台級設定
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_platforms_subdomain ON platforms(subdomain);

-- Sample data
INSERT INTO platforms (name, subdomain, config) VALUES
  ('示範教育平台', 'demo', '{"theme": "education", "max_schools": 10}'),
  ('台北市教育局', 'taipei-edu', '{"theme": "education", "max_schools": 100}');
```

**說明**:
- 最上層租戶,支援 SaaS 多平台模式
- `subdomain` 用於子域名隔離 (demo.platform.com)
- `config` 儲存平台級配置 (主題、限制、功能開關)

---

### 1.2 Organizations (教育機構)

```sql
CREATE TABLE organizations (
  organization_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_id UUID NOT NULL REFERENCES platforms(platform_id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  type VARCHAR(50) NOT NULL, -- 'hospital', 'school_district', 'university'
  config JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_organizations_platform ON organizations(platform_id);

-- Sample data
INSERT INTO organizations (platform_id, name, type) VALUES
  ((SELECT platform_id FROM platforms WHERE subdomain = 'demo'),
   '示範學校', 'school_district');
```

**說明**:
- 醫院、學區、大學等機構
- 支援一個平台下多個機構

---

### 1.3 Schools (學校)

```sql
CREATE TABLE schools (
  school_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  address TEXT,
  config JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_schools_organization ON schools(organization_id);

-- Sample data
INSERT INTO schools (organization_id, name) VALUES
  ((SELECT organization_id FROM organizations WHERE name = '示範學校'),
   '示範國小');
```

---

### 1.4 Classrooms (班級)

```sql
CREATE TABLE classrooms (
  classroom_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(school_id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL, -- '一年級甲班', 'Grade 1 Class A'
  grade_level INT, -- 1, 2, 3...
  academic_year VARCHAR(20), -- '2024', '2024-2025'
  google_classroom_id VARCHAR(255) UNIQUE, -- 外部 ID (可選)
  config JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_classrooms_school ON classrooms(school_id);
CREATE INDEX idx_classrooms_google ON classrooms(google_classroom_id);

-- Sample data
INSERT INTO classrooms (school_id, name, grade_level, academic_year) VALUES
  ((SELECT school_id FROM schools WHERE name = '示範國小'),
   '一年級甲班', 1, '2024');
```

**說明**:
- `google_classroom_id`: Google Classroom 課程 ID (同步用)
- `config`: 班級設定 (作業截止時間、評分標準等)

---

### 1.5 Teachers (教師)

```sql
CREATE TABLE teachers (
  teacher_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  google_user_id VARCHAR(255) UNIQUE, -- Google OAuth ID
  role VARCHAR(50) DEFAULT 'teacher', -- 'teacher', 'admin', 'principal'
  avatar_url TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_teachers_email ON teachers(email);
CREATE INDEX idx_teachers_google ON teachers(google_user_id);

-- Sample data
INSERT INTO teachers (organization_id, email, name, google_user_id) VALUES
  ((SELECT organization_id FROM organizations WHERE name = '示範學校'),
   'teacher@example.edu.tw', '王老師', 'google-oauth-id-123');
```

**說明**:
- `google_user_id`: Google Sign-In OAuth ID
- `role`: 支援不同權限級別

---

### 1.6 Students (學生)

```sql
CREATE TABLE students (
  student_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  classroom_id UUID NOT NULL REFERENCES classrooms(classroom_id) ON DELETE CASCADE,
  email VARCHAR(255) UNIQUE, -- 可選 (年幼學生可能沒有 email)
  name VARCHAR(255) NOT NULL,
  student_number VARCHAR(50), -- 學號
  google_user_id VARCHAR(255) UNIQUE, -- Google OAuth ID (可選)
  avatar_url TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_students_classroom ON students(classroom_id);
CREATE INDEX idx_students_email ON students(email);

-- Sample data
INSERT INTO students (classroom_id, name, student_number) VALUES
  ((SELECT classroom_id FROM classrooms WHERE name = '一年級甲班'),
   '小明', 'S001'),
  ((SELECT classroom_id FROM classrooms WHERE name = '一年級甲班'),
   '小華', 'S002');
```

---

### 1.7 Classroom Teachers (班級-教師關聯)

```sql
CREATE TABLE classroom_teachers (
  classroom_id UUID NOT NULL REFERENCES classrooms(classroom_id) ON DELETE CASCADE,
  teacher_id UUID NOT NULL REFERENCES teachers(teacher_id) ON DELETE CASCADE,
  role VARCHAR(50) DEFAULT 'teacher', -- 'teacher', 'assistant'
  created_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (classroom_id, teacher_id)
);

CREATE INDEX idx_classroom_teachers_teacher ON classroom_teachers(teacher_id);

-- Sample data
INSERT INTO classroom_teachers (classroom_id, teacher_id) VALUES
  ((SELECT classroom_id FROM classrooms WHERE name = '一年級甲班'),
   (SELECT teacher_id FROM teachers WHERE email = 'teacher@example.edu.tw'));
```

---

## 2️⃣ 課程內容層 (Hierarchical)

### 2.1 Course Nodes (課程節點 - ltree)

```sql
-- Enable ltree extension
CREATE EXTENSION IF NOT EXISTS ltree;

CREATE TABLE course_nodes (
  node_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
  path ltree NOT NULL, -- e.g., 'grade1.unit1.lesson1'
  node_type VARCHAR(50) NOT NULL, -- 'grade', 'unit', 'lesson', 'section'
  title VARCHAR(255) NOT NULL,
  description TEXT,
  order_index INT DEFAULT 0, -- 排序
  metadata JSONB DEFAULT '{}', -- 擴展資料
  github_path VARCHAR(500), -- GitHub 檔案路徑 (e.g., 'courses/grade1/unit1/lesson1.md')
  synced_at TIMESTAMP, -- 最後同步時間
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_course_nodes_path ON course_nodes USING GIST(path);
CREATE INDEX idx_course_nodes_organization ON course_nodes(organization_id);
CREATE INDEX idx_course_nodes_github ON course_nodes(github_path);

-- Sample data
INSERT INTO course_nodes (organization_id, path, node_type, title, github_path) VALUES
  ((SELECT organization_id FROM organizations WHERE name = '示範學校'),
   'grade1', 'grade', '一年級', 'courses/grade1/README.md'),
  ((SELECT organization_id FROM organizations WHERE name = '示範學校'),
   'grade1.unit1', 'unit', '第一單元', 'courses/grade1/unit1/README.md'),
  ((SELECT organization_id FROM organizations WHERE name = '示範學校'),
   'grade1.unit1.lesson1', 'lesson', '第一課:我的家', 'courses/grade1/unit1/lesson1.md');

-- 查詢範例: 取得 grade1 下所有課程
SELECT * FROM course_nodes
WHERE path <@ 'grade1'
ORDER BY path;

-- 查詢範例: 取得 lesson1 的父節點
SELECT * FROM course_nodes
WHERE 'grade1.unit1.lesson1' <@ path
  AND path != 'grade1.unit1.lesson1';
```

**說明**:
- `ltree` 提供高效的階層查詢
- `path` 格式: `grade{N}.unit{M}.lesson{K}.section{L}`
- `github_path` 對應 GitHub Markdown 檔案路徑
- 支援跨機構共享課程 (透過 `organization_id`)

---

### 2.2 Learning Materials (教材)

```sql
CREATE TABLE learning_materials (
  material_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id UUID NOT NULL REFERENCES course_nodes(node_id) ON DELETE CASCADE,
  material_type VARCHAR(50) NOT NULL, -- 'text', 'audio', 'video', 'image', 'pdf'
  title VARCHAR(255),
  content TEXT, -- Markdown 內容 (從 GitHub 同步)
  file_url TEXT, -- S3/CDN URL (音檔、影片等)
  duration_seconds INT, -- 音檔/影片長度
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_learning_materials_node ON learning_materials(node_id);
CREATE INDEX idx_learning_materials_type ON learning_materials(material_type);

-- Sample data
INSERT INTO learning_materials (node_id, material_type, title, content) VALUES
  ((SELECT node_id FROM course_nodes WHERE path = 'grade1.unit1.lesson1'),
   'text', '課文內容', '# 我的家\n\n我有一個溫暖的家...');
```

---

### 2.3 Vocabulary (生字表)

```sql
CREATE TABLE vocabulary (
  vocabulary_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id UUID NOT NULL REFERENCES course_nodes(node_id) ON DELETE CASCADE,
  character VARCHAR(10) NOT NULL, -- 生字
  pinyin VARCHAR(50), -- 注音/拼音
  stroke_count INT, -- 筆畫數
  definition TEXT, -- 字義
  example_sentence TEXT, -- 例句
  audio_url TEXT, -- 發音音檔
  image_url TEXT, -- 字卡圖片
  order_index INT DEFAULT 0,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_vocabulary_node ON vocabulary(node_id);
CREATE INDEX idx_vocabulary_character ON vocabulary(character);

-- Sample data
INSERT INTO vocabulary (node_id, character, pinyin, stroke_count, definition) VALUES
  ((SELECT node_id FROM course_nodes WHERE path = 'grade1.unit1.lesson1'),
   '家', 'ㄐㄧㄚ', 10, '住的地方'),
  ((SELECT node_id FROM course_nodes WHERE path = 'grade1.unit1.lesson1'),
   '我', 'ㄨㄛˇ', 7, '自己');
```

---

### 2.4 Assignments (作業)

```sql
CREATE TABLE assignments (
  assignment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id UUID NOT NULL REFERENCES course_nodes(node_id) ON DELETE CASCADE,
  classroom_id UUID REFERENCES classrooms(classroom_id) ON DELETE CASCADE, -- NULL = 全班通用
  title VARCHAR(255) NOT NULL,
  description TEXT,
  assignment_type VARCHAR(50) NOT NULL, -- 'reading', 'writing', 'listening', 'speaking'
  due_date TIMESTAMP,
  max_score INT DEFAULT 100,
  auto_scoring BOOLEAN DEFAULT FALSE, -- 是否使用 AI 自動評分
  scoring_criteria JSONB DEFAULT '{}', -- 評分標準
  created_by UUID REFERENCES teachers(teacher_id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_assignments_node ON assignments(node_id);
CREATE INDEX idx_assignments_classroom ON assignments(classroom_id);
CREATE INDEX idx_assignments_due ON assignments(due_date);

-- Sample data
INSERT INTO assignments (node_id, classroom_id, title, assignment_type, due_date, auto_scoring) VALUES
  ((SELECT node_id FROM course_nodes WHERE path = 'grade1.unit1.lesson1'),
   (SELECT classroom_id FROM classrooms WHERE name = '一年級甲班'),
   '朗讀課文', 'speaking', '2024-09-20 23:59:59', TRUE);
```

---

## 3️⃣ 學習記錄層 (Transactional)

### 3.1 Submissions (提交記錄)

```sql
CREATE TABLE submissions (
  submission_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id UUID NOT NULL REFERENCES assignments(assignment_id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
  status VARCHAR(50) DEFAULT 'draft', -- 'draft', 'submitted', 'graded', 'returned'
  submitted_at TIMESTAMP,
  graded_at TIMESTAMP,
  graded_by UUID REFERENCES teachers(teacher_id),
  final_score DECIMAL(5, 2), -- 最終分數
  teacher_feedback TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(assignment_id, student_id) -- 每個作業只能提交一次
);

CREATE INDEX idx_submissions_assignment ON submissions(assignment_id);
CREATE INDEX idx_submissions_student ON submissions(student_id);
CREATE INDEX idx_submissions_status ON submissions(status);

-- Sample data
INSERT INTO submissions (assignment_id, student_id, status, submitted_at) VALUES
  ((SELECT assignment_id FROM assignments WHERE title = '朗讀課文'),
   (SELECT student_id FROM students WHERE name = '小明'),
   'submitted', NOW());
```

---

### 3.2 Submission Files (提交檔案)

```sql
CREATE TABLE submission_files (
  file_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID NOT NULL REFERENCES submissions(submission_id) ON DELETE CASCADE,
  file_type VARCHAR(50) NOT NULL, -- 'audio', 'video', 'image', 'document'
  file_url TEXT NOT NULL, -- S3 URL
  file_size_bytes BIGINT,
  duration_seconds INT, -- 音檔/影片長度
  mime_type VARCHAR(100),
  uploaded_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_submission_files_submission ON submission_files(submission_id);

-- Sample data
INSERT INTO submission_files (submission_id, file_type, file_url, file_size_bytes, duration_seconds) VALUES
  ((SELECT submission_id FROM submissions WHERE student_id = (SELECT student_id FROM students WHERE name = '小明')),
   'audio', 's3://bucket/submissions/student-001/audio.mp3', 512000, 45);
```

---

### 3.3 Scores (評分記錄)

```sql
CREATE TABLE scores (
  score_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID NOT NULL REFERENCES submissions(submission_id) ON DELETE CASCADE,
  score_type VARCHAR(50) NOT NULL, -- 'ai_auto', 'teacher_manual', 'peer_review'
  score_value DECIMAL(5, 2) NOT NULL,
  max_score DECIMAL(5, 2) DEFAULT 100,
  criteria JSONB DEFAULT '{}', -- 評分細項 {'pronunciation': 85, 'fluency': 90}
  feedback TEXT,
  scored_by UUID REFERENCES teachers(teacher_id), -- NULL if AI
  scored_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_scores_submission ON scores(submission_id);
CREATE INDEX idx_scores_type ON scores(score_type);

-- Sample data
INSERT INTO scores (submission_id, score_type, score_value, criteria) VALUES
  ((SELECT submission_id FROM submissions WHERE student_id = (SELECT student_id FROM students WHERE name = '小明')),
   'ai_auto', 87.5, '{"pronunciation": 85, "fluency": 90, "accuracy": 88}');
```

**說明**:
- 支援多次評分 (AI 自動 + 教師覆蓋)
- `criteria` 儲存細項評分

---

### 3.4 Learning Progress (學習進度)

```sql
CREATE TABLE learning_progress (
  progress_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
  node_id UUID NOT NULL REFERENCES course_nodes(node_id) ON DELETE CASCADE,
  status VARCHAR(50) DEFAULT 'not_started', -- 'not_started', 'in_progress', 'completed', 'mastered'
  completion_percentage INT DEFAULT 0, -- 0-100
  last_accessed_at TIMESTAMP,
  completed_at TIMESTAMP,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(student_id, node_id)
);

CREATE INDEX idx_learning_progress_student ON learning_progress(student_id);
CREATE INDEX idx_learning_progress_node ON learning_progress(node_id);

-- Sample data
INSERT INTO learning_progress (student_id, node_id, status, completion_percentage) VALUES
  ((SELECT student_id FROM students WHERE name = '小明'),
   (SELECT node_id FROM course_nodes WHERE path = 'grade1.unit1.lesson1'),
   'in_progress', 60);
```

---

### 3.5 Student Achievements (學生成就)

```sql
CREATE TABLE student_achievements (
  achievement_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
  achievement_type VARCHAR(100) NOT NULL, -- 'perfect_score', 'streak_7_days', 'completed_unit'
  title VARCHAR(255) NOT NULL,
  description TEXT,
  icon_url TEXT,
  earned_at TIMESTAMP DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX idx_achievements_student ON student_achievements(student_id);
CREATE INDEX idx_achievements_type ON student_achievements(achievement_type);
```

---

## 4️⃣ 外部整合層 (Sync)

### 4.1 GitHub Sync Logs (GitHub 同步記錄)

```sql
CREATE TABLE github_sync_logs (
  log_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(organization_id),
  sync_type VARCHAR(50) NOT NULL, -- 'full', 'incremental', 'webhook'
  status VARCHAR(50) NOT NULL, -- 'success', 'failed', 'partial'
  files_synced INT DEFAULT 0,
  errors JSONB DEFAULT '[]',
  started_at TIMESTAMP NOT NULL,
  completed_at TIMESTAMP,
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX idx_github_sync_organization ON github_sync_logs(organization_id);
CREATE INDEX idx_github_sync_status ON github_sync_logs(status);
```

---

### 4.2 Classroom Sync Logs (Google Classroom 同步記錄)

```sql
CREATE TABLE classroom_sync_logs (
  log_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  classroom_id UUID NOT NULL REFERENCES classrooms(classroom_id),
  sync_type VARCHAR(50) NOT NULL, -- 'students', 'teachers', 'assignments'
  status VARCHAR(50) NOT NULL,
  records_synced INT DEFAULT 0,
  errors JSONB DEFAULT '[]',
  started_at TIMESTAMP NOT NULL,
  completed_at TIMESTAMP
);

CREATE INDEX idx_classroom_sync_classroom ON classroom_sync_logs(classroom_id);
```

---

### 4.3 Webhook Events (Webhook 事件)

```sql
CREATE TABLE webhook_events (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source VARCHAR(50) NOT NULL, -- 'github', 'google_classroom'
  event_type VARCHAR(100) NOT NULL, -- 'push', 'pull_request', 'student_enrolled'
  payload JSONB NOT NULL,
  processed BOOLEAN DEFAULT FALSE,
  processed_at TIMESTAMP,
  received_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_webhook_events_source ON webhook_events(source);
CREATE INDEX idx_webhook_events_processed ON webhook_events(processed);
```

---

## 5️⃣ Row Level Security (RLS) 多租戶隔離

```sql
-- Enable RLS on all tenant tables
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE schools ENABLE ROW LEVEL SECURITY;
ALTER TABLE classrooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE teachers ENABLE ROW LEVEL SECURITY;
ALTER TABLE course_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE submissions ENABLE ROW LEVEL SECURITY;

-- 範例: 教師只能看到自己機構的資料
CREATE POLICY teacher_organization_isolation ON teachers
  FOR ALL
  USING (organization_id = current_setting('app.current_organization_id')::UUID);

-- 範例: 學生只能看到自己的提交記錄
CREATE POLICY student_submission_isolation ON submissions
  FOR ALL
  USING (student_id = current_setting('app.current_student_id')::UUID);

-- 應用程式設定 context
-- SET app.current_organization_id = 'uuid-here';
-- SET app.current_student_id = 'uuid-here';
```

---

## 6️⃣ 常用查詢範例

### 查詢 1: 取得班級所有學生的作業完成狀況

```sql
SELECT
  s.name AS student_name,
  a.title AS assignment_title,
  sub.status,
  sub.final_score,
  sub.submitted_at
FROM students s
CROSS JOIN assignments a
LEFT JOIN submissions sub
  ON sub.student_id = s.student_id
  AND sub.assignment_id = a.assignment_id
WHERE s.classroom_id = 'classroom-uuid'
  AND a.classroom_id = 'classroom-uuid'
ORDER BY a.due_date DESC, s.name;
```

### 查詢 2: 取得學生的學習進度 (完成了哪些課)

```sql
SELECT
  cn.path,
  cn.title,
  lp.status,
  lp.completion_percentage,
  lp.last_accessed_at
FROM learning_progress lp
JOIN course_nodes cn ON cn.node_id = lp.node_id
WHERE lp.student_id = 'student-uuid'
  AND cn.node_type = 'lesson'
ORDER BY cn.path;
```

### 查詢 3: 取得 AI 評分與教師評分對比

```sql
SELECT
  s.name AS student_name,
  a.title AS assignment_title,
  ai.score_value AS ai_score,
  teacher.score_value AS teacher_score,
  (teacher.score_value - ai.score_value) AS score_diff
FROM submissions sub
JOIN students s ON s.student_id = sub.student_id
JOIN assignments a ON a.assignment_id = sub.assignment_id
LEFT JOIN scores ai ON ai.submission_id = sub.submission_id AND ai.score_type = 'ai_auto'
LEFT JOIN scores teacher ON teacher.submission_id = sub.submission_id AND teacher.score_type = 'teacher_manual'
WHERE a.classroom_id = 'classroom-uuid';
```

---

## 7️⃣ 資料庫優化建議

### 分區 (Partitioning)

```sql
-- submissions 表按時間分區 (每季一個分區)
CREATE TABLE submissions_2024_q1 PARTITION OF submissions
  FOR VALUES FROM ('2024-01-01') TO ('2024-04-01');

CREATE TABLE submissions_2024_q2 PARTITION OF submissions
  FOR VALUES FROM ('2024-04-01') TO ('2024-07-01');
```

### 索引優化

```sql
-- 複合索引 (常一起查詢的欄位)
CREATE INDEX idx_submissions_student_assignment
  ON submissions(student_id, assignment_id);

-- 部分索引 (只索引特定狀態)
CREATE INDEX idx_submissions_pending
  ON submissions(assignment_id)
  WHERE status = 'submitted';
```

### 物化視圖 (Materialized Views)

```sql
-- 班級作業完成統計 (每小時更新)
CREATE MATERIALIZED VIEW mv_classroom_assignment_stats AS
SELECT
  c.classroom_id,
  c.name AS classroom_name,
  a.assignment_id,
  a.title AS assignment_title,
  COUNT(DISTINCT s.student_id) AS total_students,
  COUNT(DISTINCT sub.submission_id) AS submitted_count,
  AVG(sub.final_score) AS avg_score
FROM classrooms c
JOIN students s ON s.classroom_id = c.classroom_id
JOIN assignments a ON a.classroom_id = c.classroom_id
LEFT JOIN submissions sub ON sub.assignment_id = a.assignment_id AND sub.student_id = s.student_id
GROUP BY c.classroom_id, c.name, a.assignment_id, a.title;

-- 定期刷新
REFRESH MATERIALIZED VIEW mv_classroom_assignment_stats;
```

---

## 8️⃣ 遷移腳本範例

```sql
-- migrations/001_initial_schema.sql
BEGIN;

-- Create extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "ltree";

-- Create tables (按依賴順序)
-- ... (上述所有 CREATE TABLE 語句)

-- Create indexes
-- ... (上述所有 CREATE INDEX 語句)

-- Enable RLS
-- ... (上述所有 RLS 語句)

COMMIT;
```

---

## 9️⃣ 備份策略

```bash
# 每日全量備份
pg_dump -U postgres -d literacy_platform > backup_$(date +%Y%m%d).sql

# 連續歸檔 (WAL)
archive_mode = on
archive_command = 'cp %p /var/lib/postgresql/archive/%f'

# 時間點恢復 (PITR)
pg_basebackup -D /var/lib/postgresql/backup -Ft -z -P
```

---

## 🎯 總結

### Schema 設計原則驗證

| 原則 | 實現方式 |
|------|---------|
| **資料主權** | ✅ 所有核心資料在 PostgreSQL (不依賴外部系統) |
| **多租戶隔離** | ✅ Platform → Org → School → Classroom (4 層) + RLS |
| **階層式課程** | ✅ ltree 支援高效階層查詢 |
| **外部同步** | ✅ `github_path`, `google_classroom_id` 欄位 + Sync Logs |
| **可擴展性** | ✅ JSONB `metadata` 欄位 + 分區表 |
| **高效查詢** | ✅ 精心設計的索引 + 物化視圖 |

### 預估資料量 (500 學生、1 年)

| 表 | 預估記錄數 | 儲存空間 |
|----|-----------|---------|
| students | 500 | 50 KB |
| teachers | 50 | 5 KB |
| course_nodes | 1,000 | 500 KB |
| assignments | 5,000 | 2 MB |
| submissions | 150,000 | 50 MB |
| submission_files | 150,000 | 1 GB (metadata only, 音檔在 S3) |
| scores | 300,000 | 100 MB |
| **總計** | **~606,000 rows** | **~1.2 GB** |

### 效能指標

- **查詢延遲**: < 100ms (單一班級作業列表)
- **寫入 TPS**: > 1000 (作業提交高峰)
- **同步延遲**: < 5 分鐘 (GitHub Webhook 觸發)

---

## 📝 後續文件

✅ **完成**: 資料庫 Schema 設計
⏭️ **下一步**: GitHub 同步服務設計.md
