# 逐畫面審查紀錄 — #3772（遊戲化學院第二輪審查 P1-1）

> 多人對抗賽結算頁改用後端主題文案，不要通用甲隊／乙隊／平手。
> 環境：本機前後端（真實帳號，session 帶 `story_pack_key: "myth"`，2v2 真實對局後用
> `control action=end` 強制結束取得結算畫面）。

## 修法

`StudentTeamArenaPlay.tsx` 新增兩個小 helper（`teamLabel` / `resultCopy`），四處呼叫點改讀
`state.story`（lobby 等待室、進行中頂部狀態列、結算畫面、過渡態訊息），不再硬寫「甲隊／乙隊」
與「平手／你的隊伍獲勝！／你的隊伍差一點」。

`story.team_labels` 經查證 **永遠是兩個真實字串**（`services/team_arena/story_adapter.py`
連例外 fallback 路徑都回傳「青隊／橙隊」而非 null/空字串），所以不需要額外的「甲隊/乙隊」
防呆——這也是為什麼之前的通用文字其實完全沒有存在理由，純粹是沒接上後端已有的資料。

## 截圖

| 畫面 | 桌機 | 手機 |
|---|---|---|
| 多人對抗賽結算（探書隊 vs 尋光隊，平手，myth 主題包） | `01-teamarena-story-desktop.png` | `02-teamarena-story-mobile.png` |

親眼 Read 過：隊名顯示「探書隊」「尋光隊」（不是甲隊/乙隊），結算文字顯示
「兩隊同時讀懂了這段故事，迷霧一起散去了」（不是通用「平手」）。

## 測試

- `StudentTeamArenaPlay.storyLabels.test.tsx`：3 條（lobby 隊名、進行中頂部狀態列隊名、
  結算畫面隊名＋客製文案，都斷言「不是通用甲隊/乙隊/平手」）
- 既有 `StudentTeamArenaPlay.towerLabel.test.tsx` 等 6 個測試檔全部維持綠燈（26/26）
- lint 0 error、typecheck 棘輪維持基準 34、零 backend 檔案異動
