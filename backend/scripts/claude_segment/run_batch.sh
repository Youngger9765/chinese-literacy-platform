#!/bin/bash
# Batch: segment → validate → audit (auto-fix) for a range of lessons.
# Usage: run_batch.sh <start_id> <end_id>
# Example: run_batch.sh 31 33
set -uo pipefail

START=${1:?start_id required}
END=${2:?end_id required}
ROOT="$(git rev-parse --show-toplevel)"
SEG="$ROOT/backend/scripts/claude_segment/segment_lesson.sh"
AUDIT="$ROOT/backend/scripts/claude_segment/audit_lesson.py"
VALIDATE="$ROOT/backend/scripts/validate_segmentation.py"
OUTDIR="$ROOT/backend/data/segmentation-v2"
SUMMARY="$OUTDIR/_batch_${START}_${END}.summary.json"

mkdir -p "$OUTDIR"
echo "[batch] L${START}..L${END} starting at $(date '+%H:%M:%S')" >&2

results="["
first=1
fail_count=0

for lid in $(seq "$START" "$END"); do
  stem=$(printf "L%02d" "$lid")
  echo "" >&2
  echo "=========================================" >&2
  echo "[$stem] STEP 1: segment via claude -p --bare" >&2
  echo "=========================================" >&2

  seg_status="ok"
  if ! bash "$SEG" "$lid"; then
    seg_status="segment_failed"
    fail_count=$((fail_count + 1))
    echo "[$stem] segment FAILED, skipping validate/audit" >&2
    entry="{\"lesson_id\":$lid,\"segment\":\"$seg_status\"}"
    [ $first -eq 1 ] && first=0 || results="$results,"
    results="$results$entry"
    continue
  fi

  echo "" >&2
  echo "[$stem] STEP 2: validate_segmentation.py (reports violations)" >&2
  python3 "$VALIDATE" --input "$stem.opus.v2.json" 2>&1 | tee "$OUTDIR/$stem.validate.log" || true

  echo "" >&2
  echo "[$stem] STEP 3: audit_lesson.py (auto-fix length + split >40)" >&2
  audit_out=$(python3 "$AUDIT" "$lid" 2>&1 || echo '{"error":"audit_failed"}')
  echo "$audit_out" | tee "$OUTDIR/$stem.audit.json"

  [ $first -eq 1 ] && first=0 || results="$results,"
  results="$results$audit_out"
done

results="$results]"
echo "$results" > "$SUMMARY"

echo "" >&2
echo "=========================================" >&2
echo "[batch] DONE at $(date '+%H:%M:%S')" >&2
echo "[batch] failures: $fail_count" >&2
echo "[batch] summary: $SUMMARY" >&2
echo "=========================================" >&2

# Print human-readable recap
python3 - "$SUMMARY" <<'PYEOF'
import json, sys
arr = json.load(open(sys.argv[1]))
print("\n=== BATCH RECAP ===")
print(f"{'LID':>4} {'title':<20} {'sents':>5} {'fixes':>5} {'over40':>6} {'split':>5} {'issues':>6}")
for r in arr:
    if r.get("segment") == "segment_failed":
        print(f"{r['lesson_id']:>4} SEGMENT_FAILED")
        continue
    if r.get("error"):
        print(f"{r.get('lesson_id','?'):>4} AUDIT_FAILED")
        continue
    print(f"{r['lesson_id']:>4} {r.get('title','')[:18]:<20} {r['total_sentences']:>5} {r['length_fixes']:>5} {r['over40_count']:>6} {r['auto_splits']:>5} {len(r['issues']):>6}")
    for iss in r.get("issues", []):
        print(f"       └─ p{iss['p']}s{iss['s']}: {iss['issue']}")
PYEOF
