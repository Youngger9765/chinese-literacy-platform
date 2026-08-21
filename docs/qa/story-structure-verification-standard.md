# 文章重點表 QA 標準（三層契約）

## 0. Merge Gate（必做 — 防假綠）

動到 **cell parser / stories structure / lesson YAML `story_structure_table` / QA lib** 時，merge 前必跑：

```bash
# 有 private schema 時（完整重建 + 驗證）
bash scripts/story_structure_ship_gate.sh --rebuild

# CI / 無 private schema（驗證 committed manifest 是否跟 runtime 一致）
bash scripts/story_structure_ship_gate.sh
```

| 步驟 | 做什麼 | 失敗代表 |
|------|--------|----------|
| 1 | `build_keypoints_qa_manifest.py --all` | manifest / snapshot 過期 |
| 2 | `keypoints_manifest_verify.py` | 儀表板會跟學生端不一致（假綠） |
| 3 | pytest manifest + story-structure contracts | 契約回歸 |

**CI**：`.github/workflows/keypoints-manifest-gate.yml` — PR 觸及相關路徑時自動跑，**不需要** private schema

**禁止**：只 merge parser fix、不重跑 manifest（#2273 教訓：G7-L6 儀表板仍 `display_only` 假綠）

---

對齊架構：

```
DOCX / keypoints.yml → story_structure_table → rows + interactive_type + layout
        ↓
GET /structure + interaction_profile
        ↓
storyStructureProfile.ts → demo/coach/DOM
        ↓
StoryStructureTable + ComprehensionLayout
```

**原則**：版面與互動正確性驗 **資料層 + API 契約**；示範文案與 coach 步驟驗 **前端 profile 單測**，不全掃硬編 PSR 文案。

---

## 1. 每課分級（Tier）

| Tier | 條件 | 課數（約） |
|------|------|-----------|
| `docx_keypoints` | 有 `*.keypoints.yml` + YAML `story_structure_table` | 136 |
| `ai_fallback` | 僅 `story_structure_rows`（AI/checkbox 卡版） | 16 |
| `no_keypoints_docx` | DOCX 無填空式重點表（圖文/純表等） | 15 |
| `parser_gap` | 有 DOCX 表但 parser 未產 `interactive_type`（`PARSER_GAP_LESSONS`） | 0 |

`parser_gap` 課碼清單：`scripts/story_structure_qa_lib.py` → `PARSER_GAP_LESSONS`（#2273 後 G7-L6 已移出）

`G8-L13` / `G8-L14` 若 YAML 內 `□` 未進 `interactive_type: checkbox` → L3 **FAIL**（見 `count_checkbox_cells_in_table` gate）

---

## 2. 五層 Gate（每課依 Tier 套用）

| Gate | 名稱 | 工具 | 適用 Tier |
|------|------|------|-----------|
| **L1** | DOCX ↔ keypoints.yml | `eval_lesson_schema.py` | `docx_keypoints` |
| **L2** | keypoints.yml ↔ YAML sync | `keypoints_table_sync` fingerprint | `docx_keypoints` |
| **L3** | API 結構契約 | `_format_yaml_structure_table` + `interaction_profile` | 全部有 structure 的課 |
| **L4** | Staging API 一致 | `GET /structure` vs loader | 圖書館已上架課 |
| **L5** | Staging UI + DOM | browse + profile 驅動 DOM 檢查 | 圖書館已上架課 |

### L1 — DOCX（沿用 #2205）

| 指標 | 門檻 | 阻擋合併 |
|------|------|----------|
| `row_recall` | ≥ 0.95 | 是 |
| `blank_recall` | ≥ 0.95 | 是 |
| `nesting_preserved` | true | 是 |
| `label_family_correct` | true | **是** |

> **B4 修正（2026-08-14）**：`label_family_correct` 過去在這裡標「否（僅
> warn）」，但 code SOT（`scripts/eval_lesson_schema.py:345-350` 的
> `passed = row_recall>=0.95 and blank_recall>=0.95 and nesting_preserved and
> label_family_correct`）從一開始就把它當硬 gate，從未只是 warn。此表與
> `docs/issue-2205-eval-standard.md`（曾寫 `row_recall == 1.0`）兩份互相矛盾
> 且都與實作不符 —— 已裁定**以 code 為準**，兩份文件同步更正。詳見
> `specs/modules/story-structure/INTENT.md` 的 B4 決議記錄。

### L2 — YAML sync

- `keypoints_to_table(kp)` fingerprint **==** on-disk `story_structure_table`
- 有 table 的課 **不得** 同時保留 `story_structure_rows`（AI 覆蓋）

### L3 — API / interaction_profile 契約

每份 structure（sanitize 後）必須：

| 檢查 | 規則 |
|------|------|
| `rows` | 非空 |
| `interactive_type` | 每列 ∈ `fill_blank` \| `checkbox` \| `display` |
| `interaction_profile.mode` | 與 rows 統計一致 |
| `interaction_profile.fill_blank_count` | == rows 內 `fill_blank` 數（含 sub_rows） |
| `interaction_profile.checkbox_count` | == rows 內 `checkbox` 數 |
| `interaction_profile.layout` | `worksheet_table` 若有 title/nested pair；否則 `cards` |
| 答案不外洩 | client `value` 無 `【 答案 】`（僅 `【　　　】`） |

**mode 期望（docx_keypoints）**：

| 情況 | 期望 mode |
|------|-----------|
| 有 `【】` 填空 | `fill_blank` 或 `mixed` |
| 僅勾選題 | `checkbox` |
| `parser_gap` | `display_only`（已知，不阻擋） |
| 其他 docx 有空白卻 `display_only` | **FAIL** |

### L4 — Staging API

- HTTP 200，`rows.length > 0`
- `interaction_profile` 與本地 loader 一致（layout / mode / counts）
- `docx_keypoints`：`layout` + `worksheet_rows` 與本地一致

### L5 — Staging UI（profile 驅動，**不用** `<tr>` 當唯一標準）

| mode | DOM 通過條件 |
|------|----------------|
| `display_only` | `[data-story-structure-table]` 存在；無載入錯誤 |
| `fill_blank` / `mixed` | 上 + `[data-story-structure-interactive]` 或填空 input |
| `checkbox` | 上 + `[data-story-structure-interactive]` 或 `input[type=checkbox]` |
| 全 mode | 無「無法載入」；未 redirect `/login` |
| 圖文課 G7-L28/29/30 | `[data-comprehension-lesson-text]` 存在 |

**不屬 L5**：demo 氣泡文案、`buildDemoSequence` 步驟數 → `storyStructureProfile` 單元測試

---

## 3. Eval / Testing 分工

| 層 | 自動化 | 命令 |
|----|--------|------|
| L1–L2 | `scripts/story_structure_qa.py --gates L1,L2` | 151 DOCX 課 |
| L3 | 同上 `--gates L3` + `pytest test_yaml_first_structure.py` | 165 loader |
| L4 | 同上 `--gates L4` | staging API |
| L5 | `scripts/story_structure_qa.py --gates L5` | staging UI |
| Demo/coach | `frontend` 單測（待補 `storyStructureProfile.test.ts`） | 不跑 165 全掃 |

**一鍵全檢**：

```bash
export QA_STUDENT_EMAIL='...'   # staging /login 學生懶人登入帳號
export QA_STUDENT_CRED='...'    # 舊名 QA_STUDENT_PASSWORD 仍相容
backend/.venv/bin/python scripts/story_structure_qa.py --all
```

報告：`private/curriculum-source/_online-schema/story_structure_qa_report.json`

---

## 4. 代表課回歸集（冒煙，非抽樣代替全檢）

| 課 | 驗什麼 |
|----|--------|
| G6-L22 | nested PSR + `worksheet_table` + `fill_blank` |
| G7-L28 | 科學探究 + 圖文 `data-comprehension-lesson-text` |
| G4-L1 | theme_facts + 多列紙本表 |
| G4-L6 | `ai_fallback` / `mixed` |
| G7-L6（catalog `G7-L06`） | `label_blanks` + `fill_blank`×5（#2273 cell parser） |

> **命名注意**：冒煙集用 **parsed** 課碼（DOCX batch id）。例如 parsed `G8-L13` = catalog `G8-L10`（構樹），不是 catalog `G8-L13`（告別方式）

完整 pinned 清單見 `scripts/story_structure_qa_lib.py` → `REPRESENTATIVE_LESSONS`
