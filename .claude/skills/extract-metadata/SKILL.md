---
name: extract-metadata
description: 抽「課級後設資料」這一個模組 —— 年級／文體／策略／課序／作者／簡介，產出 metadata.yml 並通過它自己的 schema。⛔ 不抽任何大題內容。當需要「抽 metadata」「補課級資料」「這課是幾年級第幾課」「派工單派到 metadata」時使用。來源 issue #2843。
---

# extract-metadata — 課級後設資料

> **骨架與共同紀律在 `.claude/skills/extract-module/SKILL.md`，先讀那份。**
> 這裡只寫這個模組專屬的 know-how。

## 規模（2026-08-23 實測全庫）

```
175 / 175 課全有   ·   schema 宣告 44 個欄位，但真正常用的只有 9 個
```

## 🔴 它是課級檔，不是大題

`metadata` **不對應學習單上的任何一個大題** —— 它是整課的識別資料。
所以：

- 見證對帳門（⑥b）對它**不適用**（`run_extraction_pipeline.LESSON_LEVEL` 有列它）
- 它沒有 `items`、沒有題號、不會有「原稿 8 題 yml 只有 6 題」這種問題
- ⛔ 不要試著從它產出任何題目

## 欄位分成三層（實測 175 課）

```
100%  lesson_uid · version_id · lesson_no · series · lesson_seq     ← 缺一不可
 90%+ intro 174 課
      strategy 171 課
      genre 170 課
      level 169 課                                                  ← 核心
 <10  其餘 32 個                                                    ← 個案，別硬湊
```

**schema `required` 只有 `lesson_no` / `lesson_seq` / `series`** ——
那是最低限度，不是目標。⛔ 只填必填欄位就交等於沒抽。

### `lesson_seq` 是編出來的，不是印在紙上的

```
4 年級第 1 課 → 4100
4 年級第 2 課 → 4110
4 年級第 3 課 → 4120     （以此類推，每課 +10）
```

前一碼是年級（4–9），後三碼是課序 ×10。**留間隔是刻意的** ——
中間插課時不必重編。⛔ 不要「順手改成連號」。

### `series` 只有三種

```
一般 152 · 文言文 12 · 體育生 11
```

⛔ 不要自創第四種。看不出來就照 `catalog_slot` 的年級段判斷，
真的判不出來標 `needs_review` 讓人看。

### `level` = 年級，`genre` = 文體

```
level  4 年級 29 課 · 5 年級 30 · 6 年級 28
       7 年級 30 · 8 年級 29 · 9 年級 23      （分佈平均，異常集中就是抽錯了）
genre  說明文 71 · 記敘文 49 · 議論文 19 · 文言文 11 · 抒情文 9 · 應用文 5
```

⚠️ `genre` 是**學習單印的**，不是你讀完課文的感想。印什麼寫什麼；
印的跟內容明顯不符時，寫進 `genre_printed` 並在 `notes` 說明，
⛔ 不要自己改成「比較對的那個」。

## 🔴 專屬陷阱：`課文作者` 與 `學習單` 是兩個人，而且常常缺

```
學習單 151/175 · 課文作者 137/175
```

缺的那些**不是抽漏**，是學習單上真的沒印。⛔ 不要去別的地方找來填 ——
那會把「這份沒署名」這個事實抹掉。

同一人兼兩職時原稿常只印一行，此時寫 `課文學習單同一人: true`
（全庫 2 課這樣），而不是把同一個名字抄兩遍。

⚠️ 這一欄是**真實姓名**。它留在 `metadata.yml` 裡沒問題（這是教材的著作資訊），
但 ⛔ **不要把它複製進任何對外文件、commit message、或 issue 留言**。

## 那 32 個個案欄位

`header_target`(7) `出處`(5) `課文`(4) `學習單_後半`(3) `genre_printed`(3)
`文言文類型`(3) `課文出處`(3) … 一路到只出現 1 次的 `_header_box`。

**它們存在是因為某一課的版面真的長那樣**，不是規範。
⛔ 抽新課時不要照著填一輪 —— 只在那一課真的有那個東西時才寫。
需要新欄位時先查 schema 有沒有宣告過（`additionalProperties: false`，
沒宣告的會被形狀門擋下）。

## 收尾自驗

```bash
python3 -c "
import json,yaml,sys
s=json.load(open('specs/modules/schemas/metadata.schema.json'))
d=yaml.safe_load(open('$OUT'))
core={'lesson_no','series','lesson_seq'}
nice={'level','genre','strategy','intro'}
extra=set(d)-set(s['properties'])-{'lesson_uid','version_id'}
print('未宣告欄位:', extra or '無')
print('缺必填:', core-set(d) or '無')
print('缺核心（90% 課都有）:', nice-set(d) or '無')
print('series:', d.get('series'), '（只能是 一般/文言文/體育生）')
seq=d.get('lesson_seq')
print('lesson_seq:', seq, '· 首碼年級', str(seq)[:1] if seq else '?', '· level', d.get('level'))
sys.exit(1 if (extra or (core-set(d)) or d.get('series') not in ('一般','文言文','體育生')) else 0)"
```

⚠️ 最後那個 `lesson_seq` 首碼要跟 `level` 一致 —— 對不上代表其中一個抄錯了。

## 現況

**已做過全庫重抽對帳（見文末實跑紀錄），但尚未逐題重抽。** 數字全部來自對現有 175 課的統計。
第一次真的用它抽一課的人，把「跟現有 yml 逐欄比對」的結果補進來。


## 🔴 實跑紀錄（2026-08-23，全庫重抽對帳）

在這之前這支標著「尚未實跑」—— 本文所有數字都是**對現有語料的統計**，
不是「照這份 skill 做會抽出什麼」。

`scripts/skill_dryrun_diff.py --module metadata` 對**全部 175 課**做了一次
重抽對帳：把這個模組的每個逐字欄位從 DOCX 的 `<w:t>` 流（文件順序，不經排版）
重新取一次，跟現有 yml 逐字比對。

```
175 課 · 逐字一致 175 · 對不上 0 · 受檢 275 字串
```

**全部逐字一致。**

⛔ **這不等於「這支 skill 已驗證」。** 它回答的是一個較窄的問題：
「現有 yml 的**逐字欄位**跟原稿一字不差嗎」。它**不驗**判斷型的欄位
（`answer` / `kind` / `confidence` / `needs_review`）、也不驗「該有的東西
在不在」—— 一整個大題被漏抽，這支會是綠的。那些要人看。

⚠️ 真正逐題重抽過的只有 `extract-vocab-definitions`（L0011），
而那一次就撞出四個本文沒寫的東西，其中一個是真的抽錯
（兩欄折行處掉了一個頓號）。**統計綠 ≠ 抽得出來。**
