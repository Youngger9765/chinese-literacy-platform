---
name: qa-spotlight
description: 對一課已產出的聚光燈 schema 跑量化 eval + 人眼抽審。當需要「qa 聚光燈」「驗證聚光燈 schema」「spotlight qa」「確認聚光燈品質」「check spotlight」時使用。依賴 docs/issue-2205-eval-standard.md 的 PASS 門檻，不重發明指標。L-layer 框架見 docs/qa/layer-verification-framework.md §5.2。
---

# qa-spotlight — 聚光燈 schema 品質驗證

> **L-layer 對照**（L1–L5 全 platform 框架）：`docs/qa/layer-verification-framework.md` §5.2  
> **Module SOT**：`specs/modules/spotlight_v2/INTENT.md`

對一課 `build-spotlight` 產出的 `.spotlight.yml` 做**量化 eval + 人眼抽審**。
兩步缺一不可：auto-eval 抓數字，人眼抓語意錯誤。

## 前置條件

- `scripts/build_lesson_schema.py` 已跑完，產出 `private/curriculum-source/_online-schema/<lesson_id>.spotlight.yml`
- `scripts/eval_lesson_schema.py` 存在（PR #2210 fixes 已 cherry-pick 入 staging）
- raw DOCX 可取得（gitignored，在 `private/curriculum-source/2026-05-01/` 下）

## 程序

### 1. 跑 auto-eval（量化指標）

```bash
# 單課 eval
python3 scripts/eval_lesson_schema.py \
  <lesson_id> <docx_path> \
  --schema-dir private/curriculum-source/_online-schema/

# 範例
python3 scripts/eval_lesson_schema.py \
  G6-L22 \
  "private/curriculum-source/2026-05-01/自學教材兩個單元/G6-L22小兵立大功：雞鳴狗盜的故事（摘要策略-問題.解決.結果結構）.docx" \
  --schema-dir private/curriculum-source/_online-schema/
```

### 2. 解讀指標（PASS 門檻來自 docs/issue-2205-eval-standard.md §2）

| 指標 | 門檻 | 說明 |
|------|------|------|
| `answer_recall` | == 1.0 | 所有 single/multi 都有 answer；抓不到的已標 null |
| `mcq_leakage` | == 0 | 閱讀理解 5 題 MCQ 不能混入聚光燈 |
| `guide_retained` | true | 至少 1 個 guide block；教學脈絡不能丟 |

**PASS = 以上三條全滿足。** 其餘指標（guide_count、figure_asset_recall、null_count）為診斷用，不是 gate。

如果有 null_answers 清單，列出來讓人工補正解。

### 3. 跑 overfit lint（每次必跑，改 build_lesson_schema.py 後尤其重要）

```bash
python3 -c "
import sys; sys.path.insert(0, '.')
import importlib.util, pathlib
spec = importlib.util.spec_from_file_location('ev', 'scripts/eval_lesson_schema.py')
ev = importlib.util.module_from_spec(spec); spec.loader.exec_module(ev)
r = ev.overfit_lint(pathlib.Path('scripts/build_lesson_schema.py'))
print(r)
"
```

**必須 PASS。** overfit lint 偵測 `build_lesson_schema.py` 的 detector 邏輯裡是否含硬編課號（G6-L22 等）或課文專有名詞（孟嘗君/白鯨/八哥/雞鳴狗盜）。任何 FAIL = 規則過擬，必須重構成通用條件。

### 4. 人眼抽審 checklist（auto-eval 量不到的語意正確性）

打開 `private/curriculum-source/_online-schema/<lesson_id>.spotlight.yml`，對照 raw DOCX 逐項檢查：

#### A. passage 正確性（最常出問題）
- [ ] `source: supplementary` 的段落真的是插入小文本（如孟嘗君/大象故事），不是本課課文
- [ ] `source: lesson_text` 的段落確實來自本課課文，段落號正確
- [ ] passage 文字沒有 garbled（斷字、合併格串接錯）

#### B. answer 正確性
- [ ] 抽查 3 個 single/multi block：answer 對應 DOCX 裡無 □ 或有標色的選項
- [ ] 如有 `answer: null`，DOCX 原檔確實沒有明確標示答案（而非抽取漏掉）

#### C. guide 教學脈絡
- [ ] 第一個 guide block 保留教授最在意的策略說明文字（「我們可以這樣思考…」「小祕訣…」等）
- [ ] 沒有 guide 被誤標為 passage 或 free_text

#### D. figure 綁定（圖文整合課必查）
- [ ] figure block 的 `bind_paragraph` 有填（非空），且對應正確段落
- [ ] `asset` 欄位有值（非空），指向正確的圖片/表格

#### E. 邊界正確性
- [ ] 固定 scaffold（計時、我的表現、詞語解釋表）沒有混入 blocks
- [ ] 閱讀理解 5 題 MCQ（`（X）1.` 格式）沒有混入 spotlight blocks

### 5. 自測驗收（兩課必跑）

```bash
python3 scripts/eval_lesson_schema.py --dev
```

期望輸出（參考 docs/issue-2210-coverage-report.md §1）：
- DEV spotlight：教授七課全 PASS（SP adjusted 95.2% across 151 courses）
- generalization_gap ≤ 0.15（DEV - TEST pass rate）

## Ship gate（PR / 宣稱 pass 前必過 — #2397）

per-lesson auto-eval + 人眼抽審只是課級檢查。要宣稱「聚光燈這批 ship 得了」**還要過全平台 content evidence gate（fail-closed）**：

```bash
python scripts/content_evidence_gate.py --run-id <id>
bash   scripts/content_evidence_ship_gate.sh --run-id <id>   # 須印 CONTENT_EVIDENCE_GATE=PASS
```

只認 evidence 檔（`fail_cells=0` + `unknown_cells=0` + `figure_blacklist_hits=0`），口頭/單課過關不算。真缺口登 `content_known_gaps.yaml` 標 known_gap（誠實，非 pass）。

## 反模式

- ❌ 只看 auto-eval 數字就算過——語意錯誤（passage source 標錯、answer 抓錯選項）auto-eval 量不到
- ❌ 為了過關放寬分母（把「無聚光燈課次」算入 PASS）——依 docs/issue-2205-eval-standard.md §4 定義 adjusted rate
- ❌ overfit lint FAIL 但繼續跑——lint FAIL = 規則不通用，eval 數字不可信
- ❌ 跳過人眼抽審——上線後教授會看到語意錯誤
- ❌ 把 eval 邏輯複製進 SKILL——引用 eval_lesson_schema.py，不重複
- ❌ 憑單課 eval pass 就宣稱整批 ship——要過 content evidence ship-gate
- ❌ 把真缺口（無聚光燈/合成 figN 未上傳）fake 成 pass——登 content_known_gaps.yaml
