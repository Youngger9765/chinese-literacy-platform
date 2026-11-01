# MOE School Directory (教育部學校名錄)

Official source data for the school search directory (#3804 §4.2).

## Source

Ministry of Education Statistics Department (教育部統計處), published via the
Taiwan government open data platform (政府資料開放平臺 / data.gov.tw). No
unofficial mirrors used, per `~/.claude/rules/security.md` (official sources
only).

| File | Dataset page | CSV download URL | Academic year | Downloaded |
|---|---|---|---|---|
| `elementary.csv` | [國民小學名錄 (data.gov.tw/dataset/6087)](https://data.gov.tw/dataset/6087) | https://stats.moe.gov.tw/files/school/115/e1_new.csv | 115 (single year) | 2026-11-01 |
| `junior_high.csv` | [國民中學名錄 (data.gov.tw/dataset/6088)](https://data.gov.tw/dataset/6088) | https://stats.moe.gov.tw/files/opendata/j1_new.csv | 104–115 (multi-year, one file) | 2026-11-01 |
| `senior_high.csv` | [一般高級中等學校名錄 (data.gov.tw/dataset/6089)](https://data.gov.tw/dataset/6089) | https://stats.moe.gov.tw/files/school/115/high.csv | 115 (single year) | 2026-11-01 |

License: 政府資料開放授權條款 (Government Open Data License) v1.

## Why these three files

LingoLeap's users are 國小高年級～國中生 (per project CLAUDE.md), so elementary
and junior high are the primary coverage; senior high (高中職) is included
because issue #3804 asks for the full 國小/國中/高中職 range and a teacher
account can belong to any of the three levels.

Vocational senior high schools (高職) are a separate MOE dataset not pulled in
this round — flagged as a known gap, not silently dropped (see PRD §4.2).

## File shape (as downloaded, NOT re-encoded)

All three are UTF-8 with BOM, columns: `學年度,代碼,學校名稱,公/私立,縣市名稱,地址,電話,網址`
(`senior_high.csv` has one extra trailing `備註` column).

- `代碼` — the national MOE school code (`moe_school_code` after import). Globally
  unique across all three files (verified: 0 collisions across 3855 codes at
  import time).
- `縣市名稱` — looks like `[31]臺北市`. The bracketed number is **not** a stable
  per-county code — Taipei alone spans `[31]`–`[42]` (12 different bracket
  values all labelled 臺北市, one per historical district), and Kaohsiung
  spans `[51]`–`[61]`. It is stored as-is in `county_code` for provenance but
  the search API filters by the human-readable `county_name` text, not by
  this code — see `app/services/moe_school_import.py`.

## Known data quirks handled at import time

- `junior_high.csv` bundles every academic year (104–115) in one file —
  the import filters to `學年度 == "115"` (740 of 8875 rows) and documents
  why the "row count" for this file is the filtered count, not the raw file
  line count.
- `senior_high.csv` has one non-data footnote row
  (`學年度=="高中部尚未招生"`, every other column empty) mixed into the data —
  skipped, not imported, and counted separately so the reconciliation is
  honest about why imported rows (506) is one less than the raw CSV
  (507).

## Re-downloading a newer academic year

```bash
curl -sL -o backend/data/moe_schools/elementary.csv https://stats.moe.gov.tw/files/school/<YEAR>/e1_new.csv
curl -sL -o backend/data/moe_schools/senior_high.csv https://stats.moe.gov.tw/files/school/<YEAR>/high.csv
curl -sL -o backend/data/moe_schools/junior_high.csv https://stats.moe.gov.tw/files/opendata/j1_new.csv
```

Then re-run `python scripts/import_moe_schools.py` — the import is an upsert
keyed on `moe_school_code`, safe to re-run.
