# Curriculum Ingestion Pipeline

> Auto-sync 教授 source (xlsx + docx) → backend/data/ yml, with drift detection.
> Issue: #1624

## Goal

Treat curriculum as **data**, not hand-edited yml. Every time 教授 ships a new edition (5/1 v1 → 8/15 v2 → ...):

1. Drop the new source under `private/curriculum-source/{date}/`
2. Run parser → catalog yml + content yml + INGESTION_MANIFEST refresh
3. Drift detector enforces the invariant `backend/data/ ≡ parser(source)` for parser-managed fields

Prevents the class of bugs in #1620 / #1621 (manual yml align after edition change).

---

## Source layout (教授 ships)

```
private/curriculum-source/
├── 2026-05-01/
│   └── 1.L1-158新版完成學習單1150415/
│       ├── 自學教材清單.xlsx                    # master index: 新課次 / 原課次 / 年級 / 課名 / 策略 / 語詞
│       ├── 1-1教師版(L1~122)/                  # teacher version (has story text in table[0])
│       │   ├── 4年級/G4-L01贏得喝采的輸家.docx
│       │   └── ...
│       ├── 2-1學生版(L1~122)/                  # student worksheet (no story)
│       │   └── ...
│       └── 第三階段(L123開始~L157)差學生版/    # phase 3 (student only)
│           └── ...
└── 2026-XX-XX/   # next edition
```

---

## Identity model (important)

| Field | Source | Meaning | Stability |
|-------|--------|---------|-----------|
| `lesson_code` | derived | `G{grade}-L{NN}` where NN is **per-grade sequential** in new edition (G4 L01..L27) | Changes between editions |
| `display_order` | xlsx 新課次 | Global ordering (1..158) | Changes between editions |
| `original_order` | xlsx 原課次 | Original (pre-5/1) numbering | **Stable across editions** — used as content yml stem |
| Content yml stem | `L{original_order:02d}` | e.g. `L01.yml`, `L126.yml` | Stable — downstream AI-generated content (story_structure, fill_in_blank, etc.) keyed by this |

**Why two yml namespaces**: `curriculum/lessons/G{grade}-L{NN}.yml` is the catalog (per-edition view); `lessons/L{NN}.yml` is the content (stable identity for AI-generated assets).

---

## Files

| File | Role |
|------|------|
| `scripts/ingest_curriculum.py` | Parser: xlsx + docx → yml |
| `scripts/check_curriculum_drift.py` | ⛔ **無法執行**（來源目錄已不存在）— 見下方「二修之後誰在守」 |
| `backend/data/curriculum/INGESTION_MANIFEST.yml` | 一修的 active version + parser-managed 欄位清單 |
| ~~`.github/workflows/curriculum-drift-check.yml`~~ | **已刪除（#2746）** — 它只會 skip 然後報綠 |
| `docs/curriculum-pipeline.md` | This doc |

---

## Parser-managed fields

Only these fields are owned by the parser. Drift detector ignores everything else (AI-generated story_structure, hand-curated vocab_bank, fill_in_blank, multiple_choice are **NOT** clobbered).

### Catalog yml (`curriculum/lessons/{code}.yml`)
- `lesson_code`, `display_order`, `original_order`, `title`, `grade`, `genre`,
  `text_type`, `unit_topic`, `applicable_grade`, `strategy_name`,
  `classical_chinese`, `vocab`

### Content yml (`lessons/L{NN}.yml`)
- `lesson_number`, `grade`, `grade_code`, `title`, `genre`, `text_type`,
  `reading_strategy`, `story_text`, `paragraphs`, `paragraph_count`,
  `char_count`, `vocab_keywords`

To change scope, edit `parser_managed_*_fields` in `backend/data/curriculum/INGESTION_MANIFEST.yml`.

---

## SOP: 教授 ships a new edition

1. **Drop source** under `private/curriculum-source/{YYYY-MM-DD}/`. Should contain `自學教材清單.xlsx` + docx dirs (same shape as 5/1).

2. **Dry-run parser** to inspect output:
   ```bash
   python scripts/ingest_curriculum.py \
     --source private/curriculum-source/{YYYY-MM-DD}/... \
     --target /tmp/curriculum-new/
   # (no --write = dry-run; just prints stats)
   ```

3. **Generate to staging-tmp** + diff against current backend/data/:
   ```bash
   python scripts/ingest_curriculum.py \
     --source private/curriculum-source/{YYYY-MM-DD}/... \
     --target /tmp/curriculum-new/ --write

   diff -r /tmp/curriculum-new/curriculum/lessons backend/data/curriculum/lessons | head -100
   ```

4. **Review the diff manually**. Expected changes:
   - New display_order (新課次 changed) → fine, parser is the source of truth
   - New lesson_code per-grade sequential → fine
   - story_text changed → fine, teacher edited
   - vocab list changed → fine
   - **Unexpected**: AI-generated downstream fields lost → BAD; parser shouldn't touch those, file a bug

5. **Open issue** `feat(curriculum): align with 教授 {date} edition` and let the parser overwrite yml:
   ```bash
   python scripts/ingest_curriculum.py \
     --source private/curriculum-source/{YYYY-MM-DD}/... \
     --target backend/data/ --write
   ```

6. **Update INGESTION_MANIFEST**:
   ```bash
   # Edit backend/data/curriculum/INGESTION_MANIFEST.yml → bump active_version
   # (parser auto-writes INGESTION_MANIFEST when --target = backend/data; just verify)
   ```

7. **Run drift detector** to confirm clean state:
   ```bash
   python scripts/check_curriculum_drift.py
   # Exit 0 = no drift
   ```

8. **Commit** + PR to staging.

---

## Drift detector

Run anytime to verify backend/data/ matches the active source:

```bash
python scripts/check_curriculum_drift.py
```

Exit codes:
- `0` = no drift (parser-managed fields match exactly)
- `1` = drift found (report printed)
- `2` = parser/INGESTION_MANIFEST error

CI runs this weekly + on every PR touching `backend/data/lessons/` or `curriculum/lessons/`.

---

## Anti-patterns

- ❌ Hand-edit `backend/data/lessons/*.yml` parser-managed fields → next drift check will fail
- ❌ Hand-edit `backend/data/curriculum/lessons/*.yml` catalog → same
- ❌ Re-run parser without updating `INGESTION_MANIFEST.active_version` → INGESTION_MANIFEST becomes lying record
- ❌ Touch private/curriculum-source/ source files → 教授 ships read-only; only Young copies new editions in
- ❌ Add new "parser-managed" field without updating INGESTION_MANIFEST.parser_managed_*_fields

---

## Future iterations

- Phase 3 + classical docx filename matchers (current parser misses ~17 files)
- AI-generated downstream pipeline (story_structure, fill_in_blank) as separate `enrich_curriculum.py` script with its own INGESTION_MANIFEST
- Schema validation against `backend/data/schemas/lesson-content-v2.schema.json`

---

## References

- Issue #1624 — parser + INGESTION_MANIFEST + drift detector
- Issue #1620, #1621 — manual yml align (the bugs this pipeline prevents)
- `backend/data/schemas/lesson-content-v2.schema.json` — downstream content schema


---

## 二修之後誰在守（#2746，2026-08-19）

`.github/workflows/curriculum-drift-check.yml` 已刪除。它每週排程 + 每個碰
`backend/data/lessons/**` 的 PR 都跑，但**第一步就注定失敗**：它從
`INGESTION_MANIFEST.yml` 讀 `source_dir`，那是
`private/curriculum-source/2026-05-01/…` —— runner 沒有（`private/` gitignored），
**開發機也沒有**（二修把它換成 `private/curriculum-source/_SOT/`）。找不到就 `skip=true`，
然後 job 報 ✅。實測最近 8 次全部走這條，`Run drift detector` 步驟狀態是 `skipped`。

⚠️ 順帶更正一個當時的推測：**這個 repo 是 PUBLIC**，所以「GHA 只留 public repo」那條成本原則
並不禁止它。刪掉的理由與成本無關，是**它做不到它宣稱在做的事** —— 而且不是「在 CI 做不到」，
是**在任何地方都做不到**（`python3 scripts/check_curriculum_drift.py` 本機同樣 exit 2）。

那它守的東西現在誰在守：

| 它宣稱守的 | 現在誰守 | 在哪跑 |
|---|---|---|
| 已抽取的課 vs 它宣稱的原稿 | `sot_drift_check.py --offline`（SOT_STALE）| `specs/run-ci.sh` **Gate 6**，每次 push 前 |
| 本機原稿快照 vs Drive | `sot_drift_check.py`（完整，SOT_DRIFT）| 排程／手動 —— 要 rclone 憑證，CI 本來就做不到 |
| `backend/data/curriculum/lessons/*.yml`（OMO 課程 catalog）| `backend/specs/test_omo_catalog_spec.py` | `specs/run-ci.sh` Gate 2 |

第三列是**原本會被漏掉的那一半**：那 158 個一修 catalog 檔仍然被
`omo_lesson_catalog._load_omo_lessons()` 讀去給 OMO 拍照批改比對課程，而它們的來源已經刪了
—— 所以「重跑 parser 再 diff」對它們**永遠無解**，不管在哪個環境。repo 內答得出來的是
「catalog 還在不在、欄位齊不齊、有多少 code 還對得到服務中的課」，那就是新 spec 做的事。

🔴 **順帶量到一個既有缺陷（不是這次改動造成的，另案）**：那 148 筆 catalog 裡
**只有 126 筆的 `lesson_code` 對得到服務中的課**，標題比對只有 117 筆對得上 ——
二修 renumber 之後，OMO 有 22 個課碼指向不存在或別的課。已在 spec 裡釘成只能變好的 ratchet。
