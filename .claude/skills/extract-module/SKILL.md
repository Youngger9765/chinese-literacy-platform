---
name: extract-module
description: 抽單一模組的骨架 skill —— 照派工單只讀自己那幾頁、只產自己那一份 yml、輸出必須通過自己的 schema。取代 extract-lesson-multimodal 的第 ④ 步（一次抽全部）。當需要「抽某個模組」「照派工單抽」「拆模組 skill」「重抽某一節」時使用。來源 issue #2843。
---

# extract-module — 派出去的那架飛機

> ⚠️ **先讀 `.claude/skills/ai-lesson-extract/SKILL.md`**（@stgst 2026-07 寫的）。
> 那支已經把「AI 自判題意但答案要鎖進可機器判分的契約」整套想通了，
> 下面 §2 的答案紀律**直接沿用它的**，不是重新發明。
>
> 8 月二修另寫了 `extract-lesson-multimodal`，沒有沿用它 —— 那是重造，
> 這份骨架把它的紀律收回來。

## 1. 它取代的是什麼

`extract-lesson-multimodal` 扛八個步驟，其中 **④ 逐頁讀 PDF 抽全部** 是
「一個 skill 打遍天下」的所在，也是東漏西漏的來源。

```
①定位  ②DOCX→PDF  ③抽XML  ④主抽取  ⑤讀總表  ⑥產truth  ⑦三道門  ⑧產diff
                            ↑ 只有這一步要拆
```

拆完之後：

```
航母（extract-lesson-multimodal 降級）
  ①②③⑤⑧ 留著 —— 定位、轉檔、抽 XML、讀總表、產 diff 本來就該共用
  ④ → 讀 _manifest.yml 的 dispatch，逐一派 extract-<module>
                                       ↓
                          每架飛機只讀自己那幾頁、只產自己那一份 yml
```

⛔ **不是**多做一支 skill 放旁邊。④ 要真的被取代，否則兩套抽取並行比現在更糟。

| | 一次抽全部 | 逐模組抽 |
|---|---|---|
| 一次要記住的事 | 24 種模組的規則 | 1 種 |
| 漏抽的症狀 | truth.yml 少一段，要人比對才發現 | 該模組 yml 沒產出 → **對帳門直接指名** |
| token | 全份 × 1 | **自己那幾頁 × N** |

最後一列是拆分能成立的關鍵：派工單帶 `pages`。**沒有派工單就不該拆**，成本會乘上去。

---

## 2. 答案紀律（沿用 `ai-lesson-extract`，這是最重要的一段）

### 2.1 答案不變量 —— 鐵律，`custom` 也不豁免

每一個要學生作答的東西都必須帶：

```
answer_space  ∈ choice / multi_choice / text / order / free_text
answer        = 可機器比對的標準答案（int 索引、list[int]、字串、dict{blank_id: fill}…）
grader        ∈ exact / set / ordered / rubric_ai / manual（且 space ↔ grader 要相容）
```

⛔ **散文不算答案。**

判斷不出正解 → `answer` 可為 null **但必須 `needs_review: true`**。
**寧 🟡 不假 🟢。**

### 2.2 🔴 答案不只用來判分，也用來還原進度

@stgst 在他那支寫下的一句話，今天（#2839）才知道有多重要：

> 學生重整頁面後，渲染器會用 `select` / `multi_select` 的機器索引**重算並還原**每步判分，
> `free_text` 步驟則用 `reference_answer` 做離線近似。

所以機器可判分步驟的 `answer` 必須**正確**，`free_text` 務必附 `reference_answer` ——
否則重整後無法還原。#2839 的病根之一就在這裡。

### 2.3 先判「答案是什麼形狀」，再選契約機制

⛔ **不要用策略的名字去對映題型** —— 策略名 ≠ 呈現型別。
同一種策略在不同學習單可能是填空、表格或申論。

| 紙上的作答形狀 | 機制 | 答案 |
|---|---|---|
| 有給選項 / □ 勾一個 | step `select` | int 索引 |
| □ 可複選 | step `multi_select` | list[int] |
| 單一確定填空（紙上**沒給**選項） | `free_text` + `reference_answer` ⛔ **不要自己捏造選項變成選擇題** | null（rubric） |
| 開放推論 / 申論 | `free_text` + `reference_answer` —— rubric **就是**它的機制，**不是** needs_review | null（rubric） |
| 每格都是答案的表格 | `keypoints_table` | dict{代號: 值}，exact |
| 畫線 / 圈詞這類**紙本動作** | 改寫 prompt 成數位可作答 + `free_text` | null（rubric） |
| **主觀自評 / 後設反思** | ⛔ **範圍外，不做** | — |
| 真的判不出形狀 | `custom` + `needs_review: true` | — |

**主觀自評為什麼一定不做**（@stgst 的原話，值得整段留著）：

> 這類清單**最容易讓 skill 不穩定**：硬給它標準答案（如「四項全勾」）= 造假客觀性（錯）；
> 塞成 `custom` + manual grader = 前端無法判分、卡住完成閘（也錯）。
> **唯一穩定解 = 不做它。**

**紙本動作要改寫**：數位版學生無法在課文上畫線。
「把第 X 段要看圖的地方**畫線**」→「找出第 X 段要你看圖的**那句話，寫下來**」。
⛔ 不要保留學生做不到的字眼。

---

## 3. 介面契約（每一支 extract-\<module\> 都長這樣）

```yaml
輸入:
  lesson_uid   L0153
  source_pdf   航母轉好的 PDF（不自己轉）
  pages        [3, 4]   ← 來自 _manifest.yml，只讀這幾頁
  module       key_reading
  schema       specs/modules/schemas/key_reading.schema.json

輸出:
  backend/data/lessons/<uid>/v3/<module>.yml    ← 恰好一個檔

失敗:
  status: BLOCKED / PARTIAL + reason
  ⛔ 不產半套、不猜、不 fallback 到別課或舊版
```

### 三條鐵律

**1. 只讀 `pages` 指定的頁。** 讀全份就退回航母模式，成本乘 N。
   指定頁找不到 → 回 `BLOCKED` 說「manifest 說在第 3 頁但那裡沒有」。
   ⛔ **不要自己去翻別頁** —— 那是 manifest 錯了，要修 manifest 不是繞過它。

**2. 輸出必須通過自己的 schema**，產完立刻自驗：

```bash
python3 -c "
import json,yaml,sys
s=json.load(open('specs/modules/schemas/$MODULE.schema.json'))
d=yaml.safe_load(open('$OUT')); body=d.get('$MODULE', d)
extra=set(body)-set(s['properties']); missing=set(s['required'])-set(body)
print('未宣告欄位:', extra or '無'); print('缺必填:', missing or '無')
sys.exit(1 if (extra or missing) else 0)"
```

⛔ **不准為了過門發明欄位名。** 需要新欄位是先改 schema 並在 PR 說明，不是偷偷加 ——
那正是 597 種 key-shape 的成因。

**3. 註解寫進 `notes: {}`**，不要開新 top-level key。
   每課發明一個 `char_count_note` 就是形狀爆炸的來源（#2843 收攏過一次，別長回來）。

---

## 4. 不要重抄 loader 會灌的東西（@stgst 的分工原則）

他那支寫得很清楚：**課文段落 text 與圖片 asset 由 loader 從權威來源灌入**，
skill 只負責骨架。

- **段落**：放與權威來源**相同數量、相同順序**的 block，text 直接複製。
  ⛔ 不要逐字重打 PDF —— 段數不符 loader 會跳過灌入，就回到你抄的版本
- **圖**：`asset` 抄權威來源的 filename，⛔ 不要去挑本機 `backend/data/images/`
  （那份編號與 GCS 不同，曾害人把對的值改成 404）
- ⚠️ **認圖看內容不看編號** —— `images[i]` 可能夾雜 QR code，位置對應不可靠。
  對不上就 `needs_review`，別硬指一個編號

---

## 5. 怎麼新增一支

1. 複製這份骨架到 `.claude/skills/extract-<module>/SKILL.md`
2. **只寫那個模組專屬的 know-how**。⛔ 骨架部分不要複製貼上 ——
   寫出來若跟隔壁 90% 一樣，是這份骨架沒抽乾淨，回頭改這裡
3. 確認 `specs/modules/section-to-module.yml` 有對應的大題名
4. 跑對帳門：`python3 scripts/module_reconcile_gate.py --uid <uid>`

### 各模組該寫什麼（示意，實際從真實錯誤長出來）

| 模組 | 專屬知識 |
|---|---|
| `key_reading` | 教授用 ☞ 標**起點**，終點是段落結束不是文章結束（#2712 成因） |
| `vocab_definitions` | 語詞框在題目上方，`items.word` 要對得回 `vocabulary_bank` |
| `comprehension` | 答案載體三種：文字層 ☑、紅色圖形、沒框=答案 |
| `classical_text` | 斷詞點 `.` 不是標點，抄進 yml 要保留 |

---

## 6. 收尾自驗（沿用 `ai-lesson-extract` 的四問）

1. schema 過（§3 鐵律 2）
2. 對帳門 exit 0
3. **紅綠燈誠實**：可驗證的 🟢、需人審的 🟡（`needs_review > 0`），⛔ 不可假 🟢
4. **逐題自問「答這題需要的材料，學生在畫面上都拿得到嗎」** ——
   引用的短文/圖/表有沒有漏（尤其不在課文裡的補充短文）、有沒有同段文字重複兩次

⛔ **禁止把特定課的逐字答案寫進 SKILL / few-shot**（`scripts/lint_prompt_overfit.py` 會掃）。

---

## 7. 現況

**一支都還沒寫。** 這份是骨架與契約。

前置齊了：派工單 174 份、schema 24 份、對帳門、以及 `ai-lesson-extract` 的答案紀律。
**缺的就是飛機本身。**

第一支建議 `vocab_definitions`(150 課) 或 `comprehension`(172 課)。
⛔ 不能選 `spotlight` / `keypoints`（@stgst）、`key_reading`（@if-else-master）。

⚠️ 第一支寫完**不要馬上擴到 24 支** —— 先確認骨架可複用
（第二支寫出來，專屬 know-how 以外應該幾乎不用重寫）。一次寫 24 支的風險是 24 份一起錯。
