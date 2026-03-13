# Tier 4：獨立開發功能

到了 Tier 4，你有能力從一個 GitHub Issue 出發，獨立完成整個功能開發。這一課講的是整個流程怎麼跑，包含需求分析、任務拆解、MVP 思維。

---

## 完整開發流程

```
Issue → 需求分析 → Branch → 設計 → 實作 → 測試 → PR → Review → Merge
```

每個步驟都很重要，跳過任何一步都會讓後面更麻煩。

---

## 步驟一：讀懂 Issue

Issue 寫的是「要什麼」，不是「怎麼做」。你的工作是把「要什麼」翻譯成「實作計畫」。

假設你拿到這個 Issue：

```
Issue #300
標題：學生完成每個步驟後顯示鼓勵訊息

描述：
目前學生完成步驟後直接跳到下一步，沒有任何反饋。
希望在每個步驟完成後，顯示一個短暫的鼓勵訊息（例如「棒極了！繼續加油！」），
2-3 秒後自動消失或點擊關閉。
```

讀完 Issue 後，**寫出你的理解**，確認跟 Issue 提出者（方大哥或 Young）的期望一致，再開始做：

```markdown
## 我對 #300 的理解

**觸發時機**：完成任何一個學習步驟後（例如生字練習做完、朗讀評分完成）

**顯示內容**：隨機或固定的鼓勵訊息（例如：「做得很好！」「繼續努力！」）

**消失方式**：2-3 秒自動消失，也可以點 X 手動關閉

**我不確定的地方**：
- 每個步驟都顯示，還是只有特定步驟？
- 鼓勵訊息的文字是固定的，還是 AI 生成？

請確認我的理解正確後，我再開始做。
```

> 💡 提示：用 5 分鐘確認需求，省下 2 小時做錯方向。

---

## 步驟二：需求轉成驗收條件

把需求轉成「Given/When/Then」格式的驗收條件。這樣做完後，你會有清楚的「完成定義」。

```markdown
## Issue #300 驗收條件

1. Given 學生完成生字練習步驟
   When 步驟結果成功
   Then 顯示鼓勵訊息元件，持續 3 秒後自動消失

2. Given 鼓勵訊息顯示中
   When 學生點擊 X 關閉按鈕
   Then 訊息立即消失

3. Given 步驟失敗（例如分數不夠）
   When 結果出來
   Then 不顯示鼓勵訊息（或顯示不同的加油訊息）
```

---

## 步驟三：任務拆解

大任務拆成小步驟，每個步驟能獨立 commit。

```markdown
## #300 任務拆解

1. [元件] 建立 EncouragementToast.tsx（只是顯示用的 UI）
   - 接收 message 和 onClose props
   - 白色小卡，右上角 X
   - Tailwind 樣式

2. [邏輯] 在 EncouragementToast 加上自動消失
   - 3 秒後自動呼叫 onClose
   - useEffect + setTimeout + cleanup

3. [整合] 在 App.tsx 加上 toast state
   - useState<string | null>，null = 不顯示
   - showEncouragement(message) 函式

4. [整合] 在各步驟完成時觸發 showEncouragement
   - VocabPractice 完成後
   - DictationPractice 完成後

5. [測試] 手動測試所有觸發點
```

> 💡 提示：任務拆得越細，commit 歷史越清晰，PR review 也更容易。

---

## 步驟四：MVP 思維

MVP = Minimum Viable Product（最小可用版本）。先做最基本能運作的版本，再逐步改進。

```
不好的思維：
「我要做一個完美的 toast 系統，支援多種樣式、動畫、佇列管理...」
（花兩週，結果太複雜、改不動、也可能根本不是方大哥要的）

好的思維：
「先做一個最簡單的版本：顯示訊息 + 3 秒消失。
讓方大哥看到後，他覺得夠用就直接上，覺得不夠再改進。」
（花兩天，馬上有反饋）
```

---

## 步驟五：開 Branch + 開始實作

```bash
# 確認 Issue 沒有其他人在做
gh issue view 300

# 建立 feature branch
git checkout staging && git pull origin staging
git checkout -b feature/issue-300-encouragement-toast

# 自己 assign issue
gh issue edit 300 --add-assignee @me
```

---

## 步驟六：邊做邊 commit

```bash
# 完成任務拆解的第一項後就 commit
git add frontend/src/components/ui/EncouragementToast.tsx
git commit -m "feat(ui): 新增 EncouragementToast 元件 (#300)"

# 完成第二項
git commit -m "feat(ui): EncouragementToast 3 秒後自動消失 (#300)"

# 不要等所有任務都做完才 commit
```

---

## 步驟七：開 PR + 說明測試方法

```bash
gh pr create \
  --base staging \
  --title "feat: 步驟完成後顯示鼓勵訊息 (#300)" \
  --body "## 改動說明

新增 EncouragementToast 元件，學生完成每個步驟後顯示。

Closes #300

## 測試方式

1. 進入任一課文的生字練習
2. 完成練習（翻完所有生字卡）
3. 確認右下角出現鼓勵訊息
4. 等 3 秒確認自動消失
5. 再做一次，這次按 X 手動關閉"
```

---

## 練習

**任務**：從 LingoLeap 的 Issue 清單選一個功能，完整跑一次流程

```bash
gh issue list --label enhancement --assignee ""  # 找沒有 assignee 的功能 issue
```

選定後：

1. 寫出「我對這個 Issue 的理解」（給 Young 確認）
2. 寫出驗收條件（Given/When/Then）
3. 拆解任務清單
4. 建立 feature branch
5. 實作 + 分批 commit
6. 開 PR

不要跳過任何步驟，尤其是第 1-3 步。那三步做完，後面的實作會快很多。
