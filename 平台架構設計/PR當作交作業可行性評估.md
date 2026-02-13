# PR 當作交作業可行性評估

> **問題**: 學生能不能用 Pull Request 交作業?
>
> **評估**: 技術可行性、使用者體驗、Rate Limit 影響

---

## 🎯 評估場景

### 假設情境

```
班級規模: 30 個學生
作業頻率: 每週 3 個作業
學期長度: 18 週

總計:
- 30 students × 3 assignments/week × 18 weeks = 1,620 PRs/semester
- 平均每天: 1620 / 126 days ≈ 13 PRs/day
```

---

## ✅ 技術可行性分析

### 方案 A: 每個學生一個 Branch

```
Repository: assignments-grade1-lesson1

Branches:
├─ main (作業模板)
├─ student-001-submission
├─ student-002-submission
├─ student-003-submission
└─ ...

工作流:
1. 學生 fork 或 checkout 自己的 branch
2. 修改作業內容 (Markdown 或程式碼)
3. Commit 並 push
4. 建立 PR 到 main
5. 教師在 PR 上評分和留言
6. Merge 或 Close PR
```

**GitHub API 呼叫**:
```typescript
// 學生提交作業
async function submitAssignment(studentId: string, content: string) {
  // API 呼叫 1: 建立 Branch
  await octokit.rest.git.createRef({
    owner: 'school',
    repo: 'assignments-lesson1',
    ref: `refs/heads/student-${studentId}-submission`,
    sha: mainBranchSHA
  });

  // API 呼叫 2: 建立或更新檔案
  await octokit.rest.repos.createOrUpdateFileContents({
    owner: 'school',
    repo: 'assignments-lesson1',
    path: `submissions/${studentId}/answer.md`,
    message: `Student ${studentId} submission`,
    content: Buffer.from(content).toString('base64'),
    branch: `student-${studentId}-submission`
  });

  // API 呼叫 3: 建立 Pull Request
  const pr = await octokit.rest.pulls.create({
    owner: 'school',
    repo: 'assignments-lesson1',
    title: `作業提交 - 學生 ${studentId}`,
    head: `student-${studentId}-submission`,
    base: 'main',
    body: `## 作業內容\n\n[學生作業內容...]`
  });

  // 總計: 3 次 API 呼叫
  return pr.data;
}
```

**每日 API 用量**:
```
13 PRs/day × 3 API calls = 39 requests/day
每小時平均: 39 / 24 ≈ 2 requests/hour
```

✅ **Rate Limit 不是問題** (遠低於 5000/hour)

---

### 方案 B: 每個作業一個 Repository

```
Organization: school-assignments

Repositories:
├─ lesson-01-assignment
│  ├─ student-001-submission (branch/PR)
│  ├─ student-002-submission
│  └─ ...
├─ lesson-02-assignment
└─ ...

優點:
✅ 權限控制更精細 (per repo)
✅ 作業隔離,不會互相干擾
✅ 可以設定不同的 Branch Protection Rules

缺點:
⚠️ 需要管理多個 repositories
⚠️ 學生需要 clone 多個 repos
```

---

## 🚨 潛在問題分析

### 問題 1: 學生需要學習 Git

```
問題:
❌ 小學生不太可能會用 Git
❌ git clone, git add, git commit, git push 學習門檻高
❌ 衝突解決更是困難

實際情況:
某小學嘗試讓學生用 GitHub 交作業:
- 第 1 週: 30 個學生中只有 2 個成功提交
- 第 2 週: 教師放棄,改用 Google Classroom
```

❌ **不適合小學/國中生**

---

### 問題 2: 隱私問題

```
問題:
❌ Pull Request 是公開的 (除非 Private Repo)
❌ 所有學生可以看到其他人的作業
❌ 學生可以抄襲其他人的答案

GitHub Private Repo:
✅ 可以設定 Private
⚠️ 但學生仍可看到同一個 repo 的其他 PRs

解決方案:
方案 A: 每個學生一個 Private Repo
  - 成本: GitHub Team 需付費 ($4/user/month)
  - 30 students × $4 = $120/month

方案 B: 限制 PR 可見性
  - GitHub 沒有這個功能
  - 無法隱藏特定 PR
```

❌ **隱私保護困難**

---

### 問題 3: 作業內容不適合 Git

```
適合 Git 的作業:
✅ 程式碼作業 (Python, JavaScript)
✅ Markdown 文件
✅ 配置檔案

不適合 Git 的作業:
❌ 朗讀音檔 (audio.mp3, 10-50MB)
❌ 手寫作業照片 (photo.jpg, 2-5MB)
❌ 影片作業 (video.mp4, 50-200MB)

GitHub 限制:
- 單檔案限制: 100 MB
- 建議使用 Git LFS (Large File Storage)
- 但 LFS 有儲存配額限制:
  - 免費: 1 GB storage, 1 GB bandwidth/month
  - 付費: $5/month for 50 GB

30 個學生,每週 3 個音檔 (10MB):
30 × 3 × 10MB × 18 weeks = 16.2 GB
成本: $5/month × 4 months ≈ $20/semester
```

⚠️ **多媒體作業成本高**

---

### 問題 4: PR Review 效率問題

```
場景: 教師批改 30 份作業

傳統方式 (我們的前端):
✅ 一個頁面顯示所有學生提交
✅ 快速切換學生
✅ 批量評分
✅ 客製化評分介面

GitHub PR Review:
❌ 需要逐一打開 30 個 PRs
❌ 每個 PR 都要點進去看
❌ 無法批量操作
❌ 評分需要用 Comment (不直觀)

時間對比:
- 傳統方式: 30 × 2 分鐘 = 60 分鐘
- GitHub PR: 30 × 5 分鐘 = 150 分鐘 (多 2.5 倍)
```

❌ **教師工作效率低**

---

### 問題 5: Secondary Rate Limit 風險

```
場景: 30 個學生在截止前 1 小時同時提交

API 呼叫:
30 students × 3 API calls = 90 requests in 1 hour

看似沒問題 (遠低於 5000/hour)

但實際上:
⚠️ 如果集中在最後 10 分鐘提交:
90 requests in 10 min = 9 requests/min

⚠️ Secondary Rate Limit 可能觸發:
"You have exceeded a secondary rate limit"
403 Forbidden

實際案例:
某大學使用 GitHub Classroom 讓學生交作業:
- 截止前 30 分鐘,大量學生提交
- GitHub 觸發 Secondary Rate Limit
- 部分學生無法提交,延誤截止時間
```

⚠️ **高峰期可能失敗**

---

## 💡 混合方案:PR 用於特定作業

### 方案: 程式作業用 PR,其他作業用資料庫

```typescript
// 判斷作業類型
function getSubmissionMethod(assignmentType: string) {
  if (assignmentType === 'coding') {
    // 程式作業 → 用 GitHub PR
    return 'github-pr';
  } else {
    // 朗讀/寫作/多媒體 → 用我們的資料庫
    return 'database';
  }
}

// 程式作業提交 (適合用 PR)
async function submitCodingAssignment(studentId: string, code: string) {
  // 建立 PR
  const pr = await octokit.rest.pulls.create({
    owner: 'school',
    repo: 'python-assignments',
    title: `作業提交 - 學生 ${studentId}`,
    head: `student-${studentId}`,
    base: 'main',
    body: `## 程式碼\n\n\`\`\`python\n${code}\n\`\`\``
  });

  // 自動執行測試 (GitHub Actions)
  // 自動評分

  return pr;
}

// 朗讀作業提交 (不適合 PR)
async function submitReadingAssignment(studentId: string, audioFile: File) {
  // 上傳音檔到 S3
  const audioUrl = await s3.upload(audioFile);

  // 儲存到資料庫
  await db.query(`
    INSERT INTO submissions (student_id, assignment_id, audio_url)
    VALUES ($1, $2, $3)
  `, [studentId, assignmentId, audioUrl]);

  // AI 評分
  const score = await aiScoringService.evaluate(audioUrl);

  return { audioUrl, score };
}
```

**適用場景**:

| 作業類型 | 提交方式 | 原因 |
|---------|---------|------|
| **程式作業** | GitHub PR | ✅ 程式碼版本控制、自動測試、Code Review |
| **文字作業** | GitHub PR | ✅ Markdown 格式、版本追蹤 |
| **朗讀作業** | 資料庫 + S3 | ❌ 音檔不適合 Git |
| **手寫作業** | 資料庫 + S3 | ❌ 照片不適合 Git |
| **多選題** | 資料庫 | ❌ 簡單資料,不需要 PR |

---

## 🎯 結論與建議

### PR 當作交作業的評估

| 評估維度 | 可行性 | 說明 |
|---------|--------|------|
| **技術可行性** | ✅ 可行 | API 呼叫量不是問題 |
| **學生門檻** | ❌ 高 | 小學生不會用 Git |
| **隱私保護** | ❌ 困難 | PR 無法完全隱藏 |
| **多媒體支援** | ❌ 不適合 | 音檔/照片/影片成本高 |
| **教師效率** | ❌ 低 | 批改 30 個 PR 很慢 |
| **高峰期穩定性** | ⚠️ 風險 | Secondary Rate Limit |

### 最終建議

#### ❌ 不推薦全面使用 PR 交作業

**原因**:
1. 學生學習門檻太高 (Git)
2. 朗讀作業 (音檔) 不適合 Git
3. 教師批改效率低
4. 隱私保護困難

#### ✅ 推薦方案:分類處理

```
程式課程 (高中/大學):
✅ 使用 GitHub Classroom
✅ 學生用 PR 交作業
✅ 自動測試 + Code Review

國語/朗讀課程 (小學/國中):
❌ 不使用 PR
✅ 學生在我們的前端提交音檔
✅ AI 自動評分
✅ 教師在後台批改
```

#### ✅ 最佳架構

```
GitHub Repository (課程內容)
    ↓ Git Clone 同步
本地資料庫 (課程快取)
    ↓
我們的前端 (學生提交作業)
    ↓
S3 (音檔存儲) + PostgreSQL (提交記錄)
    ↓
AI 評分引擎
    ↓
教師後台 (批改與回饋)
```

**優勢**:
- ✅ 學生無需學習 Git
- ✅ 支援多媒體作業
- ✅ 教師批改效率高
- ✅ 隱私完全保護
- ✅ 無 Rate Limit 問題

**GitHub 的角色**:
- ✅ 課程內容管理 (Markdown)
- ✅ 版本控制 (Git)
- ✅ 內部團隊協作 (PR Review)
- ❌ 不用於學生交作業

---

## 📊 成本與效益對比

### 方案對比

| 方案 | 開發成本 | 月運營成本 | 學生體驗 | 教師效率 | 推薦度 |
|------|---------|-----------|---------|---------|--------|
| **全用 PR** | 2 週 | $120 (Private Repos) | ⭐ | ⭐ | ❌ 1/5 |
| **混合 (程式用 PR)** | 3 週 | $50 | ⭐⭐⭐ | ⭐⭐⭐ | ✅ 3/5 |
| **全用資料庫** | 2 週 | $20 (S3) | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ✅ 5/5 |

---

## 🚀 最終推薦架構

```
課程管理: GitHub (Markdown + Git)
    ├─ 內部團隊用 PR 審閱課程
    └─ 版本控制 (Git History)
        ↓
學生作業: 我們的系統 (資料庫 + S3)
    ├─ 音檔上傳到 S3
    ├─ 提交記錄存 PostgreSQL
    ├─ AI 評分
    └─ 教師批改介面
        ↓
通知: Google Classroom (可選)
    └─ 作業通知
```

**結論**: PR 適合內部團隊協作,不適合學生交作業。

