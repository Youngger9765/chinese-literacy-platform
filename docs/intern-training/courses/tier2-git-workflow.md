# Tier 2：Git 工作流

Git 基礎你已經學過了（`tier1-git-basics.md`）。這一課講的是「在真實團隊裡怎麼用 Git」。光會 `commit` 和 `push` 還不夠，你需要懂分支策略和 PR 流程。

---

## 為什麼不能直接 commit 到 main？

想像 LingoLeap 有 500 個學生每天在用。你在修一個 bug，改到一半，存檔了，push 上去。這 500 個學生的畫面直接壞掉。

這就是為什麼要有分支：

```
feature/fix-vocab-bug  ←── 你在這裡改
        ↓ (PR + review 確認沒問題)
    staging            ←── 測試環境
        ↓ (再次確認)
      main             ←── 正式環境（學生在用的）
```

- `main`：正式環境，不能直接 push，只能透過 PR 合併
- `staging`：測試環境，你的 PR 先合進這裡，大家測試沒問題再上 main
- `feature/*`：你的工作分支，想改什麼就在這裡改

> 💡 提示：YoungLing 的 pre-commit hook 會阻止你直接在 `staging` 上改程式碼。如果看到「protected branch」的錯誤，代表你忘記建 feature branch 了。

---

## LingoLeap 完整 PR 流程

### 步驟一：從最新的 staging 建立 feature branch

```bash
# 確保你有最新的 staging
git checkout staging
git pull origin staging

# 建立你的 feature branch
# 格式：feature/issue-{編號}-{簡短說明}
git checkout -b feature/issue-123-fix-vocab-display
```

為什麼要從 staging 而不是 main 建？因為 staging 比 main 更新，包含其他人最近合進去的改動。

### 步驟二：開發 + 存檔

正常開發，改完記得 commit：

```bash
# 查看改了哪些檔案
git status

# 加入改動
git add frontend/src/components/reading-steps/VocabPractice.tsx

# Commit，訊息格式：類型(範圍): 說明
git commit -m "fix(vocab): 修正生字卡在手機版的顯示問題 (#123)"
```

**Commit 粒度建議**：每完成一個小的、可以獨立描述的改動就 commit 一次。不要「改了一整天，一次 commit 所有東西」。

```bash
# 好的 commit 歷史（一步一步）
# feat(vocab): 新增生字卡翻轉動畫
# feat(vocab): 新增注音顯示切換
# fix(vocab): 修正卡片高度在 Safari 的問題

# 不好的 commit 歷史
# fix: 各種修正
```

### 步驟三：Push 到 GitHub

```bash
# 第一次 push 這個 branch 要加 -u
git push -u origin feature/issue-123-fix-vocab-display

# 之後再 push 直接
git push
```

### 步驟四：開 Pull Request

用 `gh` 指令（GitHub CLI）開 PR：

```bash
gh pr create \
  --base staging \
  --title "fix(vocab): 修正生字卡在手機版的顯示問題" \
  --body "## 改了什麼

修正 #123。

VocabPractice 在手機版（< 375px）生字卡會超出畫面。

## 測試方式

1. 在 Chrome DevTools 切換到手機模式（iPhone SE）
2. 進入任一課文的生字練習
3. 確認所有生字卡都在畫面內"
```

或者直接上 GitHub 網頁開 PR，步驟大概是：
1. 進 GitHub repo → 點「Compare & pull request」
2. Base 選 `staging`，不是 `main`
3. 填寫說明（改了什麼 + 怎麼測試）
4. 送出

> 💡 提示：PR 說明要讓 reviewer 知道「怎麼測試你的改動」，不是只說「修了 bug」。

### 步驟五：等 Review + 處理意見

Young 或其他人會看你的 PR，留下 review 意見。意見有兩種：

- **Comment**：建議，你可以選擇要不要改
- **Request changes**：你**必須**修改，修完後 re-request review

```bash
# 根據意見修改程式碼
# 改完後 add + commit + push（自動更新 PR）
git add frontend/src/components/reading-steps/VocabPractice.tsx
git commit -m "refactor(vocab): 根據 review 意見抽出 CardWrapper 元件"
git push
```

修完後在 PR 頁面點「Re-request review」通知對方再看一次。

### 步驟六：Merge

PR 被 approve 後，由 reviewer（通常是 Young）點 Merge 按鈕。你的 feature branch 就合進 staging 了。

---

## Conflict 解法（一步一步）

Conflict 發生在「你和別人改了同一個檔案的同一行」。這很正常，不要慌。

### 情境：你的 PR 跟另一個已合併的 PR 衝突了

```bash
# 步驟 1：把最新的 staging 抓下來
git checkout staging
git pull origin staging

# 步驟 2：切回你的 feature branch
git checkout feature/issue-123-fix-vocab-display

# 步驟 3：把 staging 的改動「重播」到你的分支上
git rebase staging
```

`rebase` 過程中如果有衝突，Git 會暫停，告訴你哪些檔案有問題：

```
CONFLICT (content): Merge conflict in frontend/src/components/reading-steps/VocabPractice.tsx
```

```bash
# 步驟 4：打開 VS Code，看到衝突標記
# <<<<<<< HEAD（你的版本）
# ...你的程式碼...
# =======
# ...別人的程式碼...
# >>>>>>> staging

# 在 VS Code 裡點選擇要保留哪個（或者手動合併兩邊的改動）
# 存檔

# 步驟 5：告訴 Git 衝突解決了
git add frontend/src/components/reading-steps/VocabPractice.tsx
git rebase --continue

# 步驟 6：強制 push（rebase 後需要 force push）
git push --force-with-lease
```

⚠️ 注意：`--force-with-lease` 比 `--force` 安全，它會先確認遠端沒有你不知道的新 commit 才 force push。

---

## 常見錯誤 + 解法

### 錯誤 1：在 staging 上直接改程式碼

```
Error: Direct edits to staging are not allowed.
Please create a feature branch first.
```

**解法**：
```bash
# 把你的改動「帶走」到新 branch
git stash                                        # 暫存改動
git checkout -b feature/issue-xxx-your-fix       # 建新 branch
git stash pop                                    # 還原改動
```

### 錯誤 2：忘記 `git pull` 就開始工作

你的 staging 比遠端舊，建出來的 feature branch 也是舊的，最後 PR 會有很多 conflict。

**解法**：每次開始工作前的第一個指令就是：
```bash
git checkout staging && git pull origin staging
```

---

## 練習

**任務**：完整走一次 PR 流程

1. 從最新的 staging 建立 `feature/intern-{你的名字}-practice` branch
2. 在 `frontend/src/components/` 下新增一個 `InternSignature.tsx`，內容是一個顯示你名字的小元件（隨便寫就好）
3. Commit（訊息要符合 Conventional Commits 格式）
4. Push
5. 開 PR，base 設定為 `staging`，PR 標題 + 說明要寫清楚
6. 截圖 PR 頁面給 Young

不需要真的 merge，開好 PR 就算完成。Young 會留 review 意見，你練習怎麼回應。
