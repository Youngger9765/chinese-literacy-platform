# 抽取管線全圖 —— Before / After

> 隸屬 #2843。這份是**流程地圖**，回答「東西從 DOCX 到學生眼前經過哪幾關、每一關誰在守」。
>
> 架構設計在 `extractor-skill-architecture.md`（PR #2844），
> yml 形狀正規化在 `yml-shape-normalization.md`。這份把它們接起來看。
>
> ⚠️ 圖裡每個「✅ CI / ❌ 不在 CI」都是實測的，不是照設計文件抄的。
> 重現指令見 §5，引用之前先跑一次。

---

## 1. Before（2026-08-21 早上）

```
┌─ INPUT ─────────────────────────────────────────────────────────────────────┐
│  教師版 DOCX   private/curriculum-source/_SOT/   175 份                      │
└────────────────────────────┬────────────────────────────────────────────────┘
                             ▼
┌─ PROCESS ───────────────────────────────────────────────────────────────────┐
│  extract-lesson-multimodal   🔴 一個 skill 打遍天下                          │
│           │                     「東漏西漏」的來源                            │
│           ▼                                                                 │
│     _extracted/<uid>.yml     一課一大包                                      │
│           │  split_lesson_modules.py（機械切 key，不是抽取）                  │
│           ▼                                                                 │
│     L*/v3/<module>.yml       24 種 × 175 課 = 2019 份                        │
│                                                                             │
│  🔴 沒有總覽 / 沒有分派 / 沒有派工單                                          │
└────────────────────────────┬────────────────────────────────────────────────┘
                             ▼
┌─ OUTPUT + 門 ───────────────────────────────────────────────────────────────┐
│  ① 抽對了沒    verbatim_gate ❌  coverage_gate ❌  traditional_only ❌         │
│  ② 結構對不對  keypoints_shape ❌（只管 1/24 模組） validate_lesson_content ❌ │
│  ③ 整節掉了沒  orphan_key_gate ❌                                            │
│  ④ 畫得出來沒  render_coverage_gate ❌                                       │
│  ⑤ 走得到嗎    module_entry_gate ✅                                          │
│  ⑥ 內容忠實度  content_evidence_gate ❌  eval_* ×5 ❌（全手動）               │
│                                                                             │
│  🔴 16 道門，只有 1 道在 CI                                                  │
└─────────────────────────────────────────────────────────────────────────────┘

問題三句話：
  · 出錯不知道找誰 —— 沒有東西把「學習單有什麼」對到「產出了什麼」
  · 門建了沒插電 —— 存在但沒人跑，比不存在更危險（有人以為它在守著）
  · 抽取器每課自己發明欄位名 —— 2019 份檔 606 種內層形狀
```

---

## 2. After（2026-08-22 凌晨）

```
┌─ INPUT ─────────────────────────────────────────────────────────────────────┐
│  教師版 DOCX   private/curriculum-source/_SOT/   175 份                      │
└────────────────────────────┬────────────────────────────────────────────────┘
                             ▼
┌─ ① 總覽／分派 ───────────────────────────────────────────────────────────────┐
│                                                                             │
│   既有 175 課                        新教材                                   │
│   lesson.yml                        lesson-overview-scan 🆕                  │
│    └ sections_present  174/175       └ LLM 多模態讀，只問「有哪幾個大題」      │
│           │                              🔴 尚未對真實新教材跑過               │
│           └──────────────┬───────────────┘                                  │
│                          ▼                                                  │
│         section-to-module.yml 🆕   1467 個大題 · 99.3% 對到模組               │
│                          ▼          （3 個名稱標為已知未解，不猜）             │
│              _manifest.yml 🆕       派工單 × 174                             │
│              dispatch: [...]        ← 這課要派哪幾架飛機                       │
└────────────────────────────┬────────────────────────────────────────────────┘
                             ▼
┌─ ② 抽取 ────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  航母 extract-lesson-multimodal（已降級 🆕）                                  │
│    ①定位 ②轉PDF ③抽XML ⑤讀總表 ⑧產diff   ← 共用，留著                        │
│    ④ 主抽取 ──改成──▶ 讀 dispatch，派 extract-<module>                       │
│                          │                                                  │
│              ┌───────────┴───────────┐                                      │
│              ▼           ▼           ▼                                      │
│         extract-      extract-   extract-       ← 飛機                       │
│         vocab_defs    comprehen   …×24                                       │
│                                                                             │
│         🔴 一支都還沒寫。骨架與契約在 extract-module 🆕                        │
│            （已併入 @stgst 的 ai-lesson-extract 答案紀律）                     │
│         ⚠️ 舊做法收在 <details> 標過渡期，第一支落地就刪                        │
│                          ▼                                                  │
│         L*/v3/<module>.yml    2019 份 · 內層形狀 606 → 416                    │
└────────────────────────────┬────────────────────────────────────────────────┘
                             ▼
┌─ ③ 門 ──────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  抽對了沒    verbatim_gate ⛔  coverage_gate ⛔  traditional_only ⛔           │
│  結構對不對  module_schemas ✅🆕（24/24）  yml_shape_ratchet ✅🆕              │
│              keypoints_shape ✅接線🆕                                         │
│  整節掉了沒  orphan_key ✅接線🆕  module_reconcile ✅🆕  gaps_declared ✅🆕     │
│  畫得出來沒  render_coverage ✅接線🆕                                          │
│  走得到嗎    module_entry ✅                                                  │
│  ─────────────────────────────────────────────────────────────────────────  │
│  內容忠實度  content_evidence ❌   eval_* ×5 ❌      🔴 整層空的               │
│              「這課的聚光燈是不是這課的」—— 上面全綠時它照樣壞                   │
│                                                                             │
│  CI 覆蓋 1 → 10 道 ✅       ⛔ = 接不了（讀 private/，CI 沒有那個目錄）         │
│  已淘汰：module_migration_gate（175 課全 v3，恆綠）+ 11 支死腳本               │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. 差在哪（逐項）

| | Before | After |
|---|---|---|
| 出錯知道找誰 | ❌ 沒有任何對照 | ✅ 對帳門三種紅法各自指名 |
| 派工單 | ❌ 不存在 | ✅ 174 份 `_manifest.yml` |
| 大題 → 模組 | 10 個模組（62 個大題對不到） | **1467 個大題，99.3% 對到**，10 個標為已知未解 |
| 每模組 schema | ❌ 只有 keypoints 一個形狀門 | ✅ 24 份，`additionalProperties: false` |
| 內層形狀 | 606 種 | **416 種** |
| 缺口要不要人翻原稿 | 每次都要 | ✅ 46 課 / 167 缺口已宣告，雙向門 |
| 在 CI 的門 | **1 / 16** | **10 / 16** |
| 新教材看得懂沒見過的大題 | ❌ 表回 None | ✅ overview skill（**尚未實測**） |

---

## 4. 還是空的那一層 —— 也是「隨機」真正住的地方

⑥ **內容忠實度**：這課的聚光燈是不是這課的、版面有沒有斷掉。

**上面所有的門在「結構全對但內容放錯課」時都是綠的。** 這正是 Young 說的隨機問題，
而它一道 CI 都沒有。

料其實是齊的，只是沒插電也沒人跑：

| 現成資產 | 狀態 |
|---|---|
| `eval_lesson_schema.py`（DOCX → 聚光燈量化 eval） | 手動 |
| `eval_keypoints_text_fidelity.py` / `eval_keypoints_dual.py` | 手動 |
| `eval_strategy_validate.py`（free_text AI 評分 eval） | 手動 |
| `eval_lesson_content.py`（block-based EDD harness） | 手動 |
| `qa-spotlight` / `qa-keypoints` skill（render 截圖 → vision judge） | 手動 |

⚠️ 這五支 + 兩個 skill **今天一個都沒用到**。今天做的六支腳本 LLM 相關字樣 **0 處**。

**下一步應該是這一層，不是再加結構門。** 結構門已經夠了。

---

## 5. TODO 工單（給接手的人 —— 依序，前一項沒綠不做下一項）

> 每一項都寫了**怎麼驗**，不是只寫要做什麼。
> ⚠️ 動手前先跑 §6 的重現指令確認數字沒漂 —— 資料每次重抽都會變。

### 🟢 T1 快、安全、做了就不會錯（先做這批）

- [ ] **T1a 淘汰 `module_migration_gate.py`**
      它數「還有幾課停在 v2」，實測 175 課全在 v3 → 恆綠、量不到東西。
      ⚠️ 刪之前先 `grep -rn module_migration_gate` 確認沒有別的東西讀它
      （它現在在 `test_corpus_gates_are_wired_2843.py` 的 `WIRED` 裡，要一起拿掉，
      而該檔有一條 `len(WIRED) >= 4` 的斷言會擋，順手改成 3）

- [ ] **T1b 清掉指向已刪除目錄的引用**
      三個目錄 git 追蹤數都是 0，但還有 code 在讀：
      ```
      _online-schema         0 檔    21 個檔在引用
      _parsed_2026-05-01     0 檔    26 個檔在引用
      spotlight/catalog      0 檔     5 個檔在引用
      ```
      這些讀取多半 fail-soft 成空值，**所以沒人發現**。
      逐一判讀：刻意保留的相容路徑（要在 code 寫明原因）還是漏掉的遺留（刪）。
      ⚠️ `spotlight/catalog` 那 5 處碰到 @stgst 的範圍，先問過。

- [ ] **T1c 淘汰 `keypoints_shape_gate.py`**
      今天的 `module_schemas` 對 24 個模組驗同一件事，它只驗 keypoints 一個。
      ⛔ **但現在還不能刪** —— keypoints 的 schema 是 `x-enforcement: warn`
      （@stgst 正在改）。等他把 keypoints 轉成 `error` 之後才刪。

### 🔴 T2 內容忠實度 —— 這是「隨機」真正住的那一層

**上面所有的門在「結構全對但內容放錯課」時都是綠的。** 這一層一道 CI 都沒有。

- [ ] **T2a 盤點 5 支既有 eval 各自涵蓋什麼、為什麼沒在 CI**
      `eval_lesson_schema.py`（DOCX → 聚光燈量化）
      `eval_keypoints_text_fidelity.py` / `eval_keypoints_dual.py`
      `eval_strategy_validate.py`（free_text AI 評分）
      `eval_lesson_content.py`（block-based EDD harness）
      ⚠️ 先確認它們需要什麼輸入 —— 若跟 `coverage_gate` 一樣要 `private/`，
      那就跟結構門是同一個問題（CI 拿不到原稿），要先解那個。

- [ ] **T2b 決定 EDD 的判準怎麼接地**
      vision judge 是機率性的，要有校準（~20 個人工標註樣本）與 human-agreement 數字，
      否則 judge 自己會 drift。⛔ 別直接把 judge 的輸出當 gate。
      參考 `qa-spotlight` / `qa-keypoints` skill 既有做法。

- [ ] **T2c eval case 要來自真實壞過的課**，不是憑空設計
      候選：8/19 那批「抽對了但下游沒接」的課、聚光燈放錯課的歷史案例。

### ⚪ T3 讓派工單真的有人吃（工程量大，不解決隨機）

現在 `_manifest.yml` 的 `dispatch: [...]` 寫著「這課要出動哪幾個模組 skill」，
**但那些 skill 不存在** —— 它目前只被對帳門讀，沒有真的在派工。

- [ ] **T3a 從 `extract-lesson-multimodal` 切出第一個模組 skill 當範本**
      選 `vocab_definitions`(150 課) 或 `comprehension`(172 課)。
      ⛔ 不能選 `spotlight` / `keypoints`（@stgst）或 `key_reading`（@if-else-master）。
- [ ] **T3b** 驗過範本可複用再批次擴，順序：無人認領 → 文言文那 6 個 → 最後才是被認領的三個
- [ ] **T3c** `lesson-overview-scan` 對真實新教材跑一次，把實測數字補回 SKILL.md
      （跑兩次的一致率、對帳門結果、跟 `sections_present` 的差異數）

### ⛔ 不要做的

| 不要做 | 為什麼 |
|---|---|
| 再加結構門 | 結構層已經夠了（10 道在 CI）。再加是在容易的地方使力 |
| 把 `coverage_gate` / `traditional_only_gate` / `verbatim_gate` 硬接進 CI | 它們讀 gitignore 的 `private/`，接了就是恆紅的門，**紅久了大家學會忽略它** |
| 為了讓門變綠去補內容 | 那 46 課的缺口是學習單本來就沒有，補了是造假 |
| 憑名字像就往 `section-to-module.yml` 加一條 | 猜錯會讓對帳門把好課判成壞課，比留欠債更糟 |

### 相關 PR / issue

| | |
|---|---|
| #2843 | 抽取器 skill 模組化（母票） |
| #2844 | 架構 PRD（已 merge） |
| #2847 | yml 形狀正規化 606→416（已 merge） |
| #2851 | 46 課缺口宣告（已 merge） |
| **#2852** | **本 PR** — schema + 對照表 + 對帳門 + 派工單 + 接線 + overview skill |
| #2853 | 進度持久化剩下 3 關（另一條線） |

---

## 6. 重現指令（圖裡每個 ✅/❌ 的來源）

```bash
# 各門有沒有真的被「執行」（會看到 10/16）
#
# ⚠️ 不可以用「門的名字有沒有出現在測試檔裡」當判準 —— 我這樣量得到 13，
#    因為 test_corpus_gates_are_wired_2843.py 的 CANNOT_WIRE 字典**提到**了
#    verbatim_gate / coverage_gate / traditional_only_gate，而那是在記錄
#    「它們接不了」。被提到不等於被執行。
python3 - <<'PY'
import pathlib, re, importlib.util
spec = importlib.util.spec_from_file_location(
    "w", "backend/tests/test_corpus_gates_are_wired_2843.py")
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
executed = set(mod.WIRED)                       # 真的會被 subprocess 跑起來的
runci = pathlib.Path('specs/run-ci.sh').read_text()
executed |= {g for g in ['module_entry_gate','spotlight_fingerprints','sot_drift_check']
             if any(g in l and not l.strip().startswith('#') for l in runci.split('\n'))}
executed |= {'module_reconcile_gate','build_module_schemas','yml_shape_report'}  # 各自有測試呼叫
print(f"實際執行 {len(executed)} 道：{sorted(executed)}")
PY

# 各門需要什麼輸入（決定接不接得了 CI）
grep -l 'private/\|curriculum-source\|_SOT' scripts/*gate*.py

# 派工單涵蓋率（1467 個大題 / 99.3%）
python3 - <<'PY'
import yaml, pathlib
t=m=u=0
for f in sorted(pathlib.Path('backend/data/lessons').glob('L*/v3/_manifest.yml')):
    for s in yaml.safe_load(f.read_text())['sections']:
        t += 1
        m += bool(s.get('module')); u += bool(s.get('module_unresolved'))
print(f"{t} 個大題 · 對到 {m} ({100*m/t:.1f}%) · 已知未解 {u} · 漏網 {t-m-u}")
PY

# 內層形狀（606 → 416）
python3 scripts/yml_shape_report.py

# 對帳
python3 scripts/module_reconcile_gate.py
```

⚠️ 引用本文件任何數字前先跑一次。今天已經有兩次「沒查就斷言」翻車：
說「沒有一道門問學生看不看得到」（實際上 `render_coverage_gate` 就是），
說「EDD 0 個 eval」（實際上有 5 支，只是沒在 CI）。
