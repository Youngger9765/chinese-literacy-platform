---
name: extract-keypoints-followup-questions
description: 抽「重點表延伸追問」這一個模組 —— 照派工單只讀自己那幾頁，產出 keypoints_followup_questions.yml 並通過它自己的 schema。⛔ 不抽其他模組。當需要「抽重點表延伸追問」「重抽 keypoints_followup_questions」「派工單派到 keypoints_followup_questions」時使用。來源 issue #2843。
---

# extract-keypoints-followup-questions — 重點表延伸追問

> **骨架與共同紀律在 `.claude/skills/extract-module/SKILL.md`，先讀那份。**
> 這裡只寫這個模組專屬的東西。⛔ 骨架的部分不要複製過來。

## 規模（2026-08-22 實測全庫）

```
2 / 175 課有
核心欄位（≥90% 課都有）：（無 —— 見下方警告）
```

🔴 **這個模組沒有任何欄位出現在 90% 以上的課** —— 代表它的形狀高度不一致。抽之前先讀 3 課現有的 yml 看它到底長什麼樣，⛔ 不要憑一課的樣子推廣。

## 題目/內容載體

實測用的 key：`questions` / `items`

⚠️ **不只一種載體，兩種都在服務中。** 抽取時沿用該課現有 yml 的 key，⛔ 不要統一 —— 統一任何一邊都會讓那批課的消費端讀不到。

## 版面辨識

⚠️ **尚未實際讀過這個模組的 PDF 版面。**
第一個用這支抽的人，把版面特徵補進來：答案印在哪、題號長什麼樣、是否雙欄、會不會跨頁。

## 收尾自驗

```bash
python3 -c "
import json,yaml,sys
s=json.load(open('specs/modules/schemas/keypoints_followup_questions.schema.json'))
b=yaml.safe_load(open('\$OUT'))['keypoints_followup_questions']
extra=set(b)-set(s['properties']); missing=set(s['required'])-set(b)
print('未宣告欄位:', extra or '無'); print('缺必填:', missing or '無')
sys.exit(1 if (extra or missing) else 0)"
```

再跑對帳門：`python3 scripts/module_reconcile_gate.py --uid <uid>`

## 現況

**尚未實跑。** 上面的數字來自對現有語料的統計（不是猜的），但**版面辨識還是空的** —— 那要真的讀過 PDF 才寫得出來。

第一個實跑的人要補：版面特徵 + 跟現有 yml 的逐欄比對結果。
