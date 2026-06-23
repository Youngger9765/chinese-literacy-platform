#!/usr/bin/env python
"""Generate the 聚光燈品質審查頁 (human-anchor audit kit, per PM protocol #2397).

Reads the post-deploy vision sweep verdicts + eval disputed set, copies each
audited lesson's render screenshot into the presentation dir, and emits a
self-review HTML: per lesson = title + judge verdict + reasoning + screenshot
+ a column for the human (Young/教授) to mark 真對/真錯/誤判. This is the
human-anchored truth point the quality chain was missing.
"""
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SWEEP = ROOT / "qa/content-evidence/vision-judge-grade-map/sweep-results.jsonl"
SHOTS_SRC = ROOT / "qa/content-evidence/vision-judge-grade-map/shots"
OUT_DIR = ROOT / "frontend/public/presentation"
SHOTS_DST = OUT_DIR / "spotlight-audit-shots"
SHOTS_DST.mkdir(parents=True, exist_ok=True)

rows = [json.loads(l) for l in SWEEP.read_text().splitlines() if l.strip()]

# Priority audit set: all non-faithful (judge flagged) + a faithful sample.
flagged = [r for r in rows if r.get("verdict") != "faithful"]
faithful = [r for r in rows if r.get("verdict") == "faithful"]
# deterministic faithful sample: every Nth to spread across grades
sample = faithful[:: max(1, len(faithful) // 20)][:20]
audit = flagged + sample

def shot_for(sid):
    for cand in (SHOTS_DST.parent, SHOTS_SRC):
        p = cand / str(sid) / "reading-strategy.png"
        if p.exists():
            return p
    # sweep stored under shots/<sid>/reading-strategy.png
    p = SHOTS_SRC / str(sid) / "reading-strategy.png"
    return p if p.exists() else None

cards = []
for r in audit:
    sid = r.get("story_id")
    src = shot_for(sid)
    img = ""
    if src and src.exists():
        dst = SHOTS_DST / f"{sid}.png"
        if not dst.exists():
            shutil.copy(src, dst)
        img = f'<img loading="lazy" src="spotlight-audit-shots/{sid}.png" alt="{sid}">'
    v = r.get("verdict", "?")
    color = {"faithful": "#2e7d32", "cross_lesson": "#c62828",
             "figure_broken": "#e65100", "error": "#777"}.get(v, "#777")
    cards.append(f"""
    <div class="card">
      <div class="hd"><b>{r.get('lesson_code','?')}</b> · story {sid}
        <span class="title">{(r.get('title') or '')}</span>
        <span class="verdict" style="background:{color}">judge: {v}</span></div>
      <div class="reason">{(r.get('reasoning') or '')[:240]}</div>
      <div class="shot">{img or '(無截圖)'}</div>
      <div class="human">人工裁決: ☐ 真對(faithful) ☐ 真放錯課(cross) ☐ judge 誤判 ☐ 破圖 ☐ 其他____</div>
    </div>""")

counts = {}
for r in rows:
    counts[r.get("verdict")] = counts.get(r.get("verdict"), 0) + 1

html = f"""<!DOCTYPE html><html lang="zh-TW"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>聚光燈品質審查 — 人工錨點 audit</title>
<style>
 body{{font-family:"Noto Sans TC",system-ui,sans-serif;background:#FDF8F0;color:#1a1a2e;margin:0;padding:24px}}
 h1{{color:#5B4FC4;font-size:1.4rem}} .sub{{color:#6b6b8a;margin-bottom:20px}}
 .card{{background:#fff;border-radius:10px;padding:16px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.08)}}
 .hd{{font-size:1rem;margin-bottom:6px}} .title{{color:#444;margin:0 8px}}
 .verdict{{color:#fff;border-radius:6px;padding:2px 8px;font-size:.8rem;float:right}}
 .reason{{font-size:.85rem;color:#555;margin:8px 0;line-height:1.5}}
 .shot img{{max-width:100%;border:1px solid #ddd;border-radius:6px}}
 .human{{margin-top:10px;font-size:.9rem;color:#5B4FC4;background:#f3f1fc;padding:8px;border-radius:6px}}
</style></head><body>
<h1>聚光燈品質審查 · 人工錨點 audit</h1>
<p class="sub">全 {len(rows)} 課 sweep: {json.dumps(counts, ensure_ascii=False)}　|
本頁列出 judge flagged({len(flagged)}) + faithful 抽樣({len(sample)}) 供人工裁決。
判定門檻(PM): cross_lesson 漏網=0 才算過。</p>
{''.join(cards)}
</body></html>"""

out = OUT_DIR / "spotlight-audit.html"
out.write_text(html, encoding="utf-8")
print(f"wrote {out} ({len(audit)} cards, shots copied to {SHOTS_DST})")
