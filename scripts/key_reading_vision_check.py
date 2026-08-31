#!/usr/bin/env python3
"""念順順：用 LLM vision 看印出來的那一頁，交叉檢查抽出來的起點與終點。

    python3 scripts/key_reading_vision_check.py --uid L0011

## 為什麼需要它

決定性的兩個標記（☞ 起點、右緣累計字數的最後一個 = 終點）已經把 147 課裡的
137 課判到 ±15 字內。但那是**算出來的**，沒有人看過紙上長什麼樣：

- ☞ 是畫上去的圖形，不在文字層也不在符號層（全庫 ☞ 字面只出現 1 次）
- 累計數字整欄集中在文字流裡，跟課文段落**不交錯**，所以「它印在哪一段旁邊」
  這件事，只有看版面才知道

owner 2026-08-24：「你抽的時候 start end 要看文章脈絡、也要用 LLM vision 去檢查」。

## 它做什麼、不做什麼

**做**：把該頁 render 成圖，問 vision「☞ 指著哪一段的開頭」「右緣最後一個數字
印在哪一段旁邊」「這個範圍收在完整的句子嗎」，然後跟 yml 對。
**不做**：它不改任何東西，也不是 gate。vision 是機率性的，拿它當唯一判準
就是把一個算得出來的東西交給運氣。它的角色是**第二意見** ——
跟決定性結果不一致時，把那一課挑出來給人看。
"""
from __future__ import annotations

import argparse
import json
import pathlib
import subprocess
import sys
import tempfile

import yaml

REPO = pathlib.Path(__file__).resolve().parent.parent
SOT = REPO / "private" / "curriculum-source" / "_SOT"
LESSONS = REPO / "backend" / "data" / "lessons"

MODEL = "gemini-2.5-flash"
LOCATION = "us-central1"   # 空間推理用這顆，見 CLAUDE.md 的 A/B（#1730）

SYSTEM = """你在看一張國小國語文學習單的掃描頁。只根據你**在圖上看到的**回答，看不到就說看不到。

這一頁有一個「念順順」的朗讀練習，用兩個標記界定朗讀範圍：
1. 手指圖示 ☞ 或指令文字「從指定段落（X）開始朗讀」→ **起點**
2. 課文**右緣**一欄由小到大的累計字數（25 55 85 …），對齊各行行末；
   **最後一個數字**所在的那一行 → **終點**

我們已經用程式從文字層算出一個答案，請你**核對**它，不要自己重新推導：

    起點：第 {start_para} 段，開頭是「{start_head}」
    終點：最後一個累計數字是 {printed}，落在「{end_tail}」這句話附近

請逐題回答（是非題為主，不要轉抄整段）：
- start_ok：☞／指令文字指的，就是上面那個起點嗎？
- end_ok：右緣最後一個數字，就是印在上面那個終點附近嗎？
- printed_seen：你在圖上看到的最後一個累計數字是多少？（看不到填 null）
- ends_full_sentence：這個範圍收在完整句子嗎？
- evidence：一句話說你在圖上看到什麼才這樣判斷

⚠️ 你只看得到其中幾頁，**不要自己從看到的第一段開始數段號** —— 段號以上面給的為準。
⚠️ 不確定就把 start_ok / end_ok 填 null，不要猜。"""

SCHEMA = {
    "type": "object",
    "properties": {
        "first_15_chars": {"type": "string"},
        "last_15_chars": {"type": "string"},
        "counter_visible": {"type": "boolean"},
        "last_counter_value": {"type": "integer", "nullable": True},
        "ends_on_full_sentence": {"type": "boolean"},
        "start_para_no": {"type": "integer"},
        "end_para_no": {"type": "integer"},
        "evidence": {"type": "string"},
    },
    "required": ["first_15_chars", "last_15_chars", "counter_visible", "evidence"],
}


def render_pages(uid: str, out: pathlib.Path) -> list[pathlib.Path]:
    lesson = yaml.safe_load((LESSONS / uid / "v3" / "lesson.yml").read_text(encoding="utf-8"))
    lesson = lesson.get("lesson", lesson)
    rel = (lesson.get("source") or {}).get("drive_path")
    docx = SOT / rel if rel else None
    if not (docx and docx.is_file()):
        raise SystemExit(f"⛔ 原稿不在：{docx}")
    subprocess.run(["soffice", "--headless", "--convert-to", "pdf", "--outdir", str(out), str(docx)],
                   check=True, capture_output=True)
    pdf = next(iter(out.glob("*.pdf")), None)
    if pdf is None:
        raise SystemExit("⛔ 轉 PDF 失敗")
    subprocess.run(["pdftoppm", "-png", "-r", "150", str(pdf), str(out / "page")], check=True)
    return sorted(out.glob("page-*.png"))


def ask(pages: list[pathlib.Path], manifest_pages: list[int] | None) -> dict:
    from google import genai
    from google.genai import types as t

    pick = pages
    if manifest_pages:
        pick = [p for p in pages if int(p.stem.split("-")[-1]) in manifest_pages] or pages
    pick = pick[:3]   # 念順順只佔一兩頁，別把整份丟進去

    client = genai.Client(vertexai=True, project="lingoleap-dev", location=LOCATION)
    parts = [t.Part.from_bytes(data=p.read_bytes(), mime_type="image/png") for p in pick]
    parts.append(t.Part.from_text(text="請看這幾頁裡的「念順順」那一節，回答上面四個問題。"))
    r = client.models.generate_content(
        model=MODEL,
        contents=[t.Content(parts=parts, role="user")],
        config=t.GenerateContentConfig(
            system_instruction=SYSTEM,
            response_mime_type="application/json",
            response_schema=SCHEMA,
            temperature=0.0,
            # 2.5 系列不關 thinking 會把 output 預算吃掉，JSON 直接被截斷成半句
            # （CLAUDE.md「Config fairness」那條）。3.5+ 要改用 thinking_level。
            thinking_config=t.ThinkingConfig(thinking_budget=0),
            max_output_tokens=4096,
        ),
    )
    raw = r.text or ""
    try:
        return json.loads(raw)
    except json.JSONDecodeError as e:
        # 截斷或格式壞掉 → 說出來，不要靜靜回空 dict 讓上面印一排 None
        raise SystemExit(
            f"⛔ vision 回的不是完整 JSON（{e}）。finish_reason="
            f"{getattr(r.candidates[0], 'finish_reason', '?') if r.candidates else '?'}\n"
            f"   前 200 字：{raw[:200]}"
        )


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--uid", required=True)
    ap.add_argument("--keep", action="store_true", help="保留 render 出來的圖")
    a = ap.parse_args()

    kp = LESSONS / a.uid / "v3" / "key_reading.yml"
    kr = yaml.safe_load(kp.read_text(encoding="utf-8")) or {}
    kr = kr.get("key_reading", kr) or {}
    stored_start = kr.get("start_paragraph")
    spans = kr.get("spans_paragraphs") or []
    stored_end = spans[-1] if spans else None

    mf = LESSONS / a.uid / "v3" / "_manifest.yml"
    pages = None
    if mf.is_file():
        m = yaml.safe_load(mf.read_text(encoding="utf-8")) or {}
        for sec in m.get("sections") or []:
            if sec.get("module") == "key_reading":
                pages = sec.get("pages")

    tmp = pathlib.Path(tempfile.mkdtemp(prefix=f"krv-{a.uid}-"))
    imgs = render_pages(a.uid, tmp)
    print(f"  render {len(imgs)} 頁 · 派工單說念順順在第 {pages} 頁")
    v = ask(imgs, pages)

    passage = kr.get("passage") or ""
    import re as _re
    def norm(x: str) -> str:
        return _re.sub(r"[\s　]", "", x or "")
    v_head, v_tail = norm(v.get("first_15_chars")), norm(v.get("last_15_chars"))
    p_norm = norm(passage)

    head_ok = bool(v_head) and p_norm.startswith(v_head[:8])
    tail_ok = bool(v_tail) and p_norm.endswith(v_tail[-8:])

    print(f"  vision 讀到的開頭：{v.get('first_15_chars')}")
    print(f"  yml  存的開頭：    {passage[:15]}   {'✅ 一致' if head_ok else '🔴 不一致'}")
    print(f"  vision 讀到的結尾：{v.get('last_15_chars')}")
    print(f"  yml  存的結尾：    {passage[-15:]}   {'✅ 一致' if tail_ok else '🔴 不一致'}")
    print(f"  右緣數字欄 {'看得到' if v.get('counter_visible') else '看不到'}"
          f"（最後一個 {v.get('last_counter_value')}）· 收在完整句子 {v.get('ends_on_full_sentence')}")
    print(f"  vision 依據：{v.get('evidence','')[:170]}")
    agree_start, agree_end = head_ok, tail_ok
    if not a.keep:
        for p in imgs:
            p.unlink(missing_ok=True)
    else:
        print(f"  圖留在 {tmp}")
    # 不一致回 1，讓人看得到；但這不是 gate，vision 是第二意見不是判準
    return 0 if (agree_start and agree_end) else 1


if __name__ == "__main__":
    sys.exit(main())
