#!/usr/bin/env python3
"""本課學習策略：從學習單抽名稱，再用 LLM 展開成學生看得懂的說明。

    python3 scripts/build_lesson_strategy.py --dry-run          # 只抽，不呼叫 LLM、不寫檔
    python3 scripts/build_lesson_strategy.py --uid L0002        # 單課
    python3 scripts/build_lesson_strategy.py --all              # 全庫

## 為什麼來源是學習單而不是總表

策略原本只從總表（`backend/data/curriculum-index.json`）讀。那一欄的名字自己就寫著
「閱讀聚光燈策略──教材目標策略（**學習單第一頁右上方**）」—— 它是抄過去的副本。
實測 175 課：總表 24 課有、學習單 151 課有，其中 **132 課只有學習單有**。副本抄漏了。

## 原稿怎麼存

拆成相鄰兩段，接起來才完整：

    [0] 目標策略：摘要策略──
    [1] 找小主題和重要細節

⚠️ 逐字內容一律回 DOCX 的 `<w:t>` 流取，不讀 `pdftotext -layout` —— 那會為了排版折行，
折點落在標點上就把標點吃掉，而且讀起來完全通順、沒有任何症狀。

## 為什麼批次預生成

策略說明一年不會變。預生成可以人工校對、runtime 零成本、每一課能單獨改。
即時呼叫每次講法都不一樣，而且沒人看得到它講錯了什麼。
"""
from __future__ import annotations

import argparse
import importlib.util
import pathlib
import re
import sys

import yaml

REPO = pathlib.Path(__file__).resolve().parent.parent
SOT = REPO / "private" / "curriculum-source" / "_SOT"
LESSONS = REPO / "backend" / "data" / "lessons"

_spec = importlib.util.spec_from_file_location("dw", REPO / "scripts" / "docx_witnesses.py")
dw = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(dw)

DASHES = "──—－-–"
# 尾巴是一個短詞組，不是下一個大題的標題。30 字是實測 96 種策略裡最長的一倍餘。
MAX_TAIL = 30


# 大題編號就印在策略那一行的正下方（「一」「二」…），長度和「找出故事道理」一樣短。
# 沒有這道檢查，`目標策略：推論策略──` 的下一段是「一」時就會接成「推論策略──一」。
# 目前語料沒有中招，但那是排版剛好，不是規則擋住的 —— 而排版下一版就會變。
_SECTION_NO = re.compile(r"^[一二三四五六七八九十]{1,3}$")


def _is_tail(t: str) -> bool:
    return not (t.startswith("目標策略") or _SECTION_NO.fullmatch(t))


def strategy_from_paragraphs(paras: list[str]) -> str:
    """『目標策略：X──』後面那一段是尾巴。找不到回空字串，不猜。"""
    for i, raw in enumerate(paras):
        m = re.match(r"^目標策略[：:]\s*(.+?)\s*$", raw.strip())
        if not m:
            continue
        head = m.group(1)
        if not head.endswith(tuple(DASHES)):
            return head
        tail = paras[i + 1].strip() if i + 1 < len(paras) else ""
        if tail and len(tail) <= MAX_TAIL and _is_tail(tail):
            return head.rstrip(DASHES) + "──" + tail
        return head.rstrip(DASHES)
    return ""


# 總表（curriculum-index.json）裡有四張 sheet，課名會跨 sheet 重複。
# 只有這兩張帶策略欄；把四張混在一起 join 會拿到「影片連結-新」那張的列，
# 那張沒有策略，於是看起來像「總表沒寫」。2026-08-23 就是這樣誤報成「總表只有 24 課」。
STRATEGY_SHEETS = {"總表", "文言文"}
SHEET_KEYS = {
    "target": "閱讀聚光燈策略──教材目標策略（學習單第一頁右上方）",
    "section6": "閱讀聚光燈策略──第六大題標題",
    "partner": "閱讀聚光燈策略──研發夥伴用",
    "topic": "單元議題",
    "genre": "文體",
    "kind": "類型",
}


def load_master_sheet() -> dict[str, dict]:
    """課名 -> 總表那一列。

    ⛔ 這支會在課名不唯一時直接 raise。一個 join 只要鍵不唯一，就會安靜地
    對到錯的那一列，而值看起來完全正常 —— 今天先用 catalog_slot 對，
    課名相符只有 2/175（其餘 128 全錯行），而輸出的策略字串每一個都像真的。
    唯一性不是最佳實踐，是這個 join 能不能被相信的前提。
    """
    import json

    idx = json.loads((REPO / "backend" / "data" / "curriculum-index.json").read_text(encoding="utf-8"))
    rows: list[dict] = []

    def walk(o):
        if isinstance(o, dict):
            if "課名" in o:
                rows.append(o)
            else:
                for v in o.values():
                    walk(v)
        elif isinstance(o, list):
            for x in o:
                walk(x)

    walk(idx)
    keep = [r for r in rows if str(r.get("_source_sheet")) in STRATEGY_SHEETS]
    out: dict[str, dict] = {}
    dupes = []
    for r in keep:
        t = str(r.get("課名") or "").strip()
        if not t:
            continue
        if t in out:
            dupes.append(t)
        out[t] = r
    if dupes:
        raise SystemExit(
            f"⛔ 總表課名不唯一，join 不可信：{sorted(set(dupes))[:5]}\n"
            f"   （在 {sorted(STRATEGY_SHEETS)} 這幾張 sheet 裡）"
        )
    return out


def lesson_source(uid: str) -> tuple[dict, pathlib.Path | None]:
    p = LESSONS / uid / "v3" / "lesson.yml"
    if not p.is_file():
        return {}, None
    inner = yaml.safe_load(p.read_text(encoding="utf-8"))
    inner = inner.get("lesson", inner)
    rel = (inner.get("source") or {}).get("drive_path")
    f = SOT / rel if rel else None
    return inner, (f if f and f.is_file() else None)


PROMPT = """你在幫國小/國中的閱讀學習平台寫一段「本課學習策略」的說明，給{grade}的學生自己讀。

這一課：《{title}》（{genre}）
單元議題：{topic}

教材對這一課的目標策略，有兩份紀錄，**兩份都要參考**：
  A. 學習單第一頁印的：{ws}
  B. 教材總表登記的：{sheet}
（其中一份可能是空的；兩份不一樣時多半是一份寫得比較細，不是互相矛盾）

課文開頭：
{excerpt}

請寫 2 到 3 句話，回答學生心裡的三個問題：
1. 這一課要練的是什麼（把策略名稱講成白話）
2. 為什麼這篇文章適合拿來練它（要扣住這篇的具體內容，不要泛泛而談）
3. 讀的時候可以怎麼做

規則：
- 用「你」稱呼學生，語氣像老師在旁邊講話，不要條列、不要標題
- 繁體中文，台灣用語，**句尾不要句號**，用換行或空格斷句
- 不要重複貼策略名稱，那個名稱已經印在旁邊了
- A 和 B 講的若是同一件事的不同細緻度，用比較具體的那一份來理解；
  若真的是兩個不同的策略，就講兩者共同要練的那個能力，不要只挑一個講
- 不要出現「本文」「本課」「筆者」這種書面語
- 總長度 60 到 120 字
- 只輸出那段話本身，不要任何前言、引號或說明"""


MAX_CHARS = 150


def tidy(text: str) -> tuple[str, list[str]]:
    """把 house rule 做成決定性後處理，不靠 prompt 求 LLM 聽話。

    句號那條（中文除正式文件外不加句號）是硬規則，而模型大約每三課會忘一次 ——
    prompt 講了它還是會加。能用一行 replace 解決的事就不要交給機率。

    回傳 (清理後的文字, 需要人看一眼的理由)。理由不擋寫入：這是機率性產出，
    完成的判準是「流程對、出錯知道在哪、能單獨修」，不是每一課都完美。
    """
    out = "\n".join(line.rstrip().rstrip("。").rstrip() for line in text.strip().splitlines() if line.strip())
    out = out.replace("。\n", "\n")
    warn = []
    if "。" in out:
        warn.append(f"句中仍有 {out.count('。')} 個句號")
    if len(out) > MAX_CHARS:
        warn.append(f"{len(out)} 字，超過 {MAX_CHARS}")
    for bad in ("本文", "本課", "筆者"):
        if bad in out:
            warn.append(f"出現書面語「{bad}」")
    return out, warn


def expand(client, ws: str, sheet_row: dict | None, inner: dict, meta: dict) -> str:
    body = inner.get("content") or meta.get("content") or []
    if isinstance(body, str):
        body = [body]
    excerpt = "\n".join(str(x) for x in body[:3])[:600] or (meta.get("intro") or "")[:600]
    grade = str(meta.get("level") or inner.get("level") or "")
    def col(k: str) -> str:
        v = str((sheet_row or {}).get(SHEET_KEYS[k]) or "").strip()
        return "" if v in ("無", "None") else v

    sheet = col("target") or col("section6") or col("partner")
    prompt = PROMPT.format(
        grade=f"{grade} 年級" if grade.isdigit() else "這個年段",
        title=inner.get("title") or "",
        genre=meta.get("genre") or col("genre") or "",
        ws=ws or "（學習單沒印）",
        sheet=sheet or "（總表沒登記）",
        topic=col("topic") or meta.get("topic") or "（未標）",
        excerpt=excerpt,
    )
    r = client.models.generate_content(model="gemini-2.5-flash-lite", contents=prompt)
    return (r.text or "").strip()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--uid", action="append", help="只跑這幾課")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--dry-run", action="store_true", help="只抽名稱，不呼叫 LLM、不寫檔")
    a = ap.parse_args()
    if not (a.uid or a.all):
        ap.error("要給 --uid 或 --all")

    uids = a.uid or sorted(p.parts[-3] for p in LESSONS.glob("L*/v3/lesson.yml"))

    sheets = load_master_sheet()

    client = None
    if not a.dry_run:
        from google import genai
        client = genai.Client(vertexai=True, project="lingoleap-dev", location="global")

    found = written = skipped = 0
    flagged: list[tuple[str, str]] = []
    for uid in uids:
        inner, docx = lesson_source(uid)
        if docx is None:
            print(f"  {uid}  原稿不在，跳過")
            skipped += 1
            continue
        ws = strategy_from_paragraphs(dw.docx_paragraphs(str(docx)))
        row = sheets.get(str(inner.get("title") or "").strip())
        sheet_val = ""
        if row:
            for k in ("target", "section6", "partner"):
                v = str(row.get(SHEET_KEYS[k]) or "").strip()
                if v and v not in ("無", "None"):
                    sheet_val = v
                    break
        # 兩個來源都算數 —— owner: 「應該都要參考，然後 LLM 判斷怎麼整合」。
        # 學習單 129 課、總表 129 課，但不是同一批：聯集比任一邊都大。
        if not (ws or sheet_val):
            skipped += 1
            continue
        found += 1
        # 名稱欄取比較具體的那一份（長的通常帶了細分項），原始兩份都留著可回溯。
        strategy = max((ws, sheet_val), key=len)
        mp = LESSONS / uid / "v3" / "metadata.yml"
        meta_doc = yaml.safe_load(mp.read_text(encoding="utf-8")) if mp.is_file() else {}
        meta = meta_doc.get("metadata", meta_doc) if isinstance(meta_doc, dict) else {}

        if a.dry_run:
            same = "＝" if ws and sheet_val and ws == sheet_val else " "
            print(f"  {uid} {same} 學習單「{ws or '－'}」 總表「{sheet_val or '－'}」")
            continue

        raw = expand(client, ws, row, inner, meta)
        if not raw:
            print(f"  {uid}  🔴 LLM 回空，不寫")
            continue
        explained, warn = tidy(raw)
        if warn:
            flagged.append((uid, "；".join(warn)))
        meta["strategy"] = strategy
        meta["strategy_explained"] = explained
        # 兩份原始紀錄都留著。將來有人問「這句話依據什麼」，答案要在檔案裡，
        # 不是在某次跑批次的終端機捲軸裡。
        meta["strategy_sources"] = {"worksheet": ws or None, "master_sheet": sheet_val or None}
        if "metadata" in meta_doc:
            meta_doc["metadata"] = meta
        else:
            meta_doc = meta
        mp.write_text(yaml.safe_dump(meta_doc, allow_unicode=True, sort_keys=False), encoding="utf-8")
        written += 1
        print(f"  {uid}  {strategy}\n        {explained[:70]}…")

    print(f"\n  抽到 {found} 課 · 寫入 {written} 課 · 跳過 {skipped} 課（學習單沒印）")
    if flagged:
        print(f"  ⚠️ {len(flagged)} 課寫進去了但值得人看一眼（不擋，可單課重跑）：")
        for uid, why in flagged:
            print(f"     {uid}  {why}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
