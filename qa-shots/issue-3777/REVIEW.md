# 逐畫面審查紀錄 — #3777（遊戲化學院第二輪審查 P1-2）

> 多人對抗賽入口頁補主視覺橫幅。
> 環境：本機前後端（真實帳號，建立一場尚未滿額的 team-arena session 停在 lobby 狀態）。

## 釐清：缺橫幅的不是「選擇頁」，是「加入房間後的等待室」

讀 code 才發現 `StudentTeamArenaJoin.tsx` 的「選擇頁」（發起比賽/輸入代碼加入）
**早在 #3761 round 3 就已經有橫幅**（雙塔插畫＋漸層卡，跟 PK/迷城密室一致）。
審查報告的證據檔名是 `09-teamarena-lobby.png`，對照報告原文「已經有一張不錯的雙塔插畫——
只是**沒有延伸到進入玩法後的頁面**」，缺橫幅的其實是**建立/加入房間之後**的等待室
（`StudentTeamArenaPlay.tsx` 的 `state.status === 'lobby'` 畫面：只有「比賽代碼」+ 純文字代碼 +
兩隊名單方框），不是入口選擇頁。本票範圍修正為這個畫面。

## 修法

等待室加同一張雙塔插畫（`/story-assets/team-arena-hub/icon.png`）+ 同一組漸層
（`from-[#1FA6A6] to-[#E0792B]`）做成橫幅卡，把原本獨立的「比賽代碼」文字收進橫幅裡，
兩隊名單方框維持在橫幅下方不變——跟選擇頁視覺延續、不是另一套風格。

## 截圖

| 畫面 | 桌機 | 手機 |
|---|---|---|
| 等待室（1/2 人，等對手加入） | `01-teamarena-lobby-banner-desktop.png` | `02-teamarena-lobby-banner-mobile.png` |

## 測試

- `StudentTeamArenaPlay.lobbyBanner.test.tsx`：2 條（橫幅圖片出現、代碼與隊名仍正常顯示）
- 既有 6 個 team-arena 測試檔維持綠燈（25/25）
- lint 0 error、typecheck 棘輪維持基準 34、零 backend 檔案異動
