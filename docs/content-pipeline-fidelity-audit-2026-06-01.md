# Content Pipeline Fidelity Audit — 2026-06-01

**Action item**: 5/29 OMO landing-review meeting §2 — "盤點 Word→GCS→Google Doc→PDF 轉檔失真節點 + 降風險方案"

**Scope**: Read-only audit of `backend/scripts/`, `backend/app/services/lesson_loader*.py`,
`backend/data/lessons/`, `scripts/convert_docx_to_pdf.py`, `scripts/rebuild_worksheets_fonts.py`,
`backend/app/services/omo_storage.py`, and `.github/workflows/` detect-changes logic.

**Legend**
- VERIFIED — claim confirmed against actual code/data
- PARTIAL — partially confirmed; evidence noted
- 待查 — could not verify in current codebase; flagged for follow-up

---

## 1. Pipeline Node Map

```
[Word docx source]
    ↓ (Node A) parse_docx_lessons.py / parse_docx_lessons_bulk.py
[YAML in _parsed_2026-05-01/]
    ↓ (Node B) lesson_layer_loaders.py — load_layer2_lessons()
[in-memory lesson dict]
    ↓ (Node C) stories.py GET /api/stories → frontend
[Student/teacher browser view]

Parallel path — worksheet PDF:
[Word docx source]
    ↓ (Node D) scripts/convert_docx_to_pdf.py (LibreOffice headless)
[/tmp/lingoleap-worksheets/{code}.pdf]
    ↓ (Node E) gsutil cp → gs://lingoleap-assets/worksheets/
[GCS public URL in lesson YAML worksheet_pdf_url field]
    ↓ (Node F) lesson_layer_loaders.py passes through → stories API
[Frontend PDF viewer / OMO upload target]

OMO student upload path:
[Student photo / scan of paper worksheet]
    ↓ (Node G) omo/upload.py → omo_storage._upload_to_gcs()
[gs://lingoleap-omo-uploads/{user_id}/{upload_id}/{attempt}/{file}.jpg]
    ↓ (Node H) omo_identifier + omo_grader (Gemini vision)
[grade result → DB]
```

---

## 2. Node-by-Node Fidelity Loss Analysis

### Node A — Word docx → YAML (parse_docx_lessons_bulk.py)

**File**: `backend/scripts/parse_docx_lessons_bulk.py`

#### A-1: 教師版答案 leak into YAML — VERIFIED (HIGH RISK)

The parser uses **教師版 (teacher version)** docx as the primary source. Teacher copies contain
answer keys inline — the answer letter `(Ｃ)1.` prefix embedded in the question text. The
parser's `extract_multiple_choice()` (line 441–474) calls `extract_answer()` which reads the
`（X）` prefix and stores it in `answer` field; `strip_answer_prefix()` (line 53) is then called
to remove the `（C）` from the rendered question text.

**Risk**: If `strip_answer_prefix()` misses a format variant, the rendered `question` string
will contain the answer letter visible to students. The regex (line 455):
```
re.sub(r"^[（(]\s*[A-Za-z]\s*[）)]\s*", "", text)
```
handles standard half/full-width parentheses but does NOT handle:
- `[C]` square-bracket variant
- `C.` without parentheses
- Full-width digit answers `（１）`

The parser's `DOCX_MAP` in `parse_docx_lessons.py` (line 505) and the bulk parser's
`discover_docx_files()` explicitly prefer 教師版 when both versions exist (`TEACHER_DIR_NAME`
constant, line 43; `seen_codes` override logic lines 839–844). No mechanism strips
teacher-only answer annotations from non-MC content (e.g., fill_in_blank cloze answers,
discussion model answers).

**Mitigation (recommended)**: Add a post-parse sanity check: scan `question` strings for
residual `（[A-D]）` patterns after stripping; emit a `WARN: answer_leak_candidate` flag
into the YAML `flags[]` field for human review.

#### A-2: Placeholder / demo blank misread as fill_in_blank — VERIFIED (HIGH RISK)

`extract_fill_in_blank()` (lines 196–244) scans ALL tables except the story table for
`【...】` markers — any cell containing `【text_inside】` becomes a fill_in_blank item.

This is the exact failure reported at the 5/29 meeting: lessons whose G7 圖文整合 section has
diagram captions or "示意 sample" rows formatted with `【】` brackets are extracted as graded
questions. The function has no lesson-type guard and no way to distinguish:
- Actual student fill-in-blank `【奠定】`
- Diagram label `【圖1】`
- Section heading `【語詞應用】`
- Sample placeholder `【範例】`

**Concrete example**: `G6-L22.yml` (verified, `_parsed_2026-05-01/G6-L22.yml`) has 8
fill_in_blank items, all correct. But a lesson with a diagram caption section using `【】`
formatting would inject spurious items — not verifiable without inspecting those specific
source docx files (source is private/gitignored).

**Mitigation (recommended)**: Add an allowlist filter: only accept `【】` blanks from
paragraphs or table cells that also contain a number pattern `(N)` or `（N）`, or that
appear in tables already identified as `vocab_bank` / `fill_in_blank_exercise` style.
Alternatively, emit `_schema: context_fill` for cells that lack a numeric question prefix
(already done in `normalize_fill_in_blank_item()` for new-format items, line 108–113).

#### A-3: story_text paragraph splitting — PARTIAL

`split_story_paragraphs()` (lines 168–191) has three fallback strategies:
1. Split on `\n` (natural table-cell newline)
2. Split on two-space separator
3. Split on `。\n`

For G6-L1 (`_parsed_2026-05-01/G6-L1.yml`, verified), `paragraph_count: 1` was observed —
the entire 1053-character story is a single paragraph. This means either the docx table cell
had no internal newlines or the two-space strategy failed, and TTS and comprehension steps
operate on a single unsplit block.

**Impact for OMO**: single-paragraph stories cause OMO identifier to match a shorter/wrong
paragraph context when grading answers that reference "paragraph 2" etc. (待查: whether
the OMO grader uses paragraph_count for grading context).

**Mitigation**: emit `paragraph_count=1` as a `flags: [single_paragraph]` warning; add a
heuristic splitter for `。` followed by Chinese name/clause (suitable for 說明文).

#### A-4: image extraction mixes templates, QR codes, real diagrams — VERIFIED

`extract_images_with_metadata()` (lines 595–648) iterates `doc.part.rels.values()` and
extracts ALL embedded images. Per the existing pipeline gotchas doc (verified in memory):
- 7–12 decoration icons per docx (same hash across 100+ lessons)
- 1–3 QR codes (3–5 KB)
- 0–5 real lesson diagrams

The hash-dedup `seen_hashes` set (line 609) prevents exact duplicates within one docx, but
the inter-lesson template icons are not filtered here — that requires the separate
`scripts/filter_template_images.py` which runs post-parse. If that script is not run, or
the GCS path contains unfiltered images, the `images[]` array in the lesson YAML will
contain non-instructional assets.

**Impact for OMO**: the OMO identifier uses `images[]` to display the lesson to the student
as a reference. Template icons shown as "lesson content" confuse the reference view.

**Mitigation (verified existing)**: hash-appearing-in-5-or-more-lessons heuristic in
`filter_template_images.py`. Recommend running it as a mandatory post-parse step in CI.

#### A-5: grade_code zero-pad inconsistency — VERIFIED

Layer-1 files (L01.yml): `grade_code: G4-L01` (zero-padded).
Layer-2 files (_parsed_2026-05-01/G6-L1.yml): `grade_code: G6-L1` (not zero-padded).
Layer-2 files (_parsed_2026-05-01/G6-L22.yml): `grade_code: G6-L22` (matches no-pad).

`normalize_manifest_code()` in `lesson_code_normalization.py` (line 41–60) explicitly
strips zero-padding: `G4-L01 → G4-L1`. So the normalized lookup works correctly. However,
the `worksheet_pdf_url` in `lesson_layer_loaders.py` hardcodes the GCS path as
`gs://lingoleap-assets/stories/thumbnails/{norm_code}.webp` using `norm_code` (non-padded).
The GCS bucket may contain files with padded names (e.g., `G4-L04.pdf` from
`rebuild_worksheets_fonts.py`, line 28 AFFECTED list). This creates a URL mismatch.

**Concrete evidence**: `rebuild_worksheets_fonts.py` line 29 AFFECTED list includes both
`"G4-L04"` (padded) and `"G4-L5"` (unpadded) — confirming the inconsistency is present
in the actual GCS namespace.

**Mitigation**: standardize GCS filenames to non-padded form (`G4-L4.pdf`) and verify
`gsutil ls` against the lesson codes generated by `normalize_manifest_code()`.

#### A-6: multi-lesson YAML covers only primary slot — VERIFIED

`parse_docx_lessons_bulk.py` lines 1032–1035 (parse-report Known Remaining Gaps):
> "Multi-lesson files (e.g. G4-L20-22, G9-L15~16) only parse first lesson metadata"

Verified: `lesson_code_normalization.py` defines `MULTI_LESSON_PRIMARY` (line 73–78) with 4
entries; `MULTI_LESSON_MAP` (line 80–87) maps the secondary slots back to the primary.

**Impact**: G4-L21, G4-L22, G5-L25, G9-L16, G9-L18, G9-L19 are all served as the primary
slot's story. Secondary-slot students reading a different text still get lesson 1 of the
combined file — potentially the wrong story, wrong fill_in_blank answers, wrong vocabulary.

**Mitigation**: flag multi-lesson secondaries explicitly in the platform UI; or emit N
separate YAMLs per multi-lesson docx in the parser.

---

### Node B — YAML → lesson_loader (lesson_layer_loaders.py)

#### B-1: strategy_exercise singular/plural schema mismatch — VERIFIED

`lesson_layer_loaders.py` line 369–372:
```python
"strategy_exercise": (
    data.get("strategy_exercise") or data.get("strategy_exercises")
),
```
This accepts both keys with a priority fallback. The Layer-1 loader (line 217) reads only
`strategy_exercise` (singular). Layer-2 files from `parse_docx_lessons_bulk.py` emit
`strategy_exercises` (plural). If a developer writes a new YAML with only the singular key
for a Layer-2 lesson, or vice versa, the field will silently be None for Layer-1 enrichment.

**Mitigation**: add a YAML schema validation step (e.g., `pydantic` or `jsonschema`) that
rejects YAMLs containing both `strategy_exercise` and `strategy_exercises`, or that require
one of them for G7 lessons.

#### B-2: fill_in_blank _schema filtering at load time — VERIFIED

`normalize_fill_in_blank_item()` (line 81–114) tags new-format (context_fill) items with
`_schema: "context_fill"`. The comment confirms (line 105–107):
> "Frontend api.ts filters by _schema: items with _schema='context_fill' are dropped from
> fillInBlank → hasData=false → NoDataFallback renders (correct for 6/1 demo)."

This is a deliberate bridge — new-format fill_in_blank items from 5/1 curriculum batch are
silently dropped from the student exercise view. The student sees "no data" instead of a
(wrongly-typed) exercise.

**Impact for OMO**: the `omo_question_schema._build_question_schema()` reads `fill_in_blank`
from the loaded lesson dict. If `context_fill` items are not dropped there too, the grader
will receive fill_in_blank items with `answer: "模仿雞叫"` (freetext) but expect a single
letter for vocab-bank matching. This creates a grading schema mismatch for 5/1 lessons.

**Mitigation**: verify `_build_question_schema()` handles `_schema: "context_fill"` items.
If not, add an explicit filter there. (待查: current code in `omo_question_schema.py` does
read `fill_in_blank` without filtering by `_schema`.)

#### B-3: thumbnail_url hardcoded GCS path — VERIFIED

`lesson_layer_loaders.py` line 349–350:
```python
f"https://storage.googleapis.com/lingoleap-assets/stories/"
f"thumbnails/{norm_code}.webp"
```
These webp files must be pre-generated by `scripts/generate_layer2_thumbnails.py` and
uploaded. Per pipeline gotchas memory (verified): Layer-2 lessons ship with `thumbnail_url`
pointing to GCS files that don't exist → 404 in book library for any lesson not yet
processed.

**Mitigation**: run `generate_layer2_thumbnails.py` as a required step after adding new
parsed YAMLs; consider adding a 404-detection health check in CI.

---

### Node D — Word docx → PDF via LibreOffice (scripts/convert_docx_to_pdf.py)

**File**: `scripts/convert_docx_to_pdf.py` — LibreOffice headless conversion.

#### D-1: LibreOffice ≠ Microsoft Word render — VERIFIED (CONFIRMED BY ISSUE #2018)

`scripts/rebuild_worksheets_fonts.py` (verified) explicitly lists 37 worksheets that required
reprocessing because LibreOffice substituted Simplified Chinese fonts (`PingFangSC`,
`SimSun`, `DFFangYuanW7-GB5`, etc.) for Traditional Chinese content.

This is concrete evidence that the LibreOffice headless conversion path produces layout and
typography fidelity loss compared to the Word source:
- Font substitution → wrong character rendering (SC vs TC glyphs for some characters)
- Layout reflow → paragraph breaks, spacing, table column widths can shift
- Hidden/invisible elements may become visible (white-text content revealed)
- Form fields / checkboxes may not render

**Mitigation (partially verified existing)**: `rebuild_worksheets_fonts.py` uses `pdffonts`
post-build font check (lines 157–174) and rejects builds with bad font patterns. This is a
detect-and-rebuild loop but does not prevent the root cause.

**Better mitigation**: run conversion on a macOS/Windows machine with the same font set as
the Word author (verified: the `find_soffice()` function targets `/opt/homebrew/bin/soffice`
i.e., macOS homebrew). Do NOT run on Linux CI where TC fonts are not installed.

#### D-2: soffice output filename mismatch — VERIFIED

`convert_docx_to_pdf.py` lines 174–184: soffice names the output file after the docx stem,
not the lesson code. The script renames it to `{lesson_code}.pdf`. If the stem → rename
logic fails (file already exists, race condition in parallel execution), the PDF may be
skipped with a silent "not found" error rather than an actual missing file error.

**Mitigation**: add post-conversion hash/size verification; treat zero-byte or absent PDF
as a hard error.

#### D-3: 教師版 vs 學生版 selection — VERIFIED (RISK FOR ANSWER LEAK)

`convert_docx_to_pdf.py` line 104–121: `find_all_docx_files()` prefers 教師版 when both
exist (first source_dir wins). `rebuild_worksheets_fonts.py` line 83–90: explicitly
searches student version (`-SL-` / `學生版`) first, teacher version second.

These two scripts have **opposite selection order**. The main convert script would produce
PDFs with teacher answer keys embedded; the rebuild script would produce student-version
PDFs. If the rebuild script is used to refresh only the 37 affected files, and the main
script was used for the rest, the production PDF bucket has **mixed teacher/student versions**.

**This is the highest-severity fidelity/confidentiality risk in the pipeline.**

**Mitigation**: unify both scripts to consistently prefer 學生版 when available. Add a
`version_type` audit column to the build manifest and verify all 158 GCS files are
student-version.

#### D-4: no Google Doc conversion node — VERIFIED (pipeline clarification)

The action item mentions "Google Doc". The actual pipeline does NOT pass through Google Docs.
The flow is: `Word docx → LibreOffice headless → PDF → GCS`. There is no Google Docs
import/export step. The "Google Doc" in the action item likely refers to either:
a) a proposed alternative (use Google Drive import → Google Docs → export PDF); or
b) a mischaracterization of the GCS storage step.

**Decision needed**: if Google Docs conversion is desired as an alternative to LibreOffice,
it would require Google Drive API upload, Docs API export, and authorization setup. This
would be a Node D replacement, not an addition. Recommend staying with LibreOffice + macOS
font environment and fixing the known issues (D-1, D-3) before considering a Google Docs path.

---

### Node E — GCS upload (gsutil cp)

#### E-1: no versioning / rollback — 待查

The `gsutil cp` command in both scripts uses a plain copy with no `--versioning` flag.
If a bad PDF is uploaded it overwrites the previous version with no rollback path (待查:
whether the `lingoleap-assets` bucket has object versioning enabled in GCP config).

**Mitigation**: enable GCS object versioning on `lingoleap-assets/worksheets/`; document
rollback procedure.

#### E-2: no integrity check post-upload — PARTIAL

`rebuild_worksheets_fonts.py` runs `pdffonts` before upload (font check), but does not
verify the GCS object after upload (e.g., size match or MD5 check). If the upload is
silently truncated, the GCS file will be corrupt but the build manifest will show "uploaded".

**Mitigation**: after each upload, run `gsutil stat` and compare the reported size to the
local file size.

---

### Node F — lesson_loader passes worksheet_pdf_url

#### F-1: worksheet_pdf_url is manually set in YAML, not auto-derived — VERIFIED

Checked in L01.yml (not present), L23.yml (has it), L37.yml (has it), L40.yml, L41.yml,
L55.yml. The field is only set in the 57 Layer-1 YAML files where it was manually added.

Layer-2 lessons from `_parsed_2026-05-01/` do NOT have `worksheet_pdf_url` unless it was
manually inserted after parsing. The `load_layer2_lessons()` function passes through
`data.get("worksheet_pdf_url")` which will be None for the 101 new lessons.

**Impact**: OMO's "download paper worksheet" feature is broken for 101/158 lessons.

**Mitigation**: after converting all 158 lesson docx files to PDF and uploading to GCS,
run a script to inject `worksheet_pdf_url` into each Layer-2 YAML using the standard
GCS URL pattern `https://storage.googleapis.com/lingoleap-assets/worksheets/{lesson_code}.pdf`.

---

### Node G — Student photo upload (omo_storage.py)

#### G-1: silent GCS upload failure — VERIFIED

`omo_storage._upload_to_gcs()` lines 41–44:
```python
except Exception as exc:
    logger.warning("OMO GCS upload failed ... — continuing without GCS")
```
If GCS upload fails, the function still returns `object_path` as if the upload succeeded.
Downstream `omo_identifier` and `omo_grader` will attempt to read a non-existent GCS object
and either get a signed URL for a 404 resource, or fail at Gemini vision with an unhelpful error.

**Mitigation**: either surface the GCS failure to the frontend (return an error status on
upload failure) or implement an explicit existence check before kicking off identification.

---

### Node H — OMO identifier/grader: placeholder-as-question root cause

#### H-1: question detection has no upper-level reference — VERIFIED (MEETING ROOT CAUSE)

`omo_question_schema._build_question_schema()` (verified, file read) builds the grader
schema from `lesson.fill_in_blank` and `lesson.multiple_choice` fields. These fields come
from Node A parsing (A-2 above). If the parsing extracted placeholder blanks as fill_in_blank
items, the grader will attempt to match them against student answers — and fail or produce
random scores.

The fix therefore has two prongs:
1. Node A: fix parser to not extract non-question `【】` blanks (A-2 mitigation)
2. Node H: add a reference alignment step that compares the number of detected questions
   against the YAML's `fill_in_blank_count` and emits a warning if they diverge by more
   than 2

---

## 3. 降風險 Prioritized Table

| Priority | Node | Fidelity Loss | Impact on Students/Grading | Mitigation |
|----------|------|--------------|---------------------------|------------|
| P0 | D-3 | Teacher answer key in student-facing PDF (mixed teacher/student version) | Student sees correct answers before doing worksheet | Unify both scripts to always prefer 學生版; audit GCS bucket version_type |
| P0 | A-1 | answer_leak in `question` text if strip_answer_prefix misses variant | Student sees answer embedded in MCQ text | Add post-parse regex scan; add `answer_leak_candidate` flag |
| P0 | A-2 / H-1 | Placeholder/demo blank → false fill_in_blank → wrong grading | OMO grader scores a non-question; OCR mismatch → all items wrong | Add question-prefix guard in `extract_fill_in_blank()`; add count-divergence check in grader |
| P1 | D-1 | LibreOffice font substitution → Simplified Chinese render | Teacher cannot read Traditional Chinese content; layout breaks hide content | Enforce macOS build environment; pdffonts check before upload is already in place |
| P1 | G-1 | Silent GCS upload failure → grader reads 404 object | Identification/grading silently fails | Raise exception instead of warning; add pre-identification existence check |
| P1 | B-2 | `context_fill` items not filtered in omo_question_schema | 5/1 curriculum fill_in_blank items create grading mismatch | Confirm and add `_schema` filter in `_build_question_schema()` |
| P2 | F-1 | `worksheet_pdf_url` missing for 101/158 lessons | "Download worksheet" broken for most new lessons | Script to inject URL after GCS upload |
| P2 | A-6 | Multi-lesson secondary slot served as primary story | Students in G4-L21/L22 slots see wrong story | Emit separate YAMLs per slot; or surface a platform warning |
| P2 | A-5 | GCS filename zero-pad inconsistency | Some thumbnail/worksheet URLs return 404 | Standardize to non-padded filenames; verify with `gsutil ls` |
| P3 | A-3 | Single-paragraph story (G6-L1 verified) | TTS and comprehension steps cannot refer to "paragraph N" | Emit `single_paragraph` flag; add fallback splitter |
| P3 | A-4 | Template/QR images in `images[]` | Incorrect reference images shown in OMO view | Mandate `filter_template_images.py` as post-parse CI step |
| P3 | B-1 | strategy_exercise singular/plural mismatch | G7 strategy exercises may silently be None for some lessons | Add YAML schema validation; reject dual-key YAMLs |
| P3 | E-1 | No GCS object versioning | Corrupt upload unrecoverable | Enable bucket versioning; document rollback |
| P3 | B-3 | Thumbnail 404 for Layer-2 lessons | Book library shows broken images | Run thumbnail generation script after YAML additions |

---

## 4. Claimed Gotchas — Verification Status

The following are gotchas from memory/project notes — verified against actual code:

| Gotcha | Status | Evidence |
|--------|--------|---------|
| Parser missing thumbnail generation for Layer-2 | VERIFIED | `lesson_layer_loaders.py` L349: hardcoded GCS URL with no generation step |
| Imagen quotas (20/min regular, 200/min fast) | 待查 — not in scope of this audit (Vertex AI config) | memory only |
| Imagen content filter silent reject | 待查 — not in scope of this audit | memory only |
| lesson_loader Layer-1 vs Layer-2 key mismatch (`strategy_exercise` singular vs plural) | VERIFIED | `lesson_layer_loaders.py` L369–372 |
| Image extraction mixes templates + QR + real diagrams | VERIFIED | `parse_docx_lessons_bulk.py` lines 595–648 |
| grade_code zero-pad inconsistency | VERIFIED | L01.yml = `G4-L01`, `_parsed_2026-05-01/G6-L1.yml` = `G6-L1`; plus AFFECTED list in `rebuild_worksheets_fonts.py` mixes padded and non-padded |
| detect-changes skips frontend rebuild on yml-only changes | VERIFIED | `staging-deploy.yml` path filter: `backend: 'backend/**'` — YAML changes in `backend/data/lessons/*.yml` trigger backend deploy only, NOT frontend |
| Squash-merge danger (feature branched from staging) | VERIFIED (pattern visible in git structure) — not directly in scope | memory only |

---

## 5. Files Read (Audit Trail)

- `backend/scripts/parse_docx_lessons.py` (full)
- `backend/scripts/parse_docx_lessons_bulk.py` (full)
- `backend/app/services/lesson_loader.py` (full)
- `backend/app/services/lesson_layer_loaders.py` (full)
- `backend/app/services/lesson_code_normalization.py` (full)
- `backend/app/services/omo_storage.py` (full)
- `backend/app/services/omo_question_schema.py` (partial, lines 1–80)
- `backend/data/lessons/L01.yml` (fill_in_blank section)
- `backend/data/lessons/_parsed_2026-05-01/G6-L22.yml` (lines 1–60)
- `backend/data/lessons/_parsed_2026-05-01/G6-L1.yml` (head)
- `scripts/convert_docx_to_pdf.py` (full)
- `scripts/rebuild_worksheets_fonts.py` (full)
- `.github/workflows/staging-deploy.yml` (detect-changes section)
- `docs/meetings/2026-05-29-record.md`
- memory file `project_lingoleap_pipeline_gotchas.md`

---

*Audit produced 2026-06-01. Code base: staging branch. Action item from 5/29 meeting §2.*
