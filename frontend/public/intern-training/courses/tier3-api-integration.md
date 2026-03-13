# Tier 3：API 串接

前端的工作大部分就是「把使用者的操作送給後端，把後端的資料顯示出來」。這一課學的是怎麼做這件事。

---

## REST API 基本概念

後端提供「API endpoint」，前端透過 HTTP 請求呼叫它。

**資源 (Resource)**：API 裡的資料單位。LingoLeap 有 `/api/stories`（課文）、`/api/learning-sessions`（學習記錄）等。

**HTTP 方法**：

```
GET    /api/stories         → 取得所有課文清單
GET    /api/stories/123     → 取得 ID 為 123 的課文
POST   /api/learning-sessions → 新建一個學習記錄
PUT    /api/learning-sessions/456 → 完整更新記錄 456
PATCH  /api/learning-sessions/456 → 部分更新記錄 456
DELETE /api/learning-sessions/456 → 刪除記錄 456
```

**Status Code（狀態碼）**：後端用數字告訴你結果怎麼了。

```
2xx = 成功
  200 OK          — 一般成功
  201 Created     — 新建成功

4xx = 你的問題
  400 Bad Request  — 你送的資料格式有問題
  401 Unauthorized — 沒登入
  403 Forbidden    — 沒有權限
  404 Not Found    — 找不到這個資源
  422 Unprocessable — 資料驗證失敗（FastAPI 常見）

5xx = 後端的問題
  500 Internal Server Error — 後端程式掛了
  503 Service Unavailable   — 服務不可用
```

---

## fetch + async/await 完整範例

```typescript
// 基本 GET 請求
async function fetchStories() {
  const response = await fetch('http://localhost:8000/api/stories');

  if (!response.ok) {
    throw new Error(`HTTP error: ${response.status}`);
  }

  const data = await response.json();
  return data;
}

// POST 請求（送資料給後端）
async function createSession(storyId: string, studentId: string) {
  const response = await fetch('http://localhost:8000/api/learning-sessions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',         // 告訴後端你送的是 JSON
      'Authorization': `Bearer ${token}`,          // 登入 token
    },
    body: JSON.stringify({                         // 把物件轉成 JSON 字串
      story_id: storyId,
      student_id: studentId,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.detail ?? 'Request failed');
  }

  return response.json();
}
```

> 💡 提示：`response.ok` 是 status code 在 200-299 範圍時才是 `true`。`fetch` 本身不會因為 4xx/5xx 而 throw，你要自己檢查。

---

## 錯誤處理：try/catch + 告知使用者

```typescript
const [error, setError] = useState<string | null>(null);

const loadStory = async (id: string) => {
  try {
    const story = await fetchStory(id);
    setStory(story);
    setError(null);           // 清除之前的錯誤
  } catch (err) {
    if (err instanceof SessionExpiredError) {
      // 特殊錯誤：session 過期，重建 session
      await rebuildSession();
    } else {
      // 一般錯誤：顯示給使用者
      setError('載入課文失敗，請稍後再試');
      console.error('loadStory error:', err);  // 開發時記錄詳細錯誤
    }
  }
};

// 在 JSX 顯示錯誤
{error && (
  <div className="bg-red-50 text-red-700 px-4 py-3 rounded border border-red-200">
    {error}
  </div>
)}
```

---

## Loading 三態管理

每個 API 請求都有三種狀態：**載入中 → 成功 / 失敗**。

```typescript
const [isLoading, setIsLoading] = useState(false);
const [data, setData] = useState<Story[] | null>(null);
const [error, setError] = useState<string | null>(null);

const loadData = async () => {
  setIsLoading(true);
  setError(null);        // 清除之前的錯誤

  try {
    const result = await fetchStories();
    setData(result);
  } catch (err) {
    setError('載入失敗');
  } finally {
    setIsLoading(false); // 不管成功失敗都關閉 loading
  }
};

// JSX 對應三種狀態
if (isLoading) return <Spinner />;
if (error) return <ErrorMessage message={error} />;
if (!data) return null;

return <StoryList stories={data} />;
```

⚠️ 注意：`finally` 裡的 `setIsLoading(false)` 很重要。如果只在成功時關閉 loading，失敗時 UI 會永遠停在轉圈圈。

---

## LingoLeap api.ts 分析

LingoLeap 把所有 API 呼叫集中在 `frontend/src/services/api.ts`，好處是：

1. **改 API URL 只要改一個地方**：`const API_BASE = import.meta.env.VITE_API_URL`
2. **型別轉換集中處理**：後端回傳 `lesson_number: number`，前端需要 `id: string`，轉換邏輯在 api.ts 裡
3. **特殊錯誤集中定義**：`SessionExpiredError` 在這裡定義，所有元件用同一個錯誤型別

```typescript
// api.ts 的結構
const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';

// 特殊錯誤類別
export class SessionExpiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionExpiredError';
  }
}

// 每個 API 呼叫都是一個 async 函式
export async function fetchStories(token?: string) {
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}/api/stories`, { headers });
  if (!res.ok) throw new Error(`fetchStories failed: ${res.status}`);

  const data: ApiStoryListResponse = await res.json();
  return {
    stories: data.stories.map(apiListItemToStory),  // 轉換格式
    total: data.total,
    grades: data.grades,
  };
}
```

**SessionExpiredError 的特殊處理**：

LingoLeap 部署在 Cloud Run，重新部署時 in-memory session 會清掉。前端收到 422 「session not found」時，會自動重建 session 再重試。這個邏輯在 `api.ts` 裡，每個呼叫到 session 的 endpoint 都會檢查。

---

## 練習：新增一個 API 呼叫

**任務**：在 LingoLeap 的 `api.ts` 裡新增一個函式，呼叫「取得學生最近的學習記錄」API

後端已經有這個 endpoint：`GET /api/learning-sessions/recent?limit=5`

回傳格式：
```json
{
  "sessions": [
    {
      "id": 1,
      "story_title": "小木偶的故事",
      "completed_at": "2026-03-10T10:30:00",
      "score": 85
    }
  ]
}
```

你要做的：

```typescript
// 1. 在 api.ts 定義回傳型別
interface RecentSession {
  // TODO：填入欄位
}

// 2. 定義 API 函式
export async function fetchRecentSessions(token: string, limit = 5): Promise<RecentSession[]> {
  // TODO：實作 fetch 呼叫
  // 注意：要帶 Authorization header（需要登入）
  // 注意：要檢查 res.ok
}

// 3. 在某個元件裡呼叫它，顯示「最近學習的課文」清單
// 提示：用 useEffect + useState，處理三態（loading/data/error）
```

完成後截圖給 Young，顯示「最近學習記錄」出現在畫面上。
