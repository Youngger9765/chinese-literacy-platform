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

## 2. After（2026-08-21 深夜）

```
┌─ INPUT ─────────────────────────────────────────────────────────────────────┐
│  教師版 DOCX   private/curriculum-source/_SOT/   175 份                      │
└────────────────────────────┬────────────────────────────────────────────────┘
                             ▼
┌─ 總覽／分派 ─────────────────────────────────────────────────────────────────┐
│                                                                             │
│  既有教材（175 課）          新教材                                           │
│  lesson.yml                 lesson-overview-scan  🆕 skill                   │
│   └ sections_present         └ LLM 多模態逐頁讀，只問「有哪幾個大題」          │
│     174/175 課有                （跟 extract-lesson-multimodal 同技術）       │
│           │                          │                                      │
│           └──────────┬───────────────┘                                      │
│                      ▼                                                      │
│        section-to-module.yml 🆕  大題名 → 模組（1467 個大題，99.3% 對到）      │
│                      ▼                                                      │
│           _manifest.yml 🆕      派工單 × 174 份                              │
│           dispatch: [...]       ← 這課要出動哪幾個模組 skill                   │
└────────────────────────────┬────────────────────────────────────────────────┘
                             ▼
┌─ PROCESS ───────────────────────────────────────────────────────────────────┐
│  extract-lesson-multimodal   ⚠️ 仍是一個 skill 打遍天下（模組 skill 未拆）      │
│           ▼                                                                 │
│     L*/v3/<module>.yml       2019 份，內層形狀 606 → 416                      │
└────────────────────────────┬────────────────────────────────────────────────┘
                             ▼
┌─ OUTPUT + 門 ───────────────────────────────────────────────────────────────┐
│  ① 抽對了沒    verbatim_gate ❌   coverage_gate ⛔   traditional_only ⛔       │
│  ② 結構對不對  module_schemas 🆕 ✅（24/24 模組）                             │
│                yml_shape_ratchet 🆕 ✅                                       │
│                keypoints_shape ✅（接線 🆕）                                  │
│  ③ 整節掉了沒  orphan_key_gate ✅（接線 🆕）                                  │
│                module_reconcile 🆕 ✅   module_gaps_declared 🆕 ✅            │
│  ④ 畫得出來沒  render_coverage_gate ✅（接線 🆕）                             │
│  ⑤ 走得到嗎    module_entry_gate ✅                                          │
│  ⑥ 內容忠實度  content_evidence_gate ❌   eval_* ×5 ❌   ← 🔴 這一層還是空的   │
│                                                                             │
│  ✅ CI 覆蓋 1 → 10 道                                                        │
│  ⛔ = 接不了（讀 private/，CI checkout 沒有那個目錄）                          │
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

## 5. 重現指令（圖裡每個 ✅/❌ 的來源）

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
