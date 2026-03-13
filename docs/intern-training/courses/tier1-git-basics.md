# Tier 1：Git 基礎

Git 是程式設計師每天都會用到的工具，就像 Google Docs 的「版本記錄」，但強大一千倍。

---

## 為什麼需要 Git？

想像你在改 LingoLeap 的 StepperNav 元件，改到一半發現改壞了，但你已經存檔了。沒有 Git 的話，就只能從頭來過。有了 Git，你可以：

- 隨時回到任何一個「存檔點」
- 多人同時改不同功能，不會互相覆蓋
- 每個改動都有記錄：誰改的、為什麼改

> 💡 提示：把每個 `git commit` 想成遊戲的存檔點。「關鍵時刻就存檔」是好習慣。

---

## 安裝 + 設定

```bash
# 確認已安裝
git --version
# git version 2.x.x

# 第一次設定（用你的 GitHub 帳號資料）
git config --global user.name "你的名字"
git config --global user.email "你的email@gmail.com"

# 確認設定
git config --list
```

---

## 核心概念圖

```
Working Directory  →  Staging Area  →  Repository (本地)  →  GitHub (遠端)
    (你的檔案)          (準備提交)         (已存檔)              (備份+協作)
      git add ↗           git commit ↗         git push ↗
```

重點：`git add` 是「選擇要存哪些改動」，`git commit` 是「真正存檔」。

---

## 核心指令

### `git clone` — 下載專案

```bash
# 把 LingoLeap 專案下載到本地
git clone https://github.com/your-org/chinese-literacy-platform.git

# 下載後進入目錄
cd chinese-literacy-platform
```

### `git status` — 查看現在狀態

```bash
# 在 LingoLeap 專案裡隨時可以下這個指令
git status

# 輸出範例：
# On branch staging
# Changes not staged for commit:
#   modified:   frontend/src/components/StepperNav.tsx
# Untracked files:
#   frontend/src/components/NewFeature.tsx
```

> 💡 提示：養成習慣，做任何操作前先下 `git status`，確認自己在哪、有什麼改動。

### `git add` — 選擇要提交的改動

```bash
# 加入單一檔案
git add frontend/src/components/StepperNav.tsx

# 加入資料夾下所有改動
git add frontend/src/components/

# 加入所有改動（小心用，可能加到不想加的檔案）
git add .
```

### `git commit` — 存檔（建立存檔點）

```bash
# 提交，並說明這次改了什麼
git commit -m "fix: 修正 StepperNav 在手機版的顯示問題"

# LingoLeap 專案的 commit 訊息格式：
# feat: 新功能
# fix: 修 bug
# refactor: 整理程式碼（沒改功能）
# docs: 更新文件
# test: 加測試
```

⚠️ 注意：commit 訊息要說「做了什麼」，不要只寫「update」或「fix bug」。三個月後的你（還有 Young）要靠這個搞懂當時在幹嘛。

### `git push` — 上傳到 GitHub

```bash
# 把本地的 commit 上傳到 GitHub
git push

# 如果是新建的 branch，第一次要指定 upstream
git push -u origin feature/my-feature-name
```

### `git pull` — 下載最新版本

```bash
# 把別人推上去的改動同步到本地
git pull

# 通常在開始工作前先 pull
git pull origin staging
```

### `git log` — 看存檔歷史

```bash
# 看最近的 commit 記錄
git log --oneline -10

# LingoLeap 的輸出範例：
# e1c1dc8 docs: update meeting agenda with PR review results
# bc156fa docs: update meeting agenda, team contributions
# 434bcf0 fix: move useMemo before conditional returns in VocabPractice
# 0c94eb0 docs: P7→P8 feature redistribution, module arch redesign
```

---

## 常見錯誤 + 解法

### 錯誤 1：push rejected

```
error: failed to push some refs to 'origin/...'
hint: Updates were rejected because the remote contains work
hint: that you do not have locally.
```

**原因**：別人在你之前 push 了，你的本地版本比遠端舊。

**解法**：
```bash
# 先 pull，再 push
git pull origin staging
# 如果沒衝突，就直接
git push
```

### 錯誤 2：Merge Conflict（衝突）

當你和別人改了同一個檔案的同一行，Git 不知道要保留誰的，就會出現衝突標記：

```
<<<<<<< HEAD
const steps = ['簡介', '朗讀', '理解'];  // 你的版本
=======
const steps = ['簡介', '逐段朗讀', '課文理解'];  // 別人的版本
>>>>>>> origin/staging
```

**解法**：
1. 打開 VS Code，會有「Accept Current Change / Accept Incoming Change / Accept Both」按鈕
2. 選擇保留哪個版本（通常要跟 Young 確認）
3. 存檔後 `git add` 再 `git commit`

> 💡 提示：Conflict 不是錯誤，是正常的協作過程。看到不要慌，一個一個解決就好。

---

## 練習題

**任務**：Clone LingoLeap → 改 README → Commit → Push

```bash
# 步驟 1：Clone 專案
git clone https://github.com/your-org/chinese-literacy-platform.git
cd chinese-literacy-platform

# 步驟 2：建立自己的 branch（不要在 staging 上改！）
git checkout -b feature/intern-your-name-hello

# 步驟 3：用 VS Code 打開 README.md，在最後加一行
# 「靖杭於 2026-03-13 完成第一個 commit」

# 步驟 4：查看改動
git status
git diff README.md

# 步驟 5：提交
git add README.md
git commit -m "docs: 靖杭完成 Git 基礎練習"

# 步驟 6：推上去
git push -u origin feature/intern-your-name-hello
```

完成後截圖給 Young，他會確認 GitHub 上有你的 branch。
