# 逐畫面審查紀錄 — #3778（遊戲化學院第二輪審查 P2-1 + P2-3）

## P2-3 跨班賽季空狀態改插畫風格 — 完整真實截圖驗證

環境：本機前後端，真實學生帳號（無任何跨班賽季），`/student/our-class`。

| 畫面 | 桌機 | 手機 |
|---|---|---|
| 無賽季空狀態（複用既有「跨班賽季」嚮導角色插畫） | `01-league-empty-desktop.png` | `02-league-empty-mobile.png` |

修法：空狀態加一張深色漸層卡，放既有 `guide-changan-greet.png`（跨班賽季嚮導角色，#3554 已建立，
本次沒有新生圖），文字維持原意但拆成兩行放進卡片內。測試 `StudentOurClassPage.emptyState.test.tsx`
鎖定插畫與文字同時出現，既有 `StudentOurClassPage.battleHero.test.tsx` 維持綠燈。

## P2-1 多人對抗賽隊友動作回饋 — 真實環境重現困難，改以精確單元測試驗證

嘗試本機真實重現：建立 2v2 對局，讓非當前答題的隊友帳號開著頁面輪詢，另一帳號即時答對
觸發塔被打倒。實測發現：單輪作答視窗（reading_seconds + answer_seconds）與 toast 本身的
2.5 秒顯示時間，兩個時間窗對不齊，手動用 curl 觸發＋截圖的方式在合理嘗試次數內沒能穩定
抓到畫面（這本來就是這類「稍縱即逝的即時提示」用真瀏覽器截圖驗證的已知限制——跟 PK 的
「答對了！」提示同樣難截，差別是 PK 的提示由同一個使用者的動作觸發，時間點自己可控；
這裡要等「另一位真人隊友」的動作，時間點不受控）。

**改用能忠實驗證這個行為的最低層**：`StudentTeamArenaPlay.teammateToast.test.tsx`
直接模擬輪詢前後兩次狀態快照（跟既有 `attackEveryHit.test.tsx`、`towerLabel.test.tsx`
用的手法一致），精確鎖住三種語意情境：

1. 非當前答題的隊友（`am_i_active: false`）在**我方**打倒敵方塔時看到慶祝提示（`bg-success`）
2. **我方**塔被打倒時看到不同語氣的提示（非 `bg-success`）
3. 純粹的 HP 掉血（塔沒倒）不會洗版跳提示

這三條比單一張偶然截到的截圖更完整地覆蓋了這個功能要驗證的行為。若工頭要真實瀏覽器畫面，
部署後測試站有多個真實學生同時連線時更容易重現，屆時可以補截。

## 測試

- `TeammateActionToast.test.tsx`：2 條（文字渲染、好/壞消息樣式不同）
- `StudentTeamArenaPlay.teammateToast.test.tsx`：3 條（上述三種語意情境）
- `StudentOurClassPage.emptyState.test.tsx`：1 條
- 既有相關測試檔維持綠燈
- lint 0 error、typecheck 棘輪維持基準 34、零 backend 檔案異動
