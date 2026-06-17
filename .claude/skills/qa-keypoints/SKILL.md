---
name: qa-keypoints
description: 對一課已產出的重點表 schema 跑量化 eval + 人眼抽審。當需要「qa 重點表」「驗證重點表 schema」「keypoints qa」「確認重點表品質」「check keypoints」時使用。依賴 docs/issue-2205-eval-standard.md 的 PASS 門檻，不重發明指標。
---

# qa-keypoints — 重點表 schema 品質驗證

對一課 `build-keypoints` 產出的 `.keypoints.yml` 做**量化 eval + 人眼抽審**。
兩步缺一不可：auto-eval 抓數字，人眼抓語意錯誤。

## 前置條件

- `scripts/build_lesson_schema.py` 已跑完，產出 `private/curriculum-source/_online-schema/<lesson_id>.keypoints.yml`
- `scripts/eval_lesson_schema.py` 存在（PR #2210 P0/P1/P2 fixes 已 cherry-pick 入 staging）
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
  G7-L29 \
  "private/curriculum-source/2026-05-01/自學教材兩個單元/G7-L29四張圖看地球暖化（圖文整合閱讀策略）.docx" \
  --schema-dir private/curriculum-source/_online-schema/
```

### 2. 解讀指標（PASS 門檻來自 docs/issue-2205-eval-standard.md §1）

| 指標 | 門檻 | 說明 |
|------|------|------|
| `row_recall` | == 1.0 | schema 列數 = DOCX 表格實際資料列數（P0 fix 後正確計算） |
| `blank_recall` | == 1.0 | 每個 `【】` 都被抓到 |
| `cell_integrity` | true | 無合併格 value 串接錯亂 |
| `label_family_correct` | true | family 判對（摘要/敘事人物/比較/研究） |

**PASS = 以上四條全滿足。** 其餘指標（nesting_preserved、blank_answer_precision）為診斷用，不是硬 gate。

> **P0 注意**：`row_recall` 計算方式依 `structure` 欄位不同：
> - `structure: flat` + `columns: [label, value]` → 只算 `len(rows_out)`（不加 sub_rows）
> - `structure: nested` 或有 sub_label 欄位 → 算 `sum(1 + len(sub_rows))`
> 這個差異已在 eval_lesson_schema.py P0/P2 fix 處理，不要手動改公式。

### 3. 跑 overfit lint（每次必跑）

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

打開 `private/curriculum-source/_online-schema/<lesson_id>.keypoints.yml`，對照 raw DOCX 逐項檢查：

#### A. 列數與層級
- [ ] 表格列數 = DOCX 實際資料列數（注意：title row 和 header row 不算）
- [ ] nested 結構有還原：解決 下的 問題1/解決1/結果1 不可攤平
- [ ] flat 結構：沒有被誤判為 nested（看 DOCX 是否真的只有一層）

#### B. 填空正確性
- [ ] 每個 `【】` 都對應一個 blank；沒有遺漏
- [ ] blank 的 `answer` 是否正確（抽查 3 個）
- [ ] `template` 文字中 `__` 位置與 DOCX 的空格位置一致
- [ ] label_blanks：有些課的 label 欄位本身就含 `【】`（如「睡眠的\n【好處】」），必須被抓到

#### C. 合併儲存格
- [ ] 合併的左欄 label 正確當父節點，沒有重複成多列
- [ ] value 沒有多 cell 文字串在一起錯亂

#### D. 段落定位型（部分課有）
- [ ] 如 DOCX 有「問題在第幾段」填空 → schema 有 `locate_paragraph: true` + 對應 blank

### 5. 自測驗收（兩課必跑）

```bash
python3 scripts/eval_lesson_schema.py --dev
```

期望輸出（參考 docs/issue-2210-coverage-report.md §1）：
- DEV keypoints：教授七課全 PASS
- KP PASS across 151 courses：134/136 = 98.5%（remaining 2 are known-gap NO_BRACKET filenames）
- generalization_gap ≤ 0.15

Known-gap 課次（不需修 — filename 無括號無法偵測 strategy）：`G4-L1`, `G9-L10`

## 反模式

- ❌ 只看 auto-eval 數字就算過——cell_integrity 是 bool，但語意錯亂不一定觸發它
- ❌ 為了過關放寬 row_recall 分子計算——P0/P2 fix 已正確處理 flat vs nested，不要再改
- ❌ overfit lint FAIL 但繼續跑——lint FAIL = 規則不通用，eval 數字不可信
- ❌ 跳過人眼抽審——nested 還原錯誤只有人眼才能抓到
- ❌ 把 eval 邏輯複製進 SKILL——引用 eval_lesson_schema.py，不重複
