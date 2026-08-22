---
name: extract-spotlight
description: 抽「閱讀聚光燈」這一個模組。⚠️ 內容規格不在這裡 —— 在 `build-spotlight`，先讀那一份。這一份只補派工層的介面契約（照派工單只讀自己那幾頁、schema 自驗、過對帳門）。當需要「抽閱讀聚光燈」「重抽 spotlight」「派工單派到 spotlight」時使用。來源 issue #2843。
---

# extract-spotlight — 轉接，不是規格

## 🔴 內容規格在別的地方，先讀那一份

```
.claude/skills/build-spotlight/SKILL.md   （174 行）
```

那份是這個模組的**唯一內容真相** —— 版面怎麼認、欄位什麼意思、
踩過哪些坑，全在那裡。⛔ **不要在這一份重抄一遍**：抄了就會漂，
而漂掉的那一份不會報錯，只會讓下一個人照著錯的做。

**維護者：啟翔 @stgst。** ⛔ 內容規格要改就改那一份，不要改這裡。

## 這一份存在的唯一理由

派工單（`_manifest.yml`）派工時印的是「對每一架跑 **extract-<module>** skill」。
`spotlight` 這個名字以前解不到任何東西 —— 操作的人只能自己去猜是哪一支，
或者退回用通用的整包抽取器（而那正是 #2843 要離開的做法）。

⚠️ **這種缺口沒有症狀**：派工單照樣產得出來（它列的是大題不是 skill）、
形狀門照樣綠（既有 yml 是先前用別的方式抽的）。不數一次就不會知道。
鎖：`backend/tests/test_every_module_has_a_skill_2843.py`。

## 派工層的介面契約（build-spotlight 那一份寫在 #2843 之前，沒有這一段）

跑那份規格之前，這四件事先成立：

1. **只讀派工單給你的那幾頁**（`sections[].pages`）。⛔ 不要「順便看一下別頁」——
   一頁上幾乎一定有別的大題（實測 150 筆派工，100% 的課至少與別的大題共用一頁）。
2. **先確認手上這份 PDF 就是算頁碼那份**：
   `python3 scripts/assert_pdf_matches_manifest.py --uid <UID> --pdf <PDF>`
   ⛔ exit 非 0 就不要開始 —— 頁碼會整體位移，而抽取器讀到一半仍會回報成功。
3. **抽完過自己的 schema**：`specs/modules/schemas/spotlight.schema.json`
   （`additionalProperties: false`，沒宣告的欄位會被擋）。
4. **判不出來就 `needs_review: true`**，⛔ 不要猜一個看起來合理的填進去。
   寧 🟡 不假 🟢 —— 假綠會讓錯的內容以「通過」的身分穿到學生面前。

## 收尾

```bash
python3 scripts/witness_reconcile_gate.py --uid <UID> --module spotlight \
  --pdf <PDF> --section <大題名> --yaml <產出>
```

⚠️ 這道門只對**題號型**模組有意義。`spotlight` 不在 `NUMBERED_MODULES` 裡時
它會回「不適用」——那**不代表內容被驗過**，內容要靠逐字忠實度門：

```bash
python3 scripts/content_fidelity_attest.py --uid <UID> --docx <原稿>
```

## 現況

**這是轉接層，本身沒有實跑紀錄。** 實跑狀況看 `build-spotlight` 那一份。
