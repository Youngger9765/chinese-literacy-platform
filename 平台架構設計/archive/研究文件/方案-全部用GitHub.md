# 方案:全部用 GitHub (課程 + 作業)

> **核心理念**:GitHub 作為唯一的內容管理系統,簡化架構
>
> **定位**:GitHub = 課程內容 + 作業模板 + 版本控制 + 協作審閱

---

## 🎯 為什麼全部用 GitHub?

### 架構簡化對比

| 方案 | 內容管理 | 版本控制 | 協作審閱 | 系統數量 | 複雜度 |
|------|---------|---------|---------|---------|--------|
| **三平台整合** | Notion | GitHub | GitHub PR | 3 個 | ⭐⭐⭐⭐⭐ |
| **Classroom + Notion** | Notion | Notion | Notion | 2 個 | ⭐⭐⭐⭐ |
| **全部 GitHub** | GitHub | GitHub | GitHub PR | 1 個 | ⭐⭐ ✅ |

### 核心優勢

```
✅ 優勢 1: 單一系統,無需跨平台同步
  - 課程內容在 GitHub Repository
  - 作業模板在 GitHub Issues
  - 版本控制原生支援 (Git)
  - 協作審閱原生支援 (PR)

✅ 優勢 2: 真正的版本控制
  - Git commit history (完整記錄)
  - Git diff (比較變更)
  - Git blame (追蹤作者)
  - Git revert (回溯版本)

✅ 優勢 3: 內建協作流程
  - Pull Request (課程審閱)
  - Code Review (內容審查)
  - Branch (草稿/正式版本)
  - Merge (發布流程)

✅ 優勢 4: 開發成本低
  - 無需整合多個 API
  - 無需建立同步機制
  - 無需維護 ID 映射
  - 專注在核心功能
```

---

## 📁 GitHub Repository 結構設計

### 方案 A: 單一 Monorepo

```
curriculum-repo/
├─ .github/
│  ├─ workflows/
│  │  ├─ validate-course.yml      # 課程格式驗證
│  │  ├─ deploy-preview.yml       # PR 預覽部署
│  │  └─ publish-course.yml       # 發布到生產
│  └─ ISSUE_TEMPLATE/
│     ├─ assignment-reading.md    # 朗讀作業模板
│     ├─ assignment-vocab.md      # 生字作業模板
│     └─ assignment-comprehension.md
│
├─ courses/                        # 課程內容
│  ├─ grade-1/                     # 一年級
│  │  ├─ semester-1/               # 上學期
│  │  │  ├─ lesson-01/
│  │  │  │  ├─ README.md          # 課程總覽
│  │  │  │  ├─ lesson.md          # 課文內容
│  │  │  │  ├─ vocabulary.md      # 生字表
│  │  │  │  ├─ teacher-guide.md   # 教師指引
│  │  │  │  └─ assets/
│  │  │  │     ├─ audio.mp3       # 朗讀音檔
│  │  │  │     └─ images/         # 插圖
│  │  │  └─ lesson-02/
│  │  └─ semester-2/
│  └─ grade-2/
│
├─ assignments/                    # 作業模板庫
│  ├─ reading/
│  │  └─ template.md
│  ├─ vocabulary/
│  │  └─ template.md
│  └─ comprehension/
│     └─ template.md
│
├─ templates/                      # 課程模板
│  ├─ course-template.md
│  └─ lesson-template.md
│
└─ README.md                       # 專案總覽
```

**優點**:
- ✅ 所有內容集中管理
- ✅ 跨課程搜尋容易
- ✅ 統一的 CI/CD

**缺點**:
- ⚠️ Repository 可能變得很大
- ⚠️ 權限管理較粗糙(整個 repo 層級)

---

### 方案 B: 多 Repository (推薦)

```
GitHub Organization: school-curriculum

Repositories:
├─ grade-1-semester-1              # 一年級上學期
│  ├─ lesson-01/
│  ├─ lesson-02/
│  └─ ...
│
├─ grade-1-semester-2              # 一年級下學期
│
├─ grade-2-semester-1              # 二年級上學期
│
├─ assignment-templates            # 作業模板庫
│  ├─ reading/
│  ├─ vocabulary/
│  └─ comprehension/
│
└─ course-standards                # 課程標準/指引
   ├─ curriculum-guidelines.md
   └─ lesson-structure.md
```

**優點**:
- ✅ 權限控制精細(per repo)
- ✅ Repository 大小可控
- ✅ 可獨立發布

**缺點**:
- ⚠️ 跨課程搜尋較複雜
- ⚠️ 需要管理多個 repo

---

## 📝 課程內容格式

### Markdown 課程結構

```markdown
# 第一課:我的家

## 課程資訊
- **年級**: 一年級
- **學期**: 上學期
- **課次**: 第一課
- **預估時間**: 40 分鐘
- **更新日期**: 2026-02-13
- **作者**: @teacher-wang

## 學習目標
- 能正確朗讀課文
- 認識本課 10 個生字
- 理解家庭成員的稱呼

## 課文內容

### 第一段
我的家有爸爸、媽媽和我。
我們住在一棟很溫暖的房子裡。

> 💡 **教學提示**: 引導學生分享自己的家庭成員

### 第二段
爸爸每天去上班,媽媽在家裡照顧我。
我很愛我的家。

## 生字表

| 生字 | 注音 | 部首 | 筆畫 | 詞語 | 例句 |
|------|------|------|------|------|------|
| 家 | ㄐㄧㄚ | 宀 | 10 | 家人、回家 | 我愛我的家 |
| 爸 | ㄅㄚˋ | 父 | 8 | 爸爸 | 爸爸去上班 |
| 媽 | ㄇㄚ | 女 | 13 | 媽媽 | 媽媽很辛苦 |

## 朗讀音檔
[▶️ 播放課文朗讀](./assets/lesson-01-reading.mp3)

## 教師指引

### 課前準備
- 準備家庭照片範例
- 準備生字卡片

### 教學流程
1. **引起動機** (5 分鐘)
   - 展示家庭照片
   - 詢問學生家中有誰

2. **課文教學** (20 分鐘)
   - 教師範讀
   - 學生跟讀
   - 分段朗讀

3. **生字教學** (10 分鐘)
   - 介紹生字部首
   - 練習寫字

4. **總結** (5 分鐘)
   - 複習重點
   - 布置作業

## 相關作業
- #123 【朗讀】第一課 - 我的家
- #124 【生字】第一課 - 生字練習
- #125 【閱讀理解】第一課 - 問答題

## 延伸資源
- [家庭教育教材](https://example.com/family-education)
- [相關繪本推薦](https://example.com/picture-books)

---
**Metadata**:
- `grade`: 1
- `semester`: 1
- `lesson_number`: 1
- `status`: published
- `version`: 1.2.0
```

---

## 🔄 內部團隊工作流

### 1. 課程建立流程

```bash
# 1. 教研人員建立新分支
git checkout -b feature/lesson-05

# 2. 複製課程模板
cp templates/lesson-template.md courses/grade-1/semester-1/lesson-05/lesson.md

# 3. 編輯課程內容
code courses/grade-1/semester-1/lesson-05/lesson.md

# 4. 提交變更
git add .
git commit -m "feat: 新增第五課 - 我的學校"
git push origin feature/lesson-05

# 5. 建立 Pull Request
gh pr create \
  --title "新課程:第五課 - 我的學校" \
  --body "## 課程資訊
- 年級:一年級
- 學習目標:認識學校環境
- 生字數量:12 個

## 審閱重點
- [ ] 課文內容是否適合年齡
- [ ] 生字難度是否恰當
- [ ] 音檔品質是否清晰

@reviewer-li 請審閱"
```

### 2. 課程審閱流程

```
教研人員提交 PR
    ↓
審閱人員收到通知
    ↓
在 GitHub PR 頁面審閱
    ├─ 查看 Diff (變更內容)
    ├─ 在特定行留言
    └─ 批准或要求修改
    ↓
(如果要求修改)
    ↓
教研人員修改內容
    ↓
再次提交審閱
    ↓
審閱通過
    ↓
Merge to main
    ↓
自動部署到生產環境
    ↓
學生/教師在前端看到新課程
```

**GitHub PR 審閱介面範例**:
```
Pull Request #45
新課程:第五課 - 我的學校

Files changed (3)
┌────────────────────────────────────────┐
│ lesson.md                              │
│ @@ -0,0 +1,50 @@                       │
│ +# 第五課:我的學校                      │
│ +                                       │
│ +## 課文內容                            │
│ +我的學校很大很美麗。                   │
│                                         │
│ 💬 審閱人員 15:30                       │
│ 建議加上注音:ㄇㄟˇ ㄌㄧˋ                │
│                                         │
│ 💬 作者 16:00                           │
│ 已修改,感謝建議                         │
└────────────────────────────────────────┘

✅ Changes approved by @reviewer-li
🔀 Merged by @admin
```

### 3. 版本控制與回溯

```bash
# 查看課程修改歷史
git log --oneline courses/grade-1/semester-1/lesson-01/lesson.md

# 輸出:
# a1b2c3d (HEAD -> main) fix: 修正第一課注音錯誤
# d4e5f6g feat: 新增第一課延伸資源
# g7h8i9j feat: 第一課初版

# 查看特定版本的變更
git show a1b2c3d

# 比較兩個版本
git diff g7h8i9j a1b2c3d

# 回溯到舊版本
git revert a1b2c3d  # 建立新 commit 還原變更
# 或
git checkout g7h8i9j -- courses/grade-1/semester-1/lesson-01/lesson.md
```

---

## 🤖 GitHub Actions 自動化

### 1. 課程格式驗證

```yaml
# .github/workflows/validate-course.yml
name: 課程格式驗證

on:
  pull_request:
    paths:
      - 'courses/**/*.md'

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: 檢查 Markdown 格式
        run: |
          # 檢查是否有必要的章節
          for file in courses/**/*.md; do
            if ! grep -q "## 課程資訊" "$file"; then
              echo "錯誤: $file 缺少「課程資訊」章節"
              exit 1
            fi
            if ! grep -q "## 生字表" "$file"; then
              echo "錯誤: $file 缺少「生字表」章節"
              exit 1
            fi
          done

      - name: 檢查生字表格式
        run: |
          # 檢查生字表是否有所有欄位
          python scripts/validate_vocabulary.py

      - name: 留言通知
        if: success()
        run: |
          gh pr comment ${{ github.event.pull_request.number }} \
            --body "✅ 課程格式驗證通過"
```

### 2. PR 預覽部署

```yaml
# .github/workflows/deploy-preview.yml
name: PR 預覽部署

on:
  pull_request:
    types: [opened, synchronize]

jobs:
  deploy-preview:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: 轉換 Markdown 為 HTML
        run: |
          npm install -g marked
          mkdir -p preview
          for file in courses/**/*.md; do
            marked "$file" -o "preview/${file%.md}.html"
          done

      - name: 部署到 Vercel Preview
        run: |
          vercel deploy --prod=false
          echo "PREVIEW_URL=$(vercel inspect --json | jq -r .url)" >> $GITHUB_ENV

      - name: 留言預覽連結
        run: |
          gh pr comment ${{ github.event.pull_request.number }} \
            --body "📱 預覽連結: ${{ env.PREVIEW_URL }}"
```

### 3. 自動發布

```yaml
# .github/workflows/publish-course.yml
name: 發布課程

on:
  push:
    branches:
      - main
    paths:
      - 'courses/**/*.md'

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: 同步到資料庫
        run: |
          python scripts/sync_to_database.py

      - name: 清除快取
        run: |
          curl -X POST https://api.example.com/cache/clear

      - name: 發送通知
        run: |
          curl -X POST ${{ secrets.SLACK_WEBHOOK }} \
            -d '{"text": "新課程已發布"}'
```

---

## 🔗 與其他系統的整合

### 架構圖

```
┌─────────────────────────────────────────────┐
│  GitHub (唯一內容管理系統)                   │
│  ┌────────────────────────────────────────┐ │
│  │ Repositories (課程 + 作業)              │ │
│  │ - Markdown 格式                         │ │
│  │ - Git 版本控制                          │ │
│  │ - PR 審閱流程                           │ │
│  └────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
              ↓ GitHub API (REST + GraphQL)
┌─────────────────────────────────────────────┐
│  我們的後端 (同步服務)                       │
│  ┌────────────────────────────────────────┐ │
│  │ 定期同步 GitHub 內容到本地              │ │
│  │ - 每小時同步一次                        │ │
│  │ - Webhook 即時更新                     │ │
│  │ - 轉換 Markdown → 結構化資料           │ │
│  └────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────┐ │
│  │ PostgreSQL (本地資料庫)                 │ │
│  │ - 課程內容快取                          │ │
│  │ - 學習記錄                              │ │
│  │ - AI 評分                               │ │
│  └────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
              ↓ REST API
┌─────────────────────────────────────────────┐
│  我們的前端 (學生/教師使用)                  │
│  - 課程瀏覽                                 │
│  - 作業完成                                 │
│  - 學習互動                                 │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│  Google Classroom (可選)                    │
│  - OAuth 登入                               │
│  - 班級管理                                 │
│  - 通知系統                                 │
└─────────────────────────────────────────────┘
```

---

## 💻 技術實作

### 1. 同步服務

```typescript
// /backend/src/sync/github-course-sync.service.ts

export class GitHubCourseSyncService {
  private octokit: Octokit;

  // ========== 同步單一課程 ==========
  async syncCourse(repo: string, coursePath: string) {
    // 1. 從 GitHub 取得 Markdown 內容
    const response = await this.octokit.rest.repos.getContent({
      owner: 'school-curriculum',
      repo: repo,
      path: `${coursePath}/lesson.md`,
    });

    const markdown = Buffer.from(response.data.content, 'base64').toString();

    // 2. 解析 Markdown
    const parsed = this.parseMarkdown(markdown);

    // 3. 儲存到資料庫
    await this.db.query(
      `INSERT INTO courses (
        course_id, title, grade, content, github_path
      ) VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (github_path) DO UPDATE SET
        title = EXCLUDED.title,
        content = EXCLUDED.content,
        updated_at = NOW()`,
      [
        uuid(),
        parsed.title,
        parsed.metadata.grade,
        JSON.stringify(parsed),
        `${repo}/${coursePath}`,
      ]
    );
  }

  // ========== 解析 Markdown ==========
  private parseMarkdown(markdown: string) {
    const lines = markdown.split('\n');
    let section = '';
    const result: any = {
      metadata: {},
      sections: {},
    };

    for (const line of lines) {
      // 解析標題
      if (line.startsWith('# ')) {
        result.title = line.replace('# ', '');
      }
      // 解析章節
      else if (line.startsWith('## ')) {
        section = line.replace('## ', '');
        result.sections[section] = [];
      }
      // 解析 Metadata
      else if (line.startsWith('- `')) {
        const match = line.match(/- `(\w+)`: (.+)/);
        if (match) {
          result.metadata[match[1]] = match[2];
        }
      }
      // 解析內容
      else if (section) {
        result.sections[section].push(line);
      }
    }

    return result;
  }

  // ========== Webhook 處理 ==========
  async handleWebhook(payload: GitHubWebhookPayload) {
    // GitHub Push Event
    if (payload.ref === 'refs/heads/main') {
      // 課程內容更新
      for (const commit of payload.commits) {
        for (const file of commit.modified) {
          if (file.startsWith('courses/') && file.endsWith('.md')) {
            await this.syncCourse(
              payload.repository.name,
              file.replace('/lesson.md', '')
            );
          }
        }
      }
    }

    // Pull Request Merged
    if (payload.action === 'closed' && payload.pull_request.merged) {
      console.log(`PR #${payload.pull_request.number} merged, syncing...`);
      await this.syncAllCourses();
    }
  }
}
```

### 2. Markdown 渲染

```typescript
// /frontend/src/components/CourseViewer.tsx

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export function CourseViewer({ courseId }: { courseId: string }) {
  const { data: course } = useCourse(courseId);

  return (
    <div className="prose max-w-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // 自訂生字表渲染
          table: ({ node, ...props }) => (
            <VocabularyTable {...props} />
          ),
          // 自訂音檔播放器
          a: ({ node, href, ...props }) => {
            if (href?.endsWith('.mp3')) {
              return <AudioPlayer src={href} />;
            }
            return <a href={href} {...props} />;
          },
        }}
      >
        {course.content}
      </ReactMarkdown>
    </div>
  );
}
```

---

## 📊 優劣分析

### ✅ 優勢

| 優勢 | 說明 | 價值 |
|------|------|------|
| **架構簡單** | 單一系統,無跨平台同步 | ⭐⭐⭐⭐⭐ |
| **真正的版本控制** | Git commit history | ⭐⭐⭐⭐⭐ |
| **協作流程成熟** | PR + Code Review | ⭐⭐⭐⭐⭐ |
| **開發成本低** | 2-3 週即可上線 | ⭐⭐⭐⭐⭐ |
| **維護成本低** | 不需要維護同步系統 | ⭐⭐⭐⭐⭐ |
| **免費** | GitHub 對開源/教育免費 | ⭐⭐⭐⭐⭐ |

### ⚠️ 劣勢

| 劣勢 | 說明 | 解決方案 |
|------|------|---------|
| **Markdown 編輯門檻** | 教師需學習 Markdown 語法 | 提供 Markdown 編輯器 UI |
| **富文本體驗較差** | 不如 Notion 直觀 | 使用 GitHub Codespaces |
| **多媒體管理** | 需要手動上傳音檔/圖片 | 使用 LFS 或外部存儲 |
| **權限管理複雜** | GitHub 權限系統較複雜 | 使用 GitHub Teams |

---

## 🎯 推薦實施方案

### Phase 1: MVP (Week 1-2)

```
Week 1:
✅ 建立 GitHub Repository 結構
✅ 建立課程模板
✅ 撰寫 2-3 個範例課程
✅ GitHub API 整合

Week 2:
✅ 同步服務開發
✅ Markdown 渲染前端
✅ 基本課程瀏覽功能
```

### Phase 2: 協作流程 (Week 3)

```
✅ PR 模板設定
✅ GitHub Actions (格式驗證)
✅ 審閱流程培訓
✅ 內部團隊試用
```

### Phase 3: 整合 Google Classroom (Week 4)

```
✅ OAuth 登入
✅ 班級同步
✅ 作業通知
```

---

## 💡 最終建議

### ✅ 推薦採用「GitHub + Google Classroom」組合

```
GitHub (內容管理)
  ├─ 課程內容 (Markdown)
  ├─ 作業模板 (Issues)
  ├─ 版本控制 (Git)
  └─ 協作審閱 (PR)
      ↓
Google Classroom (身份與通知)
  ├─ OAuth 登入
  ├─ 班級管理
  └─ 作業通知
      ↓
我們的系統 (核心價值)
  ├─ AI 評分引擎
  ├─ 學習記錄分析
  ├─ 遊戲化系統
  └─ 客製化前端
```

**開發時間**: 4 週
**複雜度**: ⭐⭐ (極低)
**投資報酬率**: ⭐⭐⭐⭐⭐

**結論**: 這是最簡潔、最實用的方案!

