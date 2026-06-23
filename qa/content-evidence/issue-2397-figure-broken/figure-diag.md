# Issue #2397 Figure Broken 診斷（先診斷再修）

時間：2026-06-23  
環境：`https://lingoleap-backend-staging-958347263320.asia-east1.run.app`  
檢查方法：
- `curl /api/stories/{story_id}` 取 `spotlight_v2.blocks[type=figure].asset`
- 對每個 `asset` 逐一 `curl -L` 物件 URL，記錄 HTTP status + 內容 md5
- 另外檢查前端目前會用到的 `spotlight_v2.lesson` 路徑（`G*-SL*`）是否存在
- placeholder md5 黑名單：`9f31079bf8dc822e61f0a65ba433c34e`

原始機器證據：
- `qa/content-evidence/issue-2397-figure-broken/diag_raw.json`
- `qa/content-evidence/issue-2397-figure-broken/diag_summary.json`
- `qa/content-evidence/issue-2397-figure-broken/api/*.json`
- `qa/content-evidence/issue-2397-figure-broken/post_fix_url_check.json`（修補後 URL 解析結果）

## 每課結論

| Lesson | story_id | 觀測 | 根因分類 |
|---|---:|---|---|
| G6-L08 | 18 | `fig1.png` 在 `.../G6-L08/fig1.png`、`.../G6-L8/fig1.png`、`.../G6-SL8/fig1.png` 全部 404 | **(a) 圖檔不存在/未上傳** + **(b) 路徑來源用到 `G6-SL8` 也錯** |
| G7-L1 | 1080 | `fig10.png`/`fig11.png` 皆 200；md5=`44d26cab...`、`600efd70...` | 未重現破圖（非 a/b/c/d） |
| G7-L5 | 1084 | `fig10.png` 200；md5=`600efd70...` | 未重現破圖（非 a/b/c/d） |
| G7-L14 | 1093 | `fig10.png` 200；md5=`600efd70...` | 未重現破圖（非 a/b/c/d） |
| G7-L18 | 1097 | `fig10.png`/`fig2.png` 皆 200；md5=`600efd70...`、`725874d0...` | 未重現破圖（非 a/b/c/d） |
| G7-L26 | 1106 | `fig2.png` 200；md5=`db44ca87...` | 未重現破圖（非 a/b/c/d） |
| G8-L6b | 1118 | `.../G8-SL8/fig1.png` 與 `.../G8-L6b/fig1.png` 404；`.../G8-L8/fig1.png` 200 但 md5 命中 placeholder | **(b) 路徑/代碼映射錯** + **(c) 佔位圖 md5** |
| G9-L3 | 1132 | `fig2.png` 200；md5=`038bba7d...` | 未重現破圖（非 a/b/c/d） |

## 類型判定說明

- (a) 圖檔不存在/未上傳：僅確認 `G6-L08`
- (b) URL/路徑錯：`G6-L08`、`G8-L6b` 皆可看到 `spotlight_v2.lesson=G*-SL*` 導向 404
- (c) 佔位圖 md5：`G8-L6b` 命中黑名單 md5
- (d) GCS 權限：本批未出現 403，未命中

## 診斷結論（先不做逐課硬改）

1. 目前「確定可重現」的壞點集中在 2 課：`G6-L08`、`G8-L6b`  
2. 6 課（`G7-L1/G7-L5/G7-L14/G7-L18/G7-L26/G9-L3`）以 API+URL+md5 檢查皆正常，需留待 UI 視角二次驗證是否為 vision 誤判  
3. 修復方向應優先做「通則綁定修正」：不要優先取 `spotlight_v2.lesson=G*-SL*` 來組圖路徑，改以可上架課號來源（如 `grade_code` / worksheet code）為主  
4. `G6-L08` 屬真缺圖，後續應誠實標記 `content_known_gaps.yaml`（`figure_missing`），不放 placeholder 充數
