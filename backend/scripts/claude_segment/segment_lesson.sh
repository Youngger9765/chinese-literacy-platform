#!/bin/bash
# Segment one lesson using claude -p --bare (Max subscription, $0 API cost).
# Usage: segment_lesson.sh <lesson_id>
set -euo pipefail

LID=${1:?lesson_id required}
STEM=$(printf "L%02d" "$LID")
ROOT="/Users/young/project/chinese-literacy-platform-issue-1176"
PROMPT="$ROOT/backend/scripts/claude_segment/prompt.md"
YML="$ROOT/backend/data/lessons/$STEM.yml"
OUTDIR="$ROOT/backend/data/segmentation-v2"
OUT="$OUTDIR/$STEM.opus.v2.json"
RAW="$OUTDIR/$STEM.opus.raw.txt"
LOG="$OUTDIR/$STEM.opus.log"

mkdir -p "$OUTDIR"

[ -f "$YML" ] || { echo "[$STEM] ERROR: $YML not found" >&2; exit 1; }

echo "[$STEM] calling claude -p --bare ..." >&2
{
  cat "$PROMPT"
  printf "\n\nlesson_id: %d\n\n" "$LID"
  cat "$YML"
  printf "\n\n請只輸出 JSON。\n"
} | claude -p --bare > "$RAW" 2>"$LOG"

# Extract JSON from raw output (strip any fences / preamble)
python3 - "$RAW" "$OUT" <<'PYEOF'
import json, re, sys
raw_path, out_path = sys.argv[1], sys.argv[2]
raw = open(raw_path, encoding='utf-8').read()
m = re.search(r'```(?:json)?\s*(\{.*\})\s*```', raw, re.DOTALL)
js = m.group(1) if m else None
if js is None:
    s, e = raw.find('{'), raw.rfind('}')
    if s < 0 or e < 0:
        sys.stderr.write(f"ERROR: no JSON in raw output. First 500 chars:\n{raw[:500]}\n")
        sys.exit(1)
    js = raw[s:e+1]
try:
    obj = json.loads(js)
except Exception as ex:
    sys.stderr.write(f"ERROR: invalid JSON: {ex}\n{js[:500]}\n")
    sys.exit(1)
open(out_path, 'w', encoding='utf-8').write(json.dumps(obj, ensure_ascii=False, indent=2))
print(f"[{out_path}] parsed OK", file=sys.stderr)
PYEOF

echo "[$STEM] saved → $OUT" >&2
