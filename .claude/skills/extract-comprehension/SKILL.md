---
name: extract-comprehension
description: 抽「閱讀理解」這一個模組 —— 照派工單只讀自己那幾頁，產出 comprehension.yml 並通過它自己的 schema。⛔ 不抽其他模組。當需要「抽閱讀理解」「重抽 comprehension」「派工單派到 comprehension」時使用。來源 issue #2843。
---

# extract-comprehension — 閱讀理解

> **骨架與共同紀律在 `.claude/skills/extract-module/SKILL.md`，先讀那份。**
> 這裡只寫閱讀理解專屬的 know-how。

## 這個模組的規模（2026-08-22 實測全庫）

```
172 / 175 課有       缺 3 課（已登錄 content_known_gaps）
schema: required=[instruction]  ·  enforcement=error
```

---

## 🔴 專屬陷阱一：`options` 是 **dict** 不是 list

**172 課全部是 dict**，沒有一課是 list：

```yaml
options: {A: 天差地遠, B: 揚眉吐氣, C: 不分上下, D: 寡不敵眾}   # ✅ 實際長這樣
options: [天差地遠, 揚眉吐氣, 不分上下, 寡不敵眾]                # ❌ 從沒出現過
```

`answer` 對應的是 **dict 的 key**（`"C"`），不是索引（`2`）。

⚠️ 這正是 2026-08-19 那批 bug 的形狀 —— 有 code 把它當 list 讀，
`.get()` 回 `None`，**不報錯、門全綠、學生看不到題目**。
產出時務必維持 dict，⛔ 不要「順手正規化」成 list。

## 🔴 專屬陷阱二：題目載體有兩種 key

```
questions   144 課
items        27 課
questions + groups   1 課
```

**不要統一。** 兩種都在服務中，改任何一邊都會讓那批課的消費端讀不到。
抽取時**照原本那課用的 key** —— 判斷方式：先讀該課現有的 yml，沿用它的 key。
新課（沒有現有 yml）用 `questions`，那是主流。

⛔ 這件事不要自作主張統一 —— 真要統一是另一張票，要先查所有消費端。

## answer 的形狀

172 課全部是**單一大寫字母字串**（A/B/C/D），分布平均（A 41 / B 41 / C 51 / D 39）。

- ⛔ 不要寫成索引數字
- ⛔ 不要寫成選項全文
- 判不出正解 → `answer: null` + `needs_review: true`（骨架 §2.1，寧 🟡 不假 🟢）

## `teacher_note`：教師版的解析

教師版常在選項下方印小字解析（如「（勢均力敵表示兩方對手實力相近）」）。

- 有印就抄進 `teacher_note`，**逐字**
- ⛔ 不要自己寫解析 —— 那是造假教材內容
- 學生版沒有這欄，缺了不是錯

## 版面辨識

閱讀理解在學習單上的樣子（實測 L0011 p5-6、L0153 p9）：

```
（ C ）1. 請問「勢均力敵」，可以用哪個詞語替換？
        A.天差地遠   B.揚眉吐氣   C.不分上下   D.寡不敵眾
```

- **答案印在題號前的括號裡**（教師版是紅字/橘字手寫體）
- 選項可能橫排也可能直排，都要抓
- ⚠️ 題目可能**跨頁**（L0011 的 Q1-2 在 p5、Q3-5 在 p6）——
  manifest 的 `pages` 會給範圍，讀完整個範圍再收

## 🔴 不屬於這個模組的

閱讀理解那一節有時**上方還有一個表格**（如 L0011 p5 的「球風 / 背景 / 經過 / 結果」勾選表）。

那個表**看起來像**閱讀理解的一部分，但它的答案載體是 ☑ 不是 A/B/C/D，
形狀完全不同。**先查該課的 `sections_present`**：如果那個表屬於別的大題（多半是文章重點表），
就不要抽進來。判不出 → `needs_review` 並在回報說明，⛔ 不要硬塞。

## 收尾自驗

```bash
python3 -c "
import json,yaml,sys
s=json.load(open('specs/modules/schemas/comprehension.schema.json'))
d=yaml.safe_load(open('$OUT')); b=d['comprehension']
extra=set(b)-set(s['properties']); missing=set(s['required'])-set(b)
qs=b.get('questions') or b.get('items') or []
bad_opt=[q['index'] for q in qs if not isinstance(q.get('options'), dict)]
bad_ans=[q['index'] for q in qs if q.get('answer') is not None and
         not (isinstance(q['answer'],str) and len(q['answer'])==1)]
print('未宣告欄位:', extra or '無'); print('缺必填:', missing or '無')
print('options 非 dict 的題:', bad_opt or '無')
print('answer 非單字母的題:', bad_ans or '無')
sys.exit(1 if (extra or missing or bad_opt or bad_ans) else 0)"
```

再跑對帳門：`python3 scripts/module_reconcile_gate.py --uid <uid>`

## 現況

**已做過全庫重抽對帳（見文末實跑紀錄），但尚未逐題重抽。** 上面的數字全部來自對現有 172 課的統計，
版面描述來自實際讀過 L0011 與 L0153 的 PDF。
第一次真的用它抽一課的人，把「跟現有 yml 逐欄比對」的結果補進來。


## 🔴 實跑紀錄（2026-08-23，全庫重抽對帳）

在這之前這支標著「尚未實跑」—— 本文所有數字都是**對現有語料的統計**，
不是「照這份 skill 做會抽出什麼」。

`scripts/skill_dryrun_diff.py --module comprehension` 對**全部 172 課**做了一次
重抽對帳：把這個模組的每個逐字欄位從 DOCX 的 `<w:t>` 流（文件順序，不經排版）
重新取一次，跟現有 yml 逐字比對。

```
172 課 · 逐字一致 172 · 對不上 0 · 受檢 4742 字串
```

**全部逐字一致。**

⛔ **這不等於「這支 skill 已驗證」。** 它回答的是一個較窄的問題：
「現有 yml 的**逐字欄位**跟原稿一字不差嗎」。它**不驗**判斷型的欄位
（`answer` / `kind` / `confidence` / `needs_review`）、也不驗「該有的東西
在不在」—— 一整個大題被漏抽，這支會是綠的。那些要人看。

⚠️ 真正逐題重抽過的只有 `extract-vocab-definitions`（L0011），
而那一次就撞出四個本文沒寫的東西，其中一個是真的抽錯
（兩欄折行處掉了一個頓號）。**統計綠 ≠ 抽得出來。**
