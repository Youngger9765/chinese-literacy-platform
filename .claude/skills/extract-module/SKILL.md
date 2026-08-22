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

> 🔴 **§2.1 對「模組自己已有既定形狀」的模組不適用**（#2865 裁決）。
> 例：`vocab_definitions` 的 `word` **就是** §2.1 講的 `answer`（space=text、grader=exact），
> ⛔ 不要另外生 `answer_space` / `grader` 三個欄位 —— 150 課、schema、既有資料全都沒有它們，
> 而 §3 鐵律 2 又說不准發明欄位名。**模組 skill 的形狀優先於這一節。**
> §2.1 管的是**新設計的作答型別**（如新的互動題），不是回頭改既有模組。

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

  ⚠️ **外層是固定的，schema 不管它**（#2865，第一次實跑才發現沒人寫過）：

  ```yaml
  lesson_uid: L0072      # 三個都要
  version_id: v3
  section_no: 三          # 這一節在學習單上的序號（漢字，見 test_section_no_is_hanzi_2843）
  <module>:              # ← schema 只驗這底下
    …
  ```

  ⛔ 少了外層會產出「裸 body」，而**四道門全部照樣綠** ——
  第一架飛機是偷看既有檔的鍵名才知道要包，真正的新課沒有既有檔可看。

失敗:
  status: BLOCKED / PARTIAL + reason
  ⛔ 不產半套、不猜、不 fallback 到別課或舊版
```

### 🔴 鐵律 0（在三條鐵律之前）：先確認手上這份 PDF 就是算頁碼的那份

```bash
python3 scripts/assert_pdf_matches_manifest.py --uid <uid> --pdf <轉好的 PDF>
# exit 0 才可以派工
```

派工單的 `pages` 是對**某一次** DOCX→PDF 轉檔算的，那份 PDF 早就不在了。
航母的 ② 是另一次獨立轉檔，而**兩次不保證一樣** —— 實測同一份 DOCX 連轉三次：

```
L0016 → 8, 9, 9 頁      L0013 → 11, 10, 11 頁
整份對比 172 課：7 課頁數不同、11 課共 33 個大題頁碼不同
L0016 從第 3 頁起每一節整體位移一頁（語詞我最棒 [3] → [4]）
```

⛔ **最糟的不是會錯，是不會喊**：span 含下一節的起始頁，位移一頁通常仍有重疊，
飛機會找到自己那一節的**一部分**、然後回報成功。靜默截斷，五條鎖沒有一條看得到。

### 🔴 版面陷阱（跑 30 課真課撞出來的，每一個都不會有症狀）

抽的時候會遇到，判斷邊界時要記得：

| 陷阱 | 實例 | 為什麼危險 |
|---|---|---|
| 同一份 DOCX 轉兩次，標題會變 | `三 語詞我最棒` → `三 🅐 語詞我最棒` | 兩份都是 8 頁，⑤ 放行 |
| 題號兩種寫法 | `(1) 質疑：…` vs `（ A ）1. 下列…` | 只認一種，整節數到 0 |
| 標題被拆成兩行 | 第 19 行只有「七」，名稱在第 21 行 | 中間那行是**別欄的內文** |
| 續頁的題排在下一個標題**之後** | L0022 p4：標題在第 1 行、第 8 題在第 4 行 | 雙欄排版下文字順序就是這樣 |
| 一頁上一定有別的大題 | 實測 150 筆派工，**100%** | 不分節就把隔壁的算進來 |

⇒ **收尾時逐條自問「這一條真的屬於我這一節嗎」**，上下緣都要切。
判不掉就 `needs_review`，⛔ 不要猜。

### 三條鐵律

**0b. 先看自己在不在 `low_confidence_pages` 裡。** 在的話，你的頁碼是用前後鄰居
   **夾出來的**不是定位到的（實測最寬涵蓋整份的 54%）。照樣只讀那幾頁，但收尾時
   多問一句「我讀到的真的都是我這一節的嗎」，把隔壁節的內容排除，判不掉就 `needs_review`。

**1. 只讀 `pages` 指定的頁。** 讀全份就退回航母模式，成本乘 N。
   指定頁找不到 → 回 `BLOCKED` 說「manifest 說在第 3 頁但那裡沒有」。
   ⛔ **不要自己去翻別頁** —— 那是 manifest 錯了，要修 manifest 不是繞過它。

**2. 輸出必須通過自己的 schema**，產完立刻自驗：

```bash
# ⚠️ 在 repo root 跑（下面是相對路徑），這兩個變數自己先設好 —— 沒設會炸在
# 'specs/modules/schemas/.schema.json'（至少不是靜默，但別浪費那一次）
MODULE=<你的模組名>
OUT=backend/data/lessons/<uid>/v3/$MODULE.yml

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

**2b. 抽完必跑見證對帳** —— 這道門問的是「來源上有幾題，你交了幾題」：

```bash
# 單獨驗自己這一架：
python3 scripts/witness_reconcile_gate.py \
  --uid <uid> --module <module> --pdf <你讀的那份 PDF> \
  --section <大題名稱> --yaml <你的產出>

# 一整課全部交件之後（航母跑）：schema + 見證對帳，逐個模組
python3 scripts/run_extraction_pipeline.py verify --uid <uid> --out <產出目錄>
```

⛔ **不是可選的。** 在它之前，飛機自己說「我看到 5 題，都抽了」——
那個 5 是它自己數的，少看到 3 題、回報 3 題，schema 一樣全綠。
這道門的見證清單由 `extract_source_witnesses.py` 從原稿數，**LLM 碰不到**。

它**不**證明內容抄對了（那是逐字門的事），只證明沒有整題被靜默丟掉。

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
   ⚠️ 派工單裡那個鍵叫 **`sections`**，不是 `sections_present`（後者是 `lesson.yml` 的鍵）—— 寫錯會印出空白，不會報錯
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

**第一支已經落地：`.claude/skills/extract-vocab-definitions/SKILL.md`**（#2857，`vocab_definitions` / 150 課）。
航母的第 ④ 步連同過渡期的舊做法一起拿掉了 —— 不再有兩套抽取並行。

⛔ 仍不能選 `spotlight` / `keypoints`（@stgst）、`key_reading`（@if-else-master）。

⚠️ **不要馬上擴到 24 支** —— 一次寫 24 支的風險是 24 份一起錯。
第二支寫出來，專屬 know-how 以外應該幾乎不用重寫；如果跟第一支有 90% 一樣，
那是這份骨架沒抽乾淨，**回頭改這裡**。

### 🔴 `pages` 是 #2857 才補上的，在那之前第 1 條鐵律沒有東西可以遵守

#2852 落地時 174 份 `_manifest.yml` **一份都沒有 `pages`**，`sections_present`
也沒有任何頁碼欄位（1467 筆只有 no/name/subtitle/part/note）。骨架與 issue 都寫著
「只讀 manifest 指定的 pages」，但那個欄位當時不存在 —— 照著做只能讀全份。

現在頁碼由 `scripts/build_section_pages.py` 從原稿轉 PDF 定位，寫進 **committed** 的
`specs/modules/section-pages.yml`，再由 manifest builder 併成 `dispatch_pages`。
（為什麼要多一層 committed 檔：頁碼只能從 `private/curriculum-source/` 推導，
而 CI 沒有那個目錄；manifest 直接讀原稿會讓 `--check` 恆紅。）

實測 1449 個大題：**1426 個靠標題定位、23 個靠前後鄰居夾**、0 個完全定位不到。
每節中位數 **2** 頁，每份學習單中位數 **10** 頁。

⛔ `dispatch_pages` 空的（目前 L0028 / L0172，manifest 上有 `pages_unavailable`
寫明原因）→ **回 BLOCKED，不要讀全份**。

### 🔴 頁碼只對**定位時那一份 PDF** 有效 —— DOCX→PDF 不可重現

同一份 DOCX、同一台機器、清掉快取連轉三次：`L0016 → 9 / 8 / 8 頁`、`L0013 → 11 / 10 / 11 頁`。
拿 committed 的頁碼對「現在重轉一次」比對 172 課：**7 課總頁數不同、11 課共 33 個大題頁碼不同**。
L0016 從第 3 頁起**每一節整體位移一頁**。

而航母的 ② 是**另一次**轉檔，所以飛機拿到的 PDF 不保證跟定位時那份分頁相同。

🔴 **最糟的是它不會 BLOCKED**：每節範圍含下一節起始頁，位移一頁通常仍有重疊，
飛機會抽到自己那一節的**一部分**然後回報成功 —— 靜默截斷。

**兩道防線，都要**：

```bash
# ① 航母派工前（總頁數對不上就不派工）
python3 scripts/assert_pdf_matches_manifest.py --uid <uid> --pdf <轉好的.pdf>
```

② **飛機自己確認標題在它那幾頁上**。⛔ 不在就回 `BLOCKED`，
⛔ **不要往前後多讀幾頁找** —— 那正是靜默截斷變成靜默抽錯的那一步。

⚠️ ① 只比總頁數，**不保證分頁位置相同**（實測 4 課總頁數一樣但位置不同），
所以 ② 不是備援、是必要的第二道。

### 🔴 拆分的成本結構：派工不是免費的

實測（#2857，本 repo）：**一頁 PDF ≈ 1,272 token；但每派出一架飛機的固定開銷 ≈ 149,000 token**。

全庫 172 課、1425 個模組派工：照派工單共讀 3,005 頁 vs 每個模組都讀全份 14,695 頁
（頁數省 ~14.9M token）—— 但 1425 次派工的固定開銷是 **212M token**，是前者的 14 倍。

⇒ **拆分不能拿「省 token」當理由。** 理由是**漏抽會被看見**（該模組的 yml 沒產出 →
對帳門直接指名）；`pages` 的作用是讓它在頁數這一軸**不要變成負收益**。

⇒ ⛔ **不要為了重抽全庫而一課派九架飛機。** 正確用法是
**某個模組的抽取修好了，只對受影響的課重跑那一個模組**。
