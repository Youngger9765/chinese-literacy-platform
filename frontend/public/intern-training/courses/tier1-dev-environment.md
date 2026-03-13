# Tier 1：開發環境設定

在開始寫程式前，要把工具準備好。這份課程帶你從零開始，把 LingoLeap 在本機跑起來。

---

## VS Code 安裝 + 必裝 Extensions

VS Code 是我們的主要編輯器。下載：https://code.visualstudio.com/

安裝完後，裝這幾個 extension（在左側 Extensions 面板搜尋）：

| Extension | 用途 |
|-----------|------|
| **ESLint** | 即時顯示 JS/TS 語法錯誤和風格問題 |
| **Prettier - Code formatter** | 自動排版程式碼（存檔時自動整齊） |
| **GitLens** | 在每行程式碼旁顯示「誰、什麼時候改的」 |
| **Tailwind CSS IntelliSense** | 輸入 Tailwind class 時自動補全 |
| **ES7+ React Snippets** | 快速輸入 React 模板（`rfce` → 完整元件） |

設定 Prettier 在存檔時自動格式化：

1. 按 `Cmd+Shift+P`，輸入「Open User Settings (JSON)」
2. 加入以下設定：

```json
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.tabSize": 2
}
```

> 💡 提示：Prettier 讓所有人的程式碼風格一致，PR 時不會有「只是改了縮排」的雜訊。

---

## 終端機基礎

VS Code 內建終端機（`Ctrl+反引號` 打開）。常用指令：

```bash
# 顯示目前在哪個目錄
pwd
# /Users/靖杭/project/chinese-literacy-platform

# 列出當前目錄的檔案
ls
ls -la  # 顯示隱藏檔案和詳細資訊

# 進入目錄
cd frontend
cd ..    # 回到上一層
cd ~     # 回到家目錄

# 建立目錄
mkdir my-new-folder

# 建立檔案
touch README.md

# 刪除檔案（小心！沒有垃圾桶）
rm unwanted-file.txt
rm -rf my-folder  # 刪除整個資料夾（非常小心）

# 印出檔案內容
cat package.json

# 搜尋檔案內容
grep -r "StepperNav" frontend/src/  # 找所有包含 StepperNav 的檔案

# 管道（pipe）：把前一個指令的輸出傳給下一個
ls | grep ".tsx"  # 列出 .tsx 檔案
```

---

## Node.js + npm

Node.js 讓 JavaScript 可以在電腦上跑（不只是瀏覽器）。npm 是套件管理工具。

```bash
# 確認安裝
node --version   # v20.x.x 以上
npm --version    # 10.x.x 以上

# 如果沒安裝，用 nvm 安裝（推薦）
# 先裝 nvm：https://github.com/nvm-sh/nvm
nvm install 20
nvm use 20
```

**package.json 是什麼？**

LingoLeap 的 `frontend/package.json` 記錄了：
- 專案名稱和版本
- 相依套件（dependencies）
- 開發相依套件（devDependencies）
- 可以跑的腳本（scripts）

```json
{
  "name": "lingoleap-frontend",
  "scripts": {
    "dev": "vite",           // 啟動開發伺服器
    "build": "tsc -b && vite build",  // 打包成正式版
    "preview": "vite preview",        // 預覽打包結果
    "test": "vitest"         // 跑測試
  },
  "dependencies": {
    "react": "^19.0.0"
  }
}
```

**node_modules 是什麼？**

`npm install` 會把 `package.json` 裡列的所有套件下載到 `node_modules/` 資料夾。這個資料夾可以很大（幾百 MB），所以 `.gitignore` 裡有它——你不應該 commit node_modules，別人 clone 後自己 `npm install` 就好。

⚠️ 注意：如果你不小心 commit 了 `node_modules`，告訴 Young，他會幫你處理。

---

## 跑 LingoLeap 本地開發環境

### 步驟一：Clone 專案

```bash
git clone https://github.com/your-org/chinese-literacy-platform.git
cd chinese-literacy-platform
```

### 步驟二：啟動前端

```bash
cd frontend
npm install          # 安裝相依套件（第一次需要，之後不用）
cp .env.example .env # 建立環境變數檔案
# 編輯 .env，設定：
# VITE_API_URL=http://localhost:8000
npm run dev          # 啟動開發伺服器
```

打開瀏覽器，進入 `http://localhost:3000`，應該可以看到 LingoLeap 首頁。

### 步驟三：啟動後端（選用）

```bash
cd backend
python3 -m venv venv           # 建立虛擬環境
source venv/bin/activate       # 啟動虛擬環境（Mac/Linux）
pip install -r requirements.txt  # 安裝 Python 套件
uvicorn app.main:app --reload  # 啟動後端
```

後端跑在 `http://localhost:8000`，可以進入 `http://localhost:8000/docs` 看 API 文件。

---

## 常見問題

### port 被佔用

```
Error: listen EADDRINUSE: address already in use :::3000
```

**解法**：
```bash
# 找出佔用 3000 port 的程序
lsof -i :3000
# 看到 PID，然後 kill 它
kill -9 <PID>
```

### npm install 失敗

```bash
# 清除快取再重裝
npm cache clean --force
rm -rf node_modules package-lock.json
npm install
```

### CORS 錯誤

瀏覽器 Console 出現：`Access to fetch at ... has been blocked by CORS policy`

**原因**：前端在 `localhost:3000`，後端在 `localhost:8000`，瀏覽器阻擋跨域請求。

**解法**：確認後端已啟動，且 `.env` 裡的 `VITE_API_URL` 設定正確（指向 `http://localhost:8000`）。

---

## 確認環境設定成功

```bash
# 應該能看到版本號
node --version
npm --version
git --version

# 前端跑起來：在瀏覽器看到 LingoLeap 首頁
# http://localhost:3000

# VS Code Extensions 都裝了
# 存一個 .tsx 檔案時 Prettier 自動排版
```
