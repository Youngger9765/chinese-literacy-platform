# Parse Report — 158 課批量解析

生成時間: 2026-05-01 21:10:47

## Summary

| 狀態 | 數量 |
|------|------|
| Success (clean) | 138 |
| Partial (warnings) | 13 |
| Failed | 0 |
| Skipped (already exist) | 0 |
| Total processed | 151 |
| Total images extracted | 2200 |

## Partial Parses (有 warnings 但成功輸出)

### G7-L23
- vocab_empty: No vocabulary extracted

### G7-L28
- vocab_empty: No vocabulary extracted

### G7-L29
- vocab_empty: No vocabulary extracted

### G7-L30
- vocab_empty: No vocabulary extracted

### G9-L8
- vocab_empty: No vocabulary extracted

### 文-L10
- vocab_empty: No vocabulary extracted

### 文-L3
- vocab_empty: No vocabulary extracted

### 文-L4
- vocab_empty: No vocabulary extracted

### 文-L5
- vocab_empty: No vocabulary extracted

### 文-L6
- vocab_empty: No vocabulary extracted

### 文-L7
- vocab_empty: No vocabulary extracted

### 文-L8
- vocab_empty: No vocabulary extracted

### 文-L9
- vocab_empty: No vocabulary extracted

## Failed Parses

## Known Remaining Gaps

- Multi-lesson files (e.g. G4-L20-22, G9-L15~16) only parse first lesson metadata
  → Follow-up: detect multi-lesson files and emit N YAMLs per file
- `paragraph_index` for images not available via rels API (would need XML walk)
  → Current metadata: filename, size_bytes, image_hash, content_type
- Some vocab fields may be empty for lessons with non-standard styles
  → Check partial parse list above for vocab_empty flags
- Video URLs blank where embedded as Word hyperlinks (not plain text)
  → Fallback extracts from paragraph text; hyperlink XML fallback attempted

## Follow-up PRs (do not include in this PR)

- Schema-match against L01.yml format (curriculum index integration)
- Filter decorative-chrome images (#1341) using image_hash dedup
- Wire 158 lessons into platform routing (#1344 part 2)
- Multi-lesson file splitting (emit N YAMLs for L15~16 etc.)