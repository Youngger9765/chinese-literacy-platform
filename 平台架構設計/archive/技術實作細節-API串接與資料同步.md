# 技術實作細節:API 串接與資料同步

> **核心價值 1**:版本控制、協作編輯等進階功能(外部系統成熟能力)
>
> **核心價值 2**:內部團隊可直接用外部工具當後台(熟悉的工作流)
>
> **使用者體驗**:100% 使用我們的前端介面,完全不接觸外部系統

---

## 💎 為什麼選擇外部系統?

### 核心價值分析

| 價值維度 | 自建方案 | 外部系統方案 | 價值差距 |
|---------|---------|-------------|---------|
| **版本控制** | 需從零開發 Git 整合 | Notion 內建版本歷史,GitHub 原生 Git | ⭐⭐⭐⭐⭐ |
| **協作編輯** | 需開發 OT/CRDT 演算法 | Notion 內建即時協作 | ⭐⭐⭐⭐⭐ |
| **內部團隊工作流** | 學習新系統(6-8 週) | 使用熟悉工具(0 週) | ⭐⭐⭐⭐ |
| **課程審閱流程** | 需開發審批系統 | GitHub PR + Review | ⭐⭐⭐⭐ |
| **變更追蹤** | 需開發 Audit Log | Notion/GitHub 內建 | ⭐⭐⭐⭐ |

### 1. 版本控制的真實價值

```
情境:教研團隊更新課程內容

傳統方案 (自建):
  Week 1: 設計版本控制資料結構
  Week 2-3: 開發 diff 演算法
  Week 4: 實作版本回溯功能
  Week 5-6: 開發版本比較 UI
  總時間: 6 週

外部系統方案 (Notion):
  Day 1: 整合 Notion API
  功能: ✅ 版本歷史自動記錄
        ✅ 一鍵回溯到任意版本
        ✅ 誰改了什麼一目瞭然
  總時間: 1 天
```

### 2. 協作編輯的真實價值

```
情境:3 位教師同時編輯同一份課程

傳統方案 (自建):
  - 需開發 Operational Transformation 演算法
  - 需處理衝突解決邏輯
  - 需開發即時同步基礎設施 (WebSocket)
  - 需開發游標位置同步
  開發時間: 12-16 週

外部系統方案 (Notion):
  - 內建即時協作
  - 自動衝突解決
  - 看到其他人的游標
  - 留言討論功能
  開發時間: 0 週 (直接使用)
```

### 3. 內部團隊工作流的真實價值

```
情境:內部課程研發團隊日常工作

❌ 自建後台的問題:
  - 團隊需學習新系統 (6-8 週培訓)
  - 功能永遠不如專業工具完整
  - 需持續維護和改進
  - UI/UX 永遠達不到 Notion/GitHub 水準

✅ 直接用外部工具的優勢:
  - 團隊已經熟悉 Notion/GitHub (0 學習成本)
  - 可以直接在 Notion 編輯課程 (富文本體驗極佳)
  - 可以直接在 GitHub 管理作業 (Issue 流程成熟)
  - 可以使用 GitHub PR 做課程審閱 (Code Review 流程)
```

### 4. Google Classroom 的核心價值

#### 價值 1: OAuth 登入系統(免開發)

```
情境:學生登入系統

❌ 自建方案:
  - 開發帳號註冊系統 (2 週)
  - 開發登入驗證系統 (1 週)
  - 開發密碼重設功能 (1 週)
  - 開發 Email 驗證 (1 週)
  - 開發 Session 管理 (1 週)
  - 總時間: 6 週

✅ Google Classroom OAuth:
  - 學生已有 Google 帳號(學校統一申請)
  - 一鍵登入(Google Sign-In)
  - 家長帳號自動關聯(Google Family Link)
  - 總時間: 2 天整合
```

#### 價值 2: 班級管理與學生名單同步

```
情境:新學期建立班級

❌ 自建方案:
  教師需要:
    1. 手動輸入學生姓名
    2. 手動輸入學生學號
    3. 手動輸入家長聯絡方式
    4. 手動設定學生權限
  時間: 每班 2-3 小時

✅ Google Classroom API:
  教師只需要:
    1. 在 Google Classroom 建立班級
    2. 邀請學生加入(Google 自動處理)
  我們的系統:
    - 透過 API 自動同步學生名單
    - 自動取得學生 Email
    - 自動取得家長帳號(如果有設定)
  時間: 5 分鐘
```

#### 價值 3: 通知系統(免開發)

```
情境:教師派發作業通知學生

❌ 自建方案:
  需開發:
    - Email 通知系統 (2 週)
    - Push Notification (3 週)
    - 通知偏好設定 (1 週)
    - 通知歷史記錄 (1 週)
  總時間: 7 週

✅ Google Classroom API:
  - 透過 API 建立 CourseWork
  - Google 自動通知學生(Email + App)
  - Google 自動通知家長(如果有設定)
  - 學生可在 Google Classroom 看到通知
  總時間: 0 週(免費獲得)
```

#### 價值 4: 學生檔案與權限管理

```
情境:管理學生權限與資料

❌ 自建方案:
  需開發:
    - 學生檔案管理系統 (3 週)
    - 角色權限系統 (RBAC, 4 週)
    - 家長關聯系統 (2 週)
    - 學生轉班/畢業處理 (2 週)
  總時間: 11 週

✅ Google Classroom API:
  學生檔案:
    - 姓名、Email、照片(Google Profile)
    - 班級資訊(自動同步)
    - 家長帳號(Google 管理)
  權限管理:
    - Google 統一身份管理
    - 學生權限自動設定
    - 家長權限自動設定
  總時間: 1 週整合
```

### Google Classroom 完整工作流程

#### 內部團隊視角

```
教師在 Google Classroom (真實的 Google Classroom UI):

1. 建立班級
   - 班級名稱: 一年甲班
   - 科目: 國語
   - 邀請學生(透過 Email 或代碼)

2. 學生自動加入
   - 學生點擊邀請連結
   - Google 自動驗證身份
   - 自動加入班級

3. 我們的系統自動同步
   ↓
   透過 Google Classroom API 取得:
   - 班級 ID
   - 學生名單(name, email, userId)
   - 教師資訊

   儲存到我們的資料庫:
   classrooms:
     - classroom_id
     - google_classroom_id ← 關聯
     - classroom_name

   students:
     - student_id
     - google_user_id ← 關聯
     - email
     - name
```

#### 學生登入流程

```
學生使用我們的前端:

1. 點擊「使用 Google 登入」
   ↓
2. Google OAuth 流程(跳轉到 Google)
   ↓
3. 學生選擇 Google 帳號
   ↓
4. 回到我們的系統,取得 Google Access Token
   ↓
5. 後端驗證 Token,取得 Google User ID
   ↓
6. 查詢資料庫:
   SELECT * FROM students
   WHERE google_user_id = ?
   ↓
7. 建立 Session,學生登入成功
```

#### 作業通知流程

```
教師在我們的前端派發作業:

1. 教師選擇作業(來自 GitHub Issue 模板)
   ↓
2. 選擇班級、設定截止日期
   ↓
3. 點擊「派發作業」
   ↓
4. 我們的後端處理:

   // A. 在我們的資料庫建立作業實例
   INSERT INTO assignments (
     classroom_id,
     template_id,
     due_date,
     status
   ) VALUES (?, ?, ?, 'active')

   // B. 透過 Google Classroom API 建立 CourseWork
   const courseWork = await classroom.courses.courseWork.create({
     courseId: googleClassroomId,
     requestBody: {
       title: '【朗讀】第一課 - 我的家',
       description: '請完成課文朗讀並上傳錄音',
       workType: 'ASSIGNMENT',
       dueDate: dueDate,
       materials: [{
         link: {
           url: `${OUR_PLATFORM}/assignments/${assignmentId}`
         }
       }]
     }
   });

   ↓
5. Google 自動處理通知:
   - 發送 Email 給所有學生
   - 推送通知到 Google Classroom App
   - 通知家長(如果有設定)
```

### Google Classroom 與其他系統的關係

```
完整資料流:

Notion (課程內容)
   ↓
我們的前端 (課程瀏覽)
   ↓
學生點擊「開始作業」
   ↓
GitHub Issue (作業模板)
   ↓
我們的後端 (建立作業實例)
   ↓
Google Classroom API (建立 CourseWork + 發送通知)
   ↓
學生收到通知
   ↓
學生在我們的前端完成作業
   ↓
我們的資料庫 (儲存學習記錄 + AI 評分)
   ↓
(可選) 透過 Google Classroom API 更新完成狀態
```

### 成本與效益分析

| 功能 | 自建開發時間 | Google Classroom | 節省 |
|------|-------------|------------------|------|
| OAuth 登入 | 6 週 | 2 天 | 5.6 週 |
| 班級管理 | 4 週 | 1 週 | 3 週 |
| 學生名單同步 | 3 週 | 0 週(自動) | 3 週 |
| 通知系統 | 7 週 | 0 週(內建) | 7 週 |
| 權限管理 | 11 週 | 1 週 | 10 週 |
| **總計** | **31 週** | **2 週** | **28.6 週 (92%)** |

**Google Classroom API 定價**:
- ✅ 完全免費
- ✅ 無 API 呼叫次數限制(與 Notion/GitHub 不同)
- ✅ 教育機構優先支援

---

## 🎯 架構定位

### 系統分層

```
┌─────────────────────────────────────────────┐
│  Layer 1: 使用者介面 (100% 我們控制)          │
│  ┌────────────────────────────────────────┐ │
│  │ React/Next.js 前端                      │ │
│  │ - 課程瀏覽頁面                           │ │
│  │ - 作業提交介面                           │ │
│  │ - 學習互動 (朗讀/生字)                   │ │
│  │ - 教師後台 (課程編輯/班級管理)            │ │
│  └────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
              ↓ REST/GraphQL API
┌─────────────────────────────────────────────┐
│  Layer 2: 業務邏輯層 (我們的後端)            │
│  ┌────────────────────────────────────────┐ │
│  │ Node.js/FastAPI 後端                    │ │
│  │ - 使用者認證與權限                       │ │
│  │ - AI 評分引擎 (STT + 分析)              │ │
│  │ - 學習分析與推薦                         │ │
│  │ - 遊戲化邏輯                            │ │
│  └────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
              ↓ Adapter Pattern
┌─────────────────────────────────────────────┐
│  Layer 3: 資料適配層 (抽象化外部 API)        │
│  ┌────────────────────────────────────────┐ │
│  │ NotionAdapter    | GitHubAdapter       │ │
│  │ - getCourse()    | - getAssignment()   │ │
│  │ - updateCourse() | - updateStatus()    │ │
│  └────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
              ↓ HTTP/REST API
┌─────────────────────────────────────────────┐
│  Layer 4: 外部系統 (當作無頭資料庫)           │
│  ┌──────────┬──────────┬──────────────────┐ │
│  │ Notion   │ GitHub   │ PostgreSQL (我們)│ │
│  │ 課程內容  │ 作業結構  │ 學習記錄/遊戲化  │ │
│  └──────────┴──────────┴──────────────────┘ │
└─────────────────────────────────────────────┘
```

---

## 📦 外部系統職責劃分

### 決策矩陣:什麼資料存哪裡?

| 資料類型 | 存放位置 | 原因 | API |
|---------|---------|------|-----|
| **課程內容** | Notion | 富文本編輯、結構化區塊 | Notion API |
| **作業結構** | GitHub Issues | 狀態管理、標籤分類、討論串 | GitHub REST API |
| **課程層級** | GitHub Projects | 階層關係、Epic/Task | GitHub GraphQL API |
| **學習記錄** | PostgreSQL (我們) | 高頻寫入、需 JOIN 分析 | 自建 API |
| **AI 評分** | PostgreSQL (我們) | 隱私敏感、需即時查詢 | 自建 API |
| **遊戲化數據** | PostgreSQL (我們) | 高頻更新(積分/徽章) | 自建 API |
| **使用者檔案** | PostgreSQL (我們) | 核心資料、權限控制 | 自建 API |

### 核心原則

```typescript
// ✅ 外部系統存「相對靜態、結構化」的資料
Notion  → 課程內容 (教師編輯後不常改)
GitHub  → 作業模板 (一個課程對應固定的作業結構)

// ✅ 我們的資料庫存「高頻變動、需分析」的資料
PostgreSQL → 學生學習記錄 (每次朗讀都寫入)
PostgreSQL → AI 評分結果 (需即時查詢、統計分析)
PostgreSQL → 遊戲化數據 (積分、連續登入天數等)
```

---

## 🔧 技術實作:API 串接

### 1. Notion API:課程內容管理

#### 1.1 資料結構設計

```typescript
// Notion Database Schema
課程資料庫 (Courses Database)
├─ Properties:
│  ├─ 課程 ID (Title)
│  ├─ 課程名稱 (Text)
│  ├─ 年級 (Select: 一年級/二年級/...)
│  ├─ 狀態 (Select: 草稿/已發布/已下架)
│  ├─ 創建時間 (Created time)
│  └─ 最後編輯 (Last edited time)
│
└─ Page Content (Blocks):
   ├─ 課文內容 (Paragraph blocks)
   ├─ 生字表 (Table block)
   ├─ 音檔連結 (File block)
   └─ 教師指引 (Callout block)
```

#### 1.2 API 呼叫實作

```typescript
// /backend/src/adapters/notion.adapter.ts
import { Client } from '@notionhq/client';

export class NotionAdapter {
  private client: Client;
  private databaseId: string;

  constructor() {
    this.client = new Client({ auth: process.env.NOTION_API_KEY });
    this.databaseId = process.env.NOTION_COURSES_DB_ID;
  }

  // ========== 讀取課程 ==========
  async getCourse(courseId: string) {
    try {
      // 1. 取得頁面屬性
      const page = await this.client.pages.retrieve({
        page_id: courseId
      });

      // 2. 取得頁面內容 (Blocks)
      const blocks = await this.client.blocks.children.list({
        block_id: courseId,
        page_size: 100,
      });

      // 3. 轉換成我們的資料格式
      return this.transformNotionPage(page, blocks);
    } catch (error) {
      throw new Error(`Notion API Error: ${error.message}`);
    }
  }

  // ========== 建立課程 ==========
  async createCourse(data: CreateCourseDTO) {
    const response = await this.client.pages.create({
      parent: { database_id: this.databaseId },
      properties: {
        '課程名稱': { title: [{ text: { content: data.title } }] },
        '年級': { select: { name: data.grade } },
        '狀態': { select: { name: '草稿' } },
      },
    });

    // 新增內容區塊
    await this.client.blocks.children.append({
      block_id: response.id,
      children: this.buildContentBlocks(data.content),
    });

    return response.id;
  }

  // ========== 更新課程 ==========
  async updateCourse(courseId: string, data: UpdateCourseDTO) {
    // 1. 更新屬性
    await this.client.pages.update({
      page_id: courseId,
      properties: {
        '課程名稱': { title: [{ text: { content: data.title } }] },
        '狀態': { select: { name: data.status } },
      },
    });

    // 2. 更新內容 (先刪除舊區塊,再新增)
    if (data.content) {
      const blocks = await this.client.blocks.children.list({
        block_id: courseId,
      });

      // 刪除舊區塊
      for (const block of blocks.results) {
        await this.client.blocks.delete({ block_id: block.id });
      }

      // 新增新區塊
      await this.client.blocks.children.append({
        block_id: courseId,
        children: this.buildContentBlocks(data.content),
      });
    }
  }

  // ========== 資料轉換 ==========
  private transformNotionPage(page: any, blocks: any) {
    return {
      id: page.id,
      title: page.properties['課程名稱'].title[0]?.plain_text || '',
      grade: page.properties['年級'].select?.name || '',
      status: page.properties['狀態'].select?.name || '草稿',
      content: this.parseBlocks(blocks.results),
      createdAt: page.created_time,
      updatedAt: page.last_edited_time,
    };
  }

  private parseBlocks(blocks: any[]) {
    return blocks.map(block => {
      switch (block.type) {
        case 'paragraph':
          return {
            type: 'text',
            content: block.paragraph.rich_text[0]?.plain_text || '',
          };
        case 'heading_2':
          return {
            type: 'heading',
            content: block.heading_2.rich_text[0]?.plain_text || '',
          };
        case 'table':
          return {
            type: 'table',
            rows: this.parseTableRows(block.id), // 需額外呼叫
          };
        default:
          return { type: block.type, content: '' };
      }
    });
  }

  private buildContentBlocks(content: any[]) {
    return content.map(item => {
      switch (item.type) {
        case 'text':
          return {
            object: 'block',
            type: 'paragraph',
            paragraph: {
              rich_text: [{ text: { content: item.content } }],
            },
          };
        case 'heading':
          return {
            object: 'block',
            type: 'heading_2',
            heading_2: {
              rich_text: [{ text: { content: item.content } }],
            },
          };
        // ... 其他區塊類型
      }
    });
  }
}
```

#### 1.3 快取策略

```typescript
// 課程內容不常改,可以積極快取
import NodeCache from 'node-cache';

export class CachedNotionAdapter extends NotionAdapter {
  private cache = new NodeCache({ stdTTL: 3600 }); // 1 小時

  async getCourse(courseId: string) {
    const cached = this.cache.get<Course>(courseId);
    if (cached) return cached;

    const course = await super.getCourse(courseId);
    this.cache.set(courseId, course);
    return course;
  }

  async updateCourse(courseId: string, data: UpdateCourseDTO) {
    await super.updateCourse(courseId, data);
    this.cache.del(courseId); // 更新後清除快取
  }
}
```

---

### 2. GitHub API:作業結構管理

#### 2.1 資料結構設計

```typescript
// GitHub Repository 結構
curriculum-repo/
├─ Issues (作業模板)
│  ├─ #1 【朗讀練習】第一課 - 我的家
│  │  Labels: 作業, 朗讀, 一年級
│  │  Body: 作業說明 + Checklist
│  │
│  ├─ #2 【生字學習】第一課 - 生字表
│  │  Labels: 作業, 生字, 一年級
│  │
│  └─ #3 【閱讀理解】第一課 - 問答題
│     Labels: 作業, 閱讀, 一年級
│
└─ Projects (課程階層)
   └─ 一年級上學期
      ├─ Epic: 第一課
      │  ├─ Task: #1 朗讀練習
      │  ├─ Task: #2 生字學習
      │  └─ Task: #3 閱讀理解
      └─ Epic: 第二課
```

#### 2.2 API 呼叫實作

```typescript
// /backend/src/adapters/github.adapter.ts
import { Octokit } from '@octokit/rest';

export class GitHubAdapter {
  private octokit: Octokit;
  private owner: string;
  private repo: string;

  constructor() {
    this.octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
    this.owner = process.env.GITHUB_OWNER;
    this.repo = process.env.GITHUB_REPO;
  }

  // ========== 建立作業模板 ==========
  async createAssignment(data: CreateAssignmentDTO) {
    const issue = await this.octokit.rest.issues.create({
      owner: this.owner,
      repo: this.repo,
      title: `【${data.type}】${data.title}`,
      body: this.buildAssignmentBody(data),
      labels: [data.type, data.grade, '作業模板'],
    });

    return {
      id: issue.data.number,
      url: issue.data.html_url,
      nodeId: issue.data.node_id, // 用於 GraphQL
    };
  }

  // ========== 取得作業模板 ==========
  async getAssignment(issueNumber: number) {
    const issue = await this.octokit.rest.issues.get({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
    });

    return {
      id: issue.data.number,
      title: issue.data.title,
      description: issue.data.body,
      labels: issue.data.labels.map(l =>
        typeof l === 'string' ? l : l.name
      ),
      createdAt: issue.data.created_at,
    };
  }

  // ========== 更新作業模板 ==========
  async updateAssignment(issueNumber: number, data: UpdateAssignmentDTO) {
    await this.octokit.rest.issues.update({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
      title: data.title,
      body: data.description,
      labels: data.labels,
    });
  }

  // ========== 建立課程 Epic (使用 Projects v2) ==========
  async createCourseEpic(data: CreateEpicDTO) {
    // 1. 建立 Epic Issue
    const epicIssue = await this.octokit.rest.issues.create({
      owner: this.owner,
      repo: this.repo,
      title: `Epic: ${data.courseName}`,
      body: `## 課程模組\n${data.modules.map(m => `- ${m}`).join('\n')}`,
      labels: ['epic', data.grade],
    });

    // 2. 加入 Project (需使用 GraphQL)
    await this.addToProject(epicIssue.data.node_id, data.projectId);

    return epicIssue.data.number;
  }

  // ========== GraphQL: 加入 Project ==========
  private async addToProject(contentId: string, projectId: string) {
    const mutation = `
      mutation($projectId: ID!, $contentId: ID!) {
        addProjectV2ItemById(input: {
          projectId: $projectId
          contentId: $contentId
        }) {
          item {
            id
          }
        }
      }
    `;

    await this.octokit.graphql(mutation, { projectId, contentId });
  }

  // ========== 輔助方法 ==========
  private buildAssignmentBody(data: CreateAssignmentDTO) {
    return `
## 作業說明
${data.description}

## 完成條件
${data.checklist.map(item => `- [ ] ${item}`).join('\n')}

## 注意事項
${data.notes || '無'}
    `.trim();
  }
}
```

#### 2.3 速率限制處理

```typescript
// GitHub API 有速率限制:每小時 5000 次
import Bottleneck from 'bottleneck';

export class RateLimitedGitHubAdapter extends GitHubAdapter {
  private limiter = new Bottleneck({
    maxConcurrent: 1,
    minTime: 100, // 每次呼叫間隔 100ms
  });

  async createAssignment(data: CreateAssignmentDTO) {
    return this.limiter.schedule(() =>
      super.createAssignment(data)
    );
  }

  async getAssignment(issueNumber: number) {
    return this.limiter.schedule(() =>
      super.getAssignment(issueNumber)
    );
  }
}
```

---

### 3. 資料同步策略

#### 3.1 同步時機

```typescript
// 策略:外部系統是「Source of Truth」,我們定期同步

export class SyncService {
  constructor(
    private notionAdapter: NotionAdapter,
    private githubAdapter: GitHubAdapter,
    private db: Database,
  ) {}

  // ========== 同步課程 (每 1 小時) ==========
  @Cron('0 * * * *') // 每小時整點
  async syncCourses() {
    console.log('[Sync] Starting course sync...');

    // 1. 從 Notion 取得所有已發布課程
    const notionCourses = await this.notionAdapter.queryCourses({
      filter: { property: '狀態', select: { equals: '已發布' } },
    });

    // 2. 更新到我們的資料庫 (用於快速查詢)
    for (const course of notionCourses) {
      await this.db.query(`
        INSERT INTO courses (id, title, grade, content, updated_at)
        VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT (id) DO UPDATE SET
          title = EXCLUDED.title,
          content = EXCLUDED.content,
          updated_at = NOW()
      `, [course.id, course.title, course.grade, course.content]);
    }

    console.log(`[Sync] Synced ${notionCourses.length} courses`);
  }

  // ========== 同步作業模板 (每 6 小時) ==========
  @Cron('0 */6 * * *') // 每 6 小時
  async syncAssignments() {
    console.log('[Sync] Starting assignment sync...');

    // 從 GitHub 取得所有作業模板 Issues
    const issues = await this.githubAdapter.listIssues({
      labels: '作業模板',
      state: 'open',
    });

    for (const issue of issues) {
      await this.db.query(`
        INSERT INTO assignment_templates (github_issue_id, title, description, labels)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (github_issue_id) DO UPDATE SET
          title = EXCLUDED.title,
          description = EXCLUDED.description,
          updated_at = NOW()
      `, [issue.id, issue.title, issue.description, issue.labels]);
    }

    console.log(`[Sync] Synced ${issues.length} assignments`);
  }

  // ========== Webhook:即時更新 ==========
  async handleNotionWebhook(payload: NotionWebhookPayload) {
    // Notion 更新時立即同步
    if (payload.type === 'page.updated') {
      const course = await this.notionAdapter.getCourse(payload.page_id);
      await this.db.query(`
        UPDATE courses SET content = $1, updated_at = NOW()
        WHERE id = $2
      `, [course.content, course.id]);
    }
  }
}
```

#### 3.2 錯誤處理與重試

```typescript
// 使用 Bull Queue 處理失敗重試
import Queue from 'bull';

export class SyncQueue {
  private queue: Queue.Queue;

  constructor() {
    this.queue = new Queue('sync', {
      redis: { host: 'localhost', port: 6379 },
    });

    this.setupProcessor();
  }

  // ========== 加入同步任務 ==========
  async addSyncJob(type: 'course' | 'assignment', id: string) {
    await this.queue.add(
      { type, id },
      {
        attempts: 3, // 最多重試 3 次
        backoff: {
          type: 'exponential',
          delay: 2000, // 2s, 4s, 8s
        },
      }
    );
  }

  // ========== 處理任務 ==========
  private setupProcessor() {
    this.queue.process(async (job) => {
      const { type, id } = job.data;

      try {
        if (type === 'course') {
          await this.syncCourse(id);
        } else if (type === 'assignment') {
          await this.syncAssignment(id);
        }
      } catch (error) {
        console.error(`[Sync] Failed to sync ${type} ${id}:`, error);
        throw error; // 讓 Bull 處理重試
      }
    });

    // 失敗處理
    this.queue.on('failed', (job, err) => {
      console.error(`[Sync] Job ${job.id} failed after 3 attempts:`, err);
      // 可選:發送告警到 Slack/Email
    });
  }

  private async syncCourse(id: string) {
    // 實作課程同步邏輯
  }

  private async syncAssignment(id: string) {
    // 實作作業同步邏輯
  }
}
```

---

## 🔒 安全性考量

### API Key 管理

```typescript
// /backend/.env
NOTION_API_KEY=secret_xxxxxxxxxxxxx
GITHUB_TOKEN=ghp_xxxxxxxxxxxxx

// 權限最小化原則
// Notion: 只給「讀取 + 更新」特定 Database 的權限
// GitHub: 只給「repo」scope,不給 admin 權限
```

### 資料隔離

```typescript
// 多租戶隔離:每個機構有獨立的 Notion Workspace / GitHub Org

export class TenantAwareNotionAdapter {
  private getClient(organizationId: string) {
    // 根據機構 ID 取得對應的 API Key
    const apiKey = await this.getApiKeyByOrg(organizationId);
    return new Client({ auth: apiKey });
  }

  async getCourse(organizationId: string, courseId: string) {
    const client = this.getClient(organizationId);
    // ...
  }
}
```

---

## 📊 監控與告警

```typescript
// 監控外部 API 健康狀態
export class APIHealthMonitor {
  @Cron('*/5 * * * *') // 每 5 分鐘
  async checkAPIs() {
    const results = await Promise.allSettled([
      this.checkNotion(),
      this.checkGitHub(),
    ]);

    for (const result of results) {
      if (result.status === 'rejected') {
        await this.sendAlert(result.reason);
      }
    }
  }

  private async checkNotion() {
    const start = Date.now();
    await notionClient.users.me({});
    const latency = Date.now() - start;

    if (latency > 3000) {
      throw new Error(`Notion API slow: ${latency}ms`);
    }
  }

  private async sendAlert(message: string) {
    // 發送到 Slack/PagerDuty
  }
}
```

---

## 💰 成本估算

### API 用量預估

```typescript
// 假設:500 個學生,50 個課程,每天活躍率 30%

每日 API 呼叫:
  Notion API:
    - 課程查詢: 500 學生 × 0.3 活躍 × 2 次/天 = 300 次
    - 快取命中率 90% → 實際呼叫 30 次

  GitHub API:
    - 作業查詢: 500 × 0.3 × 3 次/天 = 450 次
    - 快取命中率 80% → 實際呼叫 90 次

  總計:120 次/天 → 3600 次/月

成本:
  - Notion: 免費額度足夠 (無 API 用量計費)
  - GitHub: 免費額度 5000 次/小時,綽綽有餘

結論:API 呼叫成本可忽略不計
```

---

## 🎯 完整資料流範例

### 使用情境:學生查看課程並完成作業

```typescript
// 1. 學生請求課程頁面
GET /api/courses/123

// 2. 後端處理
export async function getCourseHandler(req: Request) {
  const { courseId } = req.params;

  // 2.1 檢查快取
  const cached = await redis.get(`course:${courseId}`);
  if (cached) return JSON.parse(cached);

  // 2.2 從 Notion 取得課程內容
  const notionCourse = await notionAdapter.getCourse(courseId);

  // 2.3 從 GitHub 取得作業列表
  const assignments = await githubAdapter.getAssignmentsByCourse(courseId);

  // 2.4 合併資料
  const response = {
    id: courseId,
    title: notionCourse.title,
    content: notionCourse.content,
    assignments: assignments.map(a => ({
      id: a.number,
      title: a.title,
      type: a.labels.find(l => ['朗讀', '生字', '閱讀'].includes(l)),
    })),
  };

  // 2.5 快取 1 小時
  await redis.setex(`course:${courseId}`, 3600, JSON.stringify(response));

  return response;
}

// 3. 學生提交作業
POST /api/assignments/456/submit

export async function submitAssignmentHandler(req: Request) {
  const { assignmentId } = req.params;
  const { audioFile, answers } = req.body;

  // 3.1 AI 評分 (我們的後端處理)
  const score = await aiScoringService.evaluateReading(audioFile);

  // 3.2 儲存學習記錄 (我們的資料庫)
  await db.query(`
    INSERT INTO learning_records (student_id, assignment_id, score, audio_url)
    VALUES ($1, $2, $3, $4)
  `, [req.user.id, assignmentId, score, audioFile.url]);

  // 3.3 更新遊戲化數據 (我們的資料庫)
  await gamificationService.addPoints(req.user.id, score * 10);

  // 3.4 不需要更新 GitHub Issue (作業模板不變)

  return { success: true, score };
}
```

---

## ✅ 總結:為什麼這個架構有效?

### 省下的開發時間

| 功能 | 自建時間 | 用外部 API | 節省 |
|------|---------|-----------|------|
| 富文本編輯器 | 8 週 | 1 週 (整合 Notion API) | 7 週 |
| 課程版本控制 | 4 週 | 0 週 (Notion 內建) | 4 週 |
| 作業狀態管理 | 6 週 | 2 週 (整合 GitHub API) | 4 週 |
| 作業標籤分類 | 2 週 | 0 週 (GitHub Labels) | 2 週 |
| **總計** | **20 週** | **3 週** | **17 週 (85%)** |

### 保留的控制權

- ✅ 使用者介面 100% 我們控制
- ✅ 核心資料 (學習記錄/AI 評分) 在我們資料庫
- ✅ 可隨時切換外部系統 (透過 Adapter 抽象層)
- ✅ 外部系統只是「無頭資料庫」,隨時可替換

### 風險可控

- ✅ 外部系統掛掉 → 降級到唯讀模式 (用快取)
- ✅ 成本超標 → 漸進式遷移到自建
- ✅ Vendor Lock-in → 定期備份,轉換腳本

---

## 🚀 下一步

現在架構清楚了,需要討論:

1. **前端設計**:教師後台的課程編輯介面怎麼做?
2. **AI 評分引擎**:STT + 發音分析的技術選型?
3. **部署架構**:怎麼部署這個混合系統?

