# Admin UI 課程管理系統設計

> **專案**: 中文識字教育平台 - Admin UI (方案 H: GitHub + Admin UI)
>
> **設計完成日期**: 2026-02-13
>
> **核心理念**: 保留 GitHub 版本控制優勢 + 提供友善的管理介面

---

## 📋 目錄

- [1. 系統概述](#1-系統概述)
- [2. 架構設計](#2-架構設計)
- [3. 前端設計](#3-前端設計)
- [4. 後端 API 設計](#4-後端-api-設計)
- [5. Git 整合層](#5-git-整合層)
- [6. Markdown 轉換器](#6-markdown-轉換器)
- [7. 資料庫設計](#7-資料庫設計)
- [8. 衝突處理](#8-衝突處理)
- [9. 部署與測試](#9-部署與測試)
- [10. 開發時程](#10-開發時程)

---

## 1. 系統概述

### 1.1 設計目標

```
問題:
  - 教師不會 Git 操作 ❌
  - Markdown 語法有學習門檻 ⚠️
  - 直接用 GitHub 無即時預覽 ❌

解決方案:
  - 提供友善的 Web 管理介面 ✅
  - WYSIWYG 編輯器 (TipTap) ✅
  - 背後自動 Git Commit + Push ✅
  - 保留完整版本控制 ✅
```

### 1.2 核心價值

| 特性 | 傳統 CMS | 純 GitHub | **方案 H** |
|------|---------|----------|-----------|
| **易用性** | ⭐⭐⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐ |
| **版本控制** | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **開發成本** | ⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| **運營成本** | ⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **維護成本** | ⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |

---

## 2. 架構設計

### 2.1 整體架構圖

```
┌─────────────────────────────────────────────┐
│           教師端 (React 管理介面)              │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐    │
│  │課程列表  │ │課程編輯  │ │版本歷史  │    │
│  └──────────┘ └──────────┘ └──────────┘    │
└────────────────┬────────────────────────────┘
                 │ REST API
                 ▼
┌─────────────────────────────────────────────┐
│              NestJS Backend                 │
│  ┌──────────────────────────────────────┐  │
│  │     Lessons Controller               │  │
│  │  GET/POST/PUT/DELETE /api/lessons    │  │
│  └──────┬───────────────────────┬───────┘  │
│         │                       │           │
│         ▼                       ▼           │
│  ┌──────────┐           ┌──────────────┐   │
│  │PostgreSQL│           │ Git Service  │   │
│  │  (查詢)  │           │(Commit+Push) │   │
│  └──────────┘           └──────┬───────┘   │
└─────────────────────────────────┼───────────┘
                                  │
                                  ▼
                    ┌─────────────────────────┐
                    │   GitHub Repository     │
                    │  (courses/*.md)         │
                    └──────────┬──────────────┘
                               │ Webhook
                               ▼
                    ┌─────────────────────────┐
                    │  Sync Service (既有)    │
                    │  Pull → Parse → DB      │
                    └─────────────────────────┘
```

### 2.2 資料流向

#### 讀取流程 (查詢課程)

```
教師 → GET /api/lessons
    ↓
  Controller → PostgreSQL
    ↓
  回傳課程列表
```

**說明**: 查詢直接從 PostgreSQL 讀取,**不走 Git**,速度快

#### 寫入流程 (更新課程)

```
教師 → PUT /api/lessons/:id
    ↓
  Controller
    ├─> MarkdownConverter (DTO → Markdown)
    ├─> GitService.commitFile()
    │     ├─ 寫入檔案 (courses/grade1/lesson-01.md)
    │     ├─ git add
    │     ├─ git commit -m "更新課程: xxx"
    │     └─ git push
    ├─> PostgreSQL.update() (即時更新)
    └─> 回傳成功

(5 分鐘內)
    ↓
  Webhook 觸發 (GitHub → Platform)
    ↓
  SyncService.pull() (確保一致性)
```

**說明**: 寫入時同時更新 PostgreSQL + Git,Webhook 是備份同步機制

---

## 3. 前端設計

### 3.1 頁面結構

```
/admin
  /lessons
    /                    # 課程列表頁面
    /new                 # 新增課程頁面
    /:id                 # 課程詳情頁面
    /:id/edit            # 課程編輯頁面
    /:id/history         # 版本歷史頁面
```

### 3.2 課程列表頁面

**路由**: `/admin/lessons`

**功能**:
- 顯示所有課程 (分頁)
- 按年級/單元篩選
- 搜尋功能
- 新增課程按鈕

**UI 設計**:

```tsx
// pages/admin/lessons/index.tsx

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

export default function LessonsListPage() {
  const [filters, setFilters] = useState({
    grade: null,
    search: '',
  });

  const { data: lessons, isLoading } = useQuery({
    queryKey: ['lessons', filters],
    queryFn: () => api.lessons.list(filters),
  });

  return (
    <div className="container mx-auto p-6">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">課程管理</h1>
        <Link
          to="/admin/lessons/new"
          className="btn-primary"
        >
          + 新增課程
        </Link>
      </div>

      {/* Filters */}
      <div className="flex gap-4 mb-6">
        <select
          value={filters.grade || ''}
          onChange={(e) => setFilters({ ...filters, grade: e.target.value })}
          className="select"
        >
          <option value="">所有年級</option>
          <option value="1">一年級</option>
          <option value="2">二年級</option>
          <option value="3">三年級</option>
        </select>

        <input
          type="text"
          placeholder="搜尋課程名稱..."
          value={filters.search}
          onChange={(e) => setFilters({ ...filters, search: e.target.value })}
          className="input flex-1"
        />
      </div>

      {/* Lessons Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {lessons?.map(lesson => (
          <LessonCard key={lesson.id} lesson={lesson} />
        ))}
      </div>
    </div>
  );
}

function LessonCard({ lesson }) {
  return (
    <div className="card hover:shadow-lg transition">
      <div className="flex justify-between items-start mb-2">
        <span className="badge">{lesson.grade}年級</span>
        <span className="text-sm text-gray-500">
          {lesson.order_index}
        </span>
      </div>

      <h3 className="text-xl font-semibold mb-2">{lesson.title}</h3>
      <p className="text-gray-600 mb-4 line-clamp-2">
        {lesson.content_preview}
      </p>

      <div className="flex gap-2">
        <Link
          to={`/admin/lessons/${lesson.id}`}
          className="btn-secondary flex-1"
        >
          檢視
        </Link>
        <Link
          to={`/admin/lessons/${lesson.id}/edit`}
          className="btn-primary flex-1"
        >
          編輯
        </Link>
      </div>

      <div className="mt-4 pt-4 border-t text-sm text-gray-500">
        最後更新: {lesson.updated_at} · {lesson.updated_by}
      </div>
    </div>
  );
}
```

---

### 3.3 課程編輯頁面

**路由**: `/admin/lessons/:id/edit`

**功能**:
- WYSIWYG 編輯器 (TipTap)
- 生字列表 CRUD
- 作業設定
- 草稿/發布狀態切換
- 自動儲存 (Auto-save)
- 版本歷史連結

**UI 設計**:

```tsx
// pages/admin/lessons/[id]/edit.tsx

import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { AutoSaveIndicator } from '@/components/AutoSaveIndicator';
import { VocabularyEditor } from '@/components/VocabularyEditor';

export default function LessonEditPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  // 載入課程資料
  const { data: lesson, isLoading } = useQuery({
    queryKey: ['lesson', id],
    queryFn: () => api.lessons.get(id),
  });

  // 表單狀態
  const [formData, setFormData] = useState({
    title: '',
    grade: 1,
    unit: '',
    order_index: 1,
    content: '',
    vocabulary: [],
    homeworks: [],
    status: 'draft', // draft | published
  });

  useEffect(() => {
    if (lesson) {
      setFormData(lesson);
    }
  }, [lesson]);

  // TipTap 編輯器
  const editor = useEditor({
    extensions: [StarterKit],
    content: formData.content,
    onUpdate: ({ editor }) => {
      setFormData(prev => ({
        ...prev,
        content: editor.getHTML(),
      }));
    },
  });

  // 儲存 Mutation
  const saveMutation = useMutation({
    mutationFn: (data) => api.lessons.update(id, data),
    onSuccess: () => {
      toast.success('儲存成功');
    },
  });

  // 發布 Mutation
  const publishMutation = useMutation({
    mutationFn: () => api.lessons.publish(id),
    onSuccess: () => {
      toast.success('發布成功');
      navigate('/admin/lessons');
    },
  });

  // 自動儲存 (5 秒 debounce)
  useAutoSave(() => {
    saveMutation.mutate(formData);
  }, formData, 5000);

  if (isLoading) return <LoadingSpinner />;

  return (
    <div className="container mx-auto p-6 max-w-5xl">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/admin/lessons')}
            className="btn-ghost"
          >
            ← 返回
          </button>
          <h1 className="text-3xl font-bold">編輯課程</h1>
          <AutoSaveIndicator isSaving={saveMutation.isLoading} />
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => saveMutation.mutate(formData)}
            className="btn-secondary"
            disabled={saveMutation.isLoading}
          >
            儲存草稿
          </button>
          <button
            onClick={() => publishMutation.mutate()}
            className="btn-primary"
            disabled={publishMutation.isLoading}
          >
            發布課程
          </button>
        </div>
      </div>

      {/* Form */}
      <div className="space-y-8">
        {/* 基本資訊 */}
        <section className="card">
          <h2 className="text-xl font-semibold mb-4">基本資訊</h2>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">課程名稱 *</label>
              <input
                type="text"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                className="input"
                placeholder="例如: 第一課 我的家"
              />
            </div>

            <div>
              <label className="label">年級 *</label>
              <select
                value={formData.grade}
                onChange={(e) => setFormData({ ...formData, grade: Number(e.target.value) })}
                className="select"
              >
                {[1, 2, 3, 4, 5, 6].map(grade => (
                  <option key={grade} value={grade}>{grade}年級</option>
                ))}
              </select>
            </div>

            <div>
              <label className="label">單元</label>
              <input
                type="text"
                value={formData.unit}
                onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                className="input"
                placeholder="例如: 第一單元"
              />
            </div>

            <div>
              <label className="label">排序</label>
              <input
                type="number"
                value={formData.order_index}
                onChange={(e) => setFormData({ ...formData, order_index: Number(e.target.value) })}
                className="input"
                min="1"
              />
            </div>
          </div>
        </section>

        {/* 課文內容 */}
        <section className="card">
          <h2 className="text-xl font-semibold mb-4">課文內容</h2>

          {/* TipTap Toolbar */}
          <div className="border-b pb-2 mb-4 flex gap-2">
            <button
              onClick={() => editor?.chain().focus().toggleBold().run()}
              className={`btn-icon ${editor?.isActive('bold') ? 'active' : ''}`}
            >
              <strong>B</strong>
            </button>
            <button
              onClick={() => editor?.chain().focus().toggleItalic().run()}
              className={`btn-icon ${editor?.isActive('italic') ? 'active' : ''}`}
            >
              <em>I</em>
            </button>
            <button
              onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
              className={`btn-icon ${editor?.isActive('heading') ? 'active' : ''}`}
            >
              H2
            </button>
            <button
              onClick={() => editor?.chain().focus().toggleBulletList().run()}
              className={`btn-icon ${editor?.isActive('bulletList') ? 'active' : ''}`}
            >
              • List
            </button>
          </div>

          {/* Editor */}
          <EditorContent
            editor={editor}
            className="prose max-w-none min-h-[300px] p-4 border rounded"
          />
        </section>

        {/* 生字列表 */}
        <section className="card">
          <h2 className="text-xl font-semibold mb-4">生字列表</h2>
          <VocabularyEditor
            vocabulary={formData.vocabulary}
            onChange={(vocab) => setFormData({ ...formData, vocabulary: vocab })}
          />
        </section>

        {/* 作業設定 */}
        <section className="card">
          <h2 className="text-xl font-semibold mb-4">作業設定</h2>

          <div className="space-y-4">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={formData.homeworks.some(h => h.type === 'reading')}
                onChange={(e) => {
                  if (e.target.checked) {
                    setFormData({
                      ...formData,
                      homeworks: [...formData.homeworks, { type: 'reading', description: '朗讀課文' }]
                    });
                  } else {
                    setFormData({
                      ...formData,
                      homeworks: formData.homeworks.filter(h => h.type !== 'reading')
                    });
                  }
                }}
              />
              朗讀課文 (需錄音上傳)
            </label>

            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={formData.homeworks.some(h => h.type === 'writing')}
                onChange={(e) => {
                  if (e.target.checked) {
                    setFormData({
                      ...formData,
                      homeworks: [...formData.homeworks, { type: 'writing', description: '書寫生字' }]
                    });
                  }
                }}
              />
              書寫生字 (上傳照片)
            </label>
          </div>
        </section>

        {/* 版本歷史 */}
        <section className="card bg-gray-50">
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-xl font-semibold">版本歷史</h2>
              <p className="text-sm text-gray-600 mt-1">
                最後更新: {lesson?.updated_at} · {lesson?.updated_by}
              </p>
            </div>
            <button
              onClick={() => navigate(`/admin/lessons/${id}/history`)}
              className="btn-secondary"
            >
              檢視完整歷史
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
```

---

### 3.4 生字編輯器組件

```tsx
// components/VocabularyEditor.tsx

import { useState } from 'react';
import { DragDropContext, Droppable, Draggable } from 'react-beautiful-dnd';

interface Vocabulary {
  id?: string;
  character: string;
  pinyin: string;
  definition: string;
  example?: string;
}

export function VocabularyEditor({
  vocabulary,
  onChange
}: {
  vocabulary: Vocabulary[];
  onChange: (vocab: Vocabulary[]) => void;
}) {
  const [isAdding, setIsAdding] = useState(false);
  const [newWord, setNewWord] = useState<Vocabulary>({
    character: '',
    pinyin: '',
    definition: '',
    example: '',
  });

  const handleAdd = () => {
    if (!newWord.character || !newWord.pinyin) {
      return;
    }
    onChange([...vocabulary, { ...newWord, id: Date.now().toString() }]);
    setNewWord({ character: '', pinyin: '', definition: '', example: '' });
    setIsAdding(false);
  };

  const handleDelete = (id: string) => {
    onChange(vocabulary.filter(v => v.id !== id));
  };

  const handleDragEnd = (result) => {
    if (!result.destination) return;
    const items = Array.from(vocabulary);
    const [reorderedItem] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reorderedItem);
    onChange(items);
  };

  return (
    <div className="space-y-4">
      {/* Vocabulary List */}
      <DragDropContext onDragEnd={handleDragEnd}>
        <Droppable droppableId="vocabulary">
          {(provided) => (
            <div {...provided.droppableProps} ref={provided.innerRef} className="space-y-2">
              {vocabulary.map((word, index) => (
                <Draggable key={word.id} draggableId={word.id} index={index}>
                  {(provided) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.draggableProps}
                      {...provided.dragHandleProps}
                      className="flex items-center gap-4 p-4 bg-white border rounded hover:shadow"
                    >
                      <div className="cursor-move text-gray-400">⋮⋮</div>
                      <div className="flex-1 grid grid-cols-4 gap-4">
                        <div>
                          <span className="text-2xl font-bold">{word.character}</span>
                        </div>
                        <div>
                          <span className="text-sm text-gray-500">拼音</span>
                          <div>{word.pinyin}</div>
                        </div>
                        <div className="col-span-2">
                          <span className="text-sm text-gray-500">解釋</span>
                          <div>{word.definition}</div>
                        </div>
                      </div>
                      <button
                        onClick={() => handleDelete(word.id)}
                        className="btn-icon text-red-500 hover:bg-red-50"
                      >
                        🗑️
                      </button>
                    </div>
                  )}
                </Draggable>
              ))}
              {provided.placeholder}
            </div>
          )}
        </Droppable>
      </DragDropContext>

      {/* Add New Word */}
      {isAdding ? (
        <div className="p-4 border-2 border-dashed rounded space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">生字 *</label>
              <input
                type="text"
                value={newWord.character}
                onChange={(e) => setNewWord({ ...newWord, character: e.target.value })}
                className="input"
                placeholder="動"
                maxLength={1}
              />
            </div>
            <div>
              <label className="label">拼音 *</label>
              <input
                type="text"
                value={newWord.pinyin}
                onChange={(e) => setNewWord({ ...newWord, pinyin: e.target.value })}
                className="input"
                placeholder="dòng"
              />
            </div>
          </div>
          <div>
            <label className="label">解釋 *</label>
            <input
              type="text"
              value={newWord.definition}
              onChange={(e) => setNewWord({ ...newWord, definition: e.target.value })}
              className="input"
              placeholder="活動、行動"
            />
          </div>
          <div>
            <label className="label">例句</label>
            <input
              type="text"
              value={newWord.example}
              onChange={(e) => setNewWord({ ...newWord, example: e.target.value })}
              className="input"
              placeholder="小明在動物園看到很多動物"
            />
          </div>
          <div className="flex gap-2">
            <button onClick={handleAdd} className="btn-primary">
              確定新增
            </button>
            <button
              onClick={() => setIsAdding(false)}
              className="btn-secondary"
            >
              取消
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setIsAdding(true)}
          className="w-full p-4 border-2 border-dashed rounded hover:bg-gray-50 text-gray-600"
        >
          + 新增生字
        </button>
      )}
    </div>
  );
}
```

---

### 3.5 版本歷史頁面

**路由**: `/admin/lessons/:id/history`

**功能**:
- 顯示 Git Commit 歷史
- 比對版本差異 (Diff)
- 回復到舊版本

```tsx
// pages/admin/lessons/[id]/history.tsx

import { useParams } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import ReactDiffViewer from 'react-diff-viewer';

export default function LessonHistoryPage() {
  const { id } = useParams();

  const { data: history } = useQuery({
    queryKey: ['lesson-history', id],
    queryFn: () => api.lessons.getHistory(id),
  });

  const [selectedCommits, setSelectedCommits] = useState<[string, string] | null>(null);

  const { data: diff } = useQuery({
    queryKey: ['lesson-diff', selectedCommits],
    queryFn: () => api.lessons.getDiff(id, selectedCommits[0], selectedCommits[1]),
    enabled: !!selectedCommits,
  });

  const revertMutation = useMutation({
    mutationFn: (commitHash: string) => api.lessons.revert(id, commitHash),
    onSuccess: () => {
      toast.success('已回復到選定版本');
    },
  });

  return (
    <div className="container mx-auto p-6 max-w-6xl">
      <h1 className="text-3xl font-bold mb-6">版本歷史</h1>

      <div className="grid grid-cols-3 gap-6">
        {/* Commit List */}
        <div className="col-span-1 space-y-2">
          {history?.commits.map(commit => (
            <div
              key={commit.hash}
              className="p-4 border rounded hover:bg-gray-50 cursor-pointer"
              onClick={() => setSelectedCommits([commit.hash, history.commits[0].hash])}
            >
              <div className="font-semibold">{commit.message}</div>
              <div className="text-sm text-gray-500 mt-1">
                {commit.author} · {commit.date}
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  revertMutation.mutate(commit.hash);
                }}
                className="text-sm text-blue-600 hover:underline mt-2"
              >
                回復到此版本
              </button>
            </div>
          ))}
        </div>

        {/* Diff Viewer */}
        <div className="col-span-2">
          {diff ? (
            <div className="border rounded overflow-hidden">
              <ReactDiffViewer
                oldValue={diff.old}
                newValue={diff.new}
                splitView={true}
              />
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-gray-500">
              選擇版本以查看差異
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

---

## 4. 後端 API 設計

### 4.1 API 端點總覽

| 方法 | 端點 | 功能 | 權限 |
|------|------|------|------|
| GET | `/api/lessons` | 課程列表 (支援篩選/分頁) | Teacher |
| GET | `/api/lessons/:id` | 課程詳情 | Teacher |
| POST | `/api/lessons` | 新增課程 | Teacher |
| PUT | `/api/lessons/:id` | 更新課程 | Teacher |
| DELETE | `/api/lessons/:id` | 刪除課程 | Teacher |
| POST | `/api/lessons/:id/publish` | 發布課程 | Teacher |
| GET | `/api/lessons/:id/history` | 版本歷史 | Teacher |
| GET | `/api/lessons/:id/diff` | 版本比對 | Teacher |
| POST | `/api/lessons/:id/revert` | 回復版本 | Teacher |

---

### 4.2 Controller 實作

```typescript
// src/lessons/lessons.controller.ts

import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { LessonsService } from './lessons.service';
import { GitService } from './git.service';
import { CreateLessonDto, UpdateLessonDto } from './dto';

@Controller('api/lessons')
@UseGuards(JwtAuthGuard)
export class LessonsController {
  constructor(
    private lessonsService: LessonsService,
    private gitService: GitService,
  ) {}

  /**
   * 課程列表
   */
  @Get()
  async list(
    @Query('grade') grade?: number,
    @Query('search') search?: string,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 20,
  ) {
    return this.lessonsService.findAll({
      grade,
      search,
      page,
      limit,
    });
  }

  /**
   * 課程詳情
   */
  @Get(':id')
  async get(@Param('id') id: string) {
    return this.lessonsService.findOne(id);
  }

  /**
   * 新增課程
   */
  @Post()
  async create(
    @Body() dto: CreateLessonDto,
    @CurrentUser() user: Teacher,
  ) {
    // 1. 驗證資料
    // 2. 建立 Markdown
    // 3. Git Commit + Push
    // 4. 寫入 PostgreSQL
    return this.lessonsService.create(dto, user);
  }

  /**
   * 更新課程
   */
  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateLessonDto,
    @CurrentUser() user: Teacher,
  ) {
    // 1. 轉換成 Markdown
    const markdown = this.lessonsService.toMarkdown(dto);

    // 2. 取得檔案路徑
    const filepath = this.lessonsService.getFilePath(id);

    // 3. Git Commit + Push
    await this.gitService.commitFile(
      filepath,
      markdown,
      `更新課程: ${dto.title}`,
      user.email,
    );

    // 4. 更新 PostgreSQL
    return this.lessonsService.update(id, dto, user);
  }

  /**
   * 刪除課程
   */
  @Delete(':id')
  async delete(
    @Param('id') id: string,
    @CurrentUser() user: Teacher,
  ) {
    // 1. 從 Git 刪除檔案
    const filepath = this.lessonsService.getFilePath(id);
    await this.gitService.deleteFile(filepath, `刪除課程: ${id}`, user.email);

    // 2. 從 PostgreSQL 標記刪除
    return this.lessonsService.softDelete(id);
  }

  /**
   * 發布課程
   */
  @Post(':id/publish')
  async publish(
    @Param('id') id: string,
    @CurrentUser() user: Teacher,
  ) {
    return this.lessonsService.publish(id, user);
  }

  /**
   * 版本歷史
   */
  @Get(':id/history')
  async history(@Param('id') id: string) {
    const filepath = this.lessonsService.getFilePath(id);
    const commits = await this.gitService.getHistory(filepath);

    return {
      lesson_id: id,
      commits: commits.map(c => ({
        hash: c.hash,
        message: c.message,
        author: c.author_name,
        email: c.author_email,
        date: c.date,
      })),
    };
  }

  /**
   * 版本比對
   */
  @Get(':id/diff')
  async diff(
    @Param('id') id: string,
    @Query('from') fromCommit: string,
    @Query('to') toCommit: string,
  ) {
    const filepath = this.lessonsService.getFilePath(id);
    return this.gitService.getDiff(filepath, fromCommit, toCommit);
  }

  /**
   * 回復版本
   */
  @Post(':id/revert')
  async revert(
    @Param('id') id: string,
    @Body('commit_hash') commitHash: string,
    @CurrentUser() user: Teacher,
  ) {
    const filepath = this.lessonsService.getFilePath(id);

    // 1. Git revert
    await this.gitService.revertToCommit(
      filepath,
      commitHash,
      `回復課程 ${id} 到版本 ${commitHash}`,
      user.email,
    );

    // 2. 重新解析 Markdown → 更新 PostgreSQL
    const content = await this.gitService.readFile(filepath);
    const lesson = this.lessonsService.parseMarkdown(content);

    return this.lessonsService.update(id, lesson, user);
  }
}
```

---

## 5. Git 整合層

### 5.1 Git Service 設計

```typescript
// src/lessons/git.service.ts

import { Injectable, Logger } from '@nestjs/common';
import simpleGit, { SimpleGit } from 'simple-git';
import * as fs from 'fs/promises';
import * as path from 'path';

@Injectable()
export class GitService {
  private readonly logger = new Logger(GitService.name);
  private readonly repoPath = process.env.REPO_PATH || '/var/repos/courses';
  private git: SimpleGit;

  constructor() {
    this.git = simpleGit(this.repoPath);
  }

  /**
   * Commit 檔案
   */
  async commitFile(
    filepath: string,
    content: string,
    message: string,
    authorEmail: string,
  ): Promise<void> {
    try {
      // 1. 寫入檔案
      const fullPath = path.join(this.repoPath, filepath);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, content, 'utf-8');

      // 2. Git add
      await this.git.add(filepath);

      // 3. Git commit
      await this.git.commit(message, undefined, {
        '--author': `"${authorEmail} <${authorEmail}>"`,
      });

      // 4. Git push (with retry)
      await this.pushWithRetry();

      this.logger.log(`Committed: ${filepath} by ${authorEmail}`);
    } catch (error) {
      this.logger.error(`Commit failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Push with retry (處理 merge conflict)
   */
  private async pushWithRetry(maxRetries = 3): Promise<void> {
    for (let i = 0; i < maxRetries; i++) {
      try {
        // 先 pull (rebase 模式避免 merge commit)
        await this.git.pull('origin', 'main', { '--rebase': null });

        // 再 push
        await this.git.push('origin', 'main');

        return;
      } catch (error) {
        if (i === maxRetries - 1) {
          throw new Error('Push failed after retries: ' + error.message);
        }

        this.logger.warn(`Push failed, retrying... (${i + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }

  /**
   * 刪除檔案
   */
  async deleteFile(
    filepath: string,
    message: string,
    authorEmail: string,
  ): Promise<void> {
    await this.git.rm(filepath);
    await this.git.commit(message, undefined, {
      '--author': `"${authorEmail} <${authorEmail}>"`,
    });
    await this.pushWithRetry();
  }

  /**
   * 取得歷史記錄
   */
  async getHistory(filepath: string, limit = 50) {
    const log = await this.git.log({
      file: filepath,
      maxCount: limit,
    });

    return log.all;
  }

  /**
   * 取得 Diff
   */
  async getDiff(filepath: string, fromCommit: string, toCommit: string) {
    const diff = await this.git.diff([`${fromCommit}..${toCommit}`, '--', filepath]);

    // 取得兩個版本的完整內容
    const oldContent = await this.git.show([`${fromCommit}:${filepath}`]);
    const newContent = await this.git.show([`${toCommit}:${filepath}`]);

    return {
      diff,
      old: oldContent,
      new: newContent,
    };
  }

  /**
   * 回復到指定版本
   */
  async revertToCommit(
    filepath: string,
    commitHash: string,
    message: string,
    authorEmail: string,
  ): Promise<void> {
    // 1. 取得該版本的檔案內容
    const content = await this.git.show([`${commitHash}:${filepath}`]);

    // 2. 寫回檔案
    const fullPath = path.join(this.repoPath, filepath);
    await fs.writeFile(fullPath, content, 'utf-8');

    // 3. Commit
    await this.git.add(filepath);
    await this.git.commit(message, undefined, {
      '--author': `"${authorEmail} <${authorEmail}>"`,
    });
    await this.pushWithRetry();
  }

  /**
   * 讀取檔案內容 (HEAD)
   */
  async readFile(filepath: string): Promise<string> {
    const fullPath = path.join(this.repoPath, filepath);
    return fs.readFile(fullPath, 'utf-8');
  }
}
```

---

## 6. Markdown 轉換器

### 6.1 DTO → Markdown

```typescript
// src/lessons/markdown.converter.ts

import { Injectable } from '@nestjs/common';
import { UpdateLessonDto } from './dto';

@Injectable()
export class MarkdownConverter {

  /**
   * DTO → Markdown
   */
  toMarkdown(dto: UpdateLessonDto): string {
    const sections: string[] = [];

    // Frontmatter (YAML)
    sections.push('---');
    sections.push(`title: "${dto.title}"`);
    sections.push(`grade: ${dto.grade}`);
    sections.push(`unit: "${dto.unit || ''}"`);
    sections.push(`order: ${dto.order_index}`);
    sections.push(`status: ${dto.status}`);
    sections.push('---');
    sections.push('');

    // 課文內容
    sections.push('## 課文');
    sections.push('');
    sections.push(this.htmlToMarkdown(dto.content));
    sections.push('');

    // 生字列表
    if (dto.vocabulary?.length > 0) {
      sections.push('## 生字');
      sections.push('');
      dto.vocabulary.forEach(vocab => {
        sections.push(`### ${vocab.character} (${vocab.pinyin})`);
        sections.push('');
        sections.push(`**解釋**: ${vocab.definition}`);
        if (vocab.example) {
          sections.push('');
          sections.push(`**例句**: ${vocab.example}`);
        }
        sections.push('');
      });
    }

    // 作業
    if (dto.homeworks?.length > 0) {
      sections.push('## 作業');
      sections.push('');
      dto.homeworks.forEach(hw => {
        sections.push(`- [ ] ${hw.description}`);
      });
      sections.push('');
    }

    // Footer
    sections.push('---');
    sections.push('');
    sections.push(`_最後更新: ${new Date().toISOString()}_`);

    return sections.join('\n');
  }

  /**
   * HTML → Markdown (簡化版)
   */
  private htmlToMarkdown(html: string): string {
    return html
      .replace(/<h2>/g, '## ')
      .replace(/<\/h2>/g, '\n')
      .replace(/<strong>/g, '**')
      .replace(/<\/strong>/g, '**')
      .replace(/<em>/g, '_')
      .replace(/<\/em>/g, '_')
      .replace(/<p>/g, '')
      .replace(/<\/p>/g, '\n\n')
      .replace(/<br\s*\/?>/g, '\n')
      .replace(/<ul>/g, '')
      .replace(/<\/ul>/g, '\n')
      .replace(/<li>/g, '- ')
      .replace(/<\/li>/g, '\n')
      .trim();
  }

  /**
   * Markdown → DTO
   */
  fromMarkdown(markdown: string): Partial<UpdateLessonDto> {
    const lines = markdown.split('\n');
    const dto: any = {
      vocabulary: [],
      homeworks: [],
    };

    let currentSection = '';
    let inFrontmatter = false;
    let currentVocab: any = null;

    for (const line of lines) {
      // Frontmatter
      if (line === '---') {
        inFrontmatter = !inFrontmatter;
        continue;
      }

      if (inFrontmatter) {
        const [key, ...valueParts] = line.split(':');
        const value = valueParts.join(':').trim().replace(/"/g, '');
        dto[key.trim()] = isNaN(Number(value)) ? value : Number(value);
        continue;
      }

      // Sections
      if (line.startsWith('## ')) {
        currentSection = line.substring(3).trim();
        continue;
      }

      // 生字
      if (currentSection === '生字' && line.startsWith('### ')) {
        if (currentVocab) {
          dto.vocabulary.push(currentVocab);
        }
        const match = line.match(/### (.+) \((.+)\)/);
        if (match) {
          currentVocab = {
            character: match[1],
            pinyin: match[2],
            definition: '',
            example: '',
          };
        }
        continue;
      }

      if (currentVocab && line.startsWith('**解釋**:')) {
        currentVocab.definition = line.substring(9).trim();
      }

      if (currentVocab && line.startsWith('**例句**:')) {
        currentVocab.example = line.substring(9).trim();
      }

      // 作業
      if (currentSection === '作業' && line.startsWith('- [ ]')) {
        dto.homeworks.push({
          description: line.substring(6).trim(),
        });
      }

      // 課文內容
      if (currentSection === '課文' && line.trim() && !line.startsWith('##')) {
        dto.content = (dto.content || '') + line + '\n';
      }
    }

    // 最後一個生字
    if (currentVocab) {
      dto.vocabulary.push(currentVocab);
    }

    return dto;
  }
}
```

---

## 7. 資料庫設計

### 7.1 Lessons 表更新

```sql
-- 在既有的 lessons 表加入 Admin UI 需要的欄位

ALTER TABLE lessons ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'draft';
ALTER TABLE lessons ADD COLUMN IF NOT EXISTS updated_by VARCHAR(255);
ALTER TABLE lessons ADD COLUMN IF NOT EXISTS git_commit_hash VARCHAR(40);

CREATE INDEX idx_lessons_status ON lessons(status);

COMMENT ON COLUMN lessons.status IS 'draft | published';
COMMENT ON COLUMN lessons.updated_by IS '最後更新者 email';
COMMENT ON COLUMN lessons.git_commit_hash IS '對應的 Git Commit Hash';
```

---

## 8. 衝突處理

### 8.1 樂觀鎖定 (Optimistic Locking)

```typescript
// DTO 加入 version 欄位
export class UpdateLessonDto {
  version: number; // 前端傳入目前的版本號
  // ... 其他欄位
}

// Service 中檢查版本
async update(id: string, dto: UpdateLessonDto, user: Teacher) {
  const lesson = await this.prisma.lesson.findUnique({ where: { id } });

  if (lesson.version !== dto.version) {
    throw new ConflictException(
      '課程已被其他教師更新,請重新載入後再編輯'
    );
  }

  // 更新時遞增版本號
  return this.prisma.lesson.update({
    where: { id },
    data: {
      ...dto,
      version: lesson.version + 1,
      updated_by: user.email,
    },
  });
}
```

### 8.2 Git Merge Conflict 處理

```typescript
// GitService 中的 pushWithRetry 已處理基本衝突

// 如果衝突無法自動解決,回傳錯誤給前端
catch (error) {
  if (error.message.includes('CONFLICT')) {
    throw new ConflictException({
      message: '您的修改與其他教師的修改衝突',
      conflictingFiles: ['...'],
      suggestion: '請聯絡管理員協助解決',
    });
  }
}
```

---

## 9. 部署與測試

### 9.1 環境變數

```bash
# .env

# Git Repository
REPO_PATH=/var/repos/courses
GITHUB_REPO_URL=https://github.com/example-org/chinese-literacy-courses.git

# Database (既有)
DATABASE_URL=postgresql://user:pass@localhost:5432/literacy

# JWT (既有)
JWT_SECRET=your-secret-key
```

### 9.2 Docker Compose 更新

```yaml
# docker-compose.yml

services:
  app:
    image: literacy-platform:latest
    volumes:
      - git-repos:/var/repos # Git Repository 持久化
    environment:
      - REPO_PATH=/var/repos/courses
      - GITHUB_REPO_URL=${GITHUB_REPO_URL}
    # ... 其他設定

volumes:
  git-repos:
    driver: local
```

### 9.3 測試策略

#### Unit Tests

```typescript
// lessons.service.spec.ts

describe('LessonsService', () => {
  it('should convert DTO to Markdown correctly', () => {
    const dto = {
      title: '第一課',
      content: '<p>小明去<strong>動物園</strong></p>',
      vocabulary: [
        { character: '動', pinyin: 'dòng', definition: '活動' }
      ],
    };

    const markdown = service.toMarkdown(dto);

    expect(markdown).toContain('## 課文');
    expect(markdown).toContain('小明去**動物園**');
    expect(markdown).toContain('### 動 (dòng)');
  });
});
```

#### Integration Tests

```typescript
// lessons.controller.spec.ts

describe('LessonsController', () => {
  it('should update lesson and commit to Git', async () => {
    const dto = { title: '更新後的課程', content: '...' };

    const result = await controller.update('lesson-1', dto, mockUser);

    expect(result.title).toBe('更新後的課程');
    expect(gitService.commitFile).toHaveBeenCalledWith(
      expect.stringContaining('lesson-1.md'),
      expect.any(String),
      expect.stringContaining('更新課程'),
      mockUser.email,
    );
  });
});
```

#### E2E Tests

```typescript
// lessons.e2e-spec.ts

describe('Lessons API (e2e)', () => {
  it('should create, update, and fetch lesson', async () => {
    // 1. Create
    const createRes = await request(app.getHttpServer())
      .post('/api/lessons')
      .send({ title: '測試課程', grade: 1 })
      .expect(201);

    const lessonId = createRes.body.id;

    // 2. Update
    await request(app.getHttpServer())
      .put(`/api/lessons/${lessonId}`)
      .send({ title: '更新後的課程' })
      .expect(200);

    // 3. Fetch
    const getRes = await request(app.getHttpServer())
      .get(`/api/lessons/${lessonId}`)
      .expect(200);

    expect(getRes.body.title).toBe('更新後的課程');

    // 4. Verify Git commit
    const history = await gitService.getHistory(`courses/grade1/lesson-${lessonId}.md`);
    expect(history[0].message).toContain('更新課程');
  });
});
```

---

## 10. 開發時程

### Phase 1: MVP (5 天)

| 任務 | 時間 | 負責 |
|------|------|------|
| 後端 API 基礎 (CRUD) | 1 天 | 後端 |
| Git Service 實作 | 1 天 | 後端 |
| Markdown 轉換器 | 0.5 天 | 後端 |
| 前端課程列表頁面 | 1 天 | 前端 |
| 前端課程編輯頁面 (基礎) | 1.5 天 | 前端 |

**交付物**:
- ✅ 課程 CRUD API
- ✅ 基本編輯介面 (純文字,無 WYSIWYG)
- ✅ Git Commit 自動化

---

### Phase 2: UX 改善 (3 天)

| 任務 | 時間 | 負責 |
|------|------|------|
| TipTap WYSIWYG 編輯器 | 1 天 | 前端 |
| 生字編輯器組件 | 1 天 | 前端 |
| 自動儲存功能 | 0.5 天 | 前端 + 後端 |
| 草稿/發布狀態 | 0.5 天 | 後端 |

**交付物**:
- ✅ WYSIWYG 編輯器
- ✅ 友善的生字管理
- ✅ Auto-save

---

### Phase 3: 協作功能 (2 天)

| 任務 | 時間 | 負責 |
|------|------|------|
| 版本歷史頁面 | 1 天 | 前端 + 後端 |
| 版本比對 (Diff) | 0.5 天 | 後端 |
| 衝突偵測與提示 | 0.5 天 | 後端 |

**交付物**:
- ✅ 版本歷史檢視
- ✅ Diff 比對
- ✅ 衝突提示

---

### 測試與上線 (2 天)

| 任務 | 時間 | 負責 |
|------|------|------|
| Unit + Integration Tests | 1 天 | 後端 |
| E2E Tests (Playwright) | 0.5 天 | QA |
| 部署與驗證 | 0.5 天 | DevOps |

---

## 總計: 12 天 (2.5 週)

**人力需求**:
- 1 後端工程師 (3.5 天)
- 1 前端工程師 (5.5 天)
- 0.5 QA 工程師 (0.5 天)
- 0.5 DevOps 工程師 (0.5 天)

**成本**: $10,560 (@$110/hr × 8hr/day × 12 天)

---

## 🎯 總結

### 核心優勢

1. **保留 GitHub 優點** - 完整版本控制 + 零運營成本
2. **改善 UX** - 教師不需要學 Git
3. **漸進演進** - 從方案 A 自然升級
4. **成本可控** - 只開發必要功能

### 關鍵技術

```
TipTap WYSIWYG → HTML → Markdown Converter → Git Commit → GitHub
                                                              ↓
                                                          Webhook
                                                              ↓
                                            PostgreSQL ← Sync Service
```

### 下一步行動

- [ ] Review 本設計文件
- [ ] 確認技術棧選擇 (TipTap vs 其他)
- [ ] 建立開發環境
- [ ] 開始 Phase 1 開發

---

**Generated with [Claude Code](https://claude.ai/code) via [Happy](https://happy.engineering)**

Co-Authored-By: Claude <noreply@anthropic.com>
Co-Authored-By: Happy <yesreply@happy.engineering>
