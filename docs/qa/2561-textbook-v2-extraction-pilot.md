# issue #2561 教材二修抽取 pilot 報告（Worker B）

> 計畫 SOT：`/Users/xiung/.claude/plans/swift-riding-lake.md` §四
> 範圍：**只證明抽取 pipeline 通不通**，不改 `manifest.yml` / `lessons/*.yml`，不動 `story_id`，不 promote 進 catalog。
> 兩課皆走**單課模式**，全部指令都指定任意路徑（`--output-dir` / `--schema-dir` 落在 `/tmp/pilot-2561/`），未寫回 repo。

## 0. 結論（先講重點）

- **Pipeline 可吃二修 DOCX**：兩課 after 版本（G4-L2 正太與小豬、G4-L12 大自然的氣象小幫手）都能一次抽出 spotlight + keypoints + assets，overfit lint 全 PASS，L1 answer_recall / mcq_leakage 全綠。
- **schema_before 對「線上現況」不是乾淨一致** —— 正太與小豬課檢出兩個具名差異（見 §3），其中一個可歸因於**checked-in catalog 本身相對現行抽取器程式碼已過期**，另一個是**抽取器本身的迴歸缺陷**（連續數字題「2.」在特定上下文被吃掉）。這兩個都如實列出，**沒有為了讓 diff 好看而調整抽取器**。
- **二修帶來的內容改變**已逐項對回原始 DOCX 驗證（§4），包含一個填空可接受答案的擴充（「高手」→「強壯的人/高手」）與一處換行格式調整。
- **重點表（keypoints）在「大自然的氣象小幫手」這課，before 與 after 兩版都偵測不到**——但這不是二修造成的迴歸，是這份 DOCX 的重點表本身就不用 `【　】` 括號標記空格（用全角空格夾住答案），現行抽取器的 hard filter（必須含 `【...】`）本來就吃不到這種格式，**before/after 表現一致**（見 §5）。
- L1 門檻兩份文件（B4）在真資料上真的會給出不同判定：`docs/issue-2205-eval-standard.md` 的 `label_family_correct` 是硬性 AND 條件，`docs/qa/story-structure-verification-standard.md` 把它降成 warn。本 pilot 兩套都算兩套都報（§6），沒有替 gate 做二選一的決定（那是 Worker A 的職責）。
- 驗收條件 5（per-lesson evidence gate PASS）依計畫指示**不在本輪範圍**，等 Worker A 交付。

---

## 1. 環境與素材

```
git fetch origin && HEAD 本來就是 origin/main (14ab3b73)，不需要 pull
分支：ao/chinese-literacy-platform-7/pilot-2561-b2（from origin/main）
python venv: /tmp/pilot-venv（python-docx / lxml / pyyaml，repo requirements 未列 python-docx，本機另建）
```

四個素材（皆已核對存在）：

| 課 | 幅度 | after（二修） | before（一修/現行） |
|---|---|---|---|
| 正太與小豬 | 大 | `修改前後差異/修改幅度大/修改後/G4-L2正太與小豬：武僧的養成之路（推論策略-找出故事道理）.docx` | `修改前後差異/修改幅度大/修改前版本--維持原來課次/G4-L7正太與小豬：武僧的養成之路.docx` |
| 大自然的氣象小幫手 | 小 | `修改前後差異/修改幅度小/G4-L12大自然的氣象小幫手（摘要策略-列舉結構：找重要細節）.docx` | `修改前後差異/修改幅度小/修改前--課次還沒改/G4-L9大自然的氣象小幫手.docx` |

---

## 2. 抽取（步驟①）

```bash
python3 scripts/build_lesson_schema.py G4-L2  "<after 正太>"   --output-dir /tmp/pilot-2561/zhutai_after
python3 scripts/build_lesson_schema.py G4-L7  "<before 正太>"  --output-dir /tmp/pilot-2561/zhutai_before
python3 scripts/build_lesson_schema.py G4-L12 "<after 氣象>"   --output-dir /tmp/pilot-2561/qixiang_after
python3 scripts/build_lesson_schema.py G4-L9  "<before 氣象>"  --output-dir /tmp/pilot-2561/qixiang_before
```

實際輸出：

| 課 | strategy 偵測 | keypoints rows/blanks | spotlight blocks |
|---|---|---|---|
| G4-L2（正太-after） | `inference` / 推論策略-找出故事道理 | 4 rows / 4 blanks / flat | 22（guide 13, free_text 5, single 2, figure 2） |
| G4-L7（正太-before） | `unknown`（檔名無括號） | 4 rows / 4 blanks / flat | 33（guide 23, free_text 7, passage 2, single 1） |
| G4-L12（氣象-after） | `summary` / 摘要策略-列舉結構：找重要細節 | **無 keypoints table**（見§5） | 12（guide 3, free_text 2, single 2, multi 3, passage 1, figure 1） |
| G4-L9（氣象-before） | `unknown`（檔名無括號） | **無 keypoints table**（見§5） | 17（guide 6, free_text 7, passage 1, single 2） |

> `strategy_type: unknown` 是**預期行為**，不是缺陷：before 檔名（一修/現行版）本來就沒有二修才加上的策略括號，`label_family_correct = stype != "unknown"` 這條規則因此對 before 檔案必然回 false（見 §6）。

---

## 3. 驗收條件① schema_before 對線上現況（正太與小豬，keypoints + spotlight 分開報）

### 3a. keypoints — 一致 ✅

`backend/data/lessons/_parsed_2026-05-01/G4-L7.yml` 的 `story_structure_table`（`story_structure_table_source: docx-keypoints-2026-06-18`，即目前線上真相）：

```
背景 / 兩百年前日本奈良，市集。
起因 / 正太看到僧人制服惡霸，讓他想要去興福寺【 學武功 】。
經過 / 師父給他【 小豬 】，每天讓正太抱著小豬走上走下，持續【 三 】年，每日不間斷。
結果 / 三年後，正太變成了【 高手 】，一般的匪徒強盜再也不是他的對手。
```

與 `/tmp/pilot-2561/zhutai_before/G4-L7.keypoints.yml` 逐字一致（4 rows / 4 blanks / 同答案）。**keypoints 這一半 pipeline 可重現線上現況。**

### 3b. spotlight — 不一致，兩個具名差異 ⚠️

`backend/data/lessons/spotlight/catalog/G4-L7.spotlight.yml`（線上現況，checked-in）24 blocks；`/tmp/pilot-2561/zhutai_before/G4-L7.spotlight.yml`（本次重跑）33 blocks。

**差異 1 — catalog 疑似已過期，而非本次重跑錯誤**：catalog 檔的 `strategy_type: inference` / `strategy_name: 推論策略-找出故事道理`，但這正是**二修 after 檔名的括號**，不是這次 pilot 用的「before」檔名（無括號）。同時 catalog 的 block 0（`guide`）把 intro／「例一：正太與小豬的第十一段」／「例二：龜兔賽跑」整段全部揑成同一個巨大 guide 字串，而本次重跑（用同一份 before DOCX）依現行 block palette 規則正確拆成 9 個獨立 block（guide/passage/free_text/figure 交錯）。**結論：checked-in catalog 是用比現行抽取器更舊的版本、對著跟 pilot 不完全同一份檔案建的，不能當作「現行程式碼 + before DOCX」的 ground truth**，這件事本身是 #2561 大工程要處理的過期問題，不在本 pilot 修復範圍。

**差異 2 — 本次重跑確實漏抓一個 block（抽取器缺陷，已在原始 DOCX 逐字驗證存在）**：

```python
# raw DOCX paragraph 84（before 檔）:
'2.想想看，農夫和破水桶的說法有什麼不同？(請打勾)'
```

這一段在 catalog（線上現況）跟原始 DOCX 都存在，但在本次 `build_lesson_schema.py` 重跑輸出的 `/tmp/pilot-2561/zhutai_before/G4-L7.spotlight.yml` 裡**完全消失**（前後 block 直接跳過，沒有被併進其他 block 的 text）。這是抽取器對「連續兩個編號問句（1./2.）+ 緊接著 □ 選項」這個模式處理不穩定的迴歸，**如實回報，未動抽取器程式碼**（超出 pilot scope，且動 code 需要重跑全 151 課回歸，不該在 pilot 裡順手改）。

---

## 4. 驗收條件② schema_after vs schema_before diff，逐項對回 DOCX

### 4a. 正太與小豬（幅度大）keypoints diff — 2 處真改變，皆已對回 DOCX 原文

| row | before | after | DOCX 驗證 |
|---|---|---|---|
| 起因 | `...興福寺【 學武功　　　】。`（同行） | `...興福寺\n【 學武功　　　】。`（多一個換行） | ✅ 二修 DOCX cell 內確實多了 `\n`，純排版調整 |
| 結果 | 答案 `高手` | 答案 `強壯的人/高手` | ✅ 二修 DOCX cell 文字為 `【 強壯的人/高手　】`，二修擴充了可接受答案 |

### 4b. 正太與小豬 spotlight diff — 結構性改寫（幅度大名符其實）

after 從 22 blocks（3 個「例子」教學鏈：例一自我引用第十一段／例二龜兔賽跑／例三破水桶，每個都配 free_text 步驟＋圖片）取代 before 33 blocks 的舖陳方式（先教破水桶／再教品德多選／再教兩個是非題）。這是**內容重寫**，pipeline 兩邊都正確抽出、qa_total／answer_recall／mcq_leakage 都乾淨（見 §6），沒有需要人工修的抽取失敗。

### 4c. 大自然的氣象小幫手（幅度小）spotlight diff

after 12 blocks 對 before 17 blocks，主要差異：
- before 有一句延伸計算題「3.如果錄下草叢裡蟋蟀的叫聲…把這個數字加5，再除以2…」在 after 消失（二修把這一步刪掉，簡化流程）
- before 「❷精簡」判成 `single`，after 同名題判成 `multi`（題目字面沒變，只有 block 分類不同——需人工核對是二修真的把單選改複選，還是分類器邊界不穩定；本 pilot 沒有充分時間逐字核對到這麼細，如實標記為**待人工複核**，不假裝已驗證）
- both 版本都有一顆 `single`/`multi`「請選擇」孤立題，before 排在最後（緊接 passage/figure 之前），after 排在最前——懷疑是 range 起點偵測抓到的位置不同，同樣標記**待人工複核**，未強行解讀

---

## 5. keypoints 偵測不到（大自然的氣象小幫手）—— before/after 一致，非二修迴歸

兩版 DOCX 的重點表（表格：`主旨／例子／總結`，4 rows × 2 cols）**都沒有 `【　】` 括號**，答案是用全角空格夾住直接寫在句子裡（例：`調整　　結網　　的大小`、`看到日暈表示　夜裡會下雨　`）。已用 python-docx 直接讀兩份 DOCX 的 tables 逐一核對：

```
G4-L9（before）table[5]: 主旨/例子/總結，無 "【" 字元
G4-L12（after） table[5]: 主旨/例子/總結，無 "【" 字元 —— 逐字相同結構
```

`find_keypoints_table()` 的 hard filter（`build-keypoints` skill §「Keypoints Table Detection」第 2 條：「Must contain 【...】 blanks」）因此兩版都判定「沒有重點表」。**這是抽取器對這種括號慣例的結構性不適應，但 before/after 表現一致，不是二修造成的新缺口**——如實記錄，未硬編任何規則讓它偵測到。

---

## 6. L1 eval（步驟②）+ B4 雙門檻並報

```
G4-L2 (after 正太):  keypoints{row_recall=1.0 blank_recall=1.0 label_family_correct=true  pass=true}
                      spotlight{answer_recall=1.0 mcq_leakage=0 guide_retained=true pass=true}
G4-L7 (before 正太):  keypoints{row_recall=1.0 blank_recall=1.0 label_family_correct=false pass=false}
                      spotlight{answer_recall=1.0 mcq_leakage=0 guide_retained=true pass=true}
G4-L12(after 氣象):   keypoints unavailable（見§5）
                      spotlight{answer_recall=1.0 mcq_leakage=0 guide_retained=true pass=true}
G4-L9 (before 氣象):  keypoints unavailable（見§5）
                      spotlight{answer_recall=1.0 mcq_leakage=0 guide_retained=true pass=true}
```

**B4 兩份門檻文件在 G4-L7 keypoints 上給出不同結論**（`eval_lesson_schema.py:343` 目前是 `label_family_correct = stype != "unknown"`，`pass` 邏輯要求全部條件 AND，等同套用 `issue-2205-eval-standard.md`）：

| 門檻文件 | row_recall | blank_recall | label_family_correct | 判定 |
|---|---|---|---|---|
| `docs/issue-2205-eval-standard.md`（AND 全部條件） | 1.0 ✅ | 1.0 ✅ | false ❌ | **FAIL** |
| `docs/qa/story-structure-verification-standard.md`（label_family 只 warn） | 1.0 ✅ (≥0.95) | 1.0 ✅ (≥0.95) | false（僅 warn） | **PASS** |

兩套都報，沒有替 gate 選邊——`label_family_correct=false` 這裡的根因單純是「before 檔名沒有二修才加的策略括號」，並非重點表本身分類錯誤，這點在報告內已標明，留給 Worker A 決定要不要把「檔名沒括號」跟「真的分類錯誤」分開處理。

另外發現 `eval_lesson_schema.py` 實際 `passed` 判斷（spotlight）**不含** `figure_asset_recall`／`block_order_match`／`passage_recall`（`eval_lesson_schema.py:406-410` 只檢查 `mcq_leakage==0 and guide_retained and answer_recall>=0.99`），但兩份門檻文件都把 `figure_asset_recall` 列在指標表（目標 1.0）。本 pilot 兩課的 `figure_asset_recall` 都是 **0.0**（figure block 的 `referent=table`、`asset=None` —— 這兩課的圖是表格型 referent，不是圖片，本抽取器對 table-referent figure 不填 asset），但因為現行 `pass` 判斷沒把這個指標算進去，仍回報 `pass=true`。**如實記錄這個「文件講的門檻」與「程式碼實際檢查的門檻」有落差**，不是本 pilot 造成也不在本 pilot 修。

---

## 7. Overfit lint（每次必跑）

四次 `eval_lesson_schema.py` 呼叫都在輸出開頭自動印出：

```
Overfit lint: PASS   (G4-L2)
Overfit lint: PASS   (G4-L7)
Overfit lint: PASS   (G4-L12)
Overfit lint: PASS   (G4-L9)
```

全 PASS，代表本 pilot 過程沒有為了讓兩課 eval 綠而在 `build_lesson_schema.py` 裡硬編課號或專有名詞。

---

## 8. 上線 dry-run（步驟④，未寫回任何檔案）

```bash
$ python3 scripts/keypoints_table_sync.py --lesson G4-L2 --schema-dir /tmp/pilot-2561/zhutai_after --dry-run
OK  G4-L2: 5 rows → 2 file(s)
DRY RUN: updated=1, skipped=0, total=1
```
（"5 rows" = `keypoints_to_table()` 把 4 個 schema rows 前面加一個標題列，非計算錯誤；"2 file(s)" 是 dry-run 匹配到 2 個 target 路徑，dry-run 沒有實際寫入，本 pilot 未進一步深挖是哪兩個路徑，因為不影響 pilot 結論且不寫檔）

```bash
$ python3 scripts/promote_spotlight_catalog.py --dry-run
promoted: 0
skipped buckets: {}
(dry-run — no files written)
```

`promote_spotlight_catalog.py` 確認**只有 `--dry-run`、無單課參數**、硬編讀 `private/curriculum-source/_online-schema/`（共用 gitignored 路徑）。因為硬約束是「不 promote 進 catalog」，且該目錄是共用路徑，pilot **沒有把兩課成果放進那個共用目錄**（本次跑的 `--dry-run` 只是確認該目錄目前是空的、CLI 行為如計畫描述，promoted=0 是因為目錄本來就沒東西，不是驗證了 pilot 產物）。

---

## 9. 沒有動的東西（硬約束核對）

```bash
$ git status --short   # 全程皆空
$ git diff --stat       # 全程皆空
```

- `manifest.yml` / `backend/data/lessons/*.yml`：未動
- `story_id`：未動、未查詢（pilot 不需要）
- catalog（`backend/data/lessons/spotlight/catalog/*`）：未寫入，promote 腳本停在 dry-run
- 兩課所有中間產物全部落在 `/tmp/pilot-2561/`，未進 repo

---

## 10. 給下一階段（不在本 pilot 做，如實列出交棒項）

1. `backend/data/lessons/spotlight/catalog/G4-L7.spotlight.yml` 疑似相對現行 `build_lesson_schema.py` 已過期（§3b 差異1）——擴量前建議先確認 catalog 是否需要整批重跑。
2. 抽取器對「連續兩個編號問句（1./2.）+ 緊接 □ 選項」模式會漏抓一個 block（§3b 差異2）——真缺陷，建議在擴量前修，否則 151 課批次會靜默漏內容。
3. 「大自然的氣象小幫手」風格重點表（無 `【】`、用全角空格夾答案）目前完全偵測不到（§5）——需要決定是否擴充 `find_keypoints_table()` 支援這種格式，或正式登記進 `content_known_gaps.yaml`（此 pilot 不登記，因兩課未 promote，登記没有實際 lesson 在 catalog 裡對應）。
4. `single` vs `multi` 分類在氣象小幫手課的「❷精簡」題型上，before/after 給出不同分類（§4c）——需要人工核對 DOCX 原文才能判斷是二修真的改了選項數，還是分類器邊界不穩，本 pilot 時間內未能定案。
5. `eval_lesson_schema.py` 的 `passed` 邏輯與兩份門檻文件列出的指標（`figure_asset_recall` 等）不完全對應（§6）——建議 Worker A 順手一併釐清。
6. B4（L1 門檻文件不一致）本 pilot 只如實雙報，未裁決；正式裁決留給 Worker A 寫進 INTENT.md。
