# Guardrail 規劃 — 從抽取到學生留下歷程

> 這份**不是**新框架。`layer-verification-framework.md` 的 L1–L5 定義是對的，
> 問題是**覆蓋率**：門幾乎全部站在上游看原稿，下游到學生之間幾乎沒人站崗。
> 這份做三件事：① 量出每一層實際有多少門 ② 標出洞 ③ 排順序。
>
> 所有數字都是 2026-08-28 實際跑出來的，不是估的。重跑指令附在每一節。

## 0. Owner 定義的五個層次

```
L0  infra yml 跟 skill 都正確有品質
L1  到得了學生面前
L2  且是正確的呈現
L3  且學生真的可以使用
L4  使用後可以留下對的歷程
```

對應到既有框架（`layer-verification-framework.md` §1）：

| Owner 的層 | 既有框架 | 問的是 |
|---|---|---|
| L0 | （框架沒涵蓋）| 門本身有沒有品質、會不會被靜靜跳過 |
| L1 | L1+L2 | 源頭 → schema → 上架 artifact |
| L2 | L3 | loader / API 契約，內容對不對 |
| L3 | L4+L5 | 真 user 從真入口走得完 |
| L4 | （框架沒涵蓋）| 走完之後留下的紀錄對不對 |

⚠️ **既有框架的 L1–L5 停在「畫面對不對」，沒有 L4（歷程）那一層。**
今天 #2904（561 課完成只有 9 筆有分數）與 #2962（第一個徽章永遠發不出來）
都住在那個框架看不到的地方。

---

## 1. 實際覆蓋率（量出來的）

### 1.1 十道 content gate 幾乎全在 L1

`specs/run-ci.sh`：

| Gate | 在哪一層 |
|---|---|
| 1 registry freshness + pointer-rot | L1 |
| 2 spec contracts（`pytest specs/` 61 支全跑）| L1／L2 混 |
| 3 legacy_tests union | 混 |
| 4 QR-manifest reconciliation | L1 |
| 5 spotlight structural ratchet | L1 |
| 6 原稿過期偵測 sot_drift | L1 |
| **7 module_entry_gate（抽出來的模組學生走不走得到）** | **L1→L2 唯一一道** |
| 8 content_fidelity_attest | L1 |
| 9 section_completeness_gate | L1 |
| 10 source_coverage_gate | L1 |

**十道裡有九道在問「抽對了沒」，只有第 7 道問「到得了學生面前嗎」。**

### 1.2 🔴 最大的洞：229/279 後端測試永遠不會被 CI 跑到

```bash
# 重跑：
python3 - <<'PY'
import re,glob,os
wf=open('.github/workflows/pytest.yml').read()
covered=set()
for p in re.findall(r'tests/[A-Za-z0-9_*/\.]+\.py', wf):
    covered.update(os.path.relpath(x) for x in glob.glob('backend/'+p))
disk={os.path.relpath(x) for x in glob.glob('backend/tests/**/test_*.py', recursive=True)}
print(len(covered), len(disk), len(disk-covered))
PY
```

| | |
|---|---|
| `pytest.yml` 展開 glob 後涵蓋 | **50** 支 |
| 磁碟上的 `backend/tests` | **279** 支 |
| **從來不會被 CI 跑到** | **229** 支 |

把那 229 支全部跑一次（10 分 28 秒）：

```
3082 passed · 165 failed · 38 skipped · 12 xfailed · 35 errors
→ 181 支全綠、48 支有紅
```

其中**檔名帶 issue 號 / gate / guard / regression 的「回歸鎖」共 93 支**：

| | |
|---|---|
| ✅ 全綠、可直接插電 | **73 支** |
| 🔴 是紅的 | **20 支** → 2026-08-28 全部處理完並插電（見 `red-locks-triage.md`）|

那 20 支紅的鎖，全是我們這幾天在處理的 issue 的鎖：

```
test_spotlight_table_content_2683   test_spotlight_ordering_items_2683
test_course_intro_present_2736      test_lesson_ordering_2736
test_step_sequence_from_worksheet_2736
test_keypoints_shape_gate_empty_claim_2736
test_multi_text_and_followups_entry_2752
test_classical_modules_entry_2752
test_sample_uids_survives_missing_spotlight_2751
test_section_completeness_2876      test_story_structure_cell_parser_2776
test_inline_choices_stay_in_the_sentence_2768
test_every_module_has_a_named_guard_2872
test_every_module_has_a_skill_2843
test_every_lesson_detail_validates_2725
test_docx_second_opinion_2868       test_ai_generation_split_1888
test_classrooms_dev_filter_1999     test_n1_queries_fix_1217
test_perf_sql_aggregates            test_perf_1243_remaining_optimizations
```

**為某個 bug 寫的鎖，紅著、而且沒有人會看到。** 這正是今天 #2962 的形狀
（`test_gamification.py` 四條紅了很久，不在清單裡）。

### 1.3 L3（真 user 走得完）只有 4 支 e2e

```
frontend/tests/e2e/  audio-comes-from-azure · demo-path · full-qa · multiTextJourney
```

而且 `full-qa` / `demo-path` **把 staging 後端寫死**，所以在 PR preview 上永遠跑不了
（preview 的 DB 是空的、沒有 seed 帳號）—— e2e workflow 自己的註解就寫著這件事。
換句話說：**PR 階段沒有任何一道門問「學生走得完嗎」。**

### 1.4 L4（歷程）幾乎沒有門

今天才補上的兩條是這一層目前**僅有**的：

- `test_session_scoring_below_threshold_2904`（5 條）
- `test_gamification.py`（49 條，今天才插電）

而這一層的洞是活的、不是理論的：
prod **561 課完成只有 9 筆有分數**、第一個徽章**永遠發不出來**。

---

## 2. 要做的事（依價值排序）

### 🔴 P0-a 把 73 支綠的回歸鎖插電

它們現在就是綠的，插電零風險，而缺席的代價已經證實過兩次。

### ✅ P0-b 那 20 支紅的鎖 —— 已完成（2026-08-28）

**34 條紅 → 0**，20 支全處理完 + 這輪新開 4 支，共 24 支已插電。
具名清單該 step 70 → 94，全 workflow **113 → 137** 支。
逐支判定與理由 → `docs/qa/red-locks-triage.md`。

其中 **7 支的根因是同一件事**（#2916 改檔名後「無 slug 的課級檔」沒被一起想過），
**3 支是判準本身寫錯**（拿查詢數比學生數／斷言 gate 必須紅／寫死集合 —— 情況一改善就紅）。

⚠️ 順帶抓到一種單跑永遠看不到的病：**一支測試呼叫 `dependency_overrides.clear()`
把另一支的登入弄成 500**（單跑 13 綠 / 批次 12 紅）。所以插電前一定要
**照 workflow 裡的順序**跑整個 step，不能只確認每支自己是綠的。

### 🟡 P1 補 L3：PR 階段要有一道「學生走得完」

現況 e2e 只能打 staging。做法二選一：
- preview 部署時 seed 一組固定測試帳號 → e2e 就能打 preview
- 或把 `multiTextJourney` 那種不依賴 seed 帳號的 spec 獨立出來，在 PR 跑

### 🟡 P2 補 L4：歷程的門 —— 大部分已完成（2026-08-28）

⚠️ **原本這裡寫「L4 幾乎沒有門」，那是錯的。門是有的（7 支），只是沒接進 CI**
—— 跟 P0-a 同一個病，不是缺門是缺接線。

| 學生做完之後該留下的東西 | 狀態 |
|---|---|
| 分數 | ✅ `test_session_scoring_below_threshold_2904` / `_write_1063` |
| 徽章 | ✅ `test_gamification`（49 條） |
| 進度 key | ✅ `test_step_progress_api` · `test_step_progress_parse` · `test_student_progress` · `test_progress_carry_forward_2889` · `test_round_progress_2916` |
| 作業提交 | ✅ `test_assignments`（102 條）· `test_assignment_1762` · `test_dashboard_assignment_completion` · `test_submission_counts_not_inflated_1764` |
| 學習紀錄可讀回 | ✅ `test_dialogue_history` · `test_reading_attempt_history` · `test_omo_history_1975` |

插電那 7 支的時候挖到 **2 支是真的紅**：

- `test_student_progress`：**學生的完成課在歷程頁顯示 17%**。
  `_compute_step_completion` 的 fallback 分支少了「completed 就是全完成」那條規則，
  於是同一個語意兩種答案（有 `step_progress` 的 100%、沒有的 17%）
- `test_dialogue_history`：#1135 的 `story_slug` gate 上線之後就一直 422，
  12 條紅了很久，而它不在 CI 清單裡所以沒有人看到

### 🟢 P3 L0：門本身的品質

- ✅ `#2925`：門不准用 `on.paths`（會被 300 檔上限靜靜跳過）
- ✅ **具名清單漂移偵測** —— `specs/test_ci_gates_are_runnable_spec.py` 兩條
  （`test_every_backend_test_named_in_ci_exists` /
  `test_every_frontend_test_named_in_ci_exists`），跑在 Spec Check 裡。
  前端那條更重要：**vitest 對不存在的路徑是靜默跳過**，pytest 至少會爆。
  現況：具名 140 支，每一支都在磁碟上
- ✅ **三支被隔離的鎖已修好插電**（2026-08-28）—— 原因不是 regression 而是
  「測試自己的環境假設」，見 `backend/tests/_route_walk.py`。
  ⚠️ 復現要另建 python3.11 + 未釘版 fastapi 的 venv（實測 0.141.1）；
  本機 3.10 + 0.115.6 永遠重現不到
- 還缺：**「鎖有沒有紅過」的紀錄** —— 沒看過紅的鎖是劇場
- 還缺：**批次順序的污染偵測** —— 這輪抓到一支測試把另一支的登入弄成 500
  （`dependency_overrides.clear()` 掃全域）。單跑永遠看不到，
  只有**照 workflow 的順序整批跑**才會出現

---

## 3. 什麼算「沒用的門」（可以刪）

Owner 2026-08-28：「太枝微末節，完全沒用的，就算綠燈也是假的，CICD 跟測試都移除。」

判準 —— 命中任一條就是刪除候選，**但要在 commit 寫明理由**：

| 判準 | 例 |
|---|---|
| **同義反覆** —— 同一個 commit 同時改實作與斷言，那條斷言只是複誦 | `assert TIMEOUT == 60` |
| **斷言 prompt 的字句** —— LLM prompt 改寫就紅，紅了也不代表品質變差 | `test_omo_grader_real`：「Prompt must explicitly forbid…」 |
| **需要外部服務才能跑** —— 在 CI 永遠是紅或永遠被跳過 | `test_gemini_content_filter`：真的去打 Gemini API |
| **測已經不存在的東西** —— code 或資料早就換掉 | `test_lesson_uid_loader`：斷言 L0001 有 spotlight，而那課本來就沒有 |
| **mutation 不咬** —— 把被測的東西弄壞它照樣綠 | 見 `rules/testing-strategy.md` |
| **只驗接線沒驗行為** —— 「有沒有呼叫 X」綠著，X 傳錯參數也綠 | |

⛔ **不要因為「它紅了很煩」就刪。** 紅的鎖優先當成 §2 P0-b 處理，
只有確認它屬於上表才刪。

---

## 4. 這份文件怎麼維護

- 每個數字都附了重跑指令，**引用之前先自己跑一次**
- 這份會過期得很快（`multi-text-open-issues.md` 8/25 那版九項裡六項三天就不成立）
- 覆蓋率有變（插電、刪除、新增門）就回來改這裡的數字，不要另開一份
