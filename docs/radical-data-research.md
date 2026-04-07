# 部件拆解資料來源研究報告

> 研究日期：2026-03-30
> 目的：為 LingoLeap 部件教學功能尋找權威、開放的資料來源

---

## 學術背景

### 曾世杰教授（台東大學特殊教育系）
- 官方頁面：https://sped.nttu.edu.tw/p/406-1035-30302,r2568.php?Lang=zh-tw
- Google Scholar：https://scholar.google.com/citations?user=kUnyA2gAAAAJ&hl=zh-TW
- 核心研究：閱讀障礙、聲韻覺識、快速自動化唸名、補救識字教學
- 著作：《有效讀寫》（心理出版社）https://www.books.com.tw/products/0010863262
- 與部件的關聯：一篇「部件強制回憶法」研究（write→cover→rewrite），非系統性部件教學法
- **結論：曾教授核心貢獻在聲韻覺識，非部件教學法的主要推動者**

### 洪儷瑜教授（台師大特教系）
- 發表著作：https://sites.google.com/view/liyuhung/%E7%99%BC%E8%A1%A8%E8%91%97%E4%BD%9C
- 2012 年提出「形→義→音」部件意義化學習模式
- 著作：《有生命的漢字：部件意義化識字教材》（心理出版社，2018）
  - 教師版：https://www.books.com.tw/products/0010797595
  - 學生版：https://www.books.com.tw/products/0010797590
  - HyRead 電子書：https://ebook.hyread.com.tw/bookDetail.jsp?id=171847
- **結論：洪儷瑜才是台灣部件意義化教學法的主要推動者，但教材為商業出版品**

### 萬雲英（中國大陸）
- 1991 年提出「集中識字」/「基本字帶字」教學法
- 最早系統化的部件教學，無開放資料集

---

## 台灣官方資料庫

### 教育部異體字字典
- URL：https://dict.variants.moe.edu.tw/
- 內容：29,921 字，有部首索引
- 授權：CC BY-ND 3.0 Taiwan（禁衍生）
- 限制：無 API，明確禁止爬蟲和程式介接
- **不可用於程式化整合**

### 教育部國語辭典（萌典 moedict）
- 官方：https://dict.revised.moe.edu.tw/
- 開放資料：https://github.com/g0v/moedict-data
- 格式：JSON（dict-revised.json.xz）
- 欄位：radical（部首）、stroke_count、heteronyms（注音/拼音）、definitions
- 授權：CC BY-ND 3.0 Taiwan（MOE 資料）
- **有中文定義，可查每個部首字的意義，但無部件教學格式**

### 全字庫 CNS11643
- URL：https://www.cns11643.gov.tw/
- 開放資料：https://data.gov.tw/dataset/5961
- GitHub 版本：https://github.com/209-Tongji/cns11643
- 格式：ZIP（TXT/CSV），7 種屬性：注音、倉頡、筆畫、部首、拼音、**部件**、筆順
- 授權：Open Government Data License v1.0（最寬鬆）
- **有「部件」欄位，台灣最權威官方來源**

### 有愛無礙（清大特教系）
- URL：https://teachers.dale.nthu.edu.tw/
- 教育部支持的特教教材網站
- 無結構化部件資料集

---

## 中研院資料庫

### 漢字構形資料庫（CDP）
- URL：https://cdp.sinica.edu.tw/cdphanzi/
- 91,510 字 + 12,208 變體
- 2013 年停止更新，桌面軟體，無 JSON
- **學術權威但實務不可用**

### 小學堂文字學資料庫
- URL：https://xiaoxue.iis.sinica.edu.tw/
- 180,000+ 字形（甲骨、金文、篆書、楷書）
- 無 API，歷史字形研究用途
- **不適合現代教學整合**

### 國際電腦漢字及異體字知識庫
- URL：https://chardb.iis.sinica.edu.tw/
- Web 介面，無批量下載

---

## GitHub 開源資料（Tier 1 — 有意義+相關字）

### saigyo/common-chinese-radicals ⭐ 最適合教學
- URL：https://github.com/saigyo/common-chinese-radicals
- 格式：TSV，100 個最常用部首
- 欄位：radical, variants, english_meaning, pinyin, **example_chars**（5 個相關字）, notes, **chinese_radical_name**（中文教學名稱如「单人旁」）
- 授權：CC-BY-SA（Olle Linge / hackingchinese.com）
- **最適合教學目的，有中文部首名稱+範例字**

### DigiDuncan CJK radicals gist ⭐ 最完整相關字
- URL：https://gist.github.com/DigiDuncan/f1288f17f97f1bc8ba525c034bb079e6
- 格式：JSON，238 個部首
- 每個部首有完整 **composites** 陣列（所有含該部首的字 + 英文定義）
- 水部有 1,080 個相關字，全部 21,009 筆
- 授權：未聲明（引用 MDBG 資料）
- **相關字數量最完整**

### nieldlr/hanzi (HanziJS)
- URL：https://github.com/nieldlr/hanzi
- 格式：JavaScript module
- 393 個部首 + 英文意義（1 個詞）
- API：`hanzi.getCharactersWithComponent('囗')` → 28 個相關字
- 授權：MIT
- **程式化最方便，但英文 only**

---

## GitHub 開源資料（Tier 2 — 有意義，無相關字）

### skishore/makemeahanzi ⭐ 最佳字源教學
- URL：https://github.com/skishore/makemeahanzi
- 格式：NDJSON（dictionary.txt），9,574 字
- 欄位：character, definition, decomposition(IDS), **etymology**（type + hint + semantic + phonetic）
- 形聲字 6,966 個，會意字 1,840 個，象形字 227 個
- 授權：LGPL
- **最適合形聲字/會意字分類教學，但英文 only**

### Synkied/hanzipy
- URL：https://github.com/Synkied/hanzipy
- 格式：JSON，650 個部首 + 英文意義
- 授權：MIT

### branneman 214 radicals gist
- URL：https://gist.github.com/branneman/f93d596ac236f0dbd9fb5b1a5099122f
- 格式：JSON，214 個康熙部首
- 欄位：id, radical, pinyin, english, strokeCount

### kanjialive/kanji-data-media
- URL：https://github.com/kanjialive/kanji-data-media
- 格式：CSV，214 部首 + 英文意義 + 日文名
- 授權：CC BY 4.0

---

## GitHub 開源資料（Tier 3 — 結構拆解 only）

### kfcd/chaizi 漢語拆字字典
- URL：https://github.com/kfcd/chaizi
- 格式：TXT，17,803 字（繁+簡）
- 授權：CC BY 3.0
- **純結構拆解，無意義**

### CHISE/IDS
- URL：https://github.com/chise/ids
- 格式：TXT，CJK Unified 20,992 字
- 授權：GPLv2（copyleft）
- **遞迴拆解（⿰亻木），無意義**

### amake/cjk-decomp
- URL：https://github.com/amake/cjk-decomp
- 75,000 字，IDS 格式

---

## 台灣 MOE 字典資料（GitHub 轉換版）

### wastu01/chinese_dictionary_collection
- URL：https://github.com/wastu01/chinese_dictionary_collection
- 國語小字典（4,720 字）、重編國語辭典修訂本
- 格式：JSON，有繁體中文定義 + 注音
- **可用於查部首字的中文意義**

### max32002/chinese_dictionary
- URL：https://github.com/max32002/chinese_dictionary
- 20,537 字，有注音、部首
- component 欄位存在但為空

### pwxcoo/chinese-xinhua
- URL：https://github.com/pwxcoo/chinese-xinhua
- 16,142 字，有中文解釋
- 授權：MIT（但資料 IP 有疑慮）

---

## Unicode 標準

### Unihan Database
- URL：https://www.unicode.org/reports/tr38/
- 下載：https://www.unicode.org/Public/UCD/latest/ucd/Unihan.zip
- kRSUnicode：部首編號 + 剩餘筆畫
- 授權：Unicode License（最寬鬆）
- **純結構映射，無意義**

### Chinese Character Web API
- URL：http://ccdb.hemiola.com/
- REST API 存取 Unihan 資料

---

## 辭典工具集

### lxs602/Chinese-Mandarin-Dictionaries
- URL：https://github.com/lxs602/Chinese-Mandarin-Dictionaries
- 包含：**漢字部件典**、小學堂、部首字典、台灣 MOE 辭典
- 格式：.mdx/.slob/.tab（辭典軟體格式）
- **漢字部件典最相關，但需轉換格式**

---

## 建議整合策略

| 層級 | 來源 | 用途 | 授權 |
|------|------|------|------|
| 1（核心） | 手動 43 字 | 最高品質教學內容 | 內部 |
| 2（部首意義） | saigyo + moedict | 中文部首名稱 + MOE 定義 | CC-BY-SA + MOE |
| 3（相關字） | DigiDuncan + makemeahanzi | 部首→相關字列表 | 需確認 + LGPL |
| 4（結構拆解） | makemeahanzi + chaizi | 字→部件分解 | LGPL + CC BY 3.0 |
| 5（筆順） | 全字庫 CNS11643 | 官方筆順資料 | Gov Open Data |
