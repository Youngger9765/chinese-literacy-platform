#!/usr/bin/env python3
"""Batch-run key-reading extractor over all reading_timer lessons with a teacher DOCX.
Measures generalization hit-rate (structure detection is content-agnostic — valid pre-2nd-draft).
"""
import sys, os, re, glob, json
sys.path.insert(0, os.path.dirname(__file__))
from extract_key_reading import extract

ROOT = "/Users/young/project/chinese-literacy-platform"
SRC = os.path.join(ROOT, "private/curriculum-source")

# reading_timer lesson codes
rt = set()
for f in glob.glob(os.path.join(ROOT, "backend/data/lessons/_parsed_2026-05-01/*.yml")):
    code = os.path.basename(f)[:-4]
    try:
        if "reading_timer" in open(f, encoding="utf-8").read():
            rt.add(code)
    except Exception:
        pass

# map code -> teacher docx (prefer 教師版/第三階段 folders, first match)
def find_docx(code):
    cands = []
    for f in glob.glob(os.path.join(SRC, "**", "*.docx"), recursive=True):
        b = os.path.basename(f)
        m = re.match(r"^(G\d+-L\d+)", b)
        if m and m.group(1) == code and ("教師版" in f or "第三階段" in f or "1-1" in f):
            cands.append(f)
    return cands[0] if cands else None

results = []
for code in sorted(rt):
    docx = find_docx(code)
    if not docx:
        results.append({"code": code, "status": "no_docx"})
        continue
    try:
        r = extract(docx)
    except Exception as e:
        results.append({"code": code, "status": "crash", "err": str(e)[:80]})
        continue
    if not r.get("ok"):
        results.append({"code": code, "status": "no_extract", "reason": r.get("reason", "")})
        continue
    ext = r["benchmark"]
    chars = r["passage_chars_no_punct"]
    sane_extent = 150 <= ext <= 600
    close = abs(chars - ext) <= 60  # snap adds up to ~1 sentence
    results.append({
        "code": code, "status": "ok",
        "extent": ext, "chars_no_punct": chars, "diff": chars - ext,
        "sane_extent": sane_extent, "ends_clean": r["ends_clean"], "close": close,
        "start": r["start_text"][:12],
    })

# summary
ok = [r for r in results if r["status"] == "ok"]
good = [r for r in ok if r["sane_extent"] and r["ends_clean"] and r["close"]]
by_status = {}
for r in results:
    by_status[r["status"]] = by_status.get(r["status"], 0) + 1

print("=== KEY-READING EXTRACTOR HIT-RATE (reading_timer lessons w/ teacher DOCX) ===")
print(f"total reading_timer lessons: {len(rt)}")
print(f"status breakdown: {json.dumps(by_status)}")
not_sane = [f"{r['code']}({r['extent']})" for r in ok if not r['sane_extent']]
not_clean = [r['code'] for r in ok if not r['ends_clean']]
far = [f"{r['code']}(d{r['diff']})" for r in ok if not r['close']]
print(f"extracted ok: {len(ok)}")
print(f"  fully-good (sane extent + ends clean + char≈extent): {len(good)}/{len(ok)}  ({100*len(good)//max(1,len(ok))}%)")
print(f"  not sane extent: {not_sane}")
print(f"  not ends-clean:  {not_clean}")
print(f"  char far from extent (>60): {far}")
print()
print("=== NON-OK (need manual/vision) ===")
for r in results:
    if r["status"] != "ok":
        print(f"  {r['code']}: {r['status']} {r.get('reason','')}{r.get('err','')}")

# dump full for inspection
json.dump(results, open("/tmp/key_reading_batch.json", "w"), ensure_ascii=False, indent=2)
print("\nfull → /tmp/key_reading_batch.json")
