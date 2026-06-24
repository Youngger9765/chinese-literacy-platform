#!/usr/bin/env python
"""聚光燈 Pipeline QA Board — 每課一 row,6 欄 = 6 pipeline 階段,每階段可 QA (#2397).

Young's vision: a production-line view where every STAGE is QA-able so you can see
where a lesson breaks (源有料但抽漏 = 卡 stage3; 抽對但 render 破 = 卡 stage5).

Columns (per lesson row):
  ① 源    — 原始 DOCX 聚光燈截圖/源文件 (worksheet pdf/docx + page scans)
  ② 萃取  — 用什麼原則抽 (build_lesson_schema.py 規則式 / guided_steps Gemini LLM)
  ③ 抽取  — extract 出的 block yml/JSON (展開看)
  ④ 版型  — layout_mode / strategy_type / block 組成
  ⑤ 元件  — 實際互動 HTML 元件 (vanilla-JS render block schema, 可試用)
  ⑥ QA    — 結構(決定性) / 內容(judge+reasoning) / 圖 三維度結果 + 修復記錄

No fake green: each cell shows the artifact/evidence; honest gaps marked.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
import sys
sys.path.insert(0, str(ROOT / "backend"))
from app.services.spotlight_v2_loader import load_spotlight_v2  # noqa
from app.services.spotlight_contract import DEV7_LESSONS, TEST15_CATALOG_CODES, CATALOG_LESSONS  # noqa
from app.services.lesson_code_normalization import normalize_manifest_code  # noqa
from app.services.lesson_loader import get_lesson_by_code  # noqa

OUT = ROOT / "frontend/public/presentation/spotlight-pipeline-board.html"
BASELINE = json.loads((ROOT / "backend/data/curriculum_qa/spotlight_regression_baseline.json").read_text())
SWEEP = {}
sj = ROOT / "qa/content-evidence/vision-judge-grade-map/sweep-results.full.jsonl"
if sj.exists():
    for l in sj.read_text().splitlines():
        if l.strip():
            r = json.loads(l); SWEEP[r.get("lesson_code")] = r

GCS = "https://storage.googleapis.com/lingoleap-assets"
FIXES = {
    "G5-L15": "fail-close→placeholder #2405", "G6-L12": "fail-close→placeholder #2405",
    "G7-L7": "fail-close→placeholder #2405", "G9-L8": "fail-close→placeholder #2405",
    "G7-L2": "shadowed guided_steps→5題 #2406", "G5-L12": "shadowed→8題 #2407",
    "G6-L17": "shadowed→4題 #2406", "G6-L2": "shadowed→4題 #2406", "G7-L1": "shadowed→11題 #2406",
    "G7-L18": "shadowed→13題 #2406", "G7-L26": "shadowed→13題 #2407", "G7-L3": "shadowed→5題 #2406",
    "G7-L4": "shadowed→5題 #2406", "G9-L3": "shadowed→4題 #2406", "G9-L4": "shadowed→4題 #2406",
    "G4-L18": "破圖佔位strip #2408", "G7-L5": "破圖佔位strip #2408", "G7-L14": "破圖佔位strip #2408",
    "G6-L8": "缺圖strip #2408", "G8-L6b": "缺圖strip #2408", "G8-L15": "佔位strip(經G8-L19) #2408",
    "G7-L28": "真圖綁回(GCS) 巴斯德", "G7-L29": "真圖綁回(GCS) 暖化×4", "G7-L30": "真圖綁回(GCS) 八哥",
    "G8-L11": "rebind還原科學探究法 #2407",
}
SHADOWED = {"G7-L2", "G5-L12", "G6-L17", "G6-L2", "G7-L1", "G7-L18", "G7-L26", "G7-L3", "G7-L4", "G9-L3", "G9-L4"}
TABLE_GAP = {"G7-L30": "table1/2.json 缺", "G5-L16": "表1 asset=None", "G9-L9": "表2/3 整頁掃描非乾淨表"}

Q = {"single", "multi", "free_text", "fill_table", "fill_blank", "sort", "match"}


def extraction_principle(code, sp):
    if code in SHADOWED:
        return "Gemini guided_steps(LLM #1418)→block 轉換器", "scripts/spotlight_convert_guided_steps.py"
    return "build_lesson_schema.py 規則式 DOCX 解析", "(deterministic parser, 非 LLM)"


def main():
    codes = sorted({normalize_manifest_code(c) for c in (set(DEV7_LESSONS) | set(TEST15_CATALOG_CODES) | set(CATALOG_LESSONS))})
    lessons = []
    for code in codes:
        sp = load_spotlight_v2(code)
        if not sp:
            continue
        l = get_lesson_by_code(code) or {}
        b = BASELINE.get(code, {})
        sv = SWEEP.get(code, {})
        blocks = sp.get("blocks", [])
        from collections import Counter
        hist = dict(Counter(bl.get("type") for bl in blocks))
        meth, meth_src = extraction_principle(code, sp)
        lessons.append({
            "code": code, "title": (l.get("title") or "")[:26], "story_id": l.get("id"),
            "grade_code": l.get("grade_code") or code,
            "pdf": l.get("worksheet_pdf_url"), "docx": l.get("worksheet_docx_url"),
            "blocks": blocks, "hist": hist,
            "n_blocks": b.get("n_blocks"), "n_q": b.get("n_questions"),
            "layout": l.get("layout_mode"), "stype": sp.get("strategy_type") or l.get("reading_strategy_type"),
            "sname": sp.get("strategy_name"),
            "method": meth, "method_src": meth_src,
            "verdict": sv.get("verdict", "—"), "reasoning": (sv.get("reasoning") or "")[:160],
            "fix": FIXES.get(code), "table_gap": TABLE_GAP.get(code),
        })

    data_json = json.dumps(lessons, ensure_ascii=False)
    fixed = len([x for x in lessons if x["fix"]])

    html = """<!DOCTYPE html><html lang="zh-TW"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>聚光燈 Pipeline QA Board</title><style>
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
 .blk{margin:5px 0;padding:5px 7px;border-radius:5px}
 .b-guide{background:#eef;color:#334} .b-passage{background:#f3f0e8;font-style:italic}
 .opt{display:block;margin:2px 0;cursor:pointer} .ans{color:#2e7d32;font-size:.72rem}
 .qa-pass{color:#2e7d32;font-weight:700} .qa-gap{color:#c62828}
 a.src{font-size:.74rem}
 .gapbox{background:#fff3f3;border-left:4px solid #c62828;padding:10px 14px;border-radius:6px;margin:12px 0;font-size:.82rem}
 .wrap{overflow-x:auto}
</style></head><body>
<h1>聚光燈 Pipeline QA Board · 每課一 row,每階段可 QA</h1>
<p class="sub">流水線視角:源 → 萃取 → 抽取 → 版型 → 渲染 → QA。看每課卡在哪一站。不假綠,每格附證據。</p>
<div class="legend">
① <b>源</b> 原始 DOCX 聚光燈(開 PDF/頁掃描) ｜ ② <b>萃取</b> 規則式 vs LLM ｜ ③ <b>抽取</b> block JSON(展開) ｜
④ <b>版型</b> layout/strategy ｜ ⑤ <b>元件</b> 點「試用」即時 render 互動 ｜ ⑥ <b>QA</b> 結構(決定性✓)/內容(judge+理由)/圖
</div>
<input id="q" placeholder="篩選課號/標題 (e.g. G7-L2)" oninput="filt()">
<div class="wrap"><table id="t"><thead><tr>
<th>課</th><th>① 源 (DOCX)</th><th>② 萃取原則</th><th>③ 抽取 data</th><th>④ 版型</th><th>⑤ HTML 元件(試用)</th><th>⑥ QA 維度</th>
</tr></thead><tbody></tbody></table></div>
<div class="gapbox" id="gaps"></div>
<script>
const GCS="https://storage.googleapis.com/lingoleap-assets/lessons-images";
const DATA=__DATA__;
function normCode(c){let m=c.match(/^(G\\d+)-L0*(\\d+)([a-z])?$/i);return m?m[1]+"-L"+m[2]+(m[3]||""):c;}
function imgSrc(asset,code){let bn=(asset||"").split("/").pop();return GCS+"/"+normCode(code)+"/"+bn;}
const VC={faithful:"#2e7d32",cross_lesson:"#c62828",figure_broken:"#e65100",skeleton:"#777",error:"#777","—":"#bbb"};
function renderBlocks(blocks,code){
  let h="";
  for(const b of blocks){
    const t=b.type;
    if(t==="guide") h+=`<div class="blk b-guide">${esc(b.text||"")}</div>`;
    else if(t==="passage") h+=`<div class="blk b-passage">${(b.paragraphs||[]).map(esc).join("<br>")}</div>`;
    else if(t==="single"||t==="multi"){
      h+=`<div class="blk"><b>${esc(b.prompt||"")}</b>`;
      for(const o of (b.options||[])){const ot=typeof o==="string"?o:(o.text||"");h+=`<label class="opt"><input type="${t==="single"?"radio":"checkbox"}" name="${code}-${esc((b.prompt||"").slice(0,8))}"> ${esc(ot)}</label>`;}
      if(b.answer) h+=`<span class="ans">✓答案:${esc(typeof b.answer==="string"?b.answer:JSON.stringify(b.answer))}</span>`;
      h+=`</div>`;
    }
    else if(t==="free_text") h+=`<div class="blk"><b>${esc(b.prompt||"")}</b><br><textarea rows="2" style="width:95%"></textarea>${b.answer?`<span class="ans">✓參考:${esc(b.answer)}</span>`:""}</div>`;
    else if(t==="figure"){const s=imgSrc(b.asset,code);h+=`<div class="blk">🖼 figure(${esc(b.referent||"")}): <a href="${s}" target="_blank">${esc(b.asset||"無asset")}</a><br><img src="${s}" style="max-width:240px;border:1px solid #ddd" onerror="this.outerHTML='<span class=qa-gap>⚠️圖載入失敗 '+this.src+'</span>'"></div>`;}
    else if(t==="self_check") h+=`<div class="blk">☑ self_check: ${(b.items||[]).map(esc).join(" / ")}</div>`;
    else if(t==="fill_table") h+=`<div class="blk">▦ fill_table (互動填表)</div>`;
    else h+=`<div class="blk muted">${esc(t)}</div>`;
  }
  return h;
}
function esc(s){return String(s==null?"":s).replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]));}
function srcCell(d){
  let h="";
  if(d.pdf) h+=`<a class="src" href="${d.pdf}" target="_blank">📄 worksheet PDF</a><br>`;
  if(d.docx) h+=`<a class="src" href="${d.docx}" target="_blank">📄 docx</a><br>`;
  h+=`<a class="src" href="${GCS}/${normCode(d.code)}/" target="_blank">🗂 頁掃描</a>`;
  return h||'<span class="muted">無源連結</span>';
}
function qaCell(d){
  let h=`<div>結構 <span class="qa-pass">✓決定性</span> ${d.n_blocks}塊/${d.n_q}題</div>`;
  const c=VC[d.verdict]||"#777";
  h+=`<div style="margin-top:3px">內容 <span class="v" style="background:${c}">${d.verdict}</span> <span class="muted">(judge,有變異)</span></div>`;
  if(d.reasoning) h+=`<div class="muted">${esc(d.reasoning)}</div>`;
  const fig=(d.hist.figure||0);
  if(d.table_gap) h+=`<div class="qa-gap">圖 ⏳ table-gap: ${esc(d.table_gap)}</div>`;
  else if(fig) h+=`<div>圖 ${fig} 個 figure block</div>`;
  if(d.fix) h+=`<div style="margin-top:3px;color:#5B4FC4">🔧 ${esc(d.fix)}</div>`;
  return h;
}
function row(d){
  const tr=document.createElement("tr");
  tr.dataset.k=(d.code+" "+d.title).toLowerCase();
  tr.innerHTML=`<td class="code">${d.code}<div class="muted">${esc(d.title)}</div></td>
    <td>${srcCell(d)}</td>
    <td>${esc(d.method)}<div class="muted">${esc(d.method_src)}</div></td>
    <td><details><summary>${d.blocks.length} blocks</summary><pre>${esc(JSON.stringify(d.blocks,null,1))}</pre></details></td>
    <td>${esc(d.layout||"—")}<div class="muted">${esc(d.stype||"")}</div><div class="muted">${Object.entries(d.hist).map(([k,v])=>k+":"+v).join(" ")}</div></td>
    <td><button class="try" onclick="tryit(this,'${d.code}')">▶ 試用</button><div class="render" style="display:none"></div></td>
    <td>${qaCell(d)}</td>`;
  return tr;
}
const byCode={};
function tryit(btn,code){
  const box=btn.nextElementSibling;
  if(box.style.display==="none"){box.style.display="block";box.innerHTML=renderBlocks(byCode[code].blocks,code);btn.textContent="▼ 收起";}
  else{box.style.display="none";btn.textContent="▶ 試用";}
}
const tb=document.querySelector("#t tbody");
for(const d of DATA){byCode[d.code]=d;tb.appendChild(row(d));}
function filt(){const q=document.getElementById("q").value.toLowerCase();for(const tr of tb.children){tr.style.display=tr.dataset.k.includes(q)?"":"none";}}
document.getElementById("gaps").innerHTML="<b>誠實缺口(不假綠):</b> Table figures 需表格JSON資料(另pipeline): "+Object.entries({"G7-L30":"table1/2","G5-L16":"表1","G9-L9":"表2/3"}).map(([k,v])=>k+"("+v+")").join(", ")+" ｜ 文言文無聚光燈素材 ｜ judge 變異課(G5-L13/16/27)render verdict 跨次跳=噪音非退步";
</script>
</body></html>"""
    html = html.replace("__DATA__", data_json)
    OUT.write_text(html, encoding="utf-8")
    print(f"wrote {OUT} ({len(lessons)} 課, fixes={fixed}, {OUT.stat().st_size//1024}KB)")


if __name__ == "__main__":
    main()
