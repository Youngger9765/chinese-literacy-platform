---
name: content-mapping-integrity
description: LingoLeap 聚光燈(reading-strategy)/重點表(story-structure)出現「內容放錯課/張冠李戴」時,先查 story_id↔lesson_code↔catalog 檔的對應,別逐課改內容。當看到某課聚光燈/重點表顯示別課內容、或反覆出現「內容放錯課」、或要動 catalog spotlight/keypoints 檔、lesson_loader、補零正規化時使用。
---

# Content Mapping Integrity — 內容放錯課的根因是 mapping，不是內容

> **為什麼存在(2026-06-23 鬼打牆 postmortem)**:聚光燈/重點表「內容放錯課」連幾天反覆(1103旅人鴿顯示雨林、1020供需顯示天才、G4-L02十秒顯示元宵、G4-L03長高顯示比車子…)。一直逐課修 + 一直建偵測(judge/gate/pixie),Young 暴怒「一直出這個錯,系統問題,鬼打牆」。**真根因是一個 mapping 錯位,不是 N 課各自內容壞。**

## 根因(已定位)
staging 課(`story_id` → title,如 story 2 = 十秒的背後)與 catalog 聚光燈/重點表檔(`backend/data/lessons/spotlight/catalog/G4-L2.spotlight.yml` 等,**沒補零命名**)**編號/排序對不上**:
- `lesson_loader` 補零正規化 `G4-L01 → G4-L1`(`lesson_code_normalization.py`)會把**不同課**綁到同一檔
- 部分課(如「十秒的背後」)catalog **根本沒有自己的 spotlight 檔** → 被綁到鄰號別課的檔
- 結果:story_id N 拿到別課的聚光燈/重點表內容 = 內容放錯課

## 鐵律(看到「內容放錯課」先做這個)
1. **先疑 mapping,不是內容**:某課顯示別課內容 → 先查 `story_id → lesson_code → catalog 檔 → title` 這條鏈哪裡對不上,**不要急著改那課的內容檔**
2. **修 mapping = 修全部**:這是一個系統根因,改對應/正規化/序號分配一次,所有受害課一起好。**禁止逐課手改輸出**(那是症狀治療,會一直冒)
3. **偵測只用來證明 + 鎖回歸**:vision judge / content_evidence_gate / pixie 是「找到哪些課中招」,不是「修好」。修完 mapping 用它們跑全量證明收斂,別把「建偵測」當成在修
4. 對齊全域 skill `recurring-bug-systematic-root`(反鬼打牆通則)

## 查 mapping 的起點(檔案)
- `backend/app/services/lesson_loader.py`(`get_lesson_by_code`,line ~104)+ `lesson_code_normalization.py`(補零正規化 — 碰撞嫌疑最大)
- `backend/data/lessons/spotlight/catalog/*.spotlight.yml`(命名/內容 vs lesson 身分)+ `catalog/manifest.json`
- `backend/data/lessons/_parsed_2026-05-01/*.yml`(Layer-2)+ multi-text slot(`G4-L20-22.yml` 一檔多課,secondary slot fallback)
- 權威身分:用課文 **title/paragraphs**(staging 真課文)當錨,不要只信 L-號(L-號兩套系統不一致)

## 反模式
- ❌ 看到聚光燈顯示別課內容,就去改那課的 spotlight.yml(沒查為什麼被綁錯)
- ❌ 逐課修「內容放錯課」(第 3 課還在修 = 該找 mapping 根因了)
- ❌ 用「再建一層偵測/eval」當作在解這個 bug
- ❌ 用 L-號(G4-L2 vs G4-L02)當身分,忽略補零碰撞 + 缺檔鄰號錯綁

## 一句話
聚光燈/重點表內容放錯課 = `story_id↔lesson_code↔catalog 檔` 對應錯位(補零碰撞 + 缺檔鄰號錯綁)。先修 mapping 一次,別逐課改內容。
