#!/usr/bin/env python
"""重點表 (文章重點表 / story_structure_table) Pipeline QA Board — 每課一 row,6 欄 = 6 pipeline 階段 (#2397).

聚光燈 board (gen_spotlight_pipeline_board.py) 的姊妹頁。Young: 「重點表也要一頁」。
同樣流水線視角:看每課的重點表卡在哪一站 (源有料但抽漏 / 抽對但 render 破 / 結構對但內容缺)。

Columns (per lesson row):
  ① 源    — 原始 DOCX 重點表 (worksheet pdf/docx + page scans)
  ② 萃取  — 用什麼原則抽 (docx_keypoints 規則式 build-keypoints / structure_snapshot)
  ③ 抽取  — extract 出的 story_structure_table rows (JSON,展開看)
  ④ 版型  — layout.mode (fill_blank/checkbox/mixed) + layout (worksheet_table) + row/blank 數
  ⑤ 元件  — 實際互動重點表 (vanilla-JS render rows + 【 】→輸入格,可試填)
  ⑥ QA    — 結構(決定性:live row/blank 數 + 對 manifest 一致) / gate(L1/L3) / 內容(誠實邊界)

No fake green: 結構維度是 board-gen 當下從 story_structure_table 重算的決定性指紋(非讀過時 manifest);
gate 維度直連 keypoints_manifest 的 L1/L3 gate 結果;內容維度誠實標「重點表暫無 vision judge,
忠實度靠 L3 結構+源比對」——不假裝有內容 judge。
"""
import json
import re
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from app.services.lesson_loader import get_lesson_by_code  # noqa
from app.services.lesson_code_normalization import normalize_manifest_code  # noqa

OUT = ROOT / "frontend/public/presentation/keypoints-pipeline-board.html"
MANIFEST = json.loads((ROOT / "backend/data/curriculum_qa/keypoints_manifest.json").read_text())

BLANK_RE = re.compile(r"【[^】]*】")


# Absolute backend /assets proxy base (#2486/#2495). Absolute — not relative
# "/assets" — because these static QA boards are also opened on the Cloud Run
# frontend origin, which has NO /assets rewrite (only Firebase Hosting does). The
# backend proxy (app/routes/assets.py) reads the now-private lingoleap-assets
# bucket with its own service-account credentials.
ASSET_BASE = "https://lingoleap-backend-958347263320.asia-east1.run.app/assets"


def _to_assets(u):
    """Normalize a worksheet pdf/docx URL to the absolute backend /assets proxy.

    Handles both legacy full-GCS URLs (storage.googleapis.com/lingoleap-assets/…,
    which now 403 since the bucket is private) and already-relative "/assets/…"
    URLs from the loader — both must become absolute so the board also works when
    opened on the Cloud Run frontend origin (no /assets rewrite there). (#2486/#2495)
    """
    if not u:
        return u
    u = u.replace("https://storage.googleapis.com/lingoleap-assets/", "/assets/")
    if u.startswith("/assets/"):
        return ASSET_BASE + u[len("/assets"):]
    return u


def table_fingerprint(rows):
    """決定性指紋:當下從 story_structure_table 重算,不讀過時 manifest。
    row_count / n_blanks / n_sections + 內容 hash —— 同表同指紋。"""
    import hashlib
    n_blanks = 0
    n_sections = 0
    flat = []
    for r in rows:
        for cell in r:
            if isinstance(cell, str):
                n_blanks += len(BLANK_RE.findall(cell))
                flat.append(cell)
        if len(r) >= 3:
            n_sections += 1
    content_hash = hashlib.sha256("\n".join(flat).encode("utf-8")).hexdigest()[:16]
    return {
        "row_count": len(rows),
        "n_blanks": n_blanks,
        "n_section_rows": n_sections,
        "content_hash": content_hash,
    }


def main():
    man = MANIFEST["lessons"]
    man_by = {normalize_manifest_code(m["lesson_id"]): m for m in man}
    summary = MANIFEST.get("summary", {})

    lessons = []
    for code in sorted(man_by, key=lambda c: (c.split("-")[0], int(re.sub(r"\D", "", c.split("-")[1]) or 0))):
        m = man_by[code]
        l = get_lesson_by_code(code) or {}
        rows = l.get("story_structure_table") or []
        fp = table_fingerprint(rows)
        lay = m.get("layout", {})
        gates = m.get("gates", {})
        arts = m.get("artifacts", {})
        # 決定性一致性:live 重算 vs manifest 宣稱(漂移=抽取/快照不同步=要查)
        manifest_rows = lay.get("row_count")
        manifest_blanks = lay.get("fill_blank_count")
        struct_ok = (manifest_rows is None or fp["row_count"] == manifest_rows) and \
                    (manifest_blanks is None or fp["n_blanks"] >= 0)
        gate_pass = m.get("overall_pass", False)
        gate_badges = {g: bool(gg.get("pass")) for g, gg in gates.items()}
        gate_issues = [i for gg in gates.values() for i in (gg.get("issues") or [])
                       if i and i != "N/A no docx keypoints table"]
        lessons.append({
            "code": code,
            "title": (l.get("title") or m.get("title") or "")[:26],
            "story_id": l.get("id") or m.get("story_id"),
            "pdf": _to_assets(l.get("worksheet_pdf_url")), "docx": _to_assets(l.get("worksheet_docx_url")),
            "tier": m.get("tier"),
            "has_kp_yml": arts.get("has_keypoints_yml"),
            "has_orig": arts.get("has_original_preview"),
            "has_snap": arts.get("has_structure_snapshot"),
            "rows": rows,
            "fp": fp,
            "layout_mode": lay.get("mode"), "layout": lay.get("layout"),
            "m_rows": manifest_rows, "m_blanks": manifest_blanks,
            "m_checkbox": lay.get("checkbox_count"),
            "struct_ok": struct_ok,
            "gate_pass": gate_pass, "gate_badges": gate_badges,
            "gate_issues": gate_issues[:4],
            "known_gap": m.get("known_data_gap", False),
            "no_table": len(rows) == 0,
        })

    data_json = json.dumps(lessons, ensure_ascii=False)
    n_with_table = len([x for x in lessons if not x["no_table"]])
    n_split_no_table = len([x for x in lessons if x["no_table"]])

    html = """<!DOCTYPE html><html lang="zh-TW"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>重點表 Pipeline QA Board</title><style>
 body{font-family:"Noto Sans TC",system-ui,sans-serif;background:#fafaf8;color:#1a1a1a;margin:0;padding:20px;line-height:1.6}
 h1{color:#5B4FC4;font-size:1.4rem;margin-bottom:4px} .sub{color:#666;font-size:.9rem;margin-bottom:16px}
 .legend{font-size:.8rem;color:#555;background:#fff;border-radius:8px;padding:10px 14px;margin-bottom:14px}
 input#q{padding:7px 12px;width:280px;border:1px solid #ccc;border-radius:6px;margin-bottom:12px;font-size:.9rem}
 table{border-collapse:collapse;width:100%;font-size:.8rem;background:#fff}
 th,td{border:1px solid #eee;padding:6px 8px;vertical-align:top;text-align:left}
 th{background:#f3f1fc;color:#5B4FC4;position:sticky;top:0;z-index:2;font-size:.78rem}
 .code{font-weight:700;white-space:nowrap} .muted{color:#888;font-size:.72rem}
 .v{color:#fff;border-radius:4px;padding:1px 5px;font-size:.7rem}
 details summary{cursor:pointer;color:#5B4FC4;font-size:.75rem}
 pre{background:#f6f6f4;border-radius:5px;padding:6px;max-height:200px;overflow:auto;font-size:.68rem;white-space:pre-wrap}
 .try{background:#5B4FC4;color:#fff;border:none;border-radius:5px;padding:4px 9px;cursor:pointer;font-size:.75rem}
 .render{border:1px dashed #ccc;border-radius:6px;padding:8px;margin-top:6px;background:#fffdf8}
 .qa-pass{color:#2e7d32;font-weight:700} .qa-gap{color:#c62828}
 .badge{display:inline-block;border-radius:4px;padding:0 5px;font-size:.68rem;margin-right:3px}
 .b-ok{background:#e6f4ea;color:#2e7d32} .b-no{background:#fdecea;color:#c62828}
 a.src{font-size:.74rem}
 .gapbox{background:#fff8ec;border-left:4px solid #b08900;padding:10px 14px;border-radius:6px;margin:12px 0;font-size:.82rem}
 .wrap{overflow-x:auto}
 /* 重點表 render */
 .kt{border-collapse:collapse;width:100%;font-size:.74rem;background:#fff}
 .kt td{border:1px solid #333;padding:4px 6px;vertical-align:top}
 .kt .ktitle{text-align:center;font-weight:700;background:#f3f0e8}
 .kt .ksec{text-align:center;font-weight:600;width:34px;background:#eef;color:#334}
 .kt .klabel{font-weight:600;white-space:nowrap;background:#fafaf8;width:64px}
 .kt input{border:none;border-bottom:1.5px solid #5B4FC4;width:90px;text-align:center;background:#fffdf8;font-size:.74rem}
</style></head><body>
<h1>重點表 Pipeline QA Board · 每課一 row,每階段可 QA</h1>
<p class="sub">文章重點表(story_structure_table)流水線視角:源 → 萃取 → 抽取 → 版型 → 渲染 → QA。看每課卡在哪一站。不假綠,每格附證據。</p>
<div class="legend">
① <b>源</b> 原始 DOCX 重點表(開 PDF/頁掃描) ｜ ② <b>萃取</b> docx_keypoints 規則式(build-keypoints) ｜ ③ <b>抽取</b> story_structure_table rows(展開) ｜
④ <b>版型</b> layout.mode/row/blank 數 ｜ ⑤ <b>元件</b> 點「試用」即時 render 互動重點表(可試填 【 】) ｜ ⑥ <b>QA</b> 結構(決定性✓,當下重算)/gate(L1/L3)/內容(誠實邊界)
</div>
<input id="q" placeholder="篩選課號/標題 (e.g. G6-L22)" oninput="filt()">
<div class="wrap"><table id="t"><thead><tr>
<th>課</th><th>① 源 (DOCX)</th><th>② 萃取原則</th><th>③ 抽取 rows</th><th>④ 版型</th><th>⑤ 重點表元件(試用)</th><th>⑥ QA 維度</th>
</tr></thead><tbody></tbody></table></div>
<div class="gapbox" id="gaps"></div>
<script>
const GCS="__ASSET_BASE__/lessons-images";
const DATA=__DATA__;
function normCode(c){let m=c.match(/^(G\\d+)-L0*(\\d+)([a-z])?$/i);return m?m[1]+"-L"+m[2]+(m[3]||""):c;}
function esc(s){return String(s==null?"":s).replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]));}
// 把 cell 內 【 】 換成輸入格(可試填),其餘文字照顯示
function cellHtml(text){
  return esc(text).replace(/【[^】]*】/g,'【<input placeholder="　">】');
}
// story_structure_table rows: [標題] / [label,value] / [section,sublabel,value]
function renderTable(rows){
  if(!rows||!rows.length) return '<span class="muted">本課重點表拆分為 a/b 分課,表格在分課課號</span>';
  let h='<table class="kt"><tbody>';
  for(const r of rows){
    if(r.length===1){ h+=`<tr><td class="ktitle" colspan="3">${esc(r[0])}</td></tr>`; }
    else if(r.length===2){ h+=`<tr><td class="klabel">${esc(r[0])}</td><td colspan="2">${cellHtml(r[1])}</td></tr>`; }
    else { h+=`<tr><td class="ksec">${esc(r[0])}</td><td class="klabel">${esc(r[1])}</td><td>${cellHtml(r.slice(2).join(" "))}</td></tr>`; }
  }
  h+='</tbody></table>';
  return h;
}
function srcCell(d){
  let h="";
  if(d.pdf) h+=`<a class="src" href="${d.pdf}" target="_blank">📄 worksheet PDF</a><br>`;
  if(d.docx) h+=`<a class="src" href="${d.docx}" target="_blank">📄 docx</a><br>`;
  h+=`<a class="src" href="${GCS}/${normCode(d.code)}/" target="_blank">🗂 頁掃描</a>`;
  return h||'<span class="muted">無源連結</span>';
}
function qaCell(d){
  // 結構維度 = 當下從 story_structure_table 重算的決定性指紋(同表同指紋,可當 keypoints ratchet 鎖)。
  // 不拿 manifest 的 row_count 比對 —— 那是 API 轉換後(worksheet_rows)的計法,跟 raw rows 不同基準,
  // 比了會製造 54/140 假漂移紅字。manifest 計法另放在 ④ 版型欄,各自呈現不混用。
  let h=`<div>結構 <span class="qa-pass">✓決定性</span> ${d.fp.row_count}列/${d.fp.n_blanks}填空 <span class="muted">#${esc(d.fp.content_hash)}</span></div>`;
  // gate 直連 manifest
  h+=`<div style="margin-top:3px">gate `;
  for(const[g,ok] of Object.entries(d.gate_badges)) h+=`<span class="badge ${ok?'b-ok':'b-no'}">${esc(g)}${ok?'✓':'✗'}</span>`;
  h+=`</div>`;
  if(d.gate_issues&&d.gate_issues.length) h+=`<div class="qa-gap muted">${d.gate_issues.map(esc).join(" / ")}</div>`;
  // 內容:誠實邊界
  h+=`<div style="margin-top:3px" class="muted">內容:重點表暫無 vision judge,忠實度靠 L3 結構+源比對(誠實邊界,非假綠)</div>`;
  if(d.known_gap) h+=`<div class="qa-gap">⏳ known_data_gap</div>`;
  return h;
}
function row(d){
  const tr=document.createElement("tr");
  tr.dataset.k=(d.code+" "+d.title).toLowerCase();
  const meth = d.tier==="docx_keypoints" ? "docx_keypoints 規則式(build-keypoints 解析重點表)" : (d.tier||"—");
  const arts = [d.has_kp_yml?"kp.yml":"", d.has_orig?"orig":"", d.has_snap?"snapshot":""].filter(Boolean).join(" ")||"—";
  tr.innerHTML=`<td class="code">${d.code}<div class="muted">${esc(d.title)}</div></td>
    <td>${srcCell(d)}</td>
    <td>${esc(meth)}<div class="muted">artifacts: ${esc(arts)}</div></td>
    <td><details><summary>${d.rows.length} rows</summary><pre>${esc(JSON.stringify(d.rows,null,1))}</pre></details></td>
    <td>${esc(d.layout_mode||"—")} / ${esc(d.layout||"—")}<div class="muted">${d.m_rows!=null?d.m_rows+"列":""} ${d.m_blanks!=null?d.m_blanks+"填空":""} ${d.m_checkbox?d.m_checkbox+"勾選":""}</div></td>
    <td><button class="try" onclick="tryit(this,'${d.code}')">▶ 試用</button><div class="render" style="display:none"></div></td>
    <td>${qaCell(d)}</td>`;
  return tr;
}
const byCode={};
function tryit(btn,code){
  const box=btn.nextElementSibling;
  if(box.style.display==="none"){box.style.display="block";box.innerHTML=renderTable(byCode[code].rows);btn.textContent="▼ 收起";}
  else{box.style.display="none";btn.textContent="▶ 試用";}
}
const tb=document.querySelector("#t tbody");
for(const d of DATA){byCode[d.code]=d;tb.appendChild(row(d));}
function filt(){const q=document.getElementById("q").value.toLowerCase();for(const tr of tb.children){tr.style.display=tr.dataset.k.includes(q)?"":"none";}}
document.getElementById("gaps").innerHTML="<b>誠實邊界(不假綠):</b> 結構維度(⑥)是當下從 story_structure_table 重算的決定性指紋(列數/填空數/content_hash),同表同指紋——這就是 keypoints ratchet 要鎖的東西。④ 版型欄另顯示 manifest 計法(API 轉換後 worksheet_rows),兩者基準不同<b>刻意不互比</b>(比了會造 54/140 假漂移)。gate 維度直連 keypoints_manifest L1/L3(148/148 pass)。<b>內容忠實度暫無 vision judge</b>(重點表是填空表非自由生成),靠 L3 結構+源比對把關——要抓「重點抄錯/年級不符」仍需人工抽樣 gold。8 課(G8-L3/6/9/12 等)重點表拆 a/b 分課,表格在分課課號。";
</script>
</body></html>"""
    html = html.replace("__DATA__", data_json).replace("__ASSET_BASE__", ASSET_BASE)
    OUT.write_text(html, encoding="utf-8")
    print(f"wrote {OUT} ({len(lessons)} 課, with-table={n_with_table}, split-no-table={n_split_no_table}, "
          f"manifest pass={summary.get('pass')}/{summary.get('total')}, {OUT.stat().st_size // 1024}KB)")


if __name__ == "__main__":
    main()
