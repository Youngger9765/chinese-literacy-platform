# yml 形狀正規化 —— 手順與 TODO

> 隸屬 issue #2843（抽取器 skill 模組化）。這份管的是**現有 2019 份 yml 的形狀**，
> 不是抽取器本身。抽取器架構的 PRD 在 `extractor-skill-architecture.md`（PR #2844）。
>
> Young 2026-08-21：「我期待現在的 yml 可以再檢查過，不要每一份模組的 yml schema 都不同」

---

## 0. 先更正一個會誤導人的數字

PR #2844 的 PRD 寫「2019 個檔 / 597 種 key-shape」，讀起來像抽取器整個失控、要重抽 175 課。

**實際量過不是這樣。** 那 597 是量在**內層、而且把註解欄位算進去**的結果。

分開量：

| 量在哪 | 結果 |
|---|---|
| **top-level** | 幾乎每個模組都只有 **1 種形狀**（`lesson_uid` / `version_id` / `section_no` / payload） |
| **內層 payload** | 才是變異所在，見下表 |

重現指令見 §5。**先跑那幾條再相信這份文件的任何數字。**

---

## 1. 真實形狀：穩定核心 + 一長串一次性註解

| 模組 | 課數 | 內層形狀數 | 核心欄位<br>(≥90% 課都有) | 邊緣欄位<br>(<10% 課) |
|---|---:|---:|---:|---:|
| `full_text_annotate` | 164 | 115 | **4** | 99 |
| `vocab_review` | 150 | 58 | **7** | 28 |
| `key_reading` | 157 | 53 | **8** | 38 |
| `vocab_application` | 149 | 30 | **3** | 22 |
| `comprehension` | 172 | 27 | **1** | 23 |
| `goal_box` | 70 | 21 | **0** ⚠️ | 27 |
| `resources` | 148 | 19 | **3** | 13 |

**每個模組的核心是穩的。亂的是尾巴。**

250 個邊緣欄位裡 **125 個（50%）是註解型** —— 名字帶 `note` / `_ref` / `_scope` / `carrier` / `errata`：

```
char_count_note        benchmark_threshold_note   _圈選note
answer_note            bank_note                  decoy_note
qr_note                approx_chars_note          char_marks_cover_note
```

**機制**：LLM 每抽一課，把它的隨手備註當成一個**新的 top-level key** 塞進 payload。
資料本身一致，是旁白在長。

→ 所以這不是重抽問題，是**改鍵**問題。

---

## 2. 手順（可重複執行，每一步都有驗）

### 步驟 1 — 量基準（改之前）

```bash
python3 scripts/yml_shape_report.py --json > qa/yml-shape/before.json
```

輸出每個模組的：課數、內層形狀數、核心欄位清單、邊緣欄位清單。
**這份 before.json 進版控**，之後所有「形狀數降了多少」都對它比。

### 步驟 2 — 收攏註解欄位

把 payload 裡符合註解樣態的 top-level key，全部搬進固定的 `notes` 物件：

```yaml
# 改之前                          # 改之後
key_reading:                      key_reading:
  passage: "..."                    passage: "..."
  benchmark: 120                    benchmark: 120
  char_count_note: "紙上是 320"     notes:
  benchmark_threshold_note: "..."     char_count: "紙上是 320"
                                      benchmark_threshold: "..."
```

判定樣態（保守，寧可漏收不可誤收）：
```
key 名稱 match  (note|說明|備註)$  或  ^_  或  _ref$  或  errata  或  carrier  或  scope
且 value 是純量（str/int/bool）或短 list —— 是 dict 就不動，那可能是真資料
```

⛔ **不准改 value，只准搬位置。** 搬完內容要逐字相同。

### 步驟 3 — 驗改動只動了鍵

```bash
python3 scripts/yml_shape_normalize.py --verify
```

對每一份改過的檔：把改前改後的**所有葉節點值**排序後比對，**必須完全相同**。
有一個值變了就整批回滾。

### 步驟 4 — 再量一次

```bash
python3 scripts/yml_shape_report.py --json > qa/yml-shape/after.json
python3 scripts/yml_shape_report.py --compare before.json after.json
```

預期：形狀數大幅下降。**實際降到多少要用跑出來的數字寫進 PR，不要事先寫死預測。**

### 步驟 5 — 上鎖（棘輪）

`backend/tests/test_yml_shape_ratchet.py`：

```
每個模組的內層形狀數 <= qa/yml-shape/baseline.json 記錄的值
```

⛔ **不可寫 `== 1`**。核心欄位有「這課沒有這一節」造成的合理缺項，
硬要 1 會恆紅，紅久了就沒人看。棘輪只保證**不再變差**。

---

## 3. TODO（依序，前一項沒綠不做下一項）

- [ ] **T1** `scripts/yml_shape_report.py` —— 量測器（含 `--json` / `--compare`）
- [ ] **T2** 量 before 基準，進版控
- [ ] **T3** `scripts/yml_shape_normalize.py` —— 收攏註解（含 `--dry-run` / `--verify`）
- [ ] **T4** 先對**一個模組**跑（選 `full_text_annotate`：164 課 115 形狀，最亂且無人認領）
- [ ] **T5** 值不變驗證通過 → 擴到其餘**無人認領**模組
- [ ] **T6** 棘輪測試 + mutation 驗過會紅 + 加進 CI 具名清單
- [ ] **T7** `goal_box` 單獨處理（**0 個核心欄位**，是唯一真的壞掉的，可能要重抽而非改鍵）

### 不在這次範圍

| 項目 | 為什麼 |
|---|---|
| `spotlight` / `keypoints` | 啟翔 @stgst 正在動 |
| `key_reading` | 靖杭 @if-else-master 正在刪 v2 修 v3，**這次連改鍵都不碰** |
| overview skill / 24 個模組 skill | 那是 #2844 的 PRD，跟這份是兩件事 |
| 重抽任何一課 | 這次只改鍵不改值 |

---

## 4. 為什麼這個順序

先**量**再**改**再**鎖**，而不是先寫 schema 再要求資料符合。

理由：schema 若是憑想像寫的，175 課會一起紅，紅了就得改 schema 而不是改資料 ——
那等於 schema 反過來被資料牽著走。**先量出核心欄位，schema 才有事實基礎。**

---

## 5. 重現指令（本文件所有數字的來源）

```bash
# top-level 形狀（會看到幾乎都是 1 種）
python3 - <<'PY'
import pathlib, yaml, collections
root=pathlib.Path('backend/data/lessons')
mods=collections.defaultdict(list)
for d in sorted(root.glob('L*/v3')):
    for f in d.glob('*.yml'):
        try: data=yaml.safe_load(f.read_text()) or {}
        except Exception: continue
        if isinstance(data,dict): mods[f.stem].append(frozenset(data.keys()))
for m,s in sorted(mods.items(), key=lambda kv:-len(kv[1])):
    print(f"{m:<24}{len(s):>5} 課{len(set(s)):>5} 種 top-level 形狀")
PY

# 內層形狀 + 核心/邊緣欄位
python3 scripts/yml_shape_report.py
```

⚠️ 引用本文件任何數字之前先跑一次 —— 資料每次重抽都會變，
而 PR #2844 那個 597 就是「沒自己量就轉述」的產物。
