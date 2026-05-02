# 破音字標注 Audit — 2026-05-01

Issue: #1353 | Phase 1 (Audit Only — no fixes applied)

## Background

Professor raised the concern that AI-driven zhuyin annotation may mis-label polyphonic characters (破音字). The example given was 「喝彩」— the character 喝 should be read ㄏㄜˋ (fourth tone, "to shout"), not ㄏㄜ (first tone, "to drink"). This audit scans all 57 lesson YAMLs to find polyphonic character occurrences and flag ones that need human verification.

**Pipeline architecture:** The runtime engine is `frontend/src/components/zhuyin/polyphonicProcessor.ts`, which loads `frontend/public/data/poyin_db.json` and applies pattern-matching rules to select the correct pronunciation variant. TTS uses Azure SSML phoneme tags for known corrections (`backend/app/services/tts_service.py`).

## Audit Scope

- **Lessons scanned:** 57
- **Target characters audited:** 31 high-priority polyphonic chars
  - `中 便 假 傳 分 喝 地 大 好 得 應 數 樂 當 的 盛 看 種 空 興 著 行 覺 說 調 轉 還 重 長 降 難`
- **Source DB:** `frontend/public/data/poyin_db.json` (3,237 entries total; 541 with explicit variant patterns)
- **Script:** `backend/scripts/audit_polyphonic.py`

## Results Summary

| Metric | Count |
|--------|-------|
| Total polyphonic occurrences found | 5,155 |
| Occurrences needing human review | 4,298 |
| Already TTS-corrected in SSML | 22 |

## Top 10 Most Frequent Polyphonic Chars

| Rank | Char | Occurrences | Needs Review | Notes |
|------|------|-------------|--------------|-------|
| 1 | 的 | 2,412 | 2,393 | de/di/di4 — runtime rule complex; 的 as "target" (目的) vs particle (我的) |
| 2 | 大 | 303 | 303 | 大夫(ㄉㄞˊ˙ㄈㄨ) vs 大小(ㄉㄚˋ) — pattern match fragile in compound words |
| 3 | 中 | 197 | 194 | 中文(ㄓㄨㄥ) vs 射中(ㄓㄨㄥˋ) — default is 一聲, but "中獎" is 四聲 |
| 4 | 說 | 174 | 170 | 說話(ㄕㄨㄛ) vs 說服(ㄕㄨㄟˋ) — 說服 rare in these texts |
| 5 | 得 | 162 | 74 | 得到(ˊ) vs 做得好(˙ㄉㄜ) vs 不得不(ˊ) — runtime patterns partially resolved |
| 6 | 分 | 159 | 106 | 分開(ㄈㄣ) vs 份/分數(ˋ) |
| 7 | 著 | 154 | 54 | 看著(ˊ輕聲) vs 著急(ˊ2聲) vs 著作(ˋ) — 5 variants, complex |
| 8 | 種 | 144 | 144 | 種植(ˋ) vs 種類(ˇ) — pattern match not applied |
| 9 | 長 | 141 | 69 | 生長(ˇ) vs 校長(ˇ) vs 長度(ˊ) |
| 10 | 看 | 136 | 136 | 看板(ˋ) vs 看家(ˉ) — low occurrence of second reading in texts |

## Top 5 Lessons with Most Polyphonic Occurrences

| Lesson | Total Polyphonic | Needs Review |
|--------|-----------------|--------------|
| L58 | 270 | 235 |
| L22 | 138 | 112 |
| L56 | 138 | 109 |
| L21 | 126 | — |
| L10 | 121 | 101 |

## Known Confirmed Issues

### 1. 喝采 / 喝彩 (喝 → ㄏㄜˋ not ㄏㄜ)

- **Status:** TTS already corrected in `tts_service.py` via SSML `<phoneme>` tag
- **Occurrences:** 22 total (mainly L01, L03, L06)
- **Zhuyin rendering:** Still uses default font rendering (ㄏㄜ first tone) — not yet overridden in `poyin_db.json`
- **Fix needed:** Add `喝采/喝彩` as explicit pattern in poyin_db.json entry for 喝, OR add YAML-level override

### 2. 的 disambiguation (~97% of occurrences flagged)

- **Root cause:** The runtime uses a complex positional rule for 的/得/地 neutralization. The simplified audit matcher cannot replicate this logic fully. Most occurrences are particle `de` (neutral tone) and are almost certainly correct at runtime — this is a false-positive from the audit matcher, not a real error rate.
- **Action:** Do not treat all 2,393 "needs review" for 的 as actual errors. Spot-check 10-20 occurrences in lessons where 的 appears as a verb object (目的、目標的) to verify.

### 3. 大夫 vs 大小 (大)

- **All 303 occurrences flagged** — pattern for 大夫(ㄉㄞˊ) may not be in poyin_db
- **Likely real error rate:** Low — 大夫 is rare in these texts; most 大 are correctly 大 (ㄉㄚˋ)
- **Action:** Check if 大夫 appears in any lesson; if so, verify TTS pronunciation

## Recommendations for Phase 2

1. **AI-assisted batch labeling (Gemini):** Feed each `needs_human_review` occurrence with its context window (±10 chars) to Gemini with a prompt asking for the correct pronunciation. Store results in `backend/data/audit/polyphonic-gemini-labels.json`. Estimated cost: ~5,000 API calls.

2. **YAML override field:** Add `phoneme_overrides` to lesson YAML schema:
   ```yaml
   phoneme_overrides:
     - char: 喝
       char_index: 423
       correct_zhuyin: "ㄏㄜˋ"
       context: "喝采"
       confirmed_by: "professor"
   ```
   The frontend `polyphonicProcessor.ts` reads overrides and applies them before pattern matching.

3. **TTS SSML extension:** Extend `_PHONEME_CORRECTIONS` list in `tts_service.py` for each confirmed correction. Current list has 4 entries; audit suggests 20-50 more may be needed for high-frequency chars.

4. **Admin review UI:** Phase 3 of the issue — a backend admin page showing each flagged occurrence with a "correct pronunciation" dropdown, letting teachers confirm or override. Corrections stored in DB.

## Files Produced

| File | Description |
|------|-------------|
| `backend/scripts/audit_polyphonic.py` | Audit script (read-only, no YAML modifications) |
| `backend/data/audit/polyphonic-audit.json` | Full structured output (5,155 occurrences) |
| `docs/audit/polyphonic-audit-2026-05-01.md` | This report |

## Next Steps

- [ ] Phase 2 (separate PR): Build Gemini batch-labeling script for `needs_human_review` items
- [ ] Phase 3: Add `phoneme_overrides` field to YAML schema + frontend reads it
- [ ] Phase 4: Admin review UI for teacher confirmation
- [ ] Confirm whether 喝 zhuyin rendering (not just TTS) is also wrong in the font display
