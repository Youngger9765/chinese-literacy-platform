#!/usr/bin/env python3
"""把多文本課的「篇」建成一等公民 —— 階段 1（純新增，不動既有欄位）

規格：docs/prd/multi-text-lessons-prd.md

做什麼
  ① 讀原稿的「篇次 N/M」決定總篇數與切點
  ② 每篇指派一個**不透明 5 碼 id**（永不重用），登記進 registry
  ③ 把 `parts:` 寫進 lesson.yml

⛔ 這一支**不動** paragraphs / multi_text_parts / 任何既有欄位。
   階段 1 只建立身分；學生看到的東西一個字都不變。
   （PRD §11：資料寫入邊界必須早於可見入口，可見入口在階段 6。）

⛔ 為什麼 id 不是 p1/p2/p3：模組換順序時 `p2` 就指到另一篇，而 QR 已經印在紙上。
   順序住在清單的排列，身分住在 id，可讀性住在 label —— 三者分開。
"""
from __future__ import annotations
import argparse, pathlib, random, re, sys, zipfile
import yaml

ROOT = pathlib.Path(__file__).resolve().parent.parent
LESSONS = ROOT / "backend" / "data" / "lessons"
SOT = pathlib.Path("/Users/young/project/chinese-literacy-platform"
                   "/private/curriculum-source/_SOT")
REGISTRY = ROOT / "backend" / "data" / "part_ids_registry.yml"

# 去掉 0 O · 1 l I · 2 Z z · 5 S s · 8 B b · g q —— 紙本掃不到時老師要手打
ALPHABET = "34679acdefhjkmnpqrtuvwxy"
ID_LEN = 5


def norm(s: str) -> str:
    return re.sub(r"[\s　]", "", s or "")


def load_registry() -> dict:
    if REGISTRY.is_file():
        return yaml.safe_load(REGISTRY.read_text(encoding="utf-8")) or {}
    return {}


def new_id(taken: set[str], rng: random.Random) -> str:
    """全庫唯一。⛔ 退役的 id 也算 taken —— 舊紙本的 QR 不能指到別篇"""
    for _ in range(10_000):
        candidate = "".join(rng.choice(ALPHABET) for _ in range(ID_LEN))
        if candidate not in taken:
            return candidate
    raise RuntimeError("短碼撞太多次，該加長了")


def docx_paragraphs(uid: str) -> list[str]:
    meta = yaml.safe_load((LESSONS / uid / "v3" / "lesson.yml").read_text(encoding="utf-8"))
    meta = meta.get("lesson", meta)
    src = SOT / ((meta.get("source") or {}).get("drive_path") or "")
    xml = zipfile.ZipFile(src).read("word/document.xml").decode("utf-8")
    out = []
    for block in re.split(r"(?=<w:p[ >])", xml):
        if not block.startswith("<w:p"):
            continue
        text = norm("".join(re.findall(r"<w:t[^>]*>([^<]*)</w:t>", block)))
        if text:
            out.append(text)
    return out


def part_count(uid: str) -> tuple[int | None, str]:
    """總篇數 —— 取「篇次 N/M」的 M。⛔ 不要自己數段落"""
    paras = docx_paragraphs(uid)
    joined = "".join(paras)
    marks = re.findall(r"篇次(\d)/(\d)", joined)
    if not marks:
        # 第二種印法：「第二篇最後一隻旅人鴿」這種標題（L0111）
        ordinals = set(re.findall(r"第([一二三四五])篇", joined))
        if ordinals:
            zh = "一二三四五"
            total = max(zh.index(o) + 1 for o in ordinals)
            return total, f"用「第N篇」標題判定（看到 {sorted(ordinals)}）"
        # 第三種：課文段落 idx 中途重新從 1 起算（書信體 L0010 L0012）
        ft = yaml.safe_load((LESSONS / uid / "v3" / "full_text_annotate.yml")
                            .read_text(encoding="utf-8")) or {}
        ft = ft.get("full_text_annotate") or ft
        idxs = [x.get("idx") for x in (ft.get("paragraphs") or []) if isinstance(x, dict)]
        resets = sum(1 for i in range(1, len(idxs)) if idxs[i] == 1 and idxs[i - 1] != 1)
        if resets:
            return resets + 1, f"用段落 idx 重起判定（重起 {resets} 次）"
        return None, "三種訊號都沒有"
    total = max(int(b) for _, b in marks)
    seen = {int(a) for a, _ in marks}
    separators = "".join(paras).count("請繼續閱讀下篇文章")
    note = ""
    if seen != set(range(1, total + 1)):
        note = f"⚠️ 只看到第 {sorted(seen)} 篇，宣稱共 {total} 篇"
    elif separators != total - 1:
        note = f"⚠️ 分隔句 {separators} 個，預期 {total - 1} 個"
    return total, note


def labels_for(uid: str, total: int) -> list[str]:
    """每篇的 label（給人看的，可以隨便改）—— 從既有資料湊，湊不到就留待補"""
    out = []
    ft = yaml.safe_load((LESSONS / uid / "v3" / "full_text_annotate.yml").read_text(encoding="utf-8"))
    ft = ft.get("full_text_annotate") or ft
    first = norm((ft.get("paragraphs") or [{}])[0].get("text", ""))[:16]
    out.append(first or "第 1 篇")
    mt_file = LESSONS / uid / "v3" / "multi_text_parts.yml"
    if mt_file.is_file():
        mt = yaml.safe_load(mt_file.read_text(encoding="utf-8")) or {}
        for part in (mt.get("multi_text_parts") or []):
            heading = part.get("lesson_heading") or ""
            body = part.get("body") or {}
            head = norm((body.get("paragraphs") or [{}])[0].get("text", ""))[:16]
            out.append(heading or head or f"第 {len(out) + 1} 篇")
    while len(out) < total:
        out.append(f"第 {len(out) + 1} 篇（label 待補）")
    return out[:total]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("uids", nargs="*", help="留空＝全庫掃 multi_text 分類的課")
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--seed", type=int, default=None, help="測試用；正式產生不要給")
    a = ap.parse_args()
    rng = random.Random(a.seed)

    registry = load_registry()
    taken = set(registry)

    uids = a.uids
    if not uids:
        uids = []
        for f in sorted(LESSONS.glob("L*/v3/metadata.yml")):
            d = yaml.safe_load(f.read_text(encoding="utf-8")) or {}
            if (d.get("source_profile") or {}).get("class") == "multi_text":
                uids.append(f.parent.parent.name)

    for uid in uids:
        lf = LESSONS / uid / "v3" / "lesson.yml"
        doc = yaml.safe_load(lf.read_text(encoding="utf-8")) or {}
        body = doc.get("lesson", doc)
        if body.get("parts"):
            print(f"·  {uid}  已有 parts（{len(body['parts'])} 篇），跳過")
            continue
        try:
            total, note = part_count(uid)
        except Exception as exc:
            print(f"🔴 {uid}  {type(exc).__name__}: {str(exc)[:60]}")
            continue
        if total is None:
            print(f"—  {uid}  {note}")
            continue
        labels = labels_for(uid, total)
        parts = []
        for i in range(total):
            pid = new_id(taken, rng)
            taken.add(pid)
            parts.append({"id": pid, "label": labels[i]})
            registry[pid] = {"status": "active", "lesson_uid": uid,
                             "label_snapshot": labels[i]}
        print(f"✅ {uid}  {total} 篇  {[p['id'] for p in parts]}  {note}")
        for p in parts:
            print(f"      {p['id']}  {p['label'][:28]}")
        if a.apply:
            body["parts"] = parts
            lf.write_text(yaml.safe_dump(doc, allow_unicode=True, sort_keys=False),
                          encoding="utf-8")

    if a.apply:
        REGISTRY.write_text(
            "# part id 登記簿 —— ⛔ 退役的 id 永不重用（舊紙本的 QR 會指到別篇）\n"
            "# 產生：scripts/build_lesson_parts.py --apply\n"
            + yaml.safe_dump(registry, allow_unicode=True, sort_keys=True),
            encoding="utf-8")
        print(f"\n登記簿 {REGISTRY.relative_to(ROOT)}：{len(registry)} 個 id")
    return 0


if __name__ == "__main__":
    sys.exit(main())
