---
name: extract-multi-text-parts
description: 抽「多文本課的第二、三篇」這一個模組 —— 一課裡有好幾篇文章時，第二篇之後的內容住這裡，產出 multi_text_parts.yml 並通過它自己的 schema。⛔ 第一篇不在這裡（它走一般模組）。當需要「抽多文本」「這課有好幾篇」「multi_text_parts」「派工單派到 multi_text_parts」時使用。來源 issue #2843。
---

# extract-multi-text-parts — 多文本課的第二篇之後

> **骨架與共同紀律在 `.claude/skills/extract-module/SKILL.md`，先讀那份。**
> 這裡只寫這個模組專屬的 know-how。

## 規模（2026-08-23 實測全庫）

```
4 / 175 課有   ·   共 6 個 part   ·   L0063(2) L0111(1) L0137(1) L0144(2)
```

**樣本只有 4 課。** 下面的「慣例」有一半是從 4 個樣本歸納的，
碰到不合的新課**先問，不要硬套**。

## 🔴 第一篇不在這裡

一課有三篇文章時：

```
第 1 篇  → 走一般模組（full_text_annotate / vocab_definitions / comprehension …）
第 2 篇  → multi_text_parts[0]
第 3 篇  → multi_text_parts[1]
```

每個 part 自己帶一整套大題（實測 `vocab_definitions` 4 個 part 有、
`comprehension` 2 個、`keypoints` 4 個…）。

⛔ **不要把第二篇的題目寫進頂層模組** —— 那會讓第一篇的題數暴增，
而見證對帳門會據此報「原稿比 yml 多」（那是假缺陷，見 #2867 / #2869 的教訓）。

## 🔴 專屬陷阱：`part_no` 現在有三種形狀，是壞的

實測 4 課：

| 課 | `part_no` | `part_of` | 判讀 |
|---|---|---|---|
| L0063 | `2`, `3`（整數） | `3`, `3` | ✅ 慣例：第幾篇 / 共幾篇 |
| L0111 | `2` | `2` | ✅ 同上 |
| L0137 | `'2/2'`（**字串**） | `'L0137'`（**課號**） | 🔴 兩欄都不對 |
| L0144 | `None`, `None` | `None`, `None` | 🔴 沒填 |

**慣例是「`part_no` = 這是第幾篇（整數），`part_of` = 全課共幾篇（整數）」。**

⚠️ L0137 把兩件事塞進一欄、又把 `part_of` 填成課號；L0144 整個沒填。
新抽的一律照慣例，⛔ 不要模仿那兩課。
（既有那兩課要不要回頭修，是另一件事 —— 先確認有沒有消費端在讀這兩欄，
沒查清楚就改會踩到 8/19 那條「本機綠、線上壞」。）

## 每個 part 的欄位

```
100%（6/6）  body · 課文作者 · 學習單            ← schema required 也是這三個
 4/6         part_no · part_of · lesson_heading · vocab_definitions · keypoints
 3/6         header_level · header_strategy · header_part
 2/6         key_reading · vocab_application · comprehension · reading_relay
             keypoints_followup_questions · part_note · part_badge
             title_line · reading_prompt · header_material_form
 1/6         spotlight · _sections
```

`body` 是那一篇的課文本身，**逐字**。它會被逐字忠實度門檢查。

`reading_relay`（閱讀接力）只在多文本課出現 —— 它問的是「後一篇比前面多說了什麼」，
本質上跨篇，所以住在 part 裡而不是頂層。

## 🔴 對帳門在多文本課上算不了

`docx_witnesses.count()` 看到同一個大題名在原稿出現多次時會回 `unknown` ——
因為第一個標題到下一節之間會橫跨第二、三篇，題號整片被算進來。
L0144 就是這樣：橫跨算會說「原稿 5 題、yml 只有 4 題」，而第一篇正好 4 題。

**那是刻意的，⛔ 不要「修好」它讓它給出答案** —— 那個答案的方向永遠是
「原稿比 yml 多」，最像真缺陷，最容易被照著開票。

## 收尾自驗

```bash
python3 -c "
import json,yaml,sys
s=json.load(open('specs/modules/schemas/multi_text_parts.schema.json'))
d=yaml.safe_load(open('$OUT'))
parts=d.get('multi_text_parts') or []
need=set(s['required'])
bad_req=[i for i,p in enumerate(parts) if need-set(p)]
extra=set().union(*[set(p) for p in parts]) - set(s['properties']) if parts else set()
bad_no=[p.get('part_no') for p in parts if not isinstance(p.get('part_no'), int)]
bad_of=[p.get('part_of') for p in parts if not isinstance(p.get('part_of'), int)]
print('part 數:', len(parts))
print('缺必填的 part:', bad_req or '無')
print('未宣告欄位:', extra or '無')
print('part_no 不是整數:', bad_no or '無')
print('part_of 不是整數:', bad_of or '無')
sys.exit(1 if (bad_req or extra or bad_no or bad_of) else 0)"
```

⚠️ 這支自驗對 **L0137 與 L0144 會紅** —— 那是既有資料的問題不是你抽錯，
新抽的課應該要綠。

再跑逐字門確認每個 part 的 `body` 逐字對得上原稿：

```bash
python3 scripts/verbatim_gate.py --yaml <產出> --docx <原稿>
```

## 現況

**已做過全庫重抽對帳（見文末實跑紀錄），但尚未逐題重抽。** 數字全部來自對現有 4 課 6 個 part 的統計。
`part_no` / `part_of` 的形狀不一致是實測發現的，不是推測。
第一次真的用它抽一課的人，把「跟現有 yml 逐欄比對」的結果補進來。


## 🔴 實跑紀錄（2026-08-23，全庫重抽對帳）

在這之前這支標著「尚未實跑」—— 本文所有數字都是**對現有語料的統計**，
不是「照這份 skill 做會抽出什麼」。

`scripts/skill_dryrun_diff.py --module multi_text_parts` 對**全部 4 課**做了一次
重抽對帳：把這個模組的每個逐字欄位從 DOCX 的 `<w:t>` 流（文件順序，不經排版）
重新取一次，跟現有 yml 逐字比對。

```
4 課 · 逐字一致 4 · 對不上 0 · 受檢 431 字串
```

**全部逐字一致。**

⛔ **這不等於「這支 skill 已驗證」。** 它回答的是一個較窄的問題：
「現有 yml 的**逐字欄位**跟原稿一字不差嗎」。它**不驗**判斷型的欄位
（`answer` / `kind` / `confidence` / `needs_review`）、也不驗「該有的東西
在不在」—— 一整個大題被漏抽，這支會是綠的。那些要人看。

⚠️ 真正逐題重抽過的只有 `extract-vocab-definitions`（L0011），
而那一次就撞出四個本文沒寫的東西，其中一個是真的抽錯
（兩欄折行處掉了一個頓號）。**統計綠 ≠ 抽得出來。**
