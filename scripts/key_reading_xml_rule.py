#!/usr/bin/env python3
"""念順順起訖 —— XML 演算法

規則（Young 2026-08-24 看圖定案）：
  start = ☞ 錨點所在的那一段
  end   = 右緣累計字數欄「最後一個數字」落在的那一段
  passage = start 段到 end 段，**整段包含**（不切半句）

⛔ 不是「一路吃段落直到湊滿 max(累計字數)」—— 那條是被否決四次的舊規則。
   差別在：這裡是「吃到數字**落在的那一段**為止」，通常 1 段，數字跨段時 2 段。
"""
from __future__ import annotations
import argparse, pathlib, re, subprocess, sys, zipfile
import yaml

REPO = pathlib.Path(__file__).resolve().parent.parent
LESSONS = REPO / "backend" / "data" / "lessons"
SOT = REPO / "private" / "curriculum-source" / "_SOT"
CACHE = pathlib.Path("/tmp/kr-xml")


def norm(s: str) -> str:
    return re.sub(r"[\s　]", "", s or "")


def paragraphs(uid: str) -> list[str]:
    f = LESSONS / uid / "v3" / "full_text_annotate.yml"
    d = yaml.safe_load(f.read_text(encoding="utf-8")) or {}
    ft = d.get("full_text_annotate") or d
    out = [norm((p.get("text") if isinstance(p, dict) else p) or "")
           for p in (ft.get("paragraphs") or [])]
    return [p for p in out if p]


def source(uid: str) -> pathlib.Path:
    m = yaml.safe_load((LESSONS / uid / "v3" / "lesson.yml").read_text(encoding="utf-8"))
    m = m.get("lesson", m)
    return SOT / ((m.get("source") or {}).get("drive_path") or "")


def anchor_paragraph(uid: str, paras: list[str]) -> list[int]:
    """☞ 掛在哪一段（XML drawing 錨點）"""
    xml = zipfile.ZipFile(source(uid)).read("word/document.xml").decode("utf-8")
    index = {p[:24]: i + 1 for i, p in enumerate(paras)}
    hits = set()
    for block in re.split(r"(?=<w:p[ >])", xml):
        if not block.startswith("<w:p"):
            continue
        if "<w:drawing" not in block and "<w:pict" not in block:
            continue
        text = norm("".join(re.findall(r"<w:t[^>]*>([^<]*)</w:t>", block)))
        if len(text) >= 25 and text[:24] in index:
            hits.add(index[text[:24]])
    return sorted(hits)


def last_count_paragraph(uid: str, paras: list[str]) -> tuple[int | None, int | None, str]:
    """右緣最後一個累計數字，以及它落在哪一段"""
    out = CACHE / uid
    out.mkdir(parents=True, exist_ok=True)
    pdfs = list(out.glob("*.pdf"))
    if not pdfs:
        subprocess.run(["soffice", "--headless", "--convert-to", "pdf",
                        "--outdir", str(out), str(source(uid))],
                       check=True, capture_output=True, timeout=240)
        pdfs = list(out.glob("*.pdf"))
    txt = subprocess.run(["pdftotext", "-layout", str(pdfs[0]), "-"],
                         capture_output=True, text=True).stdout
    rows = []
    for line in txt.split("\n"):
        m = re.search(r"^(.*\S)\s+(\d{2,4})$", line.rstrip())
        if m:
            rows.append((int(m.group(2)), norm(m.group(1))))
    seq: list[tuple[int, str]] = []
    for value, body in rows:
        if not seq:
            seq = [(value, body)]
        elif value > seq[-1][0]:
            seq.append((value, body))
        elif len(seq) < 4:
            seq = [(value, body)]
        else:
            break
    if not seq:
        return None, None, "找不到累計字數欄"
    value, body = seq[-1]
    for probe in range(12, 4, -1):
        tail = body[-probe:]
        where = [i + 1 for i, p in enumerate(paras) if tail in p]
        if len(where) == 1:
            return value, where[0], body[-14:]
    return value, None, f"最後一行「{body[-14:]}」在課文中定位不到或不唯一"


def run(uid: str) -> dict:
    paras = paragraphs(uid)
    r = {"uid": uid, "paras": len(paras), "verdict": "unknown", "why": ""}
    if not paras:
        r["why"] = "課文缺件"
        return r
    anchors = anchor_paragraph(uid, paras)
    value, end_no, note = last_count_paragraph(uid, paras)
    r.update(anchors=anchors, last_value=value, end=end_no, note=note)
    if len(anchors) != 1:
        r["why"] = f"☞ 錨點 {anchors or '抓不到'}"
        return r
    if end_no is None:
        r["why"] = note
        return r
    start = anchors[0]
    if end_no < start:
        r["verdict"] = "review"
        r["why"] = f"數字落在第 {end_no} 段，在起點第 {start} 段之前"
        return r
    r["verdict"] = "ok"
    r["start"] = start
    r["passage"] = "".join(paras[start - 1:end_no])
    return r


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("uids", nargs="+")
    a = ap.parse_args()
    for uid in a.uids:
        try:
            r = run(uid)
        except Exception as exc:
            print(f"🔴 {uid}  {type(exc).__name__}: {exc}")
            continue
        kr = yaml.safe_load((LESSONS / uid / "v3" / "key_reading.yml").read_text(encoding="utf-8"))
        kr = (kr.get("key_reading") or kr) if kr else {}
        cur = len(norm(kr.get("passage") or ""))
        if r["verdict"] == "ok":
            span = f"{r['start']}" if r["start"] == r["end"] else f"{r['start']}–{r['end']}"
            print(f"✅ {uid}  ☞第{r['start']}段 · 最後數字 {r['last_value']} 落第{r['end']}段"
                  f" → 取第 {span} 段 = {len(r['passage'])} 字（現存 {cur}）")
            print(f"      結尾…{r['passage'][-22:]}")
        else:
            print(f"—  {uid}  {r['why']}（現存 {cur} 字）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
