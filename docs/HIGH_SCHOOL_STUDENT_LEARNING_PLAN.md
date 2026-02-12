# 高中生學習計畫：6 個月全端開發實戰

## 文件目的

這份文件為**啟翔（前端）**和**張靖杭（後端）**設計完整的學習路徑，確保在 6 個月內：
1. 學到帶得走的素養和技能
2. 完成產品上線
3. 累積實戰經驗

---

## 核心理念

### 學習哲學

```
產品導向 > 技術導向
實戰經驗 > 理論知識
解決問題 > 背誦語法
持續交付 > 完美主義
```

### 時間承諾

```
每週投入：16-20 小時
週間：每天 2-3 小時（晚上或早上）
週末：每天 4-6 小時

分配：
- 60%：寫程式碼
- 20%：學習新知識
- 10%：Code Review 和協作
- 10%：文件和總結
```

### 成功標準

**技術能力**（60%）：
- ✅ 能獨立完成功能開發
- ✅ 程式碼品質達到專業水準
- ✅ 測試覆蓋率 > 70%
- ✅ 熟練使用 Git 和 GitHub

**軟技能**（30%）：
- ✅ 問題解決能力
- ✅ 自主學習能力
- ✅ 團隊溝通與協作
- ✅ 時間管理

**成果交付**（10%）：
- ✅ 產品成功上線
- ✅ 功能完整可用
- ✅ 通過真實用戶驗證

---

## 階段一：基礎建立（Week 1-8）

### 學習目標

在這個階段，重點是**建立扎實的基礎**，理解全端開發的核心概念。

### 啟翔（前端）學習路徑

#### Week 1-2：React 與 TypeScript 基礎

**學習重點**：
```
核心概念：
- React Components（函式組件）
- Props 和 State
- Hooks（useState, useEffect, useRef）
- 條件渲染和列表渲染
- TypeScript 基礎型別

工具設定：
- VS Code + Extensions
- GitHub Copilot 安裝和使用
- Node.js 和 npm
- Git 基礎指令
```

**實作任務**：
```typescript
// 任務 1：製作簡單的計數器組件
// 學習：useState, 事件處理, TypeScript props

interface CounterProps {
  initialValue?: number;
}

function Counter({ initialValue = 0 }: CounterProps) {
  const [count, setCount] = useState(initialValue);

  return (
    <div>
      <p>Count: {count}</p>
      <button onClick={() => setCount(count + 1)}>+</button>
      <button onClick={() => setCount(count - 1)}>-</button>
    </div>
  );
}

// 任務 2：製作簡單的 Todo List
// 學習：useState with arrays, 列表渲染, 表單處理

// 任務 3：製作卡片組件庫
// 學習：組件組合, CSS Modules, Props drilling
```

**學習資源**：
- React 官方教學（Tic-Tac-Toe 教學）
- TypeScript Handbook（前 5 章）
- 使用 Copilot 學習常見 patterns

**評估標準**：
- ✅ 能夠建立和組合 React 組件
- ✅ 理解 props 和 state 的區別
- ✅ 能使用 TypeScript 定義型別
- ✅ 完成 3 個小專案

#### Week 3-4：Next.js 14 與 Tailwind CSS

**學習重點**：
```
Next.js 核心：
- App Router
- Server Components vs Client Components
- File-based routing
- 環境變數

Tailwind CSS：
- Utility-first CSS
- 響應式設計
- 客製化主題
- 組件樣式
```

**實作任務**：
```typescript
// 任務 1：建立多頁面應用
// app/page.tsx - 首頁
// app/about/page.tsx - 關於頁面
// app/contact/page.tsx - 聯絡頁面

// 任務 2：建立響應式導覽列
// 學習：Tailwind 響應式工具類, useState for mobile menu

// 任務 3：建立卡片列表頁面
// 學習：Grid layout, Hover effects, 資料映射
```

**實際專案**：
```
專案：個人作品集網站
功能：
- 首頁（介紹自己）
- 專案展示頁
- 技能列表頁
- 聯絡表單（暫時不串後端）

技術要求：
- 使用 Next.js 14 App Router
- Tailwind CSS 客製化主題
- 完全響應式設計
- TypeScript
- Git 版本控制
```

**評估標準**：
- ✅ 理解 Next.js 路由系統
- ✅ 能建立響應式佈局
- ✅ 熟練使用 Tailwind CSS
- ✅ 完成個人作品集網站

#### Week 5-6：API 整合與狀態管理

**學習重點**：
```
API 整合：
- fetch API
- 錯誤處理
- Loading states
- React Query 基礎

狀態管理：
- Context API
- Zustand（輕量級狀態管理）
- 何時需要全局狀態
```

**實作任務**：
```typescript
// 任務 1：天氣 App
// 串接公開 Weather API，顯示即時天氣

interface WeatherData {
  temperature: number;
  condition: string;
  city: string;
}

function WeatherApp() {
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchWeather = async (city: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/weather?city=${city}`);
      if (!response.ok) throw new Error('Failed to fetch');
      const data = await response.json();
      setWeather(data);
    } catch (err) {
      setError('Failed to fetch weather data');
    } finally {
      setLoading(false);
    }
  };

  // ... UI rendering
}

// 任務 2：Todo App with API
// 串接 JSONPlaceholder API，實作 CRUD

// 任務 3：全局主題切換
// 使用 Context API 實作深色/淺色模式切換
```

**評估標準**：
- ✅ 能正確處理 API 呼叫
- ✅ 理解 Loading/Error/Success 狀態
- ✅ 能使用 Context API
- ✅ 完成 3 個 API 整合專案

#### Week 7-8：Git 工作流程與協作

**學習重點**：
```
Git 核心指令：
- git clone, pull, push
- git add, commit
- git branch, checkout
- git merge

GitHub 協作：
- 建立 Pull Request
- Code Review 流程
- 解決合併衝突
- Issue 管理

最佳實踐：
- Commit message 規範
- 分支命名規則
- PR 描述撰寫
```

**實作任務**：
```bash
# 任務 1：建立個人 GitHub Profile
# README 展示你的專案和技能

# 任務 2：貢獻到團隊專案
# 1. Fork 專案
# 2. 建立 feature branch
# 3. 實作簡單功能
# 4. 提交 Pull Request
# 5. 回應 Code Review

# 任務 3：解決合併衝突
# 練習處理衝突情況
```

**專案整合**：
```
將前 6 週的作品集網站部署到 Vercel：
1. 推送到 GitHub
2. 連接 Vercel
3. 設定自動部署
4. 取得線上網址
5. 分享給朋友測試
```

**評估標準**：
- ✅ 熟練使用 Git 基本指令
- ✅ 能建立和審查 Pull Request
- ✅ 理解 GitHub Flow
- ✅ 成功部署專案到線上

### 張靖杭（後端）學習路徑

#### Week 1-2：Python 與 FastAPI 基礎

**學習重點**：
```
Python 核心：
- 變數、型別、控制流程
- 函式和模組
- 列表、字典、集合
- 類別和物件導向基礎

FastAPI 基礎：
- 建立簡單 API
- 路由和路徑參數
- 查詢參數
- Request Body
```

**實作任務**：
```python
# 任務 1：建立 Hello World API
from fastapi import FastAPI

app = FastAPI()

@app.get("/")
def read_root():
    return {"message": "Hello World"}

@app.get("/items/{item_id}")
def read_item(item_id: int, q: str = None):
    return {"item_id": item_id, "q": q}

# 任務 2：簡單計算機 API
@app.get("/add")
def add(a: int, b: int):
    return {"result": a + b}

@app.get("/subtract")
def subtract(a: int, b: int):
    return {"result": a - b}

# 任務 3：Todo API（記憶體版本）
from pydantic import BaseModel
from typing import List

class Todo(BaseModel):
    id: int
    title: str
    completed: bool = False

todos: List[Todo] = []

@app.post("/todos")
def create_todo(todo: Todo):
    todos.append(todo)
    return todo

@app.get("/todos")
def list_todos():
    return todos
```

**學習資源**：
- FastAPI 官方教學
- Python Crash Course（前 10 章）
- 使用 Copilot 學習 Python syntax

**評估標準**：
- ✅ 理解 FastAPI 基礎概念
- ✅ 能建立 CRUD API
- ✅ 理解 Pydantic 模型
- ✅ 完成 3 個簡單 API

#### Week 3-4：PostgreSQL 與 資料庫設計

**學習重點**：
```
SQL 基礎：
- SELECT, INSERT, UPDATE, DELETE
- WHERE, ORDER BY, LIMIT
- JOIN（INNER, LEFT）
- 聚合函式（COUNT, SUM, AVG）

資料庫設計：
- 主鍵和外鍵
- 一對多關係
- 多對多關係
- 索引基礎

SQLAlchemy：
- ORM 概念
- 模型定義
- 關聯設定
- 查詢 API
```

**實作任務**：
```python
# 任務 1：設計部落格資料庫
# 表格：users, posts, comments

# users 表
"""
id (PK)
username (unique)
email (unique)
created_at
"""

# posts 表
"""
id (PK)
user_id (FK)
title
content
created_at
"""

# comments 表
"""
id (PK)
post_id (FK)
user_id (FK)
content
created_at
"""

# 任務 2：使用 SQLAlchemy 定義模型
from sqlalchemy import Column, Integer, String, ForeignKey, DateTime
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship
from datetime import datetime

Base = declarative_base()

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True)
    username = Column(String, unique=True, nullable=False)
    email = Column(String, unique=True, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    posts = relationship("Post", back_populates="author")
    comments = relationship("Comment", back_populates="author")

class Post(Base):
    __tablename__ = "posts"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    title = Column(String, nullable=False)
    content = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    author = relationship("User", back_populates="posts")
    comments = relationship("Comment", back_populates="post")

# 任務 3：實作完整 CRUD API（連接真實資料庫）
```

**評估標準**：
- ✅ 能設計簡單的資料庫結構
- ✅ 理解關聯式資料庫概念
- ✅ 能使用 SQLAlchemy ORM
- ✅ 完成部落格 API

#### Week 5-6：API 設計與驗證

**學習重點**：
```
RESTful API 設計：
- HTTP 方法（GET, POST, PUT, DELETE）
- 狀態碼（200, 201, 400, 404, 500）
- API 版本管理
- 錯誤回應格式

驗證與安全：
- Pydantic 驗證
- 自訂驗證器
- 錯誤處理
- CORS 設定

測試：
- pytest 基礎
- 測試資料庫設定
- API 測試
- 測試覆蓋率
```

**實作任務**：
```python
# 任務 1：完整的用戶管理 API
from pydantic import BaseModel, EmailStr, validator

class UserCreate(BaseModel):
    username: str
    email: EmailStr
    password: str

    @validator('username')
    def username_alphanumeric(cls, v):
        assert v.isalnum(), 'must be alphanumeric'
        return v

    @validator('password')
    def password_strength(cls, v):
        if len(v) < 8:
            raise ValueError('must be at least 8 characters')
        return v

@app.post("/users", status_code=201)
async def create_user(user: UserCreate, db: Session = Depends(get_db)):
    # 檢查用戶是否已存在
    existing_user = db.query(User).filter(
        User.username == user.username
    ).first()

    if existing_user:
        raise HTTPException(
            status_code=400,
            detail="Username already registered"
        )

    # 建立新用戶
    db_user = User(**user.dict())
    db.add(db_user)
    db.commit()
    db.refresh(db_user)

    return db_user

# 任務 2：撰寫測試
import pytest
from fastapi.testclient import TestClient

def test_create_user_success():
    response = client.post("/users", json={
        "username": "testuser",
        "email": "test@example.com",
        "password": "securepass123"
    })
    assert response.status_code == 201
    assert response.json()["username"] == "testuser"

def test_create_user_duplicate():
    # 第一次成功
    client.post("/users", json={
        "username": "testuser",
        "email": "test@example.com",
        "password": "securepass123"
    })

    # 第二次應該失敗
    response = client.post("/users", json={
        "username": "testuser",
        "email": "another@example.com",
        "password": "securepass123"
    })
    assert response.status_code == 400
```

**評估標準**：
- ✅ 理解 RESTful API 設計原則
- ✅ 能撰寫完整的驗證邏輯
- ✅ 能撰寫 API 測試
- ✅ 測試覆蓋率 > 70%

#### Week 7-8：Docker 與部署基礎

**學習重點**：
```
Docker 基礎：
- 容器概念
- Dockerfile 撰寫
- docker-compose
- 環境變數管理

部署：
- Railway 部署
- 環境變數設定
- 資料庫連接
- 監控和日誌
```

**實作任務**：
```dockerfile
# 任務 1：撰寫 Dockerfile
FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

# 任務 2：撰寫 docker-compose.yml
version: '3.8'

services:
  web:
    build: .
    ports:
      - "8000:8000"
    environment:
      - DATABASE_URL=postgresql://user:pass@db:5432/mydb
    depends_on:
      - db

  db:
    image: postgres:15
    environment:
      - POSTGRES_PASSWORD=pass
      - POSTGRES_USER=user
      - POSTGRES_DB=mydb
    volumes:
      - postgres_data:/var/lib/postgresql/data

volumes:
  postgres_data:

# 任務 3：部署到 Railway
# 1. 連接 GitHub 專案
# 2. 設定環境變數
# 3. 部署資料庫
# 4. 部署 API
# 5. 測試線上 API
```

**評估標準**：
- ✅ 理解容器化概念
- ✅ 能撰寫 Dockerfile
- ✅ 成功部署到 Railway
- ✅ API 在線上可正常運作

### 共同學習任務

#### Week 1-8 每週檢查點

**Week 1**：
- [ ] 安裝所有開發工具
- [ ] 完成環境設定
- [ ] 建立 GitHub 帳號
- [ ] 加入團隊專案

**Week 2**：
- [ ] 完成第一個 Hello World
- [ ] 學會使用 GitHub Copilot
- [ ] 提交第一個 commit

**Week 3**：
- [ ] 建立第一個完整專案
- [ ] 學會建立 Pull Request
- [ ] 接受第一次 Code Review

**Week 4**：
- [ ] 前後端能成功串接（本地）
- [ ] 理解完整的請求流程
- [ ] 能夠除錯 API 問題

**Week 5**：
- [ ] 完成個人專案（作品集/部落格）
- [ ] 部署到線上
- [ ] 分享給朋友使用

**Week 6**：
- [ ] 開始參與主專案開發
- [ ] 實作第一個簡單功能
- [ ] 通過 Code Review

**Week 7**：
- [ ] 能獨立完成小功能
- [ ] 撰寫測試
- [ ] 參與技術討論

**Week 8**：
- [ ] 完成階段一評估
- [ ] 展示學習成果
- [ ] 規劃階段二目標

---

## 階段二：進階應用（Week 9-16）

### 學習目標

這個階段開始**深入主專案開發**，學習更進階的技術和最佳實踐。

### 啟翔（前端）進階路徑

#### Week 9-10：狀態管理與資料流

**學習重點**：
```
進階狀態管理：
- Zustand（全局狀態）
- React Query（伺服器狀態）
- 樂觀更新
- 狀態持久化

表單處理：
- React Hook Form
- Zod 驗證
- 錯誤處理
- 多步驟表單
```

**實作任務**：
```typescript
// 任務 1：全局狀態管理（Zustand）
import create from 'zustand';
import { persist } from 'zustand/middleware';

interface UserStore {
  user: User | null;
  setUser: (user: User) => void;
  logout: () => void;
}

export const useUserStore = create<UserStore>()(
  persist(
    (set) => ({
      user: null,
      setUser: (user) => set({ user }),
      logout: () => set({ user: null }),
    }),
    {
      name: 'user-storage',
    }
  )
);

// 任務 2：伺服器狀態管理（React Query）
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

function usePosts() {
  return useQuery({
    queryKey: ['posts'],
    queryFn: async () => {
      const res = await fetch('/api/posts');
      return res.json();
    },
  });
}

function useCreatePost() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (post: CreatePostInput) => {
      const res = await fetch('/api/posts', {
        method: 'POST',
        body: JSON.stringify(post),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['posts'] });
    },
  });
}

// 任務 3：複雜表單（React Hook Form + Zod）
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

const registerSchema = z.object({
  username: z.string().min(3).max(20),
  email: z.string().email(),
  password: z.string().min(8),
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

type RegisterFormData = z.infer<typeof registerSchema>;

function RegisterForm() {
  const { register, handleSubmit, formState: { errors } } = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
  });

  const onSubmit = (data: RegisterFormData) => {
    console.log(data);
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      {/* 表單欄位 */}
    </form>
  );
}
```

**主專案應用**：
```
實作「朗朗上口」的功能：
1. 學生登入狀態管理（Zustand）
2. 練習記錄查詢（React Query）
3. 新增練習表單（React Hook Form + Zod）
```

**評估標準**：
- ✅ 理解不同類型的狀態管理
- ✅ 能正確使用 React Query
- ✅ 能處理複雜表單驗證
- ✅ 完成主專案 2 個功能

#### Week 11-12：UI 組件庫與設計系統

**學習重點**：
```
組件庫：
- shadcn/ui
- Radix UI 基礎
- 無障礙設計（a11y）
- 組件客製化

設計系統：
- Design tokens
- 顏色系統
- 字體層級
- 間距系統
```

**實作任務**：
```typescript
// 任務 1：建立專案設計系統
// tailwind.config.ts
export default {
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#f0f9ff',
          100: '#e0f2fe',
          // ... 完整色階
          900: '#0c4a6e',
        },
        // 定義完整的顏色系統
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        heading: ['Poppins', 'sans-serif'],
      },
      spacing: {
        // 一致的間距系統
      },
    },
  },
};

// 任務 2：建立可重用組件
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';

// 組合成業務組件
function StudentCard({ student }: { student: Student }) {
  return (
    <Card>
      <Card.Header>
        <h3>{student.name}</h3>
      </Card.Header>
      <Card.Content>
        <p>練習次數: {student.practiceCount}</p>
      </Card.Content>
      <Card.Footer>
        <Button>查看詳情</Button>
      </Card.Footer>
    </Card>
  );
}

// 任務 3：無障礙設計
// 確保所有互動元素可鍵盤操作
// 正確使用 ARIA 屬性
// 顏色對比度符合 WCAG AA 標準
```

**主專案應用**：
```
優化「朗朗上口」UI：
1. 建立完整設計系統
2. 實作所有頁面組件
3. 確保響應式設計
4. 通過無障礙檢查
```

**評估標準**：
- ✅ 能使用 shadcn/ui
- ✅ 理解設計系統概念
- ✅ 重視無障礙設計
- ✅ UI 品質達到專業水準

#### Week 13-14：效能優化

**學習重點**：
```
Next.js 效能優化：
- 圖片優化（next/image）
- 字體優化（next/font）
- Code splitting
- 動態載入

React 效能優化：
- useMemo, useCallback
- React.memo
- 虛擬滾動
- 防抖和節流
```

**實作任務**：
```typescript
// 任務 1：圖片優化
import Image from 'next/image';

function StudentAvatar({ src, name }: { src: string; name: string }) {
  return (
    <Image
      src={src}
      alt={name}
      width={48}
      height={48}
      className="rounded-full"
      priority={false} // 非關鍵圖片延遲載入
    />
  );
}

// 任務 2：動態載入（Code Splitting）
import dynamic from 'next/dynamic';

const ChartComponent = dynamic(() => import('@/components/Chart'), {
  loading: () => <p>Loading chart...</p>,
  ssr: false, // 客戶端渲染
});

// 任務 3：效能優化技巧
import { useMemo, useCallback } from 'react';

function StudentList({ students }: { students: Student[] }) {
  // 快取昂貴的計算
  const sortedStudents = useMemo(() => {
    return [...students].sort((a, b) => b.score - a.score);
  }, [students]);

  // 快取回呼函式
  const handleStudentClick = useCallback((id: string) => {
    console.log('Clicked student:', id);
  }, []);

  return (
    <ul>
      {sortedStudents.map((student) => (
        <StudentItem
          key={student.id}
          student={student}
          onClick={handleStudentClick}
        />
      ))}
    </ul>
  );
}

// 使用 React.memo 避免不必要的重新渲染
const StudentItem = React.memo(({ student, onClick }) => {
  return (
    <li onClick={() => onClick(student.id)}>
      {student.name}
    </li>
  );
});
```

**主專案應用**：
```
優化「朗朗上口」效能：
1. 圖片優化
2. 列表虛擬滾動（大量資料）
3. 路由預載
4. 達到 Lighthouse 90+ 分數
```

**評估標準**：
- ✅ 理解效能優化原則
- ✅ 能使用效能分析工具
- ✅ Lighthouse 分數 > 90
- ✅ 首次載入 < 3 秒

#### Week 15-16：測試與品質保證

**學習重點**：
```
測試金字塔：
- 單元測試（Vitest）
- 整合測試
- 端對端測試（Playwright）
- 視覺回歸測試

測試最佳實踐：
- Test-Driven Development
- 測試覆蓋率
- Mocking
- 測試資料管理
```

**實作任務**：
```typescript
// 任務 1：單元測試（Vitest）
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Button } from '@/components/ui/button';

describe('Button', () => {
  it('renders with text', () => {
    render(<Button>Click me</Button>);
    expect(screen.getByText('Click me')).toBeInTheDocument();
  });

  it('handles click events', async () => {
    const handleClick = vi.fn();
    render(<Button onClick={handleClick}>Click me</Button>);

    await userEvent.click(screen.getByText('Click me'));
    expect(handleClick).toHaveBeenCalledOnce();
  });

  it('can be disabled', () => {
    render(<Button disabled>Click me</Button>);
    expect(screen.getByText('Click me')).toBeDisabled();
  });
});

// 任務 2：整合測試
describe('StudentList', () => {
  it('fetches and displays students', async () => {
    // Mock API response
    server.use(
      rest.get('/api/students', (req, res, ctx) => {
        return res(ctx.json([
          { id: '1', name: 'Alice' },
          { id: '2', name: 'Bob' },
        ]));
      })
    );

    render(<StudentList />);

    // 等待資料載入
    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeInTheDocument();
      expect(screen.getByText('Bob')).toBeInTheDocument();
    });
  });
});

// 任務 3：E2E 測試（Playwright）
import { test, expect } from '@playwright/test';

test('student can complete practice session', async ({ page }) => {
  // 登入
  await page.goto('/login');
  await page.fill('[name="username"]', 'testuser');
  await page.fill('[name="password"]', 'password');
  await page.click('button[type="submit"]');

  // 開始練習
  await page.goto('/practice');
  await page.click('text=開始練習');

  // 完成練習
  await page.fill('[name="answer"]', '正確答案');
  await page.click('text=提交');

  // 驗證結果
  await expect(page.locator('text=練習完成')).toBeVisible();
});
```

**主專案應用**：
```
為「朗朗上口」建立測試：
1. 單元測試（組件）
2. 整合測試（API 整合）
3. E2E 測試（關鍵用戶流程）
4. 測試覆蓋率 > 70%
```

**評估標準**：
- ✅ 能撰寫各類測試
- ✅ 理解測試金字塔
- ✅ 測試覆蓋率 > 70%
- ✅ E2E 測試涵蓋關鍵流程

### 張靖杭（後端）進階路徑

#### Week 9-10：Azure Speech SDK 整合

**學習重點**：
```
Azure Speech Services：
- Speech-to-Text (STT)
- Text-to-Speech (TTS)
- 即時串流
- 錯誤處理

音訊處理：
- 音訊格式轉換
- 檔案上傳處理
- 串流處理
- 品質優化
```

**實作任務**：
```python
# 任務 1：基礎 STT 實作
import azure.cognitiveservices.speech as speechsdk
from fastapi import FastAPI, UploadFile, File

app = FastAPI()

def speech_to_text(audio_file: bytes) -> str:
    speech_config = speechsdk.SpeechConfig(
        subscription=os.getenv("AZURE_SPEECH_KEY"),
        region=os.getenv("AZURE_SPEECH_REGION")
    )
    speech_config.speech_recognition_language = "zh-TW"

    # 建立音訊配置
    audio_config = speechsdk.audio.AudioConfig(filename=audio_file)

    # 建立識別器
    speech_recognizer = speechsdk.SpeechRecognizer(
        speech_config=speech_config,
        audio_config=audio_config
    )

    # 執行識別
    result = speech_recognizer.recognize_once()

    if result.reason == speechsdk.ResultReason.RecognizedSpeech:
        return result.text
    else:
        raise Exception(f"Speech recognition failed: {result.reason}")

@app.post("/api/speech/recognize")
async def recognize_speech(audio: UploadFile = File(...)):
    # 儲存上傳的音訊檔案
    audio_bytes = await audio.read()

    # 轉換為文字
    text = speech_to_text(audio_bytes)

    return {"text": text}

# 任務 2：即時串流 STT
import asyncio

async def stream_speech_to_text(audio_stream):
    speech_config = speechsdk.SpeechConfig(...)
    speech_config.speech_recognition_language = "zh-TW"

    # 設定串流輸入
    stream = speechsdk.audio.PushAudioInputStream()
    audio_config = speechsdk.audio.AudioConfig(stream=stream)

    speech_recognizer = speechsdk.SpeechRecognizer(
        speech_config=speech_config,
        audio_config=audio_config
    )

    # 設定事件處理器
    results = []

    def recognized_cb(evt):
        results.append(evt.result.text)

    speech_recognizer.recognized.connect(recognized_cb)

    # 開始連續識別
    speech_recognizer.start_continuous_recognition()

    # 寫入音訊串流
    for chunk in audio_stream:
        stream.write(chunk)

    # 停止識別
    stream.close()
    speech_recognizer.stop_continuous_recognition()

    return " ".join(results)

# 任務 3：TTS 實作
@app.post("/api/speech/synthesize")
async def synthesize_speech(text: str):
    speech_config = speechsdk.SpeechConfig(...)
    speech_config.speech_synthesis_language = "zh-TW"
    speech_config.speech_synthesis_voice_name = "zh-TW-HsiaoChenNeural"

    # 合成語音
    synthesizer = speechsdk.SpeechSynthesizer(speech_config=speech_config)
    result = synthesizer.speak_text_async(text).get()

    if result.reason == speechsdk.ResultReason.SynthesizingAudioCompleted:
        return {"audio": result.audio_data}
    else:
        raise Exception("Speech synthesis failed")
```

**主專案應用**：
```
為「朗朗上口」實作語音功能：
1. 學生錄音上傳
2. 語音轉文字
3. 發音評分（整合 GPT-4）
4. 錯誤處理和重試機制
```

**評估標準**：
- ✅ 成功整合 Azure Speech SDK
- ✅ 能處理音訊上傳
- ✅ STT 準確率 > 85%
- ✅ 完成語音評分功能

#### Week 11-12：Redis 快取與效能優化

**學習重點**：
```
Redis 基礎：
- 資料結構（String, Hash, List, Set）
- 快取策略
- 過期時間
- Redis with FastAPI

效能優化：
- 資料庫查詢優化
- N+1 問題解決
- 批次處理
- 背景任務
```

**實作任務**：
```python
# 任務 1：基礎 Redis 快取
import redis
from fastapi import FastAPI, Depends
import json

redis_client = redis.Redis(host='localhost', port=6379, decode_responses=True)

@app.get("/api/students/{student_id}")
async def get_student(student_id: int, db: Session = Depends(get_db)):
    # 先檢查快取
    cache_key = f"student:{student_id}"
    cached_data = redis_client.get(cache_key)

    if cached_data:
        return json.loads(cached_data)

    # 快取未命中，查詢資料庫
    student = db.query(Student).filter(Student.id == student_id).first()

    if not student:
        raise HTTPException(status_code=404, detail="Student not found")

    # 存入快取（過期時間 1 小時）
    redis_client.setex(
        cache_key,
        3600,
        json.dumps(student.dict())
    )

    return student

# 任務 2：快取失效策略
def invalidate_student_cache(student_id: int):
    """當學生資料更新時，清除快取"""
    redis_client.delete(f"student:{student_id}")

@app.put("/api/students/{student_id}")
async def update_student(
    student_id: int,
    student_data: StudentUpdate,
    db: Session = Depends(get_db)
):
    # 更新資料庫
    student = db.query(Student).filter(Student.id == student_id).first()
    for key, value in student_data.dict(exclude_unset=True).items():
        setattr(student, key, value)
    db.commit()

    # 清除快取
    invalidate_student_cache(student_id)

    return student

# 任務 3：資料庫查詢優化
from sqlalchemy.orm import joinedload

# ❌ 不好的做法（N+1 問題）
students = db.query(Student).all()
for student in students:
    print(student.practices)  # 每次都會查詢一次

# ✅ 好的做法（使用 joinedload）
students = db.query(Student).options(
    joinedload(Student.practices)
).all()
for student in students:
    print(student.practices)  # 只查詢一次

# 任務 4：背景任務
from fastapi import BackgroundTasks

def send_email(email: str, message: str):
    """發送郵件（模擬耗時操作）"""
    time.sleep(5)  # 模擬發送郵件
    print(f"Email sent to {email}: {message}")

@app.post("/api/students/register")
async def register_student(
    student: StudentCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
):
    # 建立學生
    db_student = Student(**student.dict())
    db.add(db_student)
    db.commit()

    # 在背景發送歡迎郵件
    background_tasks.add_task(
        send_email,
        student.email,
        "Welcome to 朗朗上口!"
    )

    return db_student  # 立即回應，不等待郵件發送
```

**主專案應用**：
```
優化「朗朗上口」效能：
1. 快取常用查詢（學生資料、練習記錄）
2. 優化資料庫查詢（避免 N+1）
3. 使用背景任務（發送通知）
4. API 回應時間 < 200ms
```

**評估標準**：
- ✅ 成功整合 Redis
- ✅ 理解快取策略
- ✅ API 效能提升 50%+
- ✅ 無 N+1 查詢問題

#### Week 13-14：JWT 認證與授權

**學習重點**：
```
認證與授權：
- JWT 原理
- Access Token / Refresh Token
- 密碼雜湊（bcrypt）
- 權限管理（RBAC）

安全性：
- HTTPS
- CORS
- Rate limiting
- 輸入驗證
```

**實作任務**：
```python
# 任務 1：JWT 認證實作
from passlib.context import CryptContext
from jose import JWTError, jwt
from datetime import datetime, timedelta

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

SECRET_KEY = os.getenv("SECRET_KEY")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30

def hash_password(password: str) -> str:
    return pwd_context.hash(password)

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)

def create_access_token(data: dict, expires_delta: timedelta = None):
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=15))
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

# 任務 2：登入端點
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

@app.post("/api/auth/login")
async def login(
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db)
):
    # 驗證用戶
    user = db.query(User).filter(User.username == form_data.username).first()

    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # 建立 access token
    access_token = create_access_token(
        data={"sub": user.username},
        expires_delta=timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    )

    return {"access_token": access_token, "token_type": "bearer"}

# 任務 3：保護路由
async def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db)
):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    user = db.query(User).filter(User.username == username).first()
    if user is None:
        raise credentials_exception

    return user

@app.get("/api/me")
async def read_users_me(current_user: User = Depends(get_current_user)):
    return current_user

# 任務 4：權限管理
from enum import Enum

class Role(str, Enum):
    STUDENT = "student"
    TEACHER = "teacher"
    ADMIN = "admin"

def require_role(required_role: Role):
    async def role_checker(current_user: User = Depends(get_current_user)):
        if current_user.role != required_role:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Not enough permissions"
            )
        return current_user
    return role_checker

@app.get("/api/admin/students")
async def get_all_students(
    current_user: User = Depends(require_role(Role.ADMIN)),
    db: Session = Depends(get_db)
):
    return db.query(Student).all()
```

**主專案應用**：
```
為「朗朗上口」實作認證系統：
1. 學生/教師登入
2. Token 管理
3. 權限控制（學生只能看自己的資料）
4. 安全性最佳實踐
```

**評估標準**：
- ✅ 成功實作 JWT 認證
- ✅ 密碼安全雜湊
- ✅ 權限控制正確
- ✅ 無安全漏洞

#### Week 15-16：測試與部署

**學習重點**：
```
後端測試：
- pytest 進階
- 測試資料庫
- Mocking
- 測試覆蓋率

部署與監控：
- Railway 生產部署
- 環境變數管理
- 日誌記錄
- Sentry 錯誤追蹤
```

**實作任務**：
```python
# 任務 1：測試設定
# tests/conftest.py
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.database import Base
from app.main import app

SQLALCHEMY_DATABASE_URL = "sqlite:///./test.db"

@pytest.fixture(scope="function")
def db_session():
    engine = create_engine(SQLALCHEMY_DATABASE_URL)
    Base.metadata.create_all(bind=engine)

    TestingSessionLocal = sessionmaker(bind=engine)
    db = TestingSessionLocal()

    yield db

    db.close()
    Base.metadata.drop_all(bind=engine)

@pytest.fixture(scope="function")
def client(db_session):
    def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()

# 任務 2：API 測試
# tests/test_auth.py
def test_register_user(client):
    response = client.post("/api/auth/register", json={
        "username": "testuser",
        "email": "test@example.com",
        "password": "securepass123"
    })
    assert response.status_code == 201
    assert response.json()["username"] == "testuser"

def test_login_success(client, db_session):
    # 先建立用戶
    user = User(
        username="testuser",
        email="test@example.com",
        hashed_password=hash_password("securepass123")
    )
    db_session.add(user)
    db_session.commit()

    # 測試登入
    response = client.post("/api/auth/login", data={
        "username": "testuser",
        "password": "securepass123"
    })
    assert response.status_code == 200
    assert "access_token" in response.json()

def test_login_wrong_password(client, db_session):
    # 建立用戶
    user = User(
        username="testuser",
        email="test@example.com",
        hashed_password=hash_password("securepass123")
    )
    db_session.add(user)
    db_session.commit()

    # 測試錯誤密碼
    response = client.post("/api/auth/login", data={
        "username": "testuser",
        "password": "wrongpassword"
    })
    assert response.status_code == 401

# 任務 3：Mocking 外部服務
from unittest.mock import patch

@patch('app.services.speech.speech_to_text')
def test_recognize_speech(mock_stt, client):
    # Mock Azure Speech API
    mock_stt.return_value = "測試文字"

    # 上傳音訊檔案
    response = client.post("/api/speech/recognize", files={
        "audio": ("test.wav", b"fake audio data", "audio/wav")
    })

    assert response.status_code == 200
    assert response.json()["text"] == "測試文字"
    mock_stt.assert_called_once()

# 任務 4：生產部署設定
# 新增 Sentry 錯誤追蹤
import sentry_sdk
from sentry_sdk.integrations.fastapi import FastApiIntegration

sentry_sdk.init(
    dsn=os.getenv("SENTRY_DSN"),
    integrations=[FastApiIntegration()],
    traces_sample_rate=1.0,
)

# 結構化日誌
import logging
from logging.handlers import RotatingFileHandler

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

handler = RotatingFileHandler('app.log', maxBytes=10000000, backupCount=5)
formatter = logging.Formatter(
    '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
handler.setFormatter(formatter)
logger.addHandler(handler)
```

**主專案應用**：
```
完成「朗朗上口」後端部署：
1. 測試覆蓋率 > 70%
2. 部署到 Railway
3. 設定 Sentry 監控
4. 建立健康檢查端點
```

**評估標準**：
- ✅ 測試覆蓋率 > 70%
- ✅ 成功部署到生產環境
- ✅ 錯誤追蹤正常運作
- ✅ API 穩定性 99%+

### 共同學習任務（Week 9-16）

#### 每兩週 Demo

**Week 10 Demo**：
- 展示新學會的技術
- 分享遇到的問題和解決方案
- 與曾教授討論進度

**Week 12 Demo**：
- 展示主專案進度
- 討論設計和架構決策
- 收集用戶回饋

**Week 14 Demo**：
- 展示完整功能
- 效能和品質報告
- 準備階段三規劃

**Week 16 Demo**：
- 階段二成果展示
- 回顧學習歷程
- 規劃最後衝刺

#### 配對編程（每週至少 1 次）

```
目的：
- 啟翔和張靖杭互相學習
- 理解全端開發流程
- 提升協作能力

方式：
- 每週選一個功能配對開發
- 輪流擔任 Driver 和 Navigator
- 完成後互相 Code Review
```

---

## 階段三：專案整合與上線（Week 17-24）

### 學習目標

這個階段的重點是**完成產品並成功上線**，經歷完整的軟體開發生命週期。

### 主要任務

#### Week 17-18：功能整合

**目標**：將所有功能整合成完整產品

**啟翔任務**：
```
1. 整合所有頁面
   - 首頁
   - 學生儀表板
   - 教師儀表板
   - 練習頁面
   - 設定頁面

2. 確保所有 API 整合正確
   - 錯誤處理
   - Loading 狀態
   - 空狀態處理

3. 響應式設計檢查
   - 手機版
   - 平板版
   - 桌面版

4. 無障礙檢查
   - 鍵盤導航
   - 螢幕閱讀器
   - 顏色對比
```

**張靖杭任務**：
```
1. API 完整性檢查
   - 所有端點測試
   - 錯誤處理完善
   - 文件更新

2. 資料庫遷移
   - 生產資料庫設定
   - 遷移腳本測試
   - 資料備份策略

3. 效能優化
   - 查詢優化
   - 快取策略
   - 負載測試

4. 安全檢查
   - SQL 注入防護
   - XSS 防護
   - CSRF 防護
   - Rate limiting
```

#### Week 19-20：測試與品質保證

**全面測試計畫**：
```
單元測試：
- 前端組件測試
- 後端 API 測試
- 測試覆蓋率 > 70%

整合測試：
- 前後端整合
- 第三方服務整合
- 資料庫整合

E2E 測試：
- 關鍵用戶流程
- 錯誤處理
- 邊界情況

效能測試：
- 負載測試
- 壓力測試
- 效能基準

安全測試：
- OWASP Top 10
- 滲透測試（基礎）
- 依賴漏洞掃描
```

**Bug 修復流程**：
```
1. 發現 Bug → 建立 Issue
2. 重現 Bug → 寫測試
3. 修復 Bug → 測試通過
4. Code Review → 合併
5. 部署到 Staging → 驗證
6. 部署到 Production → 監控
```

#### Week 21-22：使用者測試與優化

**Alpha 測試（內部）**：
```
測試者：
- 曾教授
- 團隊成員
- 朋友和家人

測試內容：
- 完整用戶流程
- 功能完整性
- UI/UX 體驗
- Bug 回報

目標：
- 發現重大 Bug
- 改善用戶體驗
- 優化效能
```

**Beta 測試（小範圍）**：
```
測試者：
- 5-10 位真實學生
- 2-3 位老師

測試內容：
- 真實使用場景
- 收集反饋
- 監控使用數據
- 追蹤問題

目標：
- 驗證產品價值
- 優化核心功能
- 準備正式上線
```

**數據收集與分析**：
```
收集指標：
- 用戶留存率
- 功能使用頻率
- 錯誤率
- 效能指標
- 用戶回饋

分析工具：
- Google Analytics
- Sentry（錯誤追蹤）
- Vercel Analytics（效能）
- 用戶訪談
```

#### Week 23：上線準備

**上線檢查清單**：
```
技術檢查：
- [ ] 所有測試通過
- [ ] 效能達標（Lighthouse > 90）
- [ ] 安全掃描通過
- [ ] 備份策略就緒
- [ ] 監控系統運作
- [ ] 日誌記錄完整
- [ ] 環境變數正確設定

內容檢查：
- [ ] 文案校對完成
- [ ] 圖片優化完成
- [ ] SEO 設定完成
- [ ] 法律條款就緒（隱私政策、使用條款）

營運準備：
- [ ] 用戶文件完成
- [ ] 教學影片製作
- [ ] 客服流程建立
- [ ] 問題追蹤系統就緒

團隊準備：
- [ ] 上線流程演練
- [ ] 應急計畫準備
- [ ] 監控值班安排
- [ ] 回滾計畫就緒
```

**上線流程**：
```
1. 最終代碼審查
2. 部署到 Staging 最終測試
3. 資料庫遷移（Production）
4. 部署到 Production
5. 煙霧測試（Smoke Test）
6. 監控系統檢查
7. 通知用戶（如適用）
8. 團隊待命（24 小時）
```

#### Week 24：上線與維運

**上線日（D-Day）**：
```
上線前（-2 小時）：
- 團隊集合
- 最終檢查
- 確認備份
- 準備回滾

上線（0 小時）：
- 執行部署
- 煙霧測試
- 監控檢查
- 通知團隊

上線後（+2 小時）：
- 持續監控
- 回應問題
- 收集回饋
- 記錄問題

上線後（+24 小時）：
- 數據分析
- 問題總結
- 優化計畫
- 慶祝成功！
```

**維運計畫**：
```
日常維運：
- 每日監控檢查
- Bug 修復優先級
- 功能優化迭代
- 用戶支援

每週檢討：
- 數據回顧
- 問題分析
- 改進計畫
- 團隊分享

月度規劃：
- 新功能規劃
- 技術債務處理
- 效能優化
- 安全更新
```

---

## 學習方法與技巧

### 1. 邊做邊學（Learning by Doing）

```
原則：
- 不要試圖「先學完再做」
- 遇到問題時再深入學習
- 做中學，學中做

實踐方式：
- 70% 時間實作
- 20% 時間學習新知識
- 10% 時間回顧總結

範例：
❌ 不好的方式：
   "我要先把 React 整本書看完再開始寫程式"

✅ 好的方式：
   "我要做一個計數器，不懂 useState 時再查文件"
```

### 2. AI 輔助學習

```
使用 AI 的三個層次：

Level 1（初期）：理解程式碼
- 讓 AI 解釋不懂的程式碼
- 詢問「為什麼這樣寫」
- 學習最佳實踐

Level 2（中期）：加速開發
- 使用 Copilot 補全程式碼
- 讓 AI 生成測試
- 使用 AI 重構程式碼

Level 3（後期）：解決複雜問題
- 與 AI 討論架構設計
- 使用 AI 除錯複雜問題
- 讓 AI 審查程式碼品質
```

**提問技巧**：
```
❌ 不好的提問：
"幫我寫一個登入功能"

✅ 好的提問：
"我想用 FastAPI 實作登入功能，需要：
1. JWT token 認證
2. bcrypt 密碼雜湊
3. 錯誤處理
4. 單元測試
使用的資料庫是 PostgreSQL，可以幫我生成程式碼嗎？"

關鍵：
- 提供上下文
- 明確需求
- 說明技術棧
- 要求具體產出
```

### 3. 配對編程（Pair Programming）

```
角色分工：
- Driver：操作鍵盤，寫程式碼
- Navigator：思考邏輯，提供方向

輪換方式：
- 25 分鐘輪換一次
- 或完成一個功能後輪換

好處：
- 互相學習
- 減少錯誤
- 提升程式碼品質
- 知識共享

啟翔 ↔ 張靖杭：
- 每週至少配對 2 小時
- 選擇跨領域的功能（前後端都需要）
- 輪流擔任 Driver
```

### 4. Code Review 習慣

```
提交 PR 前自我檢查：
- [ ] 程式碼能正常運作
- [ ] 測試全部通過
- [ ] 沒有 console.log 或除錯程式碼
- [ ] 命名清晰有意義
- [ ] 註解解釋了「為什麼」
- [ ] 已經自我審查過

審查別人的 PR：
- [ ] 理解需求和實作
- [ ] 檢查邏輯正確性
- [ ] 檢查邊界情況
- [ ] 檢查安全性
- [ ] 提供建設性回饋
- [ ] 學習新技巧

回饋技巧：
❌ "這段程式碼很爛"
✅ "這個函式太長了，建議拆分成多個小函式，提升可讀性"

❌ "為什麼這樣寫"
✅ "這裡可以使用 Array.map() 代替 for 迴圈，程式碼會更簡潔"
```

### 5. 文件化習慣

```
每個功能寫 README：
# 功能名稱

## 目的
解決什麼問題？

## 實作
如何實作的？

## 使用方式
```code example```

## 測試
如何測試？

## 注意事項
有什麼需要特別注意的？

遇到問題寫 Issue：
- 問題描述
- 重現步驟
- 預期行為
- 實際行為
- 截圖或錯誤訊息
- 嘗試過的解決方案

解決方案寫 Wiki：
- 問題類型
- 解決步驟
- 相關資源
- 經驗總結
```

### 6. 時間管理技巧

```
番茄工作法：
- 25 分鐘專注工作
- 5 分鐘休息
- 4 個番茄後休息 15-30 分鐘

每日計畫：
早上：
- 查看 Issue 和 PR
- 選擇今日任務（1-3 個）
- 設定優先級

工作時間：
- 關閉通知
- 專注一個任務
- 避免多工

晚上：
- 提交當日進度
- 更新 Issue 狀態
- 規劃明日任務

每週回顧：
- 完成了什麼？
- 學到了什麼？
- 遇到什麼困難？
- 下週目標是什麼？
```

---

## 評估與里程碑

### 階段性評估

#### 第 2 個月評估（Week 8）

**技術能力**：
```
啟翔：
- [ ] 能獨立建立 React 組件
- [ ] 理解 Next.js 路由
- [ ] 能串接 API
- [ ] 熟練使用 Git

張靖杭：
- [ ] 能建立 CRUD API
- [ ] 理解資料庫設計
- [ ] 能撰寫測試
- [ ] 熟練使用 Docker
```

**軟技能**：
```
雙方：
- [ ] 能清楚描述技術問題
- [ ] 能自主搜尋解決方案
- [ ] 能進行 Code Review
- [ ] 時間管理良好
```

**如果未達標**：
- 延長階段一學習時間
- 增加指導頻率
- 調整學習方法

#### 第 4 個月評估（Week 16）

**技術能力**：
```
啟翔：
- [ ] 能處理複雜狀態管理
- [ ] 能優化效能
- [ ] 測試覆蓋率 > 70%
- [ ] UI 品質達專業水準

張靖杭：
- [ ] 成功整合 Azure SDK
- [ ] 理解快取策略
- [ ] 實作完整認證系統
- [ ] API 效能優秀
```

**專案進度**：
```
- [ ] 核心功能完成 80%
- [ ] 前後端整合順暢
- [ ] 基礎測試完成
- [ ] 可以進行內部測試
```

#### 第 6 個月評估（Week 24）

**最終評估標準**：
```
產品品質：
- [ ] 產品成功上線
- [ ] 功能完整可用
- [ ] 測試覆蓋率 > 70%
- [ ] 效能達標
- [ ] 安全性無重大漏洞
- [ ] 真實用戶使用

技術能力：
- [ ] 前端開發能力（啟翔）
- [ ] 後端開發能力（張靖杭）
- [ ] 全端協作能力
- [ ] 問題解決能力
- [ ] 測試撰寫能力

軟實力：
- [ ] 自主學習能力
- [ ] 團隊協作能力
- [ ] 溝通表達能力
- [ ] 文件撰寫能力
- [ ] 時間管理能力

成果展現：
- [ ] GitHub 專案完整
- [ ] 技術文件齊全
- [ ] Demo 影片製作
- [ ] 可對外展示
```

---

## 帶得走的素養與技能

### 核心技能清單

#### 前端開發（啟翔）

```
✅ 基礎技能：
- HTML/CSS/JavaScript
- TypeScript
- React 18
- Next.js 14
- Tailwind CSS
- Git & GitHub

✅ 進階技能：
- 狀態管理（Zustand, React Query）
- 表單處理（React Hook Form）
- 測試（Vitest, Playwright）
- 效能優化
- 無障礙設計
- 響應式設計

✅ 工具鏈：
- VS Code
- GitHub Copilot
- Chrome DevTools
- Vercel
- npm/pnpm

✅ 最佳實踐：
- 組件設計
- API 整合
- 錯誤處理
- Loading 狀態
- 程式碼審查
```

#### 後端開發（張靖杭）

```
✅ 基礎技能：
- Python
- FastAPI
- PostgreSQL
- SQL
- Git & GitHub

✅ 進階技能：
- ORM（SQLAlchemy）
- API 設計（RESTful）
- 認證授權（JWT）
- 快取（Redis）
- 測試（pytest）
- Azure Speech SDK

✅ 工具鏈：
- VS Code
- GitHub Copilot
- Docker
- Railway
- PostgreSQL

✅ 最佳實踐：
- 資料庫設計
- API 安全性
- 錯誤處理
- 效能優化
- 程式碼審查
```

#### 共同技能

```
✅ DevOps：
- Git 工作流程
- GitHub Actions
- CI/CD 流程
- 環境管理
- 部署自動化

✅ 測試：
- 單元測試
- 整合測試
- E2E 測試
- 測試覆蓋率
- TDD 思維

✅ 協作：
- Pull Request
- Code Review
- Issue 管理
- 技術文件
- 團隊溝通

✅ AI 工具：
- GitHub Copilot
- Claude
- Prompt Engineering
- AI 輔助除錯
- AI 輔助學習
```

### 軟實力清單

```
✅ 問題解決：
- 分解複雜問題
- 系統性思考
- 除錯能力
- 搜尋能力
- 學習能力

✅ 產品思維：
- 用戶導向
- 功能優先級
- MVP 思維
- 迭代改進
- 數據驅動

✅ 自主學習：
- 閱讀文件
- 觀看教學
- 實作練習
- 總結反思
- 持續改進

✅ 團隊協作：
- 清晰溝通
- 給予回饋
- 接受建議
- 知識分享
- 互相支援

✅ 時間管理：
- 任務規劃
- 優先級管理
- 專注力
- 效率提升
- 截止日期管理
```

### 職涯發展路徑

```
6 個月後的可能性：

1. 繼續深化技能
   - 前端：React Native（行動開發）
   - 後端：微服務架構
   - 全端：更多專案經驗

2. 學術發展
   - 大學資工系準備
   - 專案作為備審資料
   - 技術面試準備

3. 職涯發展
   - 實習機會
   - 接案機會
   - 開源貢獻
   - 技術社群參與

4. 創業準備
   - 產品開發能力
   - 技術領導力
   - 專案管理經驗
   - 創業家思維

帶得走的優勢：
- ✅ 真實產品經驗（不是玩具專案）
- ✅ 完整的 GitHub 專案（可展示）
- ✅ 大學教授推薦信（專業背書）
- ✅ 現代開發工具熟練度（AI 工具）
- ✅ 全端開發能力（前端+後端）
- ✅ 團隊協作經驗（Git、PR、Review）
```

---

## 支援與資源

### Young 的指導方式

```
每週固定時間：
- 週三晚上：技術指導（2 小時）
- 週五下午：進度回顧（1 小時）

隨時支援：
- GitHub Discussion 提問
- Slack 即時討論
- Code Review 回饋

指導重點：
- 不直接給答案，引導思考
- 重視過程，而非結果
- 培養自主學習能力
- 建立正確的開發習慣
```

### 學習資源

#### 免費資源

```
官方文件：
- React: https://react.dev
- Next.js: https://nextjs.org/docs
- FastAPI: https://fastapi.tiangolo.com
- PostgreSQL: https://www.postgresql.org/docs

教學平台：
- freeCodeCamp（免費）
- MDN Web Docs（免費）
- YouTube（免費教學影片）
- GitHub Learning Lab（免費）

社群：
- Stack Overflow（問答）
- Reddit r/webdev（討論）
- Discord 開發者社群（即時討論）
```

#### 付費資源（可選）

```
線上課程：
- Frontend Masters（前端進階）
- Test-Driven Development（TDD）
- Egghead.io（實務技能）

工具訂閱：
- GitHub Copilot（$10/月/人）
- Claude Pro（$20/月，共享）

書籍：
- "Clean Code"（程式碼品質）
- "The Pragmatic Programmer"（開發者思維）
- "Designing Data-Intensive Applications"（系統設計）
```

### 社群與交流

```
內部交流：
- 每週技術分享會（30 分鐘）
- Slack 頻道即時討論
- GitHub Discussions 深度討論

外部社群：
- 參加本地技術社群
- 線上技術會議
- 開源專案貢獻
- 技術部落格撰寫

建立個人品牌：
- GitHub Profile 優化
- 技術部落格
- 社群媒體分享
- 專案 Demo 影片
```

---

## 常見問題與解答

### Q1: 如果學習進度落後怎麼辦？

```
A: 不要慌張，這很正常。

步驟：
1. 識別問題：哪個部分不懂？
2. 調整策略：
   - 放慢速度，打好基礎
   - 增加練習時間
   - 尋求更多指導
3. 溝通：告訴 Young，一起調整計畫
4. 持續前進：小步前進比停滯不前好

記住：每個人學習速度不同，重要的是持續進步。
```

### Q2: 遇到不懂的概念怎麼辦？

```
A: 系統性的學習方法：

1. 先嘗試自己理解
   - 閱讀官方文件
   - 搜尋相關教學
   - 實作簡單範例

2. 使用 AI 輔助
   - 問 Claude："請解釋 [概念] 給初學者聽"
   - 使用 Copilot 查看範例程式碼

3. 尋求人類協助
   - GitHub Discussion 提問
   - 週三技術指導時討論
   - 配對編程時學習

4. 實作驗證
   - 做一個小專案測試理解
   - 教給別人（最好的學習方式）
```

### Q3: 如何平衡學校課業和專案？

```
A: 時間管理策略：

優先級：
1. 學校考試（考前 1 週）
2. 專案關鍵節點
3. 日常開發

時間安排：
平日：
- 放學後 2-3 小時（彈性）
- 專注效率而非時間長度

週末：
- 4-6 小時（分散到兩天）
- 保留休息時間

考試週：
- 專案進度暫緩
- 完成考試優先
- 考後補上進度

溝通：
- 提前告知時間衝突
- 調整里程碑
- 團隊互相支援
```

### Q4: 如果專案沒有如期完成怎麼辦？

```
A: MVP 思維和優先級管理：

核心原則：
- 完成勝過完美
- 功能可以迭代
- 技術債可以還

優先級：
P0（必須）：
- 核心功能運作
- 基礎安全性
- 可用性

P1（重要）：
- 進階功能
- 效能優化
- 完整測試

P2（可選）：
- 美化 UI
- 額外功能
- 文件完善

策略：
1. 重新評估範圍
2. 削減非核心功能
3. 延後 P2 功能
4. 確保 P0 完成並上線

記住：
- 真實產品永遠在迭代
- 上線後持續改進
- 學習過程最重要
```

### Q5: 如何知道自己真的學會了？

```
A: 多維度的驗證方法：

技術驗證：
- [ ] 能獨立完成類似功能
- [ ] 能解釋給別人聽
- [ ] 能審查別人的程式碼
- [ ] 能解決變化的問題

實踐驗證：
- [ ] 完成實際專案
- [ ] 測試覆蓋率達標
- [ ] 程式碼品質良好
- [ ] 能維護和擴展

教學驗證：
- [ ] 能教給其他人
- [ ] 能寫技術文件
- [ ] 能回答別人問題
- [ ] 能做技術分享

如果以上都能做到 → 你真的學會了！
```

---

## 成功案例與期望

### 成功標準

**最低標準（必須達成）**：
```
✅ 產品成功上線
✅ 核心功能運作
✅ 基礎測試覆蓋
✅ 能獨立開發簡單功能
✅ 理解全端開發流程
```

**理想標準（努力達成）**：
```
✅ 產品品質專業
✅ 測試覆蓋率 > 70%
✅ 效能達到業界標準
✅ 能獨立開發中等功能
✅ 具備問題解決能力
✅ 養成良好開發習慣
```

**卓越標準（超越期望）**：
```
✅ 產品受到用戶喜愛
✅ 程式碼品質接近專業
✅ 能參與架構討論
✅ 能指導其他初學者
✅ 開始貢獻開源專案
✅ 建立個人技術品牌
```

### 6 個月後的你

**啟翔（前端）**：
```
技術能力：
- 熟練使用 React 和 Next.js
- 能建立複雜的前端應用
- 理解狀態管理和資料流
- 能撰寫測試和優化效能

作品集：
- 個人作品集網站
- 朗朗上口（主專案）
- 2-3 個練習專案
- GitHub 活躍貢獻紀錄

職涯發展：
- 可申請前端實習
- 可接小型前端案子
- 大學申請加分項
- 技術社群活躍成員
```

**張靖杭（後端）**：
```
技術能力：
- 熟練使用 Python 和 FastAPI
- 能設計和實作 RESTful API
- 理解資料庫設計和優化
- 能撰寫測試和處理安全性

作品集：
- 部落格 API
- 朗朗上口（主專案）
- 2-3 個練習專案
- GitHub 活躍貢獻紀錄

職涯發展：
- 可申請後端實習
- 可接小型後端案子
- 大學申請加分項
- 技術社群活躍成員
```

### 團隊期望

```
Young 的期望：
- 看到你們從新手成長為開發者
- 培養解決問題的思維方式
- 建立持續學習的習慣
- 完成一個值得驕傲的產品

曾教授的期望：
- 產品能實際幫助學生學習
- 展現研究價值
- 學生獲得實戰經驗
- 可能的論文產出

你們自己的期望：
- 學到帶得走的技能
- 完成真實的產品
- 為未來打下基礎
- 找到自己的興趣方向
```

---

## 總結

這份學習計畫的目標不只是**教你們寫程式碼**，更重要的是：

1. **培養解決問題的能力**
   - 遇到問題時，知道如何尋找解決方案
   - 系統性的分析和除錯
   - 不害怕嘗試新技術

2. **建立專業的工作習慣**
   - 版本控制、測試、文件
   - Code Review、持續改進
   - 團隊協作、溝通表達

3. **掌握現代開發工具**
   - AI 輔助開發（未來必備）
   - CI/CD 自動化
   - 雲端服務使用

4. **累積實戰經驗**
   - 真實的產品開發
   - 完整的開發生命週期
   - 可展示的作品集

5. **培養持續學習的心態**
   - 技術不斷進化
   - 學會如何學習
   - 保持好奇心

**記住**：
- 學習過程會有挫折，這很正常
- 重要的是持續前進，不要放棄
- 互相支援，一起成長
- 享受創造的過程

**6 個月後**，當你們回頭看，會驚訝於自己的成長。

**讓我們開始吧！**

---

**文件版本**：v1.0
**最後更新**：2026-02-13
**作者**：Young
**目標學生**：啟翔（前端）、張靖杭（後端）
**專案**：朗朗上口（中文識字平台）
