# GitHub API 深度評估報告

> **評估重點**: GitHub API 能幫忙多少?Rate Limit 會不會是瓶頸?
>
> **評估範圍**: 課程內容管理、作業管理、版本控制、協作審閱

---

## 🎯 評估場景設定

### 假設規模

```
教育機構規模:
- 500 個學生
- 50 位教師
- 50 門課程
- 每門課程 20 個模組
- 每天活躍率 30% (150 個學生)

預期操作:
- 每天 150 個學生查看課程
- 每天 10 位教師編輯課程
- 每天 20 個作業提交
- 每週 5 個課程審閱 (PR)
```

---

## 📊 GitHub API Rate Limit 詳細分析

### 1. Rate Limit 規則

| API 類型 | 限制 | 重置時間 | 實際影響 |
|---------|------|---------|---------|
| **REST API (authenticated)** | 5,000 requests/hour | 每小時重置 | 主要限制 |
| **GraphQL API** | 5,000 points/hour | 每小時重置 | 依查詢複雜度計費 |
| **Search API** | 30 requests/minute | 每分鐘重置 | 嚴格限制 ⚠️ |
| **Secondary Rate Limits** | 動態限制 | 不固定 | 防止突發請求 ⚠️ |

### 2. Secondary Rate Limits (隱藏殺手)

```
Secondary Rate Limits 會在以下情況觸發:
❌ 短時間內大量請求 (即使未超過 5000/hour)
❌ 快速建立大量 Issues/PRs
❌ 快速更新大量內容
❌ 並發請求過多

觸發後果:
- 403 Forbidden
- 需要等待 (無明確時間)
- 官方文件說明模糊

來源: GitHub Docs - Secondary rate limits
```

---

## 📈 實際 API 用量估算

### 場景 1: 學生查看課程

```typescript
// 學生打開課程頁面
async function loadCourse(courseId: string) {
  // API 呼叫 1: 取得課程 Markdown 內容
  const content = await octokit.rest.repos.getContent({
    owner: 'school',
    repo: 'grade-1-semester-1',
    path: 'lesson-01/lesson.md'
  });

  // API 呼叫 2: 取得音檔
  const audio = await octokit.rest.repos.getContent({
    owner: 'school',
    repo: 'grade-1-semester-1',
    path: 'lesson-01/assets/audio.mp3'
  });

  // API 呼叫 3: 取得圖片列表
  const images = await octokit.rest.repos.getContent({
    owner: 'school',
    repo: 'grade-1-semester-1',
    path: 'lesson-01/assets/images'
  });

  // 總計: 3 次 API 呼叫
}
```

**每日用量**:
```
150 個學生 × 3 次 API 呼叫 = 450 requests/day
每小時平均: 450 / 24 ≈ 19 requests/hour
```

✅ **不是問題** (遠低於 5000/hour)

---

### 場景 2: 學生提交作業

```typescript
// 方案 A: 使用 GitHub Issues (不推薦)
async function submitAssignment(studentId: string, assignmentId: string) {
  // API 呼叫 1: 建立 Issue Comment
  await octokit.rest.issues.createComment({
    owner: 'school',
    repo: 'assignments',
    issue_number: assignmentId,
    body: `學生 ${studentId} 已提交作業\n[查看詳情](https://platform.com/submission/${id})`
  });

  // 總計: 1 次 API 呼叫
}

// 每日用量:
// 150 個學生 × 1 次 = 150 requests/day
// 每小時平均: 6 requests/hour
```

✅ **不是問題**

```typescript
// 方案 B: 儲存到我們的資料庫 (推薦)
async function submitAssignment(studentId: string, assignmentId: string) {
  // 0 次 GitHub API 呼叫!
  await db.query(`
    INSERT INTO submissions (student_id, assignment_id, content)
    VALUES ($1, $2, $3)
  `, [studentId, assignmentId, content]);

  // 總計: 0 次 API 呼叫
}
```

✅ **完全不依賴 GitHub API**

---

### 場景 3: 教師編輯課程

```typescript
// 教師在我們的前端編輯課程
async function updateCourse(courseId: string, content: string) {
  // 方案 A: 直接更新 GitHub (不推薦,會觸發 Secondary Rate Limit)
  await octokit.rest.repos.createOrUpdateFileContents({
    owner: 'school',
    repo: 'grade-1-semester-1',
    path: 'lesson-01/lesson.md',
    message: 'Update lesson content',
    content: Buffer.from(content).toString('base64')
  });
  // 總計: 1 次 API 呼叫
}

// 每日用量:
// 10 位教師 × 5 次編輯 = 50 requests/day
// 每小時平均: 2 requests/hour
```

✅ **看似沒問題**

⚠️ **但實際上有問題!**

```
Secondary Rate Limit 問題:
如果 3 位教師在 5 分鐘內快速編輯同一門課程:
- 3 teachers × 10 edits = 30 requests in 5 min
- GitHub 會認為這是「異常行為」
- 觸發 Secondary Rate Limit
- 403 Forbidden

實際案例:
"Creating content too quickly" error
來源: GitHub Community Discussions
```

**解決方案**:
```typescript
// 方案 B: 本地草稿 → 定期同步 → PR (推薦)
async function saveDraft(courseId: string, content: string) {
  // 1. 儲存到本地資料庫
  await db.query(`
    INSERT INTO course_drafts (course_id, content, author_id)
    VALUES ($1, $2, $3)
  `, [courseId, content, authorId]);

  // 0 次 GitHub API 呼叫!
}

async function publishCourse(courseId: string) {
  // 2. 發布時建立 PR (一次性操作)
  const draft = await db.getDraft(courseId);

  await octokit.rest.pulls.create({
    owner: 'school',
    repo: 'grade-1-semester-1',
    title: `Update: ${draft.title}`,
    head: `draft-${courseId}`,
    base: 'main',
    body: draft.changelog
  });

  // 總計: 1 次 API 呼叫 (低頻)
}
```

---

### 場景 4: 同步所有課程到本地

```typescript
// 系統啟動時或定期同步
async function syncAllCourses() {
  // API 呼叫 1: 列出所有 Repository
  const repos = await octokit.rest.repos.listForOrg({
    org: 'school-curriculum',
    per_page: 100
  });
  // 1 次 API 呼叫

  for (const repo of repos.data) {
    // API 呼叫 2: 取得 Repository 目錄結構
    const tree = await octokit.rest.git.getTree({
      owner: 'school-curriculum',
      repo: repo.name,
      tree_sha: 'main',
      recursive: '1'
    });
    // 1 次 API 呼叫 × 10 repos = 10 次

    // API 呼叫 3: 取得每個檔案內容
    for (const file of tree.data.tree) {
      if (file.path.endsWith('.md')) {
        const content = await octokit.rest.repos.getContent({
          owner: 'school-curriculum',
          repo: repo.name,
          path: file.path
        });
        // 假設每個 repo 有 20 個 .md 檔案
        // 20 files × 10 repos = 200 次
      }
    }
  }

  // 總計: 1 + 10 + 200 = 211 次 API 呼叫
}

// 如果每小時同步一次:
// 211 requests/hour
```

✅ **還在 5000 限制內**

⚠️ **但如果有 50 個 repos:**
```
1 + 50 + (20 × 50) = 1,051 requests/hour
```

✅ **仍在限制內,但開始接近瓶頸**

---

### 場景 5: Git Clone (最佳化方案)

```bash
# 不用 API,直接 Git Clone!
git clone https://github.com/school-curriculum/grade-1-semester-1.git

# 0 次 API 呼叫!
# 不受 Rate Limit 影響!
```

✅ **這是最佳方案!**

```typescript
// 使用 Git Clone 同步
import simpleGit from 'simple-git';

async function syncCoursesViaGit() {
  const git = simpleGit();

  // 1. Clone 或 Pull
  if (!fs.existsSync('./repos/grade-1-semester-1')) {
    await git.clone(
      'https://github.com/school-curriculum/grade-1-semester-1.git',
      './repos/grade-1-semester-1'
    );
  } else {
    await git.cwd('./repos/grade-1-semester-1').pull();
  }

  // 2. 讀取本地檔案 (不用 API!)
  const files = fs.readdirSync('./repos/grade-1-semester-1/courses');

  for (const file of files) {
    const content = fs.readFileSync(
      `./repos/grade-1-semester-1/courses/${file}`,
      'utf-8'
    );

    // 3. 儲存到資料庫
    await db.saveCourse(content);
  }

  // 總計: 0 次 API 呼叫!
}
```

✅ **完美方案,無 Rate Limit 問題!**

---

## 🚨 Rate Limit 瓶頸場景

### 瓶頸 1: Search API (嚴重限制)

```typescript
// 搜尋課程內容
async function searchCourses(keyword: string) {
  const results = await octokit.rest.search.code({
    q: `${keyword} org:school-curriculum`
  });

  // Search API 限制: 30 requests/minute
}

// 如果 10 個使用者同時搜尋:
// 10 requests in 1 minute
```

⚠️ **已經用掉 1/3 配額!**

```
問題:
- Search API 限制超嚴格 (30/min)
- 無法支援多使用者同時搜尋
- 觸發限制後需等待 1 分鐘

解決方案:
✅ 使用 Git Clone + 本地全文搜尋 (ElasticSearch/PostgreSQL FTS)
```

---

### 瓶頸 2: 大量並發請求

```typescript
// 50 個學生同時登入,載入課程
async function handleConcurrentLoad() {
  const students = Array(50).fill(0);

  await Promise.all(
    students.map((_, i) => loadCourse(`lesson-${i % 10}`))
  );

  // 50 students × 3 API calls = 150 requests
  // 在幾秒內完成
}
```

⚠️ **可能觸發 Secondary Rate Limit!**

```
Secondary Rate Limit 觸發條件:
- 短時間內大量請求 (即使未超過 5000/hour)
- GitHub 認為這是「異常行為」

解決方案:
✅ 使用本地快取 (Redis/PostgreSQL)
✅ 不直接從 GitHub API 讀取
```

---

## ✅ GitHub API 最佳實踐方案

### 核心原則

```
原則 1: GitHub 只當「源頭」,不當「資料庫」
原則 2: 使用 Git Clone,不用 REST API 讀取內容
原則 3: 寫入操作走 PR 流程,不直接 commit
原則 4: 本地資料庫是「讀取來源」
```

### 推薦架構

```
┌─────────────────────────────────────┐
│  GitHub Repository                  │
│  (內容源頭 - 低頻更新)               │
│  - Git Clone 同步                   │
│  - Webhook 通知變更                 │
└─────────────────────────────────────┘
         ↓ Git Pull (每小時一次)
         ↓ Webhook (即時)
┌─────────────────────────────────────┐
│  本地 Git Repository                │
│  (/var/repos/grade-1-semester-1/)   │
└─────────────────────────────────────┘
         ↓ 讀取本地檔案 (不用 API)
┌─────────────────────────────────────┐
│  PostgreSQL + Redis                 │
│  (快取與查詢)                        │
│  - 課程內容                         │
│  - 全文搜尋索引                     │
│  - 版本歷史                         │
└─────────────────────────────────────┘
         ↓ REST API (高效)
┌─────────────────────────────────────┐
│  我們的前端                         │
│  (學生/教師使用)                    │
└─────────────────────────────────────┘
```

---

## 💻 完整技術實作

### 1. Git Clone 同步服務

```typescript
// /backend/src/sync/git-sync.service.ts
import simpleGit, { SimpleGit } from 'simple-git';
import fs from 'fs/promises';
import path from 'path';

export class GitSyncService {
  private reposPath = '/var/repos';
  private repositories = [
    'grade-1-semester-1',
    'grade-1-semester-2',
    'grade-2-semester-1',
    // ... 其他 repos
  ];

  // ========== 初始化:Clone 所有 Repositories ==========
  async initialize() {
    console.log('[GitSync] Initializing repositories...');

    for (const repo of this.repositories) {
      const repoPath = path.join(this.reposPath, repo);

      if (!(await this.exists(repoPath))) {
        console.log(`[GitSync] Cloning ${repo}...`);
        await simpleGit().clone(
          `https://github.com/school-curriculum/${repo}.git`,
          repoPath
        );
      }
    }

    console.log('[GitSync] All repositories initialized');
  }

  // ========== 定期同步 (每小時) ==========
  @Cron('0 * * * *') // 每小時整點
  async syncAll() {
    console.log('[GitSync] Starting hourly sync...');

    for (const repo of this.repositories) {
      await this.syncRepository(repo);
    }

    console.log('[GitSync] Sync completed');
  }

  // ========== 同步單一 Repository ==========
  async syncRepository(repo: string) {
    const repoPath = path.join(this.reposPath, repo);
    const git: SimpleGit = simpleGit(repoPath);

    try {
      // 1. Pull 最新變更
      await git.pull('origin', 'main');

      // 2. 取得最新 commit
      const log = await git.log({ maxCount: 1 });
      const latestCommit = log.latest;

      // 3. 檢查是否有新變更
      const lastSyncedCommit = await this.getLastSyncedCommit(repo);

      if (latestCommit.hash === lastSyncedCommit) {
        console.log(`[GitSync] ${repo} is up to date`);
        return;
      }

      // 4. 處理變更的檔案
      const changedFiles = await this.getChangedFiles(
        git,
        lastSyncedCommit,
        latestCommit.hash
      );

      for (const file of changedFiles) {
        if (file.endsWith('.md')) {
          await this.processMarkdownFile(repo, file);
        }
      }

      // 5. 更新最後同步的 commit
      await this.updateLastSyncedCommit(repo, latestCommit.hash);

      console.log(`[GitSync] ${repo} synced to ${latestCommit.hash.slice(0, 7)}`);
    } catch (error) {
      console.error(`[GitSync] Failed to sync ${repo}:`, error);
    }
  }

  // ========== 處理 Markdown 檔案 ==========
  private async processMarkdownFile(repo: string, filePath: string) {
    const fullPath = path.join(this.reposPath, repo, filePath);
    const content = await fs.readFile(fullPath, 'utf-8');

    // 解析 Markdown
    const parsed = this.parseMarkdown(content);

    // 儲存到資料庫
    await this.db.query(
      `INSERT INTO courses (
        course_id, repo, file_path, title, content, metadata, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
      ON CONFLICT (repo, file_path) DO UPDATE SET
        title = EXCLUDED.title,
        content = EXCLUDED.content,
        metadata = EXCLUDED.metadata,
        updated_at = NOW()`,
      [
        uuid(),
        repo,
        filePath,
        parsed.title,
        JSON.stringify(parsed),
        JSON.stringify(parsed.metadata),
      ]
    );
  }

  // ========== 取得變更的檔案列表 ==========
  private async getChangedFiles(
    git: SimpleGit,
    fromCommit: string,
    toCommit: string
  ): Promise<string[]> {
    const diff = await git.diff([
      `${fromCommit}..${toCommit}`,
      '--name-only'
    ]);

    return diff.split('\n').filter(Boolean);
  }

  // ========== 輔助方法 ==========
  private async exists(path: string): Promise<boolean> {
    try {
      await fs.access(path);
      return true;
    } catch {
      return false;
    }
  }

  private async getLastSyncedCommit(repo: string): Promise<string> {
    const result = await this.db.query(
      'SELECT last_commit FROM sync_status WHERE repo = $1',
      [repo]
    );
    return result.rows[0]?.last_commit || '';
  }

  private async updateLastSyncedCommit(repo: string, commit: string) {
    await this.db.query(
      `INSERT INTO sync_status (repo, last_commit, synced_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (repo) DO UPDATE SET
         last_commit = EXCLUDED.last_commit,
         synced_at = NOW()`,
      [repo, commit]
    );
  }
}
```

### 2. Webhook 即時更新

```typescript
// /backend/src/webhooks/github-webhook.controller.ts

@Controller('/webhooks/github')
export class GitHubWebhookController {
  constructor(private gitSyncService: GitSyncService) {}

  @Post()
  async handleWebhook(@Body() payload: any, @Headers() headers: any) {
    // 1. 驗證 Webhook 簽名
    const signature = headers['x-hub-signature-256'];
    if (!this.verifySignature(payload, signature)) {
      throw new UnauthorizedException('Invalid signature');
    }

    // 2. 處理 Push Event
    if (payload.ref === 'refs/heads/main') {
      const repo = payload.repository.name;

      console.log(`[Webhook] ${repo} updated, syncing...`);

      // 立即同步 (不等待定時任務)
      await this.gitSyncService.syncRepository(repo);

      // 清除相關快取
      await this.cacheService.clearCourseCache(repo);
    }

    return { status: 'ok' };
  }

  private verifySignature(payload: any, signature: string): boolean {
    const hmac = crypto.createHmac('sha256', process.env.GITHUB_WEBHOOK_SECRET);
    const digest = 'sha256=' + hmac.update(JSON.stringify(payload)).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest));
  }
}
```

---

## 📊 API 用量總結

### 實際每日 API 用量

| 操作 | 頻率 | API 呼叫 | 每日總計 |
|------|------|---------|---------|
| **讀取課程** | 150 次/天 | 0 (用 Git Clone) | 0 |
| **搜尋課程** | 50 次/天 | 0 (本地全文搜尋) | 0 |
| **學生提交作業** | 150 次/天 | 0 (存本地 DB) | 0 |
| **教師建立 PR** | 5 次/天 | 1 × 5 | 5 |
| **Webhook 驗證** | 10 次/天 | 0 (只接收) | 0 |
| **總計** | - | - | **5 requests/day** |

✅ **遠低於 5,000/hour 限制!**

---

## 🎯 最終結論

### GitHub API 能幫忙什麼?

| 功能 | GitHub 負責 | 我們負責 | API 用量 |
|------|------------|---------|---------|
| **課程內容存儲** | ✅ Git Repository | 同步到本地 | 0 (用 Git) |
| **版本控制** | ✅ Git History | 讀取 Git Log | 0 (用 Git) |
| **協作審閱** | ✅ Pull Request | 建立 PR | 低頻 (5/day) |
| **課程讀取** | ❌ 不用 API | 讀本地檔案 | 0 |
| **課程搜尋** | ❌ 不用 Search API | PostgreSQL FTS | 0 |
| **作業提交** | ❌ 不用 Issues | 存本地 DB | 0 |

### Rate Limit 結論

✅ **不會是瓶頸!**

**原因**:
1. 使用 **Git Clone** 讀取內容,不用 REST API
2. 使用 **本地資料庫** 做查詢和快取
3. 只在 **低頻操作** (PR) 時呼叫 API
4. 每日 API 用量 < 10 requests

### 推薦最終架構

```
GitHub Repository (內容源頭)
    ↓ Git Pull (每小時)
本地 Git Clone (/var/repos/)
    ↓ 讀取本地檔案
PostgreSQL (資料庫)
    ↓ REST API
我們的前端
```

**優勢**:
- ✅ 完全不受 Rate Limit 影響
- ✅ 查詢速度極快 (本地資料庫)
- ✅ 可離線運作 (GitHub 掛掉仍可讀取)
- ✅ 完整版本控制 (Git)

**開發時間**: 2 週
**複雜度**: ⭐⭐
**可靠性**: ⭐⭐⭐⭐⭐

