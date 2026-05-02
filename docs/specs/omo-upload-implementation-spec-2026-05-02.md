# OMO 紙本拍照上傳 + AI 自動辨識批改 — Implementation Spec

**Status**: Draft v1 — pre-implementation, awaiting eng review
**Date**: 2026-05-02
**Priority**: P0 — 7/1 demo 主菜（Young 5/2 升級為「壓箱寶」）
**Owner**: Young + 隔壁工程師（待分配）
**Refs**: 5/1 expert meeting §四「OMO」（曾教授高度肯定）

---

## 0. TL;DR

教授拿一張學生剛寫完的 G6-L22 紙本學習單給 demo：
1. 開平台 → 點「OMO 上傳」→ 拍照
2. **AI 自動辨識「這是 G6-L22 小兵立大功」**（confidence 95%）→ 教授點確認
3. AI 抽出每個 fill_in_blank / MCQ 學生手寫答案
4. 平台跳「批改完成：17 題答對 14 題，3 題待加強」+ per-question 對錯 + 原圖標註
5. 教授說「哇」

**核心差異化**：學生不用先選課程，AI 從照片**自動辨識課程歸屬**。

---

## 1. Why（教學法 + 商業 leverage）

### 教學法
- 紙本書寫保留 — 體育班學生意志力較弱，紙本書寫真實感比螢幕點擊強（林校長 5/1 共識）
- 數位平台補紙本做不到 — 自動批改、班級數據聚合、跨課文模式分析
- **不重複做** — 學生在紙上已寫，平台不要要求他重打一次（曾教授 5/1：「不要做重複的事」）

### Demo wow factor
- 60 秒展示完成度 vs 學生跑 7-step 全流程要 15+ 分鐘
- AI 自動辨識課程 = 視覺化 AI 能力的最強示範
- 教授+校長最容易理解的 differentiator（紙本+AI 結合）

---

## 2. User Flow（Young 5/2 確認版）

```
學生在家寫紙本學習單 (15-30 min)
       │
       ▼
平台首頁 → 點「OMO 上傳紙本」
       │
       ▼
拍照（手機 capture or 平台 webcam）
       │ 多張支援：學習單可能 2-3 頁
       ▼
[Frontend] 顯示「上傳中... AI 辨識課程」(loading 3-5s)
       │
       ▼
[Backend] Vertex AI Vision OCR → title + story snippet
       │
       ▼
[Backend] Fuzzy match 158 課 yml `title` (Levenshtein/cosine) → top-3 candidates
       │
       ▼
[Frontend] 顯示「我猜這是 G6-L22 小兵立大功（95%）」
            + 「不是這課？選其他」 dropdown (top-3 candidates)
       │
       ▼ user 確認 / 改選
       │
       ▼
[Backend Job async] Vertex Vision + Gemini structured output
            input: 照片 + 該課 yml schema (fill_in_blank schema, MCQ schema)
            output: 每題學生答案 + AI 對標準答案的對錯
       │
       ▼
[寫入 DB] LearningSession.omo_upload = {
            lesson_id, image_urls (GCS),
            answers: [{question_id, student_answer, correct_answer, score, ai_confidence}],
            overall_score, ai_feedback
          }
       │
       ▼
[Frontend] 跳「批改結果」頁
            - 整體分數 + AI 鼓勵語
            - per-question 對錯 list（點任一題開放大原圖 + AI 抽到的答案）
            - 「我覺得 AI 抽錯」按鈕（學生 override，記下回 server 改善 prompt）
       │
       ▼
[教師後台 — 7/2+] 老師看到此學生 OMO 已批改
            - 開原圖
            - 修正 AI 抽錯的題目（教師批改 override）
            - 班級聚合：哪題大家錯最多
```

---

## 3. Architecture

### 3.1 Backend 元件

```
backend/app/services/
├── omo_service.py                    (NEW)
│   ├── identify_lesson_from_image() → top-3 candidates by title fuzzy match
│   ├── extract_answers_from_image() → per-question student answer + score
│   └── grade_omo_session()           → write to LearningSession.omo_upload
│
├── ai_omo_grading.py                 (NEW)
│   ├── Vertex Vision OCR wrapper
│   └── Gemini structured output for answer extraction
│
└── ai_service.py                     (existing) — reuse Gemini call infra

backend/app/routes/learning/
└── omo.py                            (NEW)
    ├── POST /api/omo/upload          → multi-image upload, returns identification
    ├── POST /api/omo/{session_id}/confirm  → user confirms lesson, triggers grading
    ├── GET  /api/omo/{session_id}    → grading result
    ├── PUT  /api/omo/{session_id}/answers/{qid}  → student/teacher override
    └── DELETE /api/omo/{session_id}  → student delete (privacy)

backend/app/models/learning.py
├── LearningSession (existing)
│   └── omo_upload: Optional[OMOUpload] = relationship 1:1
│
└── OMOUpload (NEW)                   → Alembic migration needed
    ├── id, learning_session_id (FK), lesson_id
    ├── image_urls: list[str]         → GCS signed URLs
    ├── identification: dict           → AI 辨識 top-3 + confidence
    ├── answers: dict (JSONB)         → per-question student answer + score
    ├── overall_score: float
    ├── ai_confidence: float
    ├── teacher_override: dict         → 老師批改修正
    ├── created_at, updated_at
    └── _source: "omo-upload-v1"

GCS bucket
├── lingoleap-omo-uploads (NEW, private)
│   └── {user_id}/{lesson_code}/{session_id}/{n}.jpg
└── Lifecycle: 90 天後自動刪除（隱私）
```

### 3.2 Frontend 元件

```
frontend/src/components/omo/
├── OMOUploadButton.tsx               (entry from home)
├── OMOCamera.tsx                     (capture multiple images)
│   └── <input type="file" accept="image/*" capture="environment" multiple>
├── OMOIdentifying.tsx                (loading + AI 辨識中)
├── OMOLessonConfirm.tsx              (top-3 candidates + confirm/reselect)
├── OMOGrading.tsx                    (loading + AI 批改中)
├── OMOResultPage.tsx                 (per-question result list)
├── OMOQuestionDetail.tsx             (modal: 原圖 + AI 抽到答案 + override button)
└── OMOOverrideButton.tsx             (學生說 AI 抽錯)

frontend/src/services/
└── omoApi.ts                         (API wrapper)

frontend/src/pages/
├── student/OMOHistory.tsx            (學生看自己過往 OMO 上傳)
└── teacher/OMOReview.tsx             (老師後台 — 7/2+)
```

### 3.3 AI 辨識邏輯

#### Lesson identification（拍照 → 候選課程）
```python
def identify_lesson_from_image(image_bytes: bytes) -> list[Candidate]:
    """
    1. Vertex AI Vision Document AI → extract text (focus on first 200 chars + headers)
    2. Extract candidate title patterns (often 大字 at top of worksheet)
    3. For each of 165 lessons, compute similarity:
       - title direct match (Levenshtein < 3) → confidence 95%
       - title contains 70% chars → confidence 85%
       - story_text first 100 chars match → confidence 80%
       - keyword overlap (vocabulary) → confidence 60%
    4. Return top-3 sorted by confidence
    """
```

**Failure cases**:
- 拍糊 / 文字 OCR 抓不到 title → 用 story_text snippet match
- 多課文相似 → top-3 都 confidence 低 → frontend 強制學生 dropdown 選

#### Answer extraction（拍照 + lesson yml schema → 每題答案）
```python
async def extract_answers_from_image(
    image_bytes: bytes, lesson_yml: dict
) -> list[QuestionAnswer]:
    """
    Strategy: Send image + structured schema to Gemini Pro Vision.
    
    Schema 從 lesson yml 構建：
      - fill_in_blank: 8 題 → 抽 8 個學生手寫答案
      - multiple_choice: 5 題 → 抽 5 個 A/B/C/D 選擇
      - self_check_items: 3-5 項 → 抽勾選狀態
    
    Prompt (structured):
      {
        "task": "extract_student_answers",
        "expected_answers": [
          {"id": "fb_1", "type": "fill_blank", "context": "孟嘗君求幸姬幫忙... 自己就【__】"},
          ...
        ],
        "image_layout_hint": "標準 LingoLeap 學習單 v1.0"
      }
    
    Output (Gemini Structured Output):
      [{question_id, student_answer, ai_confidence, position_x, position_y}]
    """
```

**Quality control**:
- Output 每題加 `ai_confidence` (0-1)
- < 0.7 → frontend mark as「AI 不確定，請確認」
- 學生 override → write back as ground truth + log for fine-tuning

---

## 4. Demo Flow（教授+校長現場 60 秒劇本）

### Setup（demo 前）
- 提前準備：1 張學生填寫完的 G6-L22 紙本學習單（清楚字跡、印刷紙本）
- 平台 demo 帳號（teacher role）
- 手機橫拿（拍清楚）

### Live demo
```
Second 0-5:    教授開平台 → 點「OMO 上傳紙本」按鈕
Second 5-10:   開手機相機 → 拍學習單第 1 張（封面 + title）
Second 10-15:  → 拍第 2 張（題目區）
Second 15-20:  → 點「上傳完成」
Second 20-25:  loading「AI 辨識課程中...」
Second 25-30:  顯示「我猜這是 G6-L22 小兵立大功（95%）」+ 教授點「確認」
Second 30-50:  loading「AI 批改中...」（這段最長，Gemini call ~15-20s）
Second 50-55:  跳結果頁：
                 「8 題填空答對 6 題，5 題選擇答對 4 題」
                 「整體分數 75 分，繼續加油！」
Second 55-60:  教授點某題 → 看到原圖 + AI 抽到的學生手寫答案
                 教授說「哇」
```

### 失敗 fallback
- 拍糊 → 平台說「照片不清楚，要重拍嗎？」
- AI 辨識錯誤 → 教授點「不是這課」 → dropdown 選正確課
- AI 抽錯答案 → 教授點「我覺得 AI 抽錯」 → 後台 log 改善

---

## 5. Schema（DB + API）

### 5.1 Alembic migration

```python
# backend/alembic/versions/XXXX_add_omo_upload.py
def upgrade():
    op.create_table(
        "omo_uploads",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("learning_session_id", sa.Integer, sa.ForeignKey("learning_sessions.id"), nullable=False, index=True),
        sa.Column("lesson_id", sa.Integer, nullable=False, index=True),
        sa.Column("image_urls", postgresql.JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("identification", postgresql.JSONB),  # top-3 candidates
        sa.Column("answers", postgresql.JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("overall_score", sa.Float),
        sa.Column("ai_confidence", sa.Float),
        sa.Column("teacher_override", postgresql.JSONB, server_default=sa.text("'{}'::jsonb")),
        sa.Column("status", sa.String(32), nullable=False, server_default="pending"),  # pending/identified/grading/done/error
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
    )
    op.create_index("idx_omo_lsid", "omo_uploads", ["learning_session_id"])
    op.create_index("idx_omo_lesson", "omo_uploads", ["lesson_id"])

def downgrade():
    op.drop_table("omo_uploads")
```

### 5.2 API schemas (Pydantic)

```python
class OMOUploadResponse(BaseModel):
    session_id: int
    status: Literal["pending", "identified", "grading", "done", "error"]
    candidates: list[LessonCandidate]  # top-3 with confidence

class LessonCandidate(BaseModel):
    lesson_id: int
    grade_code: str
    title: str
    confidence: float

class OMOConfirmRequest(BaseModel):
    confirmed_lesson_id: int

class OMOResult(BaseModel):
    session_id: int
    lesson: LessonSummary
    image_urls: list[str]  # signed URL, 1hr TTL
    answers: list[OMOAnswer]
    overall_score: float
    ai_feedback: str

class OMOAnswer(BaseModel):
    question_id: str
    question_type: Literal["fill_blank", "multiple_choice", "self_check"]
    student_answer: str
    correct_answer: str
    score: float  # 0-1
    ai_confidence: float
    teacher_override: Optional[dict] = None
```

---

## 6. Implementation Plan

### Phase 1: 基礎設施（5/3-5/7，4 天）— 這個 spec 之後接

**前置依賴**（agent 跑中 / 必須先完成）：
- [x] 7 課 yml `reading_strategy_type` + `layout_mode`（PR #1405 已 merged）
- [ ] 7 課 yml `fill_in_blank` + `paragraphs` 多段（agent 跑中，OMO 需要 ground truth schema）
- [ ] G7 vocabulary / reading_benchmark — 確認 docx 真的沒這 section（如有需另抽）

### Phase 2: Backend 骨架（5/8-5/14，1 週）

**Day 1-2**：
- Alembic migration `omo_uploads` 表
- `omo_service.py` skeleton
- `routes/learning/omo.py` 三 endpoint stub（upload / confirm / result）
- GCS bucket + service account 設定

**Day 3-4**：
- `identify_lesson_from_image()` 真實實作（Vertex Vision + fuzzy match）
- 沿用既有 ai_service Gemini call infra
- Unit test: 5 個 sample image → 確認 top-3 命中

**Day 5**：
- `extract_answers_from_image()`（Gemini Pro Vision + structured output）
- per-question schema construction from lesson yml
- Quality control: ai_confidence threshold

### Phase 3: Frontend（5/15-5/21，1 週）

**Day 1-2**：
- OMOUploadButton + OMOCamera multi-image
- 整合進 student home page

**Day 3-4**：
- OMOIdentifying / OMOLessonConfirm 流程
- OMOResultPage（per-question list + score）

**Day 5**：
- OMOQuestionDetail modal（原圖放大 + AI 答案 + override）
- 整合 + E2E

### Phase 4: Alpha + polish（5/22）

- 5 學生內部 alpha：3 個課文 × 5 學生 = 15 上傳測試
- AI 抽答案準確率測量（target ≥ 80%）
- bug fix + UI polish

### Phase 5: 教授 dry run（6/15）

教授+校長提前測 demo flow，feedback 進 prompt v2。

### Phase 6: 7/1 demo

正式 demo + 同 demo 也錄 video（萬一現場 demo 出包）。

---

## 7. Risks + Mitigations

| Risk | 機率 | Impact | 緩解 |
|---|---|---|---|
| Vision OCR 對手寫字準確率 < 80% | High | High | 1) demo 用清楚手寫 + 印刷混合 2) 學生 override button 必含 3) ai_confidence < 0.7 標 「AI 不確定」 |
| 拍照糊 / 角度歪 → OCR fail | Med | Med | frontend 加「拍照清晰度檢測」（圖片 brightness / blur score）、不清楚提示重拍 |
| 多張照片合併失敗 | Low | Med | 後端按上傳順序合併、client side preview |
| 學生隱私（手寫個資 + 照片）| High | High | GCS bucket 私有 + signed URL 1hr TTL + 90 天 auto delete + 學生可刪除 |
| AI 抽錯答案 demo 出包 | Med | High | 1) 老師後台 override 7/1 demo 必含 2) 預先用 demo 學習單測 5 次 3) demo 備用 video |
| Gemini cost 失控 | Low | Med | 每 session ≤ 1 次 Vision call + 1 次 Gemini structured ≈ NT$2，月 1500 學生 × 7 課 ≈ NT$2k/月 acceptable |
| 拍照 user permission 被拒 | Med | Low | 引導用戶開啟 + fallback 「我選現有檔案」上傳 |

---

## 8. Acceptance Criteria（7/1 demo gate）

- [ ] 7 課 OMO 拍照辨識率 ≥ 90%（top-1 命中）
- [ ] AI 抽答案準確率 ≥ 80%（fill_in_blank + MCQ 平均）
- [ ] 上傳→辨識→批改 e2e ≤ 60 秒
- [ ] 學生 override AI 抽答案的功能可用
- [ ] 學生看得到原圖 + AI 抽到答案 side-by-side
- [ ] GCS bucket 私有 + signed URL works
- [ ] 5 個 alpha 學生 e2e 跑通

### 7/1 demo 不必含
- 老師後台 OMO 批改（7/2+，等老師參與後再做）
- 班級聚合分析
- 跨課文模式偵測

---

## 9. Open Questions（pre-impl 釐清）

1. **OMO 學生需登入嗎？** 帳號歸屬學生 vs anonymous demo（demo 用無痕較快）
2. **單張學習單最大上傳張數？** 3 張？5 張？影響 GCS storage cost
3. **GCS bucket region？** asia-east1 同 Cloud Run，跨 region 流量費更貴
4. **手機 webcam vs 上傳檔案二選一？** 都支援的話誰先 default？建議手機 webcam 先（demo flow 順）
5. **AI 抽錯時學生改的 override → 是否寫回作為 prompt fine-tuning 訓練資料？** 第一版先記下不上 fine-tune

---

## 10. Refs

- 5/1 expert meeting `docs/meetings/2026-05-01-experts-review.md` §四 OMO
- CEO doc `docs/ceo-review-2026-05-02.md`（OMO 從 7/2+ 升 P0）
- 7 課 yml ground truth: `backend/data/lessons/_parsed_2026-05-01/G6-L22~25.yml`, `G7-L28~30.yml`
- Existing AI infra: `backend/app/services/ai_service.py` (Vertex AI Gemini)
- Strategy plugin pattern: `docs/architecture/strategy-step-plugin-pattern.md`（OMO 不依賴此）
