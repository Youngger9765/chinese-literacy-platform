---
name: extract-errata
description: 抽「勘誤」這一個模組 —— 記下原稿印錯的地方與應有的樣子，產出 errata.yml 並通過它自己的 schema。⛔ 不抽其他模組、⛔ 不改任何別的模組的內容。當需要「抽勘誤」「重抽 errata」「原稿印錯了」「派工單派到 errata」時使用。來源 issue #2843。
---

# extract-errata — 勘誤

> **骨架與共同紀律在 `.claude/skills/extract-module/SKILL.md`，先讀那份。**
> 這裡只寫這個模組專屬的 know-how。

## 規模（2026-08-23 實測全庫）

```
70 / 175 課有   ·   共 99 條勘誤   ·   平均一課 1.4 條
confidence: high 88 · medium 11        ⛔ 沒有 low —— 判不準就不要寫
```

## 🔴 它跟其他模組最不一樣的地方：**它不是抽出來的，是判出來的**

其他模組回答「原稿上印了什麼」。這一個回答「**原稿印錯了，應該是什麼**」——
那是一個判斷，所以每一條都要能被別人覆核。

```yaml
lesson_uid: L0002
version_id: v3
notes:                       # ⚠️ 整包住在 notes 底下，不是頂層 errata:
  errata:
  - id: E1
    section: 一 讀全文-做記號          # 哪一大題（含序號）
    locator: 第 1 段句末                # 哪一個位置
    source: 許多動物發展出各種讓人驚嘆竹的各種生存妙招。   # ⭐ 原稿逐字
    corrected: 許多動物發展出各種讓人驚嘆的生存妙招。      # 我方主張
    kind: 贅字＋語詞重複
    why: 「驚嘆」後多一個「竹」字；且「各種」在同一句出現兩次
    confidence: high
    evidence: PDF p1 與 document.xml 一致
```

**8 個欄位是 99/99 全有的**：`id` `section` `source` `corrected` `kind` `why`
`confidence` `evidence`（`locator` 98/99）。少一個就等於少一條覆核線索。

## 🔴 專屬陷阱一：`source` 是唯一會被逐字門檢查的欄位

逐字忠實度門（⑦b）對這個模組**只驗 `source`** —— 其餘欄位（`corrected` `why`
`kind` `confidence` `evidence`）都是我方的判斷，原稿上本來就沒有那些字。

所以 `source` **必須是原稿上真的印著的那一串**，一個字都不能順手改。
它對不上原稿 = 這條勘誤本身有問題（可能是抄錯位置、或看錯行）。

⚠️ 反過來說：`source` 只有一兩個字的時候（例：大題序號「五」印成「六」），
逐字門的 4 字門檻碰不到它，會回 **🟡 驗不到**。那是誠實的狀態，
⛔ 不要為了讓它變綠而去湊長度。全庫有 22 條是這種。

## 🔴 專屬陷阱二：`confidence` 只有兩級，沒有 low

```
high 88 · medium 11 · low 0
```

判不準就**不要寫這一條**，不要寫成 `low` 放著。
勘誤是要給人採用的，一條「我也不確定」的勘誤只會讓人多花時間覆核。

`medium` 保留給「確定印錯了，但正確答案有兩種可能」的情況，
此時 `why` 要寫出另一種可能是什麼。

## 🔴 專屬陷阱三：⛔ 不要動任何別的檔

這支只產 `errata.yml`。它記的是「原稿錯了」，**不是**「我方資料錯了」——
⛔ 不可以順手去把 `corrected` 的內容寫進課文或題目裡。

原因：原稿是甲方的教材，我方的抽取結果要**忠實於原稿**（那是逐字門在守的）。
勘誤是**另外一張清單**，供人決定要不要在上線版本套用。兩件事分開。

## kind 怎麼寫（實測全庫前 8 名）

```
錯字（注音符號誤植） 8   漏字 7   贅字 6   格子錯字 6
全半形括號不成對 6   字元誤用 5   整句重複 4   標點誤用 3
```

⚠️ **「注音符號誤植」是這套教材的高頻病**：序號的「一」被打成注音「ㄧ」
（U+3127），畫面上幾乎分不出來但 `'ㄧ' != '一'` 永遠比不相等。
遇到序號對不上先查這個。

## 收尾自驗

```bash
python3 -c "
import json,yaml,sys
s=json.load(open('specs/modules/schemas/errata.schema.json'))
d=yaml.safe_load(open('$OUT'))
rows=((d.get('notes') or {}).get('errata')) or []
need={'id','section','source','corrected','kind','why','confidence','evidence'}
missing=[r.get('id') for r in rows if need - set(r)]
badconf=[r.get('id') for r in rows if r.get('confidence') not in ('high','medium')]
print('條數:', len(rows))
print('缺必要欄位的:', missing or '無')
print('confidence 不是 high/medium 的:', badconf or '無')
sys.exit(1 if (missing or badconf) else 0)"
```

再跑逐字門確認每一條的 `source` 真的在原稿裡：

```bash
python3 scripts/verbatim_gate.py --yaml <產出> --docx <原稿>
```

⚠️ 全課 `source` 都短於 4 字時它會回「受檢 0 個字串」＝ FAIL。
那是**驗不到**不是驗不過 —— `content_fidelity_attest.py` 會把它記成
`unverifiable` 而不是 `fail`，那個數字上棘輪，只准往下。

## 現況

**尚未實跑。** 上面的數字全部來自對現有 70 課 99 條的統計，
欄位語意來自實際讀過 L0002 / L0022 / L0134 的內容。
第一次真的用它抽一課的人，把「跟現有 yml 逐欄比對」的結果補進來。
