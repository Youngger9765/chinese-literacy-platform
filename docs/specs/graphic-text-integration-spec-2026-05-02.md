# 圖文整合介面 Design Spec — 文圖左右並陳

**Issue**: #1341
**Priority**: P0 — 7/1 deadline 必含
**Date**: 2026-05-02
**Status**: Draft (pre-implementation, awaiting eng review)
**Refs**: 5/1 專家會議 §三.6、`docs/meetings/2026-05-01-experts-review.md`

---

## 1. Why（教學法理據）

### 1.1 紙本痛點
- 紙本圖文整合學習單**排版很長**（陳教授：「學習單會被拉得超長」）
- 學生在紙上**反覆翻頁**對應圖↔文 → 認知負荷高

### 1.2 數位機會
- 眼動研究（簡教授吳大猷獎）：**低成就學生完全不看圖**
- 教 25 分鐘圖文整合策略 → 眼動率 + 閱讀理解都顯著提升
- 結論：**數位介面要主動引導學生看圖**，不是被動讓學生選擇看不看

### 1.3 教授期望
> 「文圖左右並陳，可獨立滾動」 — 陳淑麗教授

→ **左右雙欄 + 各自獨立滾動 + 圖↔文錨點（可選）**

---

## 2. Scope（7/1 必達 vs 後續）

### 2.1 7/1 必達（單元 B 三課）
| Lesson | id | 圖數 | 字數 | 範例典型用例 |
|---|---|---|---|---|
| G7-L28 看不見的兇手 | 1108 | 8 | 717 | 科學實驗（巴斯德肉湯實驗）|
| G7-L29 四張圖看地球暖化 | 1109 | 10 | 923 | 折線圖 + 趨勢分析（4 張數據圖典型用例）|
| G7-L30 都是八哥為什麼命運不一樣 | 1110 | 7 | 840 | 對比表 + 物種比較 |

### 2.2 7/1 不做（後續）
- 圖↔文 highlight 連動（hover/click 圖時對應段落 highlight）
- 圖片標註（學生可在圖上畫圈/打點）
- AI 助教指圖功能（基於 #1340/#1387）
- 多年級擴展（其他年級的圖文課文也適用）

---

## 3. Architecture

### 3.1 元件樹
```
ReadingLayout (existing 11-step container)
└── ComprehensionChatStep (existing #1349 拆出來)
    └── GraphicTextLayout (NEW)              ← 新元件，僅在課文 has images > 0 時 render
        ├── LeftPane (course content)
        │   ├── StoryText (with paragraph anchors)
        │   └── (vertical scroll, independent)
        ├── DividerHandle (NEW)              ← 拖曳調整左右比例（optional, P1 可選）
        └── RightPane (image gallery)
            ├── ImageStrip (圖片縮圖列，sticky top)
            ├── ImageViewer (currently selected image, large)
            │   ├── ZoomControls
            │   └── (vertical scroll for tall images, independent)
            └── ImageCaption (字幕從 yml.images[i].caption)
```

### 3.2 Layout 規格

**Desktop (≥ 1024px)**
```
┌─────────────────────────────────────────────────────────────────┐
│  Header (StepperNav)                                             │
├─────────────────────────────┬───────────────────────────────────┤
│ Left Pane (50%, scrollable) │ Right Pane (50%, scrollable)      │
│ ─────────────────────────── │ ────────────────────────────────  │
│                             │ ┌───┬───┬───┬───┐                 │
│ 第一段：內容...               │ │圖1│圖2│圖3│圖4│ ← strip       │
│                             │ └───┴───┴───┴───┘                 │
│ 第二段：內容...               │ ┌─────────────────────┐           │
│                             │ │                     │           │
│ 第三段：內容...               │ │   圖 1 large view   │           │
│                             │ │   (auto-fit, zoom)  │           │
│ 第四段：內容...               │ │                     │           │
│                             │ └─────────────────────┘           │
│ ↕ scroll                    │ Caption: 圖 1 ：1850 年以來... ↕  │
└─────────────────────────────┴───────────────────────────────────┘
```

**Tablet (768px ~ 1023px)**
- Same layout，但左右各 ~50% width
- Image strip 橫向 swipe

**Mobile (< 768px)**
- **垂直堆疊**（fallback per Issue spec），不強制左右
- 圖片區域 collapsible（toggle button「展開圖片區」）
- Image viewer fullscreen modal on tap

### 3.3 Independent scroll 實作

```tsx
// frontend/src/components/reading-steps/GraphicTextLayout.tsx
<div className="grid grid-cols-1 lg:grid-cols-2 h-full">
  <div className="overflow-y-auto">  {/* Left independent scroll */}
    <StoryText paragraphs={lesson.paragraphs} />
  </div>
  <div className="overflow-y-auto">  {/* Right independent scroll */}
    <ImageGallery images={lesson.images} />
  </div>
</div>
```

關鍵 Tailwind class：`overflow-y-auto` + 各自父層 `h-full` → 互不影響。

### 3.4 Data flow

```
backend/data/lessons/_parsed_2026-05-01/G7-L28.yml
└── images: [{filename, size_bytes, image_hash, content_type, caption?}, ...]
    ↓
backend/app/routes/stories.py:get_story (existing)
    ↓ serializes images array in response
    ↓
frontend/src/services/api.ts:fetchStory
    ↓
LearningSession state.lesson.images
    ↓
GraphicTextLayout 條件 render：lesson.images.length > 0
```

**注意**：images 已經 commit 進 git（PR #1369 / #1361），URL pattern：
```
/data/lessons/images/G7-L28/G7-L28-01.png
```
→ 需在 `frontend/public/` 建 symlink 或 frontend serve 時 proxy 到 backend `/data/lessons/images/`。
**TODO**: 確認 backend serve image 路徑（grep `/data/lessons/images` in backend routes）。

---

## 4. Components 詳細 spec

### 4.1 `GraphicTextLayout.tsx`（NEW）

**Props**:
```ts
interface Props {
  lesson: Lesson;  // 含 images, paragraphs, story_text
  onImageSelect?: (idx: number) => void;  // 之後給 AI 助教用
}
```

**State**:
```ts
const [selectedImageIdx, setSelectedImageIdx] = useState(0);
const [leftScrollY, setLeftScrollY] = useState(0);  // 持久化 session
```

**渲染邏輯**:
- 若 `lesson.images.length === 0` → render fallback（純左欄，現有 ComprehensionChat）
- 否則 → 左右雙欄

### 4.2 `ImageStrip.tsx`（NEW）

縮圖列，sticky top，水平滾動。
- 點擊 → setSelectedImageIdx
- Highlight current selected
- Lazy load (loading="lazy")

### 4.3 `ImageViewer.tsx`（NEW）

放大顯示當前圖片：
- 圖片自動 `max-w-full max-h-[60vh] object-contain`
- 簡單 zoom：`+`/`−` 按鈕（react-zoom-pan-pinch lib，已有？確認）
- 圖名 + caption 在下方

### 4.4 ResponsiveBreakpoint hook（reuse existing 或新建）

```ts
const isMobile = useMediaQuery('(max-width: 767px)');
```

---

## 5. 整合進現有流程

### 5.1 Trigger 條件
```tsx
// In ComprehensionChat.tsx (existing)
{lesson.images && lesson.images.length > 0 ? (
  <GraphicTextLayout lesson={lesson} />
) : (
  <ExistingChatLayout lesson={lesson} />
)}
```

→ **不破壞** non-graphic 課文的現有體驗（57 Layer-1 + ~100 Layer-2 沒圖的課照舊）。

### 5.2 Step sequence

per #1374 schema-driven step composition，G7-L28~30 的 yml 應加：
```yaml
step_sequence:
  - introduction
  - reading-annotation
  - graphic-text-comprehension  # ← NEW step kind, 替換 comprehension-chat
  - vocab-practice
  ...
```

或：保留 `comprehension-chat` step name，但元件內部 detect images → branch render。**建議後者**（minimal change，#1374 step kind 不增）。

---

## 6. 風險 + 緩解

| Risk | 機率 | Impact | 緩解 |
|---|---|---|---|
| 大圖（G7-L29 圖二 188KB）載入慢 | High | Med | 加 lazy load + thumbnail strip 用 small WebP |
| Mobile 垂直堆疊 + 大圖 → 滾動體驗差 | Med | Med | Image collapse toggle，預設收起，學生 tap 展開 |
| 圖片 caption 沒抽出來 | High | Low | 7/1 demo G7-L28~30 手動補（3 課 × 8-10 圖 = 30 個 caption）|
| 圖↔文 highlight 連動不做 → 學生找不到對應 | Med | Med | 7/1 不做，但加段落編號（圖一→第 2 段...）by caption 補強 |
| 既有 ComprehensionChat 結構表 fill_blank 怎麼放？ | High | High | **見 §7 整合策略** |

---

## 7. 整合策略：圖文 + ComprehensionChat 結構表填空

**問題**：G7-L28 已有 6 行 `story_structure_table` (PSR 結構)，學生要填 fill_blank。但同時要看圖、文。怎麼布局？

**方案 A（推薦）**：左右雙欄 + 結構表浮層
```
┌──────────────────┬──────────────────┐
│ Left: 課文        │ Right: 圖區      │
└──────────────────┴──────────────────┘
   ↓ 學生點「題目」按鈕
┌──────────────────┬──────────────────┐
│ Left: 課文 (淡)   │ Right: 圖區 (淡) │
│   ┌──────────┐   │                  │
│   │ 題目浮層  │   │                  │
│   │ (Modal)  │   │                  │
│   └──────────┘   │                  │
└──────────────────┴──────────────────┘
```

**方案 B**：三欄
```
┌────────┬────────┬────────┐
│ 課文    │ 圖區    │ 題目    │
└────────┴────────┴────────┘
```
→ Mobile 垮（< 1280px 三欄太擠）。**Reject**.

**方案 C**：題目 inline 在左欄底部
```
┌──────────────────┬──────────────────┐
│ 課文              │ 圖區              │
│ ───              │                  │
│ 題目 (collapse)  │                  │
└──────────────────┴──────────────────┘
```
→ 學生答題時要往下滾，看不到課文。**Reject**.

**結論**：採方案 A — Modal 浮層題目，學生可隨時關閉看回課文/圖。

---

## 8. Implementation Plan

### Week 2-3 (5/9 ~ 5/22) per CEO doc

**Day 1-2**：
- 建 `GraphicTextLayout` 元件殼 + Tailwind grid
- 接 `lesson.images` data flow

**Day 3-4**：
- `ImageStrip` + `ImageViewer` + zoom
- Lazy load + responsive breakpoint

**Day 5**：
- 整合進 ComprehensionChat（圖數 > 0 條件 render）
- Mobile fallback 垂直堆疊

**Day 6**：
- 結構表填空 Modal（方案 A）
- E2E 測 G7-L28~30 三課

**Day 7**：
- 截圖驗證（desktop / tablet / mobile）
- 教授 review

---

## 9. Acceptance Criteria

- [ ] G7-L28~30 三課使用左右雙欄渲染
- [ ] 左右欄各自獨立滾動（測：滾左欄、右欄不動）
- [ ] 桌面 1024px+ 顯示左右並陳
- [ ] Tablet 768~1023px 顯示左右並陳（等比縮放）
- [ ] Mobile < 768px 垂直堆疊 + image collapse toggle
- [ ] 點 Image strip 縮圖切換 viewer 大圖
- [ ] 圖片可 zoom in/out（按鈕或 pinch）
- [ ] 結構表填空 Modal 浮層，可關閉
- [ ] 既有 non-graphic 課文（任何 lesson.images.length === 0）不受影響
- [ ] Lighthouse Performance ≥ 80（圖片 lazy load）

---

## 10. Open Questions（pre-impl 要釐清）

1. **圖片 caption 從哪來？** docx 抽出來的 yml `images[].caption` 大多空。需教授提供 3 課 × ~10 caption。
2. **圖片 served 路徑？** backend 是否有 `/data/lessons/images/{code}/...` route 或 frontend `public/lessons-images/` symlink？
3. **react-zoom-pan-pinch lib 已安裝？** 若無，要不要加？
4. **G7-L29 22 行 structure_table（per #1393）怎麼呈現？** 不適合放 Modal，建議 hide for G7-L29/30 + 用 AI 助教 prompt 替代。

---

## 11. Refs

- Issue #1341 — 本 spec 實作
- Issue #1387 — AI 助教 implementation（之後接圖文 context）
- Issue #1393 — G7-L29/L30 結構表呈現問題（影響 §7 設計）
- 5/1 會議記錄 §三.6
- CEO doc Week 2-3 plan
- PR #1369 / #1361 — 圖片 yml metadata 已抽
