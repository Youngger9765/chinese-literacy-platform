# `673c1173` 的訊息沒有描述它的全部內容

## 發生什麼

2026-08-19，我（工頭）在 commit 文言文模組入口（#2752）時用了 `git add -A`，
而當時**另一個 agent 正在同一個 worktree 上做 #2749**（manifest gate 改讀 v3）。
它的整批改動被一起收進去並 push 了，但 commit message 從頭到尾只講文言文。

所以 `673c1173` 實際包含**兩件不相關的工作**：

| 屬於 | 內容 |
|---|---|
| #2752 文言文模組入口 | 3 層後端欄位、4 個新 step、2 個併入既有 step、路由迴圈來源、`handleStartReading`、`module_entry_gate` ENTRY 表 |
| **#2749 manifest gate**（訊息完全沒提）| `scripts/build_keypoints_qa_manifest.py` 改讀 v3、`keypoints_manifest_verify.py`、`story_structure_qa_lib.py`、`story_structure_ship_gate.sh`、`backend/data/curriculum_qa/keypoints_manifest.json` + 約 300 個 `snapshots/*/`、`specs/modules/story-structure/INTENT.md`、`registry.yaml`、刪除 `scripts/rebuild_keypoints_manifest.py` |

## #2749 那半做了什麼（補記，因為 commit 訊息沒寫）

`Manifest freshness + story-structure contracts` 這道 CI check 在 #2739／#2753／#2754
都是紅的。根因不是內容有問題，是**它的重建腳本讀兩個已隨一修封存刪除的目錄**
（`private/curriculum-source/_online-schema`、`backend/data/lessons/_parsed_2026-05-01`），
所以連「重建基準」都跑不起來（`ERROR: schema dir not found`）。

改成從**現在真的在服務的**來源建：`backend/data/lessons/<uid>/<version>/keypoints.yml`
→ `get_all_lessons()`。驗證：

    python3 scripts/keypoints_manifest_verify.py
    → exit 0
    → KEYPOINTS MANIFEST GATE: OK (lessons=150 pass=150 unreviewed=34 display_only=1)

`scripts/rebuild_keypoints_manifest.py` 的刪除是**刻意的**：它的檔頭自己寫明
「WHY A SECOND BUILDER —— 因為原本那支讀 `_online-schema`，二修沒有那個目錄，
所以原本那支根本跑不起來」。原本那支修好之後，這個替身就沒有存在理由了。

⚠️ **不要刪掉這道門。** 它是 2026-08-17 唯一抓到「v3 換上去後整張重點表變成 5 列空的
display 列、學生根本不能作答」的門 —— 逐字門、拆模組、聚光燈 render 當時全綠。
理由寫在 `backend/app/services/keypoints_to_structure.py` 約 305 行。

## 為什麼用補記而不是改寫歷史

改 commit message 要 amend + force-push。當時同一個 branch 上還有 agent 在工作，
force-push 會把它們的 base 抽掉。**歷史用新增保持誠實，比用改寫保持整齊重要。**

## 教訓

`git add -A` 在多 session 共用 worktree 時會捲進別人未完成的改動。
這條在 global memory 裡已經有（`feedback_git_add_specific_still_sweeps.md`），
而我還是用了。正確做法是 `git commit -o <明確路徑>`。

⚠️ 就算改動本身沒問題（這次 mani 的工作是完整的、門也真的變綠了），
**commit message 描述不了自己的內容**這件事本身就是缺陷 ——
日後有人 bisect 到這個 commit，會完全不知道它動過 manifest。
