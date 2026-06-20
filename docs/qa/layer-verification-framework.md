# Layer 驗證框架（L1–L5）— 全 platform 通用指南

> **目的**：讓每個 content / learning module（重點表、聚光燈、未來生字/聽寫…）用**同一套五層語言**描述「怎麼驗、merge 前跑什麼」，但**各自實作** gate，不硬合成一個巨型 QA 腳本  
> **關聯**：`specs/` 模組系統（#2029）、`docs/issue-2205-eval-standard.md`  
> **首個完整實作範例**：`docs/qa/story-structure-verification-standard.md`（重點表）

---

## 0. 核心設計原則（Merge Gate 哲學）

### 0.1 語言統一、契約分家、DOCX 合流、runtime 分流

```
                         DOCX / 其他源頭（可共源）
                                    │
                    run_lesson_pipeline.py 等（L1 build/eval 可合流）
                           ╱                    ╲
                  module A artifact          module B artifact
                  （例：keypoints.yml）       （例：.spotlight.yml）
                           │                    │
                  module A L2 gold             module B L2 gold
                  （例：keypoints_manifest）  （例：gold_manifest.json）
                           │                    │
                  module A API 契約            module B API 契約
                           │                    │
                  module A UI step             module B UI step
```

| 做法 | 判斷 |
|------|------|
| **L1–L5 名詞全 platform 共用** | ✅ 所有人都問同一組問題 |
| **每 module 自己的 L2 gold、L3 契約、ship gate 腳本** | ✅ artifact 與 API 不同，不可硬 merge |
| **DOCX batch 在 lesson pipeline 合流** | ✅ 同一源頭一次 build |
| **一個 `unified_qa.py` 驗全部 module 的全部不變式** | ❌ 會變成 if/else 地獄，#2273 假綠會再發生 |

### 0.2 三種文件，三種讀者（不要混用）

| 文件類型 | 格式 | 誰讀 | 做什麼 |
|----------|------|------|--------|
| **索引** | `specs/registry.yaml`（自動生成） | AI / CI | 小、便宜：module 擁有哪些路徑、pytest 在哪 |
| **人讀 spec** | `specs/modules/<module>/INTENT.md` | 人 + AI | **為什麼**、不變式、L-layer **對照表與命令**、教學脈絡 |
| **機器契約** | `backend/specs/test_*_spec.py` + gate 腳本 | pytest / CI | **真的擋 merge** 的 assert |
| **QA 產物（gold）** | `*.json` manifest / fingerprint | 程式比對 | L2 drift 檢查；**不是**人手改的上架內容 |

**為什麼 L-layer 對照表寫在 INTENT.md（Markdown）而不是 YAML？**

- frontmatter 已是 YAML（`owns_code`、`spec_tests` → `registry.yaml`）
- L-layer 表常含 prose（Tier 例外、#2273 假綠教訓、「這是設計不是 bug」）→ Markdown 適合
- 機器 enforcement 在 pytest / contract script；**把表改成 YAML 不會讓 CI 多跑一層**，除非另寫 orchestrator

詳細 module 標準可另開 `docs/qa/<module>-verification-standard.md`（重點表已這樣做）

### 0.3 gold / manifest 是什麼（不是全文標準答案）

**gold manifest** = 已驗收 baseline 的 **結構指紋快照**（regression anchor），用於 **L2**

| 特性 | 說明 |
|------|------|
| 格式 | 通常 JSON（程式生成、程式比對） |
| 比對 | fingerprint（計數、序列、統計）≠ 整檔 YAML byte diff |
| 能抓 | parser 回歸（block 類型序列變了、guide 被 flatten、MCQ 漏進聚光燈） |
| 不能抓 | 語意錯（passage source 標錯、answer 抓錯選項但結構沒變）→ 靠 L1 eval + 人眼 |

上架內容仍在上架 YAML（如 `.spotlight.yml`、lesson YAML 的 `story_structure_table`）

---

## 1. 五層 Gate 共通定義（L1–L5）

每個 module 在 `INTENT.md` 填「這五層各自用什麼工具」；**不強求每層語意與其他 module 相同**

| Gate | 共通問題 | 典型失敗代表 |
|------|----------|--------------|
| **L1** | 源頭 → schema 轉換正確嗎？ | DOCX 表格列漏抓、策略判錯 family |
| **L2** | Schema / gold ↔ 平台上架 artifact 同步嗎？ | manifest stale、fingerprint drift |
| **L3** | Loader / API 契約合法嗎？ | 欄位缺失、interaction 計數不一致、答案外洩 |
| **L4** | Staging（或 preview）API = local loader 嗎？ | deploy 後 API 缺欄位、環境不一致 |
| **L5** | Staging UI 可用且語意對嗎？ | 錯元件、redirect login、DOM 缺互動 |

**防假綠**：L3 綠但 L4/L5 紅 = 不可宣稱「上線可學」；Admin manifest 與 runtime 不一致 = 假綠（#2273）

---

## 2. 課程 Tier（決定跑哪些 Gate）

| Tier | 條件 | L1 | L2–L5 |
|------|------|-----|-------|
| `docx_backed` | 有 DOCX + checked-in schema | 必跑 | 依 module 有無 artifact / UI |
| `yaml_only` | 僅上架 YAML，無 private DOCX 在 CI | 跳過或本地跑 | L2–L3 必跑 |
| `runtime_only` | 純 DB / AI 生成，無 checked-in gold | 不適用 | 從 L3 或 L4 定義 |
| `parser_gap` | 已知 parser 缺口，documented | warn | L3 降級或 known_gap |

Tier 標在 module QA manifest 或 `lesson-schema-registry.yaml`

---

## 3. 新 module 立項 — 四問決策表

每新增一個 Layer flow，先填此表（可貼在 `specs/modules/<module>/INTENT.md` 頂部）

### Q1：資料從哪來？

| 答案 | L1 |
|------|-----|
| DOCX / 同一套 `build_lesson_schema.py` | 共用 `eval_lesson_schema.py` 框架 |
| DB / 使用者輸入 / 純 runtime | **不要假 L1**；從 L2 或 L3 定義 |

### Q2：上架 artifact 是什麼？（L2 驗誰 sync 誰）

| 答案 | L2 長相 |
|------|---------|
| 獨立 YAML（`.spotlight.yml`） | YAML ↔ `gold_manifest.json` fingerprint |
| 嵌在 lesson YAML 欄位 | intermediate schema ↔ parsed YAML ↔ QA manifest |
| 無 checked-in gold | registry snapshot；或標 `runtime_only` |

**注意**：L2 是「**canonical artifact ↔ 上架物**」，不是「跟 keypoints 同步」— 除非 module 本身就是 keypoints

### Q3：學生端靠哪條 API？（L3）

| 答案 | L3 放哪 |
|------|---------|
| `GET /api/stories/{id}` 某欄位 | loader 契約 + `test_*_spec.py` |
| 獨立 endpoint | 該 route spec + sanitize 規則 |
| 純前端 | schema 契約；L5 權重提高 |

**不同 module 的 L3 不變式可以完全不同**（例：重點表 `interaction_profile.fill_blank_count` vs 聚光燈 block graph）

### Q4：有沒有專屬 UI step？（L5）

| 答案 | L5 |
|------|-----|
| `/learn/{id}/<step>` | browse + `data-*` DOM profile + 代表課 |
| 嵌在共用 layout | 定錨點 + 冒煙集 |
| 無 UI / 僅老師端 | L5 = N/A 或 admin-only |

---

## 4. 新 module 必備交付物（Checklist）

建立 `specs/modules/<module>/` 時：

- [ ] `INTENT.md` — frontmatter + **L-layer 對照表** + 不變式 + 代表課
- [ ] `backend/specs/test_<module>_spec.py` — L3 機器契約
- [ ] （可選）`docs/qa/<module>-verification-standard.md` — 完整門檻與 Tier 細節
- [ ] （可選）`scripts/<module>_ship_gate.sh` 或 `scripts/<module>_qa.py` — 一鍵 L1–L5
- [ ] （可選）committed gold manifest — L2 fingerprint
- [ ] 更新 `specs/build_registry.py` 後跑 `python specs/build_registry.py`
- [ ] CI path filter 觸及相關檔案時跑 gate

### INTENT.md 建議章節（複製模板）

```markdown
> 人讀 SOT：`docs/qa/<module>-verification-standard.md`（若有）
> 機器契約：`backend/specs/test_<module>_spec.py`
> 通用框架：`docs/qa/layer-verification-framework.md`

## L-layer 對照

| Gate | 驗什麼 | 工具 / 命令 | Merge 阻擋 |
|------|--------|-------------|-----------|
| L1 | … | … | 是/否 |
| L2 | … | … | 是/否 |
| L3 | … | … | 是/否 |
| L4 | … | … | 是/否 |
| L5 | … | … | 是/否 |

## 代表課（冒煙，非抽樣代替全檢）

| 課 | story_id | 驗什麼 |
|----|----------|--------|

## 不變式

### I-1: …

## 明確不在本 module
```

---

## 5. 現有 module 對照（參考實作）

### 5.1 文章重點表（story-structure）

| Gate | 實作 |
|------|------|
| L1 | `eval_lesson_schema.py` — keypoints：`row_recall`、`blank_recall` |
| L2 | `keypoints_table_sync` + `keypoints_manifest.json` + snapshots |
| L3 | `interaction_profile` 與 rows 一致；`test_yaml_first_structure.py` |
| L4 | `story_structure_qa.py --gates L4` — staging `GET /structure` |
| L5 | `story_structure_qa.py --gates L5` — browse + DOM profile |

- 人讀：`specs/modules/story-structure/INTENT.md`
- 詳標：`docs/qa/story-structure-verification-standard.md`
- 一鍵：`bash scripts/story_structure_ship_gate.sh`

### 5.2 閱讀聚光燈 v2（spotlight_v2）

| Gate | 實作 |
|------|------|
| L1 | `eval_lesson_schema.py --dev` / `--test` — spotlight：`answer_recall`、`mcq_leakage`、`guide_retained` |
| L2 | `.spotlight.yml` ↔ `gold_manifest.json` fingerprint（dev7 / test15） |
| L3 | `test_spotlight_v2_spec.py` + loader `spotlight_v2` on story dict |
| L4 | staging/preview `GET /api/stories/{id}` — `spotlight_v2` 與 local 一致 |
| L5 | browse `/learn/{id}/reading-strategy` — `BlockSequenceRenderer` |

- 人讀：`specs/modules/spotlight_v2/INTENT.md`
- 指標：`docs/issue-2205-eval-standard.md` §2
- 一鍵：`bash scripts/run_spotlight_dev_gate.sh`
- 人眼：`.claude/skills/qa-spotlight/SKILL.md`

**與重點表關係**：同一 DOCX 可同時產 keypoints + spotlight（`run_lesson_pipeline.py`），但 **L2/L3 分開驗**，merge 時兩個 gate 各自要綠

---

## 6. Merge 前建議流程

### 6.1 改某 module 的 code / data

```
1. specs/registry.yaml → 找到 module
2. 讀 specs/modules/<module>/INTENT.md（L-layer 表）
3. 改 code / data
4. 跑該 module ship gate + pytest spec
5. 若動 L2 gold → 刻意更新 manifest 並在 PR 說明原因
6. 有 UI → L5 browse 代表課（不可只 curl API）
```

### 6.2 改 DOCX pipeline（`build_lesson_schema.py`）

```
1. overfit lint（#2205 §4）
2. eval DEV + TEST set 分開報告
3. 受影響 module 的 L2 manifest 全部重算
4. 各 module ship gate
```

### 6.3 一課端到端（可選編排）

```bash
# 單課：assess → build → eval → qa-gate → registry
python3 scripts/run_lesson_pipeline.py <lesson_id> <docx_path>

# 各 module 一鍵（依改動範圍選跑）
bash scripts/story_structure_ship_gate.sh
bash scripts/run_spotlight_dev_gate.sh
```

---

## 7. 反模式（禁止）

| 反模式 | 為什麼 |
|--------|--------|
| 只跑 L3 pytest 就說「可上線」 | L4/L5 未驗 |
| Admin manifest 過期仍 merge | #2273 假綠 |
| 把聚光燈 L2 改成「跟 keypoints sync」 | 不同 artifact，邏輯錯 |
| 整檔 YAML byte diff 當 L2 | 噪音大；應 fingerprint + L1 語意 |
| 新 module 不建 INTENT，只寫 code | 下個 AI / intern 重發明 gate |
| 為 orchestrator 把 INTENT 全改成 YAML | prose 教訓會消失；應另建 `verification.yaml`（未來） |

---

## 8. 未來擴充（Phase B，非現在必做）

當 ≥3 個 module 都有 L-layer 表後，可再加：

- `scripts/lesson_content_ship_gate.sh` — 依課 ID 列出要跑哪些 module gate
- `specs/modules/<module>/verification.yaml` — **僅**給編排器讀的 command list（不取代 INTENT）
- 共用 L4/L5 runner（staging URL + 懶人登入 + JSON report）

**現階段**：通用框架 + 各 module INTENT 對照表已足夠

---

## 9. 相關文件

| 文件 | 用途 |
|------|------|
| `specs/README.md` | 模組 spec 系統總覽 |
| `docs/issue-2205-eval-standard.md` | DOCX pipeline 量化指標 |
| `docs/qa/story-structure-verification-standard.md` | 重點表 L1–L5 詳標 |
| `specs/modules/story-structure/INTENT.md` | 重點表 module SOT |
| `specs/modules/spotlight_v2/INTENT.md` | 聚光燈 module SOT |
| `scripts/run_lesson_pipeline.py` | 單課 DOCX pipeline 編排 |

---

*Last updated: 2026-06-20 · Owner: Young · Issues: #2029, #2205, #2273*
