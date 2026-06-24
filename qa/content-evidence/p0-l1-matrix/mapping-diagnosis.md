# Mapping Diagnosis: 內容放錯課的系統性根因

日期: 2026-06-23  
範圍: 聚光燈(`reading-strategy`) + 重點表(`story-structure`)  
分支: `fix/issue-2397-gate-p0-hardening`

## 1) 實際資料鏈路（story_id -> lesson_code -> catalog/parsed -> 顯示內容）

目前 runtime 鏈路是「純 code 對位」，沒有做課文身分驗證

1. `/api/stories/{id}` 先用 `story_id` 找 lesson  
   - `backend/app/routes/stories.py` 走 `get_lesson_by_id()`
2. lesson 內容由 loader 在啟動時組裝  
   - `backend/app/services/lesson_layer_loaders.py`
3. 聚光燈來源  
   - `_spotlight_enrichment()` 呼叫 `load_spotlight_v2(grade_code)`
   - `backend/app/services/spotlight_v2_loader.py` 內部 `normalize_manifest_code()` 後直接用 code 載入
   - `backend/app/services/spotlight_contract.py` 的 `load_catalog_spotlight()` 直接讀 `catalog/<norm_code>.spotlight.yml`
4. 重點表來源  
   - `lesson["story_structure_table"]` 直接取自 `_parsed_2026-05-01/*.yml`
   - parsed 檔對應靠 `catalog_to_parsed_code()`
   - `backend/app/services/lesson_code_normalization.py`
5. 關鍵事實  
   - 以上流程都只靠 `lesson_code` 正規化映射  
   - 沒有用 `title/paragraphs` 驗證「載入內容是不是同一課」

## 2) 哪裡綁錯（精確到規則/函式）

### A. 正規化把不同命名格式壓成同一 key（碰撞風險）

- `normalize_manifest_code()` 規則: `G4-L02 -> G4-L2`
- `get_lesson_by_code()` 在 miss 後會做這個正規化 fallback  
  `backend/app/services/lesson_loader.py`（`# Normalize zero-padded variant: G4-L01 -> G4-L1` 這段）
- 這代表「補零格式差異」在 lookup 時會被視為同一課  
  若上游 schema/檔名曾同時存在 `G4-L02` 與 `G4-L2` 但內容不是同一課，就會被同 key 吃掉

### B. code-only mapping 缺少語意錨（title/paragraphs）

- 聚光燈: `load_spotlight_v2()`/`load_catalog_spotlight()` 不看課文標題或段落，只看 code
- 重點表: `catalog_to_parsed_code()` 只做 code 轉換，不驗證 table 內容是否屬於該課
- 結果: 只要 catalog/parsed 檔內容與 lesson 實際課文發生錯位，就會「合法載入錯內容」

## 3) victim 實證（同一個根: code 對到檔，但內容身份錯）

### victim-1: story `2`（十秒的背後 -> 顯示元宵內容）

- API lesson: `id=2`, `grade_code=G4-L02`, `title=十秒的背後`
- mapping: `G4-L02 -> normalize -> G4-L2 -> catalog/G4-L2.spotlight.yml`
- 證據: `G4-L2.spotlight.yml` 內容含 `〈𪹚龍慶元宵〉`
- 判定: lesson title 與 spotlight 文本主題不一致

### victim-2: story `3`（長高的祕密 -> 顯示車子題）

- API lesson: `id=3`, `grade_code=G4-L03`, `title=長高的祕密`
- mapping: `G4-L03 -> G4-L3 -> catalog/G4-L3.spotlight.yml`
- 證據: `G4-L3.spotlight.yml` 內容是 `小傑跟阿光的車`
- 判定: lesson title 與 spotlight 文本主題不一致

### victim-3: story `1017`（阿耀通信 -> 顯示智凱情境）

- API lesson: `id=1017`, `grade_code=G4-L17`, `title=把球打好，就夠了嗎？...`
- mapping: `G4-L17 -> catalog/G4-L17.spotlight.yml`
- 證據: `G4-L17.spotlight.yml` 開頭情境主角是 `智凱`
- 判定: lesson title 與 spotlight 文本主題不一致

### victim-4: story `1103`（旅人鴿 -> 含雨林段落）

- API lesson: `id=1103`, `grade_code=G7-L31`, `title=最後一隻旅人鴿`
- mapping: `G7-L31 -> catalog/G7-L31.spotlight.yml`
- 證據: 檔內同時含 `〈雨林裡的奇蹟藥物〉` 與 `〈最後一隻旅人鴿〉`
- 判定: 單課 slot 載入了跨篇內容（多文本殘留）

### victim-5: story `1020`（供需 -> 顯示天才/職業表）

- API lesson: `id=1020`, `grade_code=G4-L20`, `title=物以稀為貴...`
- parsed mapping: `G4-L20 -> catalog_to_parsed_code -> G4-L20-22.yml`
- 證據 A: `catalog/G4-L20.spotlight.yml` 內有 `「天才」是練出來的`
- 證據 B: `G4-L20-22.yml` 的 `story_structure_table` 首列是 `職業 | 商店店員... | 引水人`
- 判定: multi-text 槽位直接套用共用檔內容，沒有依課文身份切對應 section

## 4) 結論

這 5 個 victim 不是 5 個獨立問題，而是同一個系統根

- 系統目前是 `story_id -> lesson_code(normalized) -> file` 的 code-only 綁定
- `normalize_manifest_code()` 的補零收斂讓 code 碰撞風險更高
- runtime 沒有 `title/paragraphs` 身分錨驗證，導致「檔案存在就當正確」
- 多文本課又加重了錯位風險（單 slot 載入跨篇內容）

## 5) 修復方向（通則，不是逐課補內容）

1. 在 loader 加入內容身份驗證  
   - 用 lesson `title + paragraphs` 對 `spotlight/story_structure` 做語意對齊檢查
2. 驗證失敗時 fail-closed  
   - 不准鄰號/共用檔錯綁顯示
3. 缺正確來源時誠實標記 known-gap  
   - 走 `backend/data/curriculum_qa/content_known_gaps.yaml`，不做假 pass

