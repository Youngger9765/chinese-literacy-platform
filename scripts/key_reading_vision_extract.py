#!/usr/bin/env python3
"""念順順起訖 —— 一律用 Vision 看紙，不用演算法算

依據 `.claude/skills/lesson-reading-pipeline/SKILL.md`「念順順的起訖怎麼判」。

問 Vision 兩件事，都問「哪一句」不問「第幾段」：
  ① ☞ 箭頭尖端對齊哪一行 → 那一行所在的**那一句**
  ② 右緣最後一個累計數字印在哪一行旁 → 涵蓋那一行的**那一句的句尾**

⛔ 不解析 XML 錨點（浮動物件，掛在哪段 ≠ 視覺指哪段）
⛔ 不用字數欄 max 算終點（那是一分鐘量尺）
⛔ 不換算段號（三套基準：列表位置／印刷段號／書信體 idx）
"""
from __future__ import annotations
import argparse, json, pathlib, re, subprocess, sys
import yaml

REPO = pathlib.Path(__file__).resolve().parent.parent
SOT = REPO / "private" / "curriculum-source" / "_SOT"
LESSONS = REPO / "backend" / "data" / "lessons"
CACHE = pathlib.Path("/tmp/kr-vision")
MODEL, LOCATION = "gemini-2.5-flash", "us-central1"   # 空間推理用這顆（CLAUDE.md #1730）

PROMPT = """你在看一張國小國語文學習單的掃描頁。只根據**圖上看得到的**回答。

這一頁有一個朗讀練習。課文旁邊有兩個記號界定朗讀範圍：

1. **一個手指圖示 ☞**（印在課文左側或右側的空白處）—— 它的箭頭尖端對齊某一行，
   那一行就是**朗讀的起點**
2. **課文右緣一欄由小到大的累計字數**（例如 27 56 85 …），每個數字對齊它那一行的行末。
   **最後一個數字**所在的那一行，就是**朗讀的終點**

請回答（逐字照抄圖上的字，不要改寫）：

- `start_sentence`：☞ 箭頭尖端那一行**所在的那一句**，從句首抄到句尾
- `end_sentence`：右緣最後一個數字那一行**所在的那一句**，從句首抄到句尾
- `last_number`：右緣最後一個數字是多少
- `arrow_visible`：你真的看到 ☞ 手指圖示了嗎
- `numbers_visible`：你真的看到右緣那一欄數字了嗎
- `evidence`：一句話說你在圖上看到什麼才這樣判斷

⚠️ **不要回段落編號** —— 這張紙上的段號有好幾套寫法，回段號會對不起來。只回**句子的文字**。
⚠️ 數字常常停在句子中間，`end_sentence` 要抄**完整的那一句**（到句號／驚嘆號／問號為止）。
⚠️ 看不到就把對應欄位填 null，**不要用另一個記號去推**，也不要猜。
⚠️ 課文內容裡本身也有數字（「214 周」「2021 年」），那些**不是**右緣的累計字數欄。
⚠️ 數字只是**參考**，不必完全對得上。真正要判斷的是：☞ 指的那一句、
   以及最後一個數字落在哪一句 —— **用文章語意挑一個讀起來完整的句子當終點**。
"""

SCHEMA = {
    "type": "object",
    "properties": {
        "start_sentence": {"type": "string", "nullable": True},
        "end_sentence": {"type": "string", "nullable": True},
        "last_number": {"type": "integer", "nullable": True},
        "arrow_visible": {"type": "boolean"},
        "numbers_visible": {"type": "boolean"},
        "evidence": {"type": "string"},
    },
    "required": ["arrow_visible", "numbers_visible", "evidence"],
}


def norm(s: str) -> str:
    return re.sub(r"[\s　]", "", s or "")


def render(uid: str) -> list[pathlib.Path]:
    out = CACHE / uid
    out.mkdir(parents=True, exist_ok=True)
    pngs = sorted(out.glob("p-*.png"))
    if pngs:
        return pngs
    meta = yaml.safe_load((LESSONS / uid / "v3" / "lesson.yml").read_text(encoding="utf-8"))
    meta = meta.get("lesson", meta)
    src = SOT / ((meta.get("source") or {}).get("drive_path") or "")
    if not src.is_file():
        raise FileNotFoundError(f"{uid}: 找不到原稿 {src}")
    subprocess.run(["soffice", "--headless", "--convert-to", "pdf", "--outdir", str(out), str(src)],
                   check=True, capture_output=True, timeout=180)
    pdf = next(iter(out.glob("*.pdf")))
    # 找「念順順」在哪幾頁 —— 只 render 那幾頁，其餘不必送
    txt = subprocess.run(["pdftotext", "-layout", str(pdf), "-"],
                         capture_output=True, text=True).stdout
    pages = [i + 1 for i, pg in enumerate(txt.split("\f")) if "念順順" in pg]
    if not pages:
        pages = [1, 2]
    lo, hi = max(1, min(pages) - 1), max(pages)
    subprocess.run(["pdftoppm", "-png", "-r", "300", "-f", str(lo), "-l", str(hi),
                    str(pdf), str(out / "p")], check=True, capture_output=True)
    return sorted(out.glob("p-*.png"))


def ask(pngs: list[pathlib.Path]) -> dict:
    from google import genai
    from google.genai import types as t
    client = genai.Client(vertexai=True, project="lingoleap-dev", location=LOCATION)
    parts = [t.Part.from_bytes(data=p.read_bytes(), mime_type="image/png") for p in pngs]
    parts.append(t.Part.from_text(text=PROMPT))
    r = client.models.generate_content(
        model=MODEL,
        contents=[t.Content(role="user", parts=parts)],
        config=t.GenerateContentConfig(
            temperature=0.0, max_output_tokens=4096,
            response_mime_type="application/json", response_schema=SCHEMA,
            thinking_config=t.ThinkingConfig(thinking_budget=0),
        ),
    )
    if not (r.text or "").strip():
        raise SystemExit(f"vision 沒回東西 finish_reason={r.candidates[0].finish_reason}")
    return json.loads(r.text)


def locate(uid: str, v: dict) -> dict:
    """把 vision 抄回來的兩句話定位回課文，取出 passage"""
    ft = yaml.safe_load((LESSONS / uid / "v3" / "full_text_annotate.yml").read_text(encoding="utf-8"))
    ft = ft.get("full_text_annotate") or ft
    body = norm("".join((p.get("text") if isinstance(p, dict) else p) or ""
                        for p in (ft.get("paragraphs") or [])))
    out = {"passage": None, "why": ""}
    s, e = norm(v.get("start_sentence")), norm(v.get("end_sentence"))
    if not s or not e:
        out["why"] = "vision 沒給完整的起訖句"
        return out
    i = body.find(s[:14])
    j = body.find(e[-14:])
    if i < 0 or j < 0:
        out["why"] = f"定位不到（起句{'✓' if i>=0 else '✗'} 訖句{'✓' if j>=0 else '✗'}）"
        return out
    out["passage"] = body[i:j + 14]
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("uids", nargs="+")
    a = ap.parse_args()
    for uid in a.uids:
        print(f"\n{'='*70}\n{uid}")
        try:
            pngs = render(uid)
        except Exception as exc:
            print(f"  🔴 render 失敗 {type(exc).__name__}: {exc}")
            continue
        print(f"  render {len(pngs)} 頁")
        try:
            v = ask(pngs)
        except Exception as exc:
            print(f"  🔴 vision 失敗 {type(exc).__name__}: {exc}")
            continue
        print(f"  看到 ☞ {v.get('arrow_visible')} · 看到數字欄 {v.get('numbers_visible')}"
              f" · 最後數字 {v.get('last_number')}")
        print(f"  起句: {v.get('start_sentence')}")
        print(f"  訖句: {v.get('end_sentence')}")
        r = locate(uid, v)
        kr = yaml.safe_load((LESSONS / uid / "v3" / "key_reading.yml").read_text(encoding="utf-8"))
        kr = kr.get("key_reading") or kr
        cur = norm(kr.get("passage") or "")
        if r["passage"]:
            same = norm(r["passage"]) == cur
            print(f"  → vision {len(norm(r['passage']))} 字 · 現存 {len(cur)} 字 · "
                  f"{'✅ 一致' if same else '🔴 不同'}")
            if not same:
                print(f"     vision: {norm(r['passage'])[:40]}…{norm(r['passage'])[-20:]}")
        else:
            print(f"  → 取不出 passage：{r['why']}")
        print(f"  依據: {v.get('evidence','')[:120]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
