---
name: three-version-converter
description: 教材「教師版→學生版＋簡答版」轉換器（白字法隱藏答案、版面 100% 一致）。老師要把教師版 docx 轉成學生版與簡答檔時使用。觸發詞：轉學生版、產生簡答、三版本、批次轉換教材。跨平台（Claude Code / Codex / Windows / Mac / Linux）；完整規範見 AGENTS.md。
---

# 教材三版本轉換器

教師版 docx → **學生版**（答案白化、版面 100% 一致）＋ **簡答版** ＋ **轉換明細**

## 原理：白字清空法
答案文字不動、只改白色（列印看不見）→ 版面與教師版完全一致
⚠️ 電子檔全選仍看得到白字答案 → 學生版一律**印紙本**發

## 環境（首次一次，自動辨識 OS）
- Windows → `setup.ps1`
- Mac / Linux → `bash setup.sh`

裝 LibreOffice + poppler + ImageMagick + python-docx/lxml + `fonts/` 內開源字型

> ⚠️ **`fonts/` 沒有放進這個 repo** —— 六個開源字型檔共約 **48MB**，進 PUBLIC repo 的 git history 是不可逆的膨脹。
> `setup.sh` 已經處理這個情況：找不到 `fonts/` 時它會印出要把 `.ttf`/`.ttc` 放到哪裡，然後你重跑一次就好。
>
> 需要的字型（都是開源，可從各自官方來源取得，或向專案 owner 索取整包）：
> `BpmfGenYoGothic-R.ttf`｜`BpmfIansui-Regular.ttf`｜`Iansui-Regular.ttf`｜`GenSenRounded-B.ttc`｜`NotoSansTC-Regular.ttf`｜`NotoSansTC-Bold.ttf`
>
> 排版對齊**依賴這些字型**（字寬差會造成跨頁跑版）→ 缺字型就跑，產出的版面不保證與教師版一致。

## 跑一課
```
python3 scripts/pipeline.py "<教師版.docx>" <輸出資料夾> <課次tag>
python3 scripts/audit.py    "<教師版.docx>" "<輸出資料夾>/<tag>學生版.docx"
python3 scripts/make_ans.py "<課名>" "<輸出>/<tag>answers.tsv" "<輸出>/<tag>簡答.docx"
```
pipeline 印 `RESULT: PASS`、audit 印 `0 個格式差異` = 過

## 鐵律
- 一課一課做；FAIL 先讀 `<tag>qc.txt` → 修 `scripts/convert.py` 規則 → 之前通過的課回歸重跑
- 改規則前先讀 `docs/轉換規則與教訓紀錄.md`（含完整答案標記規約）
- 缺標楷體/新細明體時逐頁比對自動略過（Windows 原生有；轉換正確性由結構稽核保證）

完整操作規範與跨平台細節 → `AGENTS.md`
