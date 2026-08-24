#!/usr/bin/env python3
"""念順順：vision 粗查 —— 只確認 XML 判的錨點與最後數字沒有離譜

⛔ 不做精確比對。XML 已經給出 start_paragraph / end_paragraph，這裡只問 vision
   「☞ 是不是在這一段旁邊」「右緣最後一個數字是不是大約這個值」，
   答不是才挑出來給人看。

為什麼問是非題不問轉錄：2026-08-24 實測，叫 vision 逐字抄整句會漂
（抄到閱讀理解題目、抄半句、定位不回課文）；問「是不是」它穩定得多。
⚠️ 一律 300 DPI —— 180 DPI 會穩定地編造數字（連三次都回同一個不存在的值）。
"""
from __future__ import annotations
import argparse, json, pathlib, re, subprocess, sys
import yaml

REPO = pathlib.Path(__file__).resolve().parent.parent
LESSONS = REPO / "backend" / "data" / "lessons"
SOT = pathlib.Path("/Users/young/project/chinese-literacy-platform/private/curriculum-source/_SOT")
CACHE = pathlib.Path("/tmp/kr-spot")
MODEL, LOCATION = "gemini-2.5-flash", "us-central1"

SCHEMA = {
    "type": "object",
    "properties": {
        "arrow_beside_start": {"type": "boolean", "nullable": True},
        "arrow_actually_beside": {"type": "string", "nullable": True},
        "last_margin_number": {"type": "integer", "nullable": True},
        "note": {"type": "string"},
    },
    "required": ["arrow_beside_start", "note"],
}


def norm(s): return re.sub(r"[\s　]", "", s or "")


def render(uid: str) -> list[pathlib.Path]:
    out = CACHE / uid
    out.mkdir(parents=True, exist_ok=True)
    pngs = sorted(out.glob("p-*.png"))
    if pngs:
        return pngs
    meta = yaml.safe_load((LESSONS / uid / "v3" / "lesson.yml").read_text(encoding="utf-8"))
    meta = meta.get("lesson", meta)
    src = SOT / ((meta.get("source") or {}).get("drive_path") or "")
    subprocess.run(["soffice", "--headless", "--convert-to", "pdf", "--outdir", str(out), str(src)],
                   check=True, capture_output=True, timeout=240)
    pdf = next(iter(out.glob("*.pdf")))
    txt = subprocess.run(["pdftotext", "-layout", str(pdf), "-"],
                         capture_output=True, text=True).stdout
    pages = [i + 1 for i, pg in enumerate(txt.split("\f")) if re.search(r"\d{2,4}\s*$", pg, re.M)]
    lo, hi = (min(pages), min(max(pages), min(pages) + 1)) if pages else (1, 2)
    subprocess.run(["pdftoppm", "-png", "-r", "300", "-f", str(lo), "-l", str(hi),
                    str(pdf), str(out / "p")], check=True, capture_output=True)
    return sorted(out.glob("p-*.png"))


def check(uid: str, start_head: str, last_number: int | None) -> dict:
    from google import genai
    from google.genai import types as t
    prompt = f"""這是國小國語文學習單。課文旁邊有一個手指圖示 ☞，課文右緣有一欄由小到大的累計字數。

我們用程式判出來的結果是：

  ・☞ 指的段落，開頭是「{start_head}」
  ・右緣最後一個累計數字是 {last_number}

請幫我**粗略**核對（不必精確）：

- arrow_beside_start：☞ 大致就在那一段旁邊嗎？（是／否／看不到填 null）
- arrow_actually_beside：如果不是，☞ 實際在哪一段旁邊？抄那段開頭 12 個字就好
- last_margin_number：你在右緣看到的最後一個數字（看不到填 null）
- note：一句話說明

⚠️ 右緣累計字數欄 = 印在課文**外側、單獨成一欄**、由上往下**遞增**的數字。
   課文**內容裡**的數字（「214 周」「2021 年」「80 公斤」）**不是**它。
⚠️ 數字差幾個沒關係，我只要確認沒有判離譜。看不清楚就填 null，不要猜。"""
    client = genai.Client(vertexai=True, project="lingoleap-dev", location=LOCATION)
    parts = [t.Part.from_bytes(data=p.read_bytes(), mime_type="image/png") for p in render(uid)]
    parts.append(t.Part.from_text(text=prompt))
    r = client.models.generate_content(
        model=MODEL, contents=[t.Content(role="user", parts=parts)],
        config=t.GenerateContentConfig(
            temperature=0.0, max_output_tokens=2048,
            response_mime_type="application/json", response_schema=SCHEMA,
            thinking_config=t.ThinkingConfig(thinking_budget=0)))
    return json.loads(r.text or "{}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("uids", nargs="+")
    a = ap.parse_args()
    bad = []
    for uid in a.uids:
        kr = yaml.safe_load((LESSONS / uid / "v3" / "key_reading.yml").read_text(encoding="utf-8"))
        kr = kr.get("key_reading") or kr
        if not (kr.get("passage") or "").strip():
            print(f"—  {uid}  沒有 passage")
            continue
        head = norm(kr["passage"])[:20]
        try:
            v = check(uid, head, kr.get("extent_chars"))
        except Exception as exc:
            print(f"🔴 {uid}  vision 失敗 {type(exc).__name__}")
            continue
        ok = v.get("arrow_beside_start")
        mark = "✅" if ok else ("—" if ok is None else "⚠️")
        print(f"{mark} {uid}  start_paragraph={kr.get('start_paragraph')} end_paragraph={kr.get('end_paragraph')}"
              f" · vision 看到最後數字 {v.get('last_margin_number')}")
        if ok is False:
            bad.append(uid)
            print(f"      ☞ 實際在:「{v.get('arrow_actually_beside')}」")
            print(f"      {v.get('note','')[:100]}")
    print(f"\n要人看的：{bad or '無'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
