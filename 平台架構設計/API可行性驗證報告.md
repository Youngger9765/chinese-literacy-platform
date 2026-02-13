# API 可行性驗證報告

> **結論**: ❌ 原始三平台整合架構**不建議採用**,複雜度遠超預期
>
> **建議**: 改用單一平台為核心的簡化方案

---

## 🔍 驗證結果總覽

| API | 核心功能 | 可行性 | 重大限制 | 複雜度 |
|-----|---------|--------|---------|--------|
| **Notion API** | 課程內容管理 | ⚠️ 部分可行 | ❌ **無版本歷史 API** | ⭐⭐⭐⭐ |
| **GitHub API** | 作業結構管理 | ⚠️ 部分可行 | ⚠️ Epic 功能 Beta | ⭐⭐⭐⭐ |
| **Google Classroom API** | OAuth + 通知 | ✅ 完全可行 | ⚠️ OAuth 複雜 | ⭐⭐⭐ |
| **三平台整合** | 完整方案 | ❌ 不建議 | 同步複雜度爆表 | ⭐⭐⭐⭐⭐ |

---

## 1️⃣ Notion API 驗證結果

### ✅ 可行功能

#### 讀取 Page 內容
```python
from notion_client import Client

notion = Client(auth=os.environ["NOTION_TOKEN"])

# 讀取 Page 所有 blocks
response = notion.blocks.children.list(block_id="page_id")
blocks = response["results"]

# 支援的 block types:
# - paragraph (富文本)
# - heading_1, heading_2, heading_3
# - table, table_row (表格)
# - file (音檔/檔案連結)
# - bulleted_list_item, numbered_list_item
```

✅ **富文本**: 完整支援
✅ **表格**: 完整支援
✅ **音檔連結**: 支援 File block

#### 查詢 Database
```python
# 查詢並過濾
results = notion.databases.query(
    database_id="database_id",
    filter={
        "property": "狀態",
        "select": {"equals": "已發布"}
    },
    sorts=[
        {"property": "創建時間", "direction": "descending"}
    ]
)
```

✅ **過濾查詢**: 完整支援
✅ **排序**: 完整支援

#### 建立和更新 Page
```python
# 建立 Page
new_page = notion.pages.create(
    parent={"database_id": "database_id"},
    properties={
        "課程名稱": {"title": [{"text": {"content": "第一課"}}]},
        "年級": {"select": {"name": "一年級"}},
        "狀態": {"select": {"name": "草稿"}}
    },
    children=[
        {
            "object": "block",
            "type": "paragraph",
            "paragraph": {
                "rich_text": [{"text": {"content": "課文內容"}}]
            }
        }
    ]
)

# 更新 Page
notion.pages.update(
    page_id="page_id",
    properties={
        "狀態": {"select": {"name": "已發布"}}
    }
)
```

✅ **建立**: 完整支援
✅ **更新**: 完整支援

---

### ❌ 致命限制

#### 1. **無版本歷史 API** (最大問題)

```
問題: Notion API 完全不支援取得 Page revision history
影響: 我們聲稱的「版本控制」核心價值無法實現

官方文件說明:
"The Notion API does not currently support retrieving
 page version history or revision details."

來源: Notion Developer Docs - Versioning
```

**這意味著**:
- ❌ 無法透過 API 查看誰改了什麼
- ❌ 無法透過 API 回溯到舊版本
- ❌ 無法透過 API 比較版本差異
- ❌ 我們宣稱的「省下 6 週開發版本控制」完全不成立

**替代方案**:
```python
# 需要自己實作版本控制系統
class ManualVersionControl:
    def create_snapshot(self, page_id):
        # 1. 讀取完整 Page 內容
        blocks = self.notion.get_all_blocks(page_id)

        # 2. 序列化並存入我們的資料庫
        snapshot = {
            "page_id": page_id,
            "timestamp": datetime.now(),
            "content": json.dumps(blocks),
            "user_id": current_user.id
        }
        self.db.save_snapshot(snapshot)

    def compare_versions(self, v1, v2):
        # 3. 自己寫 diff 演算法
        return diff(v1.content, v2.content)
```

**結論**: 需要開發完整的版本控制系統,回到原點,沒有節省任何時間。

#### 2. **API 速率限制**

```
限制:
- 每分鐘 180 次請求 (3 req/sec)
- 單次請求最多 100 elements
- 單次建立最多 1000 blocks
- Payload 大小限制 500KB
```

**實際影響**:
```python
# 情境:同步 50 個課程,每個課程平均 200 blocks
# 需要的請求數:
# - 50 (取得 Page properties) +
# - 50 × 2 (取得 blocks,需分頁) = 150 requests
#
# 需要時間: 150 / 180 = 0.83 分鐘
# ✅ 尚可接受

# 但如果是 500 個課程:
# 1500 requests / 180 = 8.3 分鐘
# ⚠️ 同步時間過長
```

#### 3. **協作編輯無 API**

```
問題: Notion 的「即時協作」功能無法透過 API 使用
影響: 無法透過 API 看到其他人的編輯游標、留言通知

實際情況:
- Notion API 只能讀寫 content,無法取得協作狀態
- 留言 (Comments) API 目前不開放
- 無法透過 API 知道「誰正在編輯這個 Page」
```

**結論**: Notion 的協作功能只能在 Notion UI 使用,無法整合到我們的系統。

---

## 2️⃣ GitHub API 驗證結果

### ✅ 可行功能

#### Issues 管理
```python
import requests

headers = {
    "Authorization": f"token {GITHUB_TOKEN}",
    "Accept": "application/vnd.github+json"
}

# 建立 Issue
url = "https://api.github.com/repos/owner/repo/issues"
data = {
    "title": "【朗讀】第一課 - 我的家",
    "body": "## 作業說明\n...",
    "labels": ["作業", "朗讀", "一年級"],
    "milestone": 1,
    "assignees": ["student1"]
}
response = requests.post(url, headers=headers, json=data)

# 查詢 Issues
url = "https://api.github.com/repos/owner/repo/issues"
params = {"labels": "作業", "state": "open"}
response = requests.get(url, headers=headers, params=params)
```

✅ **建立/查詢/更新**: 完整支援
✅ **Labels/Milestones**: 完整支援
✅ **Assignees**: 完整支援

#### Pull Request 和 Code Review
```python
# 建立 PR
url = "https://api.github.com/repos/owner/repo/pulls"
data = {
    "title": "課程更新: 第一課",
    "head": "course-update-lesson1",
    "base": "main",
    "body": "## 變更內容\n- 新增注音\n- 更新生字表"
}
response = requests.post(url, headers=headers, json=data)

# 建立 Review
url = f"https://api.github.com/repos/owner/repo/pulls/{pr_number}/reviews"
data = {
    "event": "APPROVE",  # or REQUEST_CHANGES, COMMENT
    "body": "審閱通過"
}
response = requests.post(url, headers=headers, json=data)
```

✅ **PR 管理**: 完整支援
✅ **Code Review**: 完整支援

---

### ⚠️ 部分可行 / 限制

#### 1. **GitHub Projects v2 Epic 功能未成熟**

```
問題: Tasklists (Epic) 功能在 Private Beta,目前 onboarding 已暫停
狀態: GitHub Roadmap Issue #760

官方說明:
"[Public Beta] Issue Hierarchy powered by Tasklists
 Beta onboarding is temporarily paused as we work
 to address scaling and quality feedback."

來源: GitHub Roadmap
```

**這意味著**:
- ⚠️ 無法使用 Epic 建立階層結構
- ⚠️ 依賴 Beta 功能風險高(可能隨時改變)
- ⚠️ 新用戶目前無法申請 Beta 資格

**替代方案**:
```python
# 使用 Labels 模擬階層
labels_hierarchy = {
    "epic:第一課": ["task:朗讀", "task:生字", "task:閱讀"],
    "epic:第二課": ["task:朗讀", "task:生字"]
}

# 透過 Label 查詢屬於某個 Epic 的 Tasks
issues = github.search_issues(query="label:epic:第一課")
```

**結論**: 可用但不優雅,需要額外邏輯維護階層關係。

#### 2. **GraphQL API 必要性**

```
問題: GitHub Projects v2 沒有 REST API,必須使用 GraphQL
複雜度: 需要學習 GraphQL 語法

GraphQL 範例:
mutation {
  addProjectV2ItemById(input: {
    projectId: "PVT_xxx"
    contentId: "I_xxx"
  }) {
    item {
      id
    }
  }
}
```

**影響**:
- ⚠️ 開發團隊需要學習 GraphQL
- ⚠️ 需要維護兩套 API client (REST + GraphQL)
- ⚠️ 錯誤處理邏輯不同

#### 3. **速率限制**

```
限制:
- Primary: 5,000 requests/hour (authenticated)
- Secondary: 防止過度並發的動態限制

GraphQL 限制:
- 每次查詢消耗的配額由複雜度決定
- Node limit: 500,000 nodes/hour
```

✅ 相對寬鬆,一般使用不會碰到

---

## 3️⃣ Google Classroom API 驗證結果

### ✅ 完全可行功能

#### 列出班級和學生
```python
from googleapiclient.discovery import build

service = build('classroom', 'v1', credentials=creds)

# 列出教師的班級
courses = service.courses().list(teacherId='me').execute()

# 列出班級學生
students = service.courses().students().list(
    courseId=course_id
).execute()

# 取得學生資料
for student in students.get('students', []):
    print(student['profile']['name'])
    print(student['profile']['emailAddress'])
    print(student['profile']['photoUrl'])
```

✅ **班級管理**: 完整支援
✅ **學生名單**: 完整支援

#### 建立作業 (CourseWork)
```python
# 建立作業
coursework = {
    'title': '【朗讀】第一課 - 我的家',
    'description': '請完成課文朗讀並上傳錄音',
    'workType': 'ASSIGNMENT',
    'state': 'PUBLISHED',
    'maxPoints': 100,
    'dueDate': {
        'year': 2026,
        'month': 3,
        'day': 15
    },
    'materials': [
        {
            'link': {
                'url': 'https://our-platform.com/assignments/123',
                'title': '點此完成作業'
            }
        }
    ]
}

result = service.courses().courseWork().create(
    courseId=course_id,
    body=coursework
).execute()

# Google 會自動發送通知給所有學生!
```

✅ **作業建立**: 完整支援
✅ **自動通知**: 完全免費獲得

#### 更新成績
```python
# 更新學生成績
submission = {
    'assignedGrade': 85,
    'draftGrade': 85
}

service.courses().courseWork().studentSubmissions().patch(
    courseId=course_id,
    courseWorkId=coursework_id,
    id=submission_id,
    updateMask='assignedGrade,draftGrade',
    body=submission
).execute()
```

✅ **成績管理**: 完整支援

---

### ⚠️ 限制

#### 1. **OAuth 流程複雜**

```
需要的步驟:
1. 在 Google Cloud Console 建立專案
2. 啟用 Google Classroom API
3. 配置 OAuth consent screen
4. 建立 OAuth 2.0 credentials
5. 實作 OAuth 流程
6. 管理 refresh tokens

使用者首次使用:
1. 點擊「使用 Google 登入」
2. 跳轉到 Google 授權頁面
3. 選擇帳號
4. 授權應用程式存取權限
5. 跳轉回我們的應用
```

**複雜度**:
- ⚠️ 設定門檻高(需要 Google Cloud Console 操作)
- ⚠️ 使用者體驗差(首次需授權)
- ⚠️ Token 管理複雜(需要 refresh)

#### 2. **無法取得課程總成績**

```
問題: API 只能操作個別作業成績,無法取得學生的課程總成績
解法: 自己計算

# 需要自己寫邏輯
def calculate_total_grade(student_id, course_id):
    submissions = service.courses().courseWork().studentSubmissions().list(
        courseId=course_id,
        userId=student_id
    ).execute()

    total_points = 0
    earned_points = 0

    for submission in submissions['studentSubmissions']:
        if 'assignedGrade' in submission:
            total_points += submission['courseWork']['maxPoints']
            earned_points += submission['assignedGrade']

    return (earned_points / total_points) * 100 if total_points > 0 else 0
```

✅ 可程式解決

#### 3. **API 配額限制**

```
免費配額:
- 每分鐘每使用者 1,200 次查詢 (20 QPS)
- 每分鐘每客戶端 3,000 次查詢 (50 QPS)
- 每天 4,000,000 次查詢 (平均 46 QPS)

實際影響:
假設 500 個學生同時登入:
- 500 × 2 (list courses + list students) = 1000 requests
- 時間: 1000 / 20 = 50 秒 (每使用者限制)
- 或: 1000 / 50 = 20 秒 (客戶端限制)
```

⚠️ 大規模使用時可能需要付費提升配額

---

## 🚨 三平台整合的複雜度分析

### 致命問題 1: 三向資料同步

```python
# 偽代碼展示實際複雜度
class AssignmentService:
    def create_assignment(self, data):
        """建立作業需要操作三個平台"""

        # Step 1: 在 Notion 建立作業 Page
        try:
            notion_page = self.notion.pages.create(...)
            notion_page_id = notion_page['id']
        except NotionAPIError as e:
            # 錯誤處理 1
            return self.handle_notion_error(e)

        # Step 2: 在 GitHub 建立 Issue
        try:
            github_issue = self.github.issues.create(...)
            github_issue_number = github_issue['number']
        except GitHubAPIError as e:
            # 錯誤處理 2: 需要清理已建立的 Notion Page?
            self.rollback_notion(notion_page_id)
            return self.handle_github_error(e)

        # Step 3: 在 Google Classroom 建立 CourseWork
        try:
            coursework = self.classroom.coursework.create(...)
            coursework_id = coursework['id']
        except ClassroomAPIError as e:
            # 錯誤處理 3: 需要清理 Notion 和 GitHub?
            self.rollback_notion(notion_page_id)
            self.rollback_github(github_issue_number)
            return self.handle_classroom_error(e)

        # Step 4: 儲存 ID 映射到本地資料庫
        try:
            self.db.save_mapping(
                notion_id=notion_page_id,
                github_id=github_issue_number,
                classroom_id=coursework_id
            )
        except DatabaseError as e:
            # 錯誤處理 4: 三個平台都已建立,但映射失敗
            # 這是最糟的情況:資料不一致
            self.alert_admin("Critical: Mapping失敗")
            return self.handle_database_error(e)

        return {
            "success": True,
            "ids": {
                "notion": notion_page_id,
                "github": github_issue_number,
                "classroom": coursework_id
            }
        }
```

**複雜度來源**:
- ❌ 4 個可能的失敗點
- ❌ 需要實作 Rollback 機制
- ❌ 需要維護 ID 映射表
- ❌ 需要處理部分成功的情況

### 致命問題 2: 狀態同步地獄

```python
# 需要監聽三個平台的變更
class SyncService:
    def sync_status_changes(self):
        """同步狀態變更"""

        # 情境 1: 學生在 Notion 更新作業
        # → 需要更新 GitHub Issue 狀態
        # → 需要更新 Classroom Submission 狀態

        # 情境 2: 教師在 Classroom 改分數
        # → 需要更新 Notion Page 分數欄位
        # → 需要更新 GitHub Issue Comment

        # 情境 3: 教研團隊在 GitHub 關閉 Issue
        # → 需要更新 Notion Page 狀態
        # → 需要更新 Classroom CourseWork 狀態

        # 需要實作:
        # 1. Webhook 監聽(三個平台)
        # 2. 事件佇列系統
        # 3. 衝突解決機制
        # 4. 資料一致性檢查
```

**需要開發的元件**:
```
┌─────────────────────────────────────┐
│  Webhook Listeners (3 個)           │
├─────────────────────────────────────┤
│  Event Queue (Redis/RabbitMQ)       │
├─────────────────────────────────────┤
│  Sync Workers (處理同步邏輯)        │
├─────────────────────────────────────┤
│  Conflict Resolver (處理衝突)       │
├─────────────────────────────────────┤
│  Consistency Checker (定期檢查)     │
├─────────────────────────────────────┤
│  ID Mapping Service (維護映射)      │
└─────────────────────────────────────┘
```

**開發時間估算**: 8-12 週

### 致命問題 3: 版本歷史需自己實作

```python
# 因為 Notion API 不支援版本歷史,需要完全自己實作
class VersionControlSystem:
    def __init__(self):
        self.db = Database()

    def create_snapshot(self, page_id, user_id):
        """每次變更時建立快照"""
        # 1. 從 Notion 讀取完整內容
        blocks = self.notion.blocks.children.list(block_id=page_id)

        # 2. 序列化
        content = json.dumps(blocks, ensure_ascii=False)

        # 3. 計算 checksum
        checksum = hashlib.sha256(content.encode()).hexdigest()

        # 4. 檢查是否有變更
        last_snapshot = self.db.get_latest_snapshot(page_id)
        if last_snapshot and last_snapshot['checksum'] == checksum:
            return  # 沒有變更,不建立快照

        # 5. 儲存快照
        self.db.save_snapshot({
            "page_id": page_id,
            "version": self.get_next_version(page_id),
            "content": content,
            "checksum": checksum,
            "user_id": user_id,
            "created_at": datetime.now()
        })

    def compare_versions(self, page_id, v1, v2):
        """比較兩個版本"""
        snapshot1 = self.db.get_snapshot(page_id, v1)
        snapshot2 = self.db.get_snapshot(page_id, v2)

        # 實作 diff 演算法
        diff = self.diff_algorithm(
            json.loads(snapshot1['content']),
            json.loads(snapshot2['content'])
        )

        return diff

    def restore_version(self, page_id, version):
        """回溯到指定版本"""
        snapshot = self.db.get_snapshot(page_id, version)
        content = json.loads(snapshot['content'])

        # 1. 刪除 Notion Page 所有 blocks
        current_blocks = self.notion.blocks.children.list(block_id=page_id)
        for block in current_blocks['results']:
            self.notion.blocks.delete(block_id=block['id'])

        # 2. 重新建立 blocks
        for block in content:
            self.notion.blocks.children.append(
                block_id=page_id,
                children=[block]
            )

        # 3. 建立新快照(回溯也是一次變更)
        self.create_snapshot(page_id, user_id="system")
```

**開發時間估算**: 4-6 週

**結論**: 原本說「省下 6 週開發版本控制」,實際上還是需要開發!

---

## 📊 開發時間真實估算

### 原始估算 vs 實際估算

| 功能 | 原始估算 | 實際估算 | 差距 |
|------|---------|---------|------|
| **Notion 整合** | 1 週 | 2 週 | +1 週 |
| **版本控制** | 0 週 (免費獲得) | 6 週 (需自己開發) | +6 週 ❌ |
| **GitHub 整合** | 2 週 | 3 週 (需 GraphQL) | +1 週 |
| **Epic 階層** | 0 週 (免費獲得) | 2 週 (用 Labels 模擬) | +2 週 ⚠️ |
| **Classroom 整合** | 2 週 | 3 週 (OAuth 複雜) | +1 週 |
| **三向同步系統** | - | 8 週 (未估算) | +8 週 ❌ |
| **錯誤處理/Rollback** | - | 3 週 (未估算) | +3 週 ❌ |
| **Webhook 監聽** | - | 2 週 (未估算) | +2 週 ❌ |
| **ID 映射服務** | - | 1 週 (未估算) | +1 週 |
| **一致性檢查** | - | 2 週 (未估算) | +2 週 |
| **總計** | **5 週** | **32 週** | **+27 週 (540%)** ❌ |

---

## 💡 推薦替代方案

### 方案 A: Google Classroom 為核心 ✅ (強烈推薦)

```
架構:
Google Classroom (主平台)
    ├─ 班級管理 ✅
    ├─ 學生名單 ✅
    ├─ 作業發布 ✅
    ├─ 成績管理 ✅
    ├─ 通知系統 ✅
    └─ OAuth 登入 ✅

我們的系統:
    ├─ AI 評分引擎
    ├─ 學習記錄分析
    ├─ 遊戲化系統
    └─ 客製化前端

可選輕整合:
    └─ Notion (教師個人筆記,手動同步)
```

**優點**:
- ✅ **開發時間**: 2-3 週
- ✅ **維護成本**: 極低
- ✅ **穩定性**: 極高(Google 基礎設施)
- ✅ **使用者體驗**: 教師已熟悉
- ✅ **完全免費**: $0 成本

**缺點**:
- ❌ 需要學校使用 Google Workspace
- ⚠️ 依賴 Google 生態系

**適用場景**: 90% 的教育機構

---

### 方案 B: 自建輕量級系統 ✅ (次推薦)

```
架構:
PostgreSQL + FastAPI/Django
    ├─ 課程管理 (自建)
    ├─ 作業管理 (自建)
    ├─ 學生檔案 (自建)
    ├─ 版本控制 (Git-based)
    └─ OAuth (Google/Microsoft/自建)

前端:
    └─ React + TailwindCSS

通知:
    ├─ Email (SendGrid/AWS SES)
    └─ Push Notification (Firebase)
```

**優點**:
- ✅ **完全掌控**: 資料、功能、UI
- ✅ **彈性高**: 可客製化任何功能
- ✅ **無外部依賴**: 不受第三方限制

**缺點**:
- ⚠️ **開發時間**: 8-12 週
- ⚠️ **維護成本**: 中等

**適用場景**: 有特殊需求、技術能力強的團隊

---

### 方案 C: Notion + Zapier (No-code) ✅ (快速原型)

```
架構:
Notion (作業管理)
    ↓
Zapier/Make (自動化)
    ├─ Email 通知 (Gmail/SendGrid)
    ├─ Google Sheets 匯出成績
    ├─ Slack/Discord 通知
    └─ Webhooks (自訂整合)
```

**優點**:
- ✅ **快速實作**: 3-5 天
- ✅ **No-code**: 非工程師也能設定
- ✅ **成本低**: $20-50/month

**缺點**:
- ❌ Zapier Task 數量限制
- ❌ 無法實作複雜邏輯

**適用場景**: 快速驗證概念、小規模試驗

---

## 🎯 最終建議

### ❌ 不推薦原始三平台整合架構

**原因總結**:
1. ❌ **Notion 無版本歷史 API** - 核心價值無法實現
2. ❌ **GitHub Epic 功能未成熟** - 依賴 Beta 功能風險高
3. ❌ **三向同步複雜度爆表** - 開發時間從 5 週 → 32 週 (540%)
4. ❌ **維護成本極高** - 需要維護 3 個 API client + 同步系統
5. ❌ **錯誤處理地獄** - 每個操作有 3+ 個失敗點

### ✅ 推薦採用方案 A (Google Classroom 為核心)

**理由**:
- ✅ 2-3 週即可上線
- ✅ 完全免費
- ✅ 教師已熟悉
- ✅ 穩定可靠
- ✅ 專注開發我們的核心價值(AI 評分、學習分析)

**實施步驟**:
1. Week 1: Google Classroom API 整合 + OAuth
2. Week 2: AI 評分引擎 + 學習記錄
3. Week 3: 遊戲化系統 + 客製化前端

**投資報酬率**: ⭐⭐⭐⭐⭐

---

## 📚 參考資料

### Notion API
- [Notion Developers](https://developers.notion.com/)
- [Working with Page Content](https://developers.notion.com/docs/working-with-page-content)
- [Versioning (無版本歷史 API)](https://developers.notion.com/reference/versioning)

### GitHub API
- [GitHub REST API](https://docs.github.com/en/rest)
- [GitHub GraphQL API](https://docs.github.com/en/graphql)
- [Projects v2 Beta](https://github.com/github/roadmap/issues/760)

### Google Classroom API
- [Google Classroom API](https://developers.google.com/classroom)
- [Python Quickstart](https://developers.google.com/classroom/quickstart/python)
- [Manage CourseWork](https://developers.google.com/classroom/guides/manage-coursework)

