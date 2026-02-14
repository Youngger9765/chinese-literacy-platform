# MVP 設計 - 中文識字教學平台

> **專案**: 中文識字教學平台 (MVP)
>
> **設計日期**: 2026-02-13
>
> **核心理念**: 先做最小可行產品,驗證核心價值

---

## ⚠️ 待確認事項

在開始開發前,必須先確認:

- [ ] **客戶是誰?** ___________
- [ ] **學生人數?** ___________
- [ ] **教師人數?** ___________
- [ ] **預算範圍?** ___________
- [ ] **上線時間?** ___________
- [ ] **最關鍵的 1 個功能是什麼?** ___________

**⚠️ 在確認以上資訊前,不要開始開發!**

---

## 🎯 MVP 功能範圍

### 必須有 (Core)

1. **課程顯示**
   - 學生能看到課文 (從 GitHub Markdown)
   - 顯示生字和拼音

2. **錄音上傳**
   - 學生錄音朗讀課文
   - 上傳到雲端

3. **教師批改**
   - 教師聽錄音
   - 給分數和評語

**就這樣!其他都不做!**

### 明確不做 (Out of Scope)

- ❌ AI 自動評分 (太複雜,等 V2)
- ❌ Google Classroom 整合 (等確認需求)
- ❌ Admin UI 課程管理 (教師直接改 GitHub)
- ❌ 多租戶架構 (先做單一學校)
- ❌ 完整監控告警 (用雲端平台內建)
- ❌ 複雜測試策略 (基本測試即可)

---

## 🏗️ 技術架構

### 整體架構圖

```
┌─────────────┐
│   學生端    │ (React)
│  看課文     │
│  錄音上傳   │
└──────┬──────┘
       │ HTTPS
       ▼
┌─────────────────┐
│   後端 API      │ (NestJS)
│  /lessons       │
│  /submissions   │
└──────┬──────────┘
       │
       ├──> PostgreSQL (課程 + 作業)
       ├──> Cloud Storage (音檔)
       └──> GitHub (課程 Markdown)
```

### 技術選型

| 層級 | 技術 | 原因 |
|------|------|------|
| 前端 | React + TypeScript | 標準,易招人 |
| 後端 | NestJS + PostgreSQL | 標準,易維護 |
| 雲端 | **GCP** | Cloud Run + Cloud SQL + Cloud Storage |
| 課程 | GitHub (Markdown) | 版本控制 + 免費 |

---

## 📊 資料庫設計 (簡化版)

### Schema (只要 4 張表)

```sql
-- 1. 學生
CREATE TABLE students (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  email VARCHAR(255) UNIQUE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 2. 課程
CREATE TABLE lessons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(255) NOT NULL,
  content TEXT,                    -- 從 GitHub 同步
  vocabulary JSONB,                -- [{"char": "動", "pinyin": "dòng", "def": "..."}]
  github_path VARCHAR(500),        -- courses/grade1/lesson-01.md
  created_at TIMESTAMP DEFAULT NOW()
);

-- 3. 作業提交
CREATE TABLE submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID REFERENCES students(id),
  lesson_id UUID REFERENCES lessons(id),
  audio_url VARCHAR(500),          -- gs://bucket/submissions/xxx.mp3
  status VARCHAR(20) DEFAULT 'pending', -- pending | graded
  created_at TIMESTAMP DEFAULT NOW()
);

-- 4. 批改記錄
CREATE TABLE gradings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID REFERENCES submissions(id),
  score INTEGER,                   -- 0-100
  feedback TEXT,
  graded_by VARCHAR(255),          -- 教師 email
  graded_at TIMESTAMP DEFAULT NOW()
);
```

**就這樣!不要 Multi-tenancy,不要複雜階層!**

---

## 🔄 GitHub 同步邏輯

### 課程內容結構

```
courses/
  grade1/
    lesson-01.md
    lesson-02.md
  grade2/
    lesson-01.md
```

### Markdown 格式

```markdown
---
title: 第一課 我的家
grade: 1
---

## 課文

小明的家有**爸爸**、**媽媽**和**妹妹**。

## 生字

- **爸** (bà) - 父親
- **媽** (mā) - 母親
- **妹** (mèi) - 妹妹

## 作業

朗讀課文 3 遍,錄音上傳。
```

### 同步方式

**方案**: 簡單的定時 Git Pull

```typescript
// sync-service.ts

@Cron('0 * * * *') // 每小時
async syncLessons() {
  // 1. Git pull
  await this.git.pull();

  // 2. 讀取所有 .md 檔案
  const files = glob.sync('courses/**/*.md');

  // 3. Parse 每個檔案
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf-8');
    const { data, content: body } = matter(content); // YAML frontmatter

    // 4. Upsert 到資料庫
    await this.prisma.lesson.upsert({
      where: { github_path: file },
      create: {
        title: data.title,
        content: body,
        vocabulary: this.parseVocabulary(body),
        github_path: file,
      },
      update: {
        title: data.title,
        content: body,
        vocabulary: this.parseVocabulary(body),
      },
    });
  }
}
```

**不用 Webhook!先簡單做!**

---

## 🎨 前端設計 (MVP)

### 學生端 (3 個頁面)

#### 1. 課程列表 `/lessons`

```tsx
export default function LessonsPage() {
  const { data: lessons } = useQuery('lessons', () => api.lessons.list());

  return (
    <div className="container">
      <h1>我的課程</h1>
      {lessons?.map(lesson => (
        <div key={lesson.id} className="card">
          <h2>{lesson.title}</h2>
          <Link to={`/lessons/${lesson.id}`}>開始學習</Link>
        </div>
      ))}
    </div>
  );
}
```

#### 2. 課程內容 `/lessons/:id`

```tsx
export default function LessonPage() {
  const { id } = useParams();
  const { data: lesson } = useQuery(['lesson', id], () => api.lessons.get(id));

  return (
    <div className="container">
      <h1>{lesson.title}</h1>

      {/* 課文 */}
      <section>
        <h2>課文</h2>
        <div dangerouslySetInnerHTML={{ __html: marked(lesson.content) }} />
      </section>

      {/* 生字 */}
      <section>
        <h2>生字</h2>
        {lesson.vocabulary?.map(v => (
          <div key={v.char}>
            <span className="text-3xl">{v.char}</span>
            <span className="text-gray-500">({v.pinyin})</span>
            <p>{v.definition}</p>
          </div>
        ))}
      </section>

      {/* 錄音 */}
      <section>
        <h2>朗讀作業</h2>
        <AudioRecorder onSave={(blob) => submitRecording(id, blob)} />
      </section>
    </div>
  );
}
```

#### 3. 作業記錄 `/submissions`

```tsx
export default function SubmissionsPage() {
  const { data: submissions } = useQuery('submissions', () => api.submissions.list());

  return (
    <div className="container">
      <h1>我的作業</h1>
      {submissions?.map(sub => (
        <div key={sub.id}>
          <h3>{sub.lesson.title}</h3>
          <p>狀態: {sub.status === 'graded' ? '已批改' : '批改中'}</p>
          {sub.grading && (
            <div>
              <p>分數: {sub.grading.score}</p>
              <p>評語: {sub.grading.feedback}</p>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
```

### 教師端 (1 個頁面)

#### 批改頁面 `/teacher/grading`

```tsx
export default function GradingPage() {
  const { data: submissions } = useQuery('pending-submissions',
    () => api.submissions.list({ status: 'pending' })
  );

  const gradeMutation = useMutation((data) => api.submissions.grade(data));

  return (
    <div className="container">
      <h1>待批改作業</h1>
      {submissions?.map(sub => (
        <div key={sub.id} className="card">
          <h3>{sub.student.name} - {sub.lesson.title}</h3>

          {/* 播放音檔 */}
          <audio src={sub.audio_url} controls />

          {/* 批改表單 */}
          <form onSubmit={(e) => {
            e.preventDefault();
            gradeMutation.mutate({
              submission_id: sub.id,
              score: e.target.score.value,
              feedback: e.target.feedback.value,
            });
          }}>
            <label>分數 (0-100)</label>
            <input type="number" name="score" min="0" max="100" required />

            <label>評語</label>
            <textarea name="feedback" rows="3" />

            <button type="submit">提交批改</button>
          </form>
        </div>
      ))}
    </div>
  );
}
```

---

## 🚀 GCP 部署架構

### 雲端服務選擇

| 服務 | GCP 產品 | 用途 |
|------|---------|------|
| 後端 | **Cloud Run** | 無伺服器容器,自動擴展 |
| 資料庫 | **Cloud SQL (PostgreSQL)** | 託管資料庫 |
| 音檔儲存 | **Cloud Storage** | 物件儲存 |
| 前端 | **Firebase Hosting** | 靜態網站託管 |

### 架構圖

```
[學生/教師] → Firebase Hosting (React)
                    ↓ API 呼叫
               Cloud Run (NestJS)
                    ↓
    ┌───────────────┼───────────────┐
    ▼               ▼               ▼
Cloud SQL    Cloud Storage      GitHub
(資料庫)      (音檔)          (課程 Markdown)
```

### 成本估算 (50 學生)

| 項目 | 規格 | 月成本 |
|------|------|--------|
| Cloud Run | 100 萬次請求 | $0 (免費額度) |
| Cloud SQL | db-f1-micro | $7 |
| Cloud Storage | 5 GB | $0.10 |
| Firebase Hosting | 10 GB | $0 (免費額度) |
| **總計** | - | **~$10/月** |

**500 學生**: ~$50/月 (10 倍)

---

## 📦 部署步驟

### 1. 準備 GCP 專案

```bash
# 建立專案
gcloud projects create literacy-platform

# 啟用服務
gcloud services enable run.googleapis.com
gcloud services enable sqladmin.googleapis.com
gcloud services enable storage.googleapis.com
```

### 2. 部署資料庫

```bash
# 建立 Cloud SQL 實例
gcloud sql instances create literacy-db \
  --database-version=POSTGRES_15 \
  --tier=db-f1-micro \
  --region=asia-east1

# 建立資料庫
gcloud sql databases create literacy --instance=literacy-db

# 執行 Schema
psql -h <INSTANCE_IP> -U postgres -d literacy -f schema.sql
```

### 3. 部署後端

```bash
# 建立 Dockerfile
cat > Dockerfile <<EOF
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build
CMD ["npm", "run", "start:prod"]
EOF

# 部署到 Cloud Run
gcloud run deploy literacy-api \
  --source . \
  --platform managed \
  --region asia-east1 \
  --allow-unauthenticated
```

### 4. 部署前端

```bash
# 建立 Firebase 專案
firebase init hosting

# 設定 API URL
echo "VITE_API_URL=https://literacy-api-xxx.run.app" > .env.production

# 建置並部署
npm run build
firebase deploy
```

---

## 🧪 測試策略 (MVP)

### 只測關鍵路徑

```typescript
// E2E 測試 (Playwright)

test('學生完整流程', async ({ page }) => {
  // 1. 登入
  await page.goto('/');
  await page.fill('[name=email]', 'student@example.com');
  await page.click('text=登入');

  // 2. 選擇課程
  await page.click('text=第一課');

  // 3. 錄音 (模擬)
  await page.click('[aria-label=開始錄音]');
  await page.waitForTimeout(2000);
  await page.click('[aria-label=停止錄音]');
  await page.click('text=提交');

  // 4. 驗證提交成功
  await expect(page.locator('text=提交成功')).toBeVisible();
});

test('教師批改流程', async ({ page }) => {
  // 1. 登入
  await page.goto('/teacher');

  // 2. 批改作業
  await page.fill('[name=score]', '85');
  await page.fill('[name=feedback]', '發音清晰,很棒!');
  await page.click('text=提交批改');

  // 3. 驗證成功
  await expect(page.locator('text=批改成功')).toBeVisible();
});
```

**不寫複雜的單元測試!只測端到端!**

---

## 📅 開發時程

### 4 週 MVP

| 週次 | 任務 | 負責人 |
|------|------|--------|
| **W1** | 資料庫 Schema<br>GitHub 同步服務<br>基本 CRUD API | 後端工程師 |
| **W2** | 學生端 3 頁面<br>錄音組件 | 前端工程師 |
| **W3** | 教師批改頁面<br>音檔上傳 Cloud Storage | 前端 + 後端 |
| **W4** | E2E 測試<br>GCP 部署<br>修 Bug | 全員 |

**人力**: 1 全端工程師 或 1 前端 + 1 後端

**成本**: $17,600 (4 週 × $110/hr × 8hr/day × 5 days)

---

## ✅ MVP 完成定義

當以下全部達成,MVP 就算完成:

- [X] 學生能看到課程內容
- [X] 學生能錄音並上傳
- [X] 教師能聽錄音並批改
- [X] 學生能看到批改結果
- [X] 部署到 GCP 並能正常運作
- [X] 至少 1 位真實使用者測試通過

**達成以上 → 可以上線!**

---

## 🔄 後續版本規劃 (等 MVP 驗證後)

### V2 (如果 MVP 成功)

- [ ] AI 自動評分 (Whisper STT)
- [ ] Google Classroom 整合
- [ ] 課程管理 Admin UI

### V3 (如果有很多學校)

- [ ] Multi-tenancy 架構
- [ ] 完整監控告警
- [ ] 進階數據分析

**但這些都是「以後」的事!先做 MVP!**

---

## 📝 關鍵決策記錄

### 為什麼選 GCP?

- ✅ Cloud Run 無伺服器,成本低
- ✅ 與 Firebase 整合好
- ✅ 台灣有 asia-east1 機房

### 為什麼不做 AI 評分?

- ⚠️ 太複雜,風險高
- ⚠️ 先驗證教師手動批改是否可行
- ✅ V2 再加

### 為什麼用 GitHub 存課程?

- ✅ 版本控制
- ✅ 免費
- ✅ 教師會用 (或可以學)

---

## 🚨 風險與應對

| 風險 | 影響 | 應對 |
|------|------|------|
| 客戶需求不明確 | **高** | ⚠️ 開發前必須確認 |
| 教師不會用 GitHub | 中 | 提供教學影片 |
| 錄音品質差 | 中 | 前端加入音量檢測 |
| GCP 成本超支 | 低 | 設定預算告警 |

---

## 📞 聯絡資訊

- **技術負責人**: ___________
- **產品負責人**: ___________
- **GitHub Repo**: ___________
- **GCP 專案 ID**: ___________

---

**Generated with [Claude Code](https://claude.ai/code) via [Happy](https://happy.engineering)**

Co-Authored-By: Claude <noreply@anthropic.com>
Co-Authored-By: Happy <yesreply@happy.engineering>
