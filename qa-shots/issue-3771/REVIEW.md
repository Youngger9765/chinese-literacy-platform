# 逐畫面審查紀錄 — #3771（遊戲化學院第二輪審查 P0-2）

> 團體擂台／課堂搶答的結算／提前結束畫面補上離開／再玩按鈕。
> 環境：本機前後端（真實帳號：本機新建 1 教師 + 4 測試學生 + 1 team-arena session 用 `control action=end` 強制結束，
> 1 live-quiz game 用教師 `/end` 提前結束）。

## 修法

新增共用元件 `GameResultActions`（`frontend/src/components/game/GameResultActions.tsx`），
不動 PK 已經在用的三按鈕版本，只給兩個新畫面需要的最小兩按鈕形狀：

| 畫面 | 再玩一場 | 回遊戲區 |
|---|---|---|
| 多人對抗賽結算 | 導向 `/team-arena`（重新配對／開新場，團隊賽沒有單一對手可「換」）| 導向 `/game-hub` |
| 課堂搶答結束 | 無此按鈕（場次由老師開啟，學生沒有「再玩一場」的對應動作）| 導向 `/game-hub` |

## 截圖

| 畫面 | 桌機 | 手機 |
|---|---|---|
| 多人對抗賽結算（平手，2v2） | `01-teamarena-ended-desktop.png` | `02-teamarena-ended-mobile.png` |
| 課堂搶答提前結束 | `03-livequiz-ended-desktop.png` | `04-livequiz-ended-mobile.png` |

兩張都親眼 Read 過：按鈕清楚可見、文字正確、唯一 CTA（課堂搶答只有一個按鈕）採實心主色，
雙按鈕（團體擂台）維持「再玩一場=實心／回遊戲區=外框」的次要樣式，跟 PK 入口已建立的慣例一致。

## 測試

- `GameResultActions.test.tsx`：3 條（雙按鈕各自觸發對應 handler、省略 onReplay 時只渲染一個按鈕、預設文案）
- `StudentTeamArenaPlay.resultActions.test.tsx`：3 條（按鈕出現、再玩一場導航、回遊戲區導航）
- `StudentLiveQuizPlay.resultActions.test.tsx`：3 條（自然結束與老師提前結束都有按鈕、導航正確、無"再玩"按鈕）
- lint 0 error、typecheck 棘輪維持基準 34、零 backend 檔案異動
