---
name: lesson-curriculum-mapping
description: 把 179 課對到 108 課綱三層（學習表現、學習內容、核心素養）的方法——用陳淑麗教授人工打的《自學教材總表0816》與她的 90 節點課程地圖，改成「節點對課綱、課繼承節點」，老師只審 90 個節點。含總表欄位意義、三版課號怎麼對、來源標記規則、重跑腳本與紅線。觸發詞：課綱對照、能力指標、學習表現、學習內容、核心素養、108 課綱、lesson-indicators、節點對課綱、教授總表、自學教材總表、課程地圖節點、審核表、議題融入、閱讀寶貝指標
---

# 課綱對照：教授節點 → 108 課綱三層 → 179 課

> 2026-10-31 建（開課學院）。產物：`docs/design/reading-babies/lesson-indicators.json`（節點欄位）＋ `node-indicator-review.xlsx`（老師審核表）
> 重跑：`python3 .claude/skills/lesson-curriculum-mapping/scripts/build_lesson_indicators.py`

## 為什麼這樣做

舊版是 AI 逐課推論 179 課，沒有人審過，也審不動。教授手上有兩份人寫（或人主導）的判斷：總表 F 欄的教材目標策略、90 個節點的課程地圖。所以改成：
1. 課 → 總表列（年級＋課次＋課名）→ 教授策略、節點
2. 節點 → 課綱三層（每節點每學習階段：學習表現 1–2 條、學習內容 1–3 條、核心素養 1 條）
3. 課繼承所屬節點的三層，再加「教授欄位規則」補強（文體、語詞、文言文、議題）

老師審 90 列，不是 179 課。

## 輸入

| 檔 | 是什麼 | 誰寫的 |
|---|---|---|
| `/Users/young/project/kist-curriculum/教材原檔/自學教材總表0816.xlsx` | 教授 2026-08-18 傳，說「人工打的」。課綱代碼 0 筆 | 教授 |
| `/Users/young/project/kist-curriculum/data/node_definitions.json` | 14 家族、90 節點、每節點列課號 | 教授用 ChatGPT 做（chatgpt-log-1~4），我方萃取；只覆核過推論家族，未封版 |
| `~/.claude/skills/tw-108-curriculum/data/chinese.json` | 國語文課綱 358 條原文＋頁碼（國教院 PDF 抽出） | 教育部官方 |
| `~/.claude/skills/tw-108-curriculum/data/zonggang.json` | 19 項議題（總綱 PDF 第 37 頁） | 教育部官方 |
| `node_code_suggestions.json`（本資料夾） | 節點 → 代碼建議（家族預設＋節點覆蓋，附理由） | Claude 推論，待老師審 |
| `docs/curriculum/2026-08-14-second-edition-lesson-code-correction.csv` | 舊課號 ↔ 課名 | 我方分析 |
| API `/api/stories?page_size=300` | 179 課；一定用 `total` 驗筆數 | 線上 |

## 教授總表的結構

| 分頁 | 列 | 課號 | 欄位 |
|---|---|---|---|
| 1.總表 | 159 課（853 列多為空白） | `適用年級`＋`課次` → `G{年級}-L{課次}` | 文體、類型、**F 欄＝閱讀聚光燈教材目標策略**、議題、第六大題標題、文本類型（單／多）、語詞 1–14 |
| 2.體育生的品格教材 | 15 | `新課次` 體-1…15 | 適用年級 4（體-1~9）／5（體-10~15）；沒有議題欄 |
| 3.文言文 | 12 | `新課次` 文-1…12 | 適用年級 8；第 F 欄是「單元議題」（多為「類型-記敘人物」不是議題） |
| 4.影片連結、5.已寫過的人物 | — | — | 本流程不用 |

- F 欄格式「類別──細項」，類別段（摘要策略、推論策略、用表格整理訊息、品格力…）是判斷家族的依據
- 儲存格裡有異體字選擇符（U+E01xx），比對前要剝掉（腳本 `clean()`）
- G5–G9 第 0 課是同一篇「正太與小豬」，教授說「不算正式課次」（2026-08-18 交接紀錄）

## 課號在三版之間怎麼對

| 版本 | 例：「十秒的背後」 | 用在哪 |
|---|---|---|
| 一修（舊線上） | G4-L2，story_id 2 | 已退役 |
| 08-14 校正清單的「new_code」 | G4-L10；但 7 年級跟 0816 不同（G7-L13＝大自然的氣象小幫手） | 教授 ChatGPT 對話與節點地圖的一部分 |
| **總表 0816 ＝ API `grade_code`** | G4-L10，story_id 20001 | **現行**，lesson_uid 樹 |

規則：
1. API `grade_code` 去補零後＝總表 `G{年級}-L{課次}`（體-L1 → 體-1）。179/179 對得上；課名有 10 課小差異（臺／台、加副標），列在審核表「對不上與待確認」
2. **節點地圖的課號不能直接信**：每條「節點 × 課號」都拿總表 0816 該課的 F 欄類別驗家族
   - 家族一致 → 收
   - 不一致 → 用 08-14 校正清單把它當舊課號換成課名，再找 0816 同年級同課名的課，家族一致就換過去；同一節點同一年級只要有一個要換，整組一起換（同一批課號是同一套編號）
   - 還是不一致 → 標衝突，**不繼承代碼**；若這課只有衝突節點，先照地圖繼承並列待確認
   - 地圖沒列、或只列在衝突節點的課 → F 欄全文含某節點名且家族一致，用規則補
3. 2026-10-31 實跑：194 條歸屬，169 條直接對上、10 條靠校正清單換（全在 7 年級）、15 條衝突

## 節點對課綱的方法

- 學習階段由**總表適用年級**決定：4＝Ⅱ、5–6＝Ⅲ、7–9＝Ⅳ。體育品格課是 4–5 年級（Ⅱ／Ⅲ），舊草稿當成Ⅳ是錯的
- 一個節點跨幾個學習階段，就每個階段各選一組代碼；核心素養選一個總綱項目（如 A2），依階段展開成 國-E-A2／國-J-A2
- 選碼原則：條文字面有對應就用字面那條（摘要→5-Ⅱ-6、自我提問→5-Ⅲ-8、順敘→Ba-Ⅱ-2、判斷句→Ac-Ⅳ-2、一字多義→4-Ⅳ-3）；沒有就取該階段最接近的一條並在 `why` 寫明
- 品格／生涯（F14）不是閱讀策略（教授判準 7）：學習表現取「閱讀多元文本以認識議題」，學習內容與核心素養依主題（Bb 情感、Cb/Cc 文化、C1/C2/C3）
- 代碼只寫在 `node_code_suggestions.json`，條文由腳本從官方資料帶入；腳本會擋掉官方沒有的代碼、條數超過上限、缺階段

## 教授欄位規則（每項都標 rule_from_professor_field）

| 規則 | 從哪欄 | 推出什麼 |
|---|---|---|
| R1 | 文體 | 文本表述：記敘 Ba、抒情 Bb、說明 Bc、議論 Bd、應用 Be；該階段有「X 文本的結構」條就用，沒有取該類第 1 條並註明。第Ⅱ階段沒有 Bd，議論文對不到就列出 |
| R2 | 語詞 1–14 | Ab 常用語詞認念／使用（Ⅱ Ab-Ⅱ-5/6、Ⅲ Ab-Ⅲ-5/6、Ⅳ Ab-Ⅳ-4/5） |
| R3 | 屬文言文分頁 | Ab-Ⅳ-6、Ab-Ⅳ-7；文體＝文言文再加 Ad-Ⅳ-4 |
| R4 | 議題（體育分頁用 F 欄） | 19 項議題，只收字面或明確同義（品格→品德、永續→環境、性別→性別平等…）；「擴展視野」「科學知識」「媒體識讀」等對不到就列出，不硬配。清單出處：總綱 PDF 第 37 頁 |
| 節點補 | F 欄 | 見上「課號怎麼對」第 2 點 |

## 來源標記

| 標記 | 意思 |
|---|---|
| `professor_table` | 教授總表儲存格直接有的值（策略、年級） |
| `rule_from_professor_field` | 從教授欄位用上表固定規則推出 |
| `professor_ai_map` | 教授用 ChatGPT 做的節點地圖（課 → 節點）；不是人工打的，所以不標 professor_table |
| `ai_inferred` | Claude 推論（節點 → 課綱代碼） |
| `teacher_reviewed` | 老師審過寫回（在 `node_code_suggestions.json` 該節點加 `reviewed_by`、`reviewed_at`） |

同一課同一層同一代碼只算一次，來源取最強。統計由腳本算，寫在 json 的 `node_mapping_coverage`。

## json 裡新增的欄位

- 每課：`professor_row`（總表哪一列、文體、議題、語詞…）、`professor_strategy`、`professor_node`（含 `primary`、`inherited`、`map_code`、`how`）、`node_indicators`（三層＋議題，每筆有 source／via／rule）、`mapping_source`（node_inherited／node_inherited_family_conflict／ai_only_no_node）、`superseded_by_node`
- 頂層：`professor_source`、`node_mapping`（90 節點，含 `resolved_courses`）、`node_codes`（用到的條文、k12ea 頁碼、與 k12ea 抄本是否一致）、`issues_19`、`node_mapping_coverage`
- 原本 AI 逐課欄位（primary_indicator、skills、core_competencies、learning_contents、station_indicator_map）**一個字都不動**，遊戲端照舊讀；只加 `superseded_by_node` 標記

## 頁碼

條文用國教院 PDF 原文；頁碼給 k12ea PDF 檔頁碼＝國教院頁碼 +2（腳本每次都拿 221 條既有 k12ea 抄本驗，差值不是固定 2 就停）。k12ea 抄本有 5 條Ⅰ/Ⅴ階段條文混進「第五學習階段」字樣，這裡用國教院版。

## 重跑

```bash
SK=/Users/young/project/clp-island-3d/.claude/skills/lesson-curriculum-mapping
python3 $SK/scripts/build_lesson_indicators.py --check            # 只印統計
python3 $SK/scripts/build_lesson_indicators.py                    # 抓線上 API，寫 json＋審核表
python3 $SK/scripts/build_lesson_indicators.py --save-stories /tmp/s.json   # 順便存 API 回應
python3 $SK/scripts/build_lesson_indicators.py --stories-json /tmp/s.json   # 用存檔重跑（可重現）
```

腳本冪等：先剝掉自己加過的欄位再算，連跑兩次 json 位元組相同、審核表儲存格相同。老師回填後：改 `node_code_suggestions.json` → 重跑。

## 紅線

- ⛔ 不准把 AI 推論標成教授寫的：節點地圖是 `professor_ai_map`，代碼是 `ai_inferred`，只有總表儲存格是 `professor_table`
- ⛔ 審核表最後兩欄（同意／修改為）沒回填前，節點對照不是正式對照；對外、給老師報告、進遊戲判定都要寫「草稿」
- ⛔ 課綱條文只抄官方（國教院／k12ea PDF），代碼不在 `chinese.json` 就不准用；腳本會擋
- ⛔ 對不上的課逐一列出，不准用相似課名硬配；節點家族衝突不准默默收
- ⛔ 不改教授的 xlsx 與 node_definitions.json（只讀）；地圖錯號回報教授，不在原檔改

## 已知待確認（2026-10-31）

- 2 課沒有任何節點：G7-L9「帶著『血拼清單』閱讀」（解題策略──帶著問題閱讀）、G7-L26「科學怪人」（推論策略──從文本線索理解標題）——地圖原本放在這兩個課號的是舊編號的別課
- 5 課只掛在家族衝突的節點：G5-L22→N04、G5-L26→N33、G7-L8→N26、G7-L25→N22、文-1→N71（N71、G7-L25 看起來是教授刻意跨家族）
- N31（特殊標點）、N55（辨識詐騙）在線上找不到家族一致的課
- 議題欄有 20 多種寫法對不到 19 項議題（最多是「擴展視野」13 課、「科學知識」8 課）
