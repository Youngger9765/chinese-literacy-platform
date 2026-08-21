---
name: extract-vocab-definitions
description: 抽「語詞我最棒」這一個模組 —— 照派工單只讀自己那幾頁，產出 vocab_definitions.yml 並通過它自己的 schema。⛔ 不抽其他模組。當需要「抽語詞我最棒」「重抽 vocab_definitions」「派工單派到 vocab_definitions」時使用。來源 issue #2843。
---

# extract-vocab-definitions — 語詞我最棒

> **骨架與共同紀律在 `.claude/skills/extract-module/SKILL.md`，先讀那份。**
> 這裡只寫這個模組專屬的 know-how。

## 規模（2026-08-22 實測全庫）

```
150 / 175 課有   ·   題目載體 100% 是 items（沒有第二種）
schema: required=[items]  ·  核心(90%)=[instruction, items, vocabulary_bank]
```

⚠️ 跟 `comprehension` 不同 —— 那個模組有 `questions`/`items` 兩種載體，
**這個只有一種**。別把那邊的紀律照搬過來。

---

## 🔴 專屬陷阱一：有沒有語詞框，決定欄位叫什麼

```
143 課  vocabulary_bank 是 list   → item 用 word
  7 課  vocabulary_bank 是 None   → item 用 answer
```

```yaml
# 有語詞框（143 課）：學生從框裡挑
vocabulary_bank: [喝采, 龍爭虎鬥, 讚嘆不已, …]
items: [{index: 1, word: 龍爭虎鬥, definition: 形容像巨龍和猛虎般地相互爭鬥…}]

# 沒有語詞框（7 課，如 L0137）：學生自己想
vocabulary_bank: null
items: [{index: 1, answer: 人煙稀少, definition: 形容一個地方住的人很少…}]
```

**這不是不一致，是兩種題型。** `word` = 從給定的框裡挑那一個；
`answer` = 沒有框、學生自己填。

⛔ **不要統一成同一個欄位名** —— 那會把「這課有沒有給語詞框」這個資訊抹掉，
而那正是判分方式的差別（前者可以做成選擇/拖拉，後者只能 free_text）。

判斷方式：**看那一頁有沒有印語詞框**。有 → `vocabulary_bank` + `word`；
沒有 → `vocabulary_bank: null` + `answer`。

## 🔴 專屬陷阱二：一格填兩個詞是正常的

```
L0003 / L0085   word: 徵兆、前兆              bank 裡是 ['徵兆', '前兆'] 分開兩筆
L0045           word: 兵來將擋，水來土掩       bank 裡是 ['兵來將擋', '水來土掩']
```

學習單上那一格的答案就是**兩個詞並列**，bank 分開列是因為它列的是「可選的語詞」。

⛔ 這不是抽錯，**不要拆開也不要改 bank**。
所以「`word` 一定要能在 `vocabulary_bank` 裡找到」這條**不成立**，
鎖只驗「多詞答案的每一段都在 bank 裡」。

## 版面辨識

實測 L0011 p3-4：

```
本課語詞：喝采、龍爭虎鬥、讚嘆不已、摸不著頭緒、…    ← 語詞框（虛線框，通常在右上）

(1)___龍爭虎鬥___：形容像巨龍和猛虎般地相互爭鬥，難分高低。
(2)___捶胸頓足___：捶打胸膛，以腳跺地。形容極為悲憤或悔恨。
```

- 答案寫在**底線上**（教師版是橘色手寫體）
- 題號是 `(1)(2)(3)…` 帶括號，不是「一二三」
- **雙欄排版**：左欄 (1)-(6)、右欄 (7)-(11)，⚠️ 要照**編號**收不是照視覺順序
- ⚠️ 可能跨頁（L0011 的補充註解在 p4）

## 收尾自驗

```bash
python3 -c "
import json,yaml,sys
s=json.load(open('specs/modules/schemas/vocab_definitions.schema.json'))
b=yaml.safe_load(open('$OUT'))['vocab_definitions']
extra=set(b)-set(s['properties']); missing=set(s['required'])-set(b)
items=b.get('items') or []
bank=b.get('vocabulary_bank')
# 有 bank 用 word、無 bank 用 answer
wrong=[i.get('index') for i in items
       if ('word' in i) != (bank is not None)]
print('未宣告欄位:', extra or '無'); print('缺必填:', missing or '無')
print('欄位名跟有無語詞框對不上的題:', wrong or '無')
sys.exit(1 if (extra or missing or wrong) else 0)"
```

再跑對帳門：`python3 scripts/module_reconcile_gate.py --uid <uid>`

## 現況

**尚未實跑。** 數字來自對現有 150 課的統計，版面描述來自實際讀過 L0011 的 PDF。

### 骨架可複用性（第 2 支的意義）

這支寫下來，**骨架的部分一行都沒重寫** —— 只讀 `pages`、schema 自驗、
註解進 `notes`、判不出就 `needs_review`，全部沿用 `extract-module`。
專屬內容只有上面兩個陷阱加版面辨識。

→ 骨架可複用，其餘 22 支可以照這個形狀擴。
