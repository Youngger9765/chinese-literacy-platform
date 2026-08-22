#!/usr/bin/env python3
"""定位每個大題印在 PDF 的第幾頁，產出 `specs/modules/section-pages.yml`（#2857）。

## 為什麼需要這支

`extract-module` 骨架的第一條鐵律是「只讀 manifest 指定的 `pages`」，
而拆分能不能成立**完全**靠這句：

> 派工單帶 `pages`，所以 N 支飛機的總 token 不會是「全份 × N」。
> 沒有派工單就不該拆，那會讓成本乘上去。

#2852 落地時 174 份 `_manifest.yml` 一份都沒有 `pages`，`sections_present`
也沒有任何頁碼欄位（實測 1467 筆只有 no/name/subtitle/part/note 這幾種鍵）。
第一條鐵律當時沒有東西可以遵守。

## 為什麼頁碼要另外存成 committed 檔，而不是直接寫進 manifest

`_manifest.yml` 的 `--check` 是 CI 的漂移門，它靠「從 git 裡的來源重新推導、
比對結果」運作。頁碼只能從 `private/curriculum-source/`（`.gitignore:2`）的原稿
轉 PDF 才推導得出來，而 **CI checkout 沒有那個目錄**
（見 `tests/test_corpus_gates_are_wired_2843.py` 的 `CANNOT_WIRE`）。

如果 manifest 直接去讀原稿，`--check` 在 CI 就變成恆紅 —— 那是最糟的形狀。

⚠️ **這個論證原本是空的**：`build_lesson_manifest.py --check` 在 #2857 之前
**沒有被任何東西執行過**（不在 workflow、不在 `specs/run-ci.sh`、不在
`test_corpus_gates_are_wired_2843` 的 `WIRED`）—— 它防的那道門並不存在。
本 PR 把 `--check` 接進 `WIRED`，論證才成立。結論（committed 檔）本來就是對的，
理由現在也是真的。

所以拆成兩段：

```
private/ 原稿 ──[本機跑這支]──> specs/modules/section-pages.yml (committed)
                                          │
                              [CI 也讀得到]│
                                          ↓
                              build_lesson_manifest.py --check
```

## 定位法與它的邊界

用 `pdftotext` 逐頁取文字，找大題名出現在哪一頁。

🔴 **PDF 的文字層是正體，簡體只出現在畫面上。** 航母 skill 警告過
「PDF 印出『语词我最棒』」，那是本機缺字型時 LibreOffice 代換字型造成的**字形**問題；
實測 L0072 第 3 頁的文字層取出來是正體「語詞我最棒」，簡體命中 0。
⇒ 拿文字層定位是安全的，拿**畫面**定位才會被字型騙。

比對前把兩邊都正規化（NFKC + 去掉所有非中日韓文字與英數字元）——
`讀全文-做記號` 在紙上可能印成 `讀全文－做記號`，破折號是半形還全形不該影響定位。

**同名大題**（多文本課的「讀全文-做記號」會出現兩次）靠**從上一個大題的頁碼往後找**
區分，不是靠名字。

## 一節橫跨幾頁

`[本大題起始頁 .. 下一個大題的起始頁]`，最後一個大題吃到最後一頁。

下一個大題的**起始頁要含進來**：本節的尾巴可能就印在那一頁的上半部。
⛔ 這裡寧可多一頁也不要少一頁 —— 少一頁是抽不到內容（會被當成教材沒印），
多一頁只是多讀一點。

## 定位不到時

**回報，不要塞全份頁碼。** 塞全份會讓所有的門變綠而拆分的收益歸零，
那正是這支腳本要防的事（見 `tests/test_section_pages_2857.py` 第四條鎖）。

用法：
    python3 scripts/build_section_pages.py                  # 全部
    python3 scripts/build_section_pages.py --uid L0072      # 單課
    python3 scripts/build_section_pages.py --jobs 6         # 平行度
"""
from __future__ import annotations

import argparse
import hashlib
import concurrent.futures as cf
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile
import unicodedata

import yaml

REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
LESSONS = REPO_ROOT / "backend" / "data" / "lessons"
def _find_sot() -> pathlib.Path:
    """原稿目錄。⚠️ `private/` 是 gitignore 的，**worktree 裡沒有** ——
    只有主 checkout 有。在 worktree 裡跑要回頭找主 checkout，
    否則會報「原稿目錄不在」而那其實是路徑問題不是資料問題。"""
    here = REPO_ROOT / "private" / "curriculum-source" / "_SOT"
    if here.is_dir():
        return here
    try:
        r = subprocess.run(["git", "rev-parse", "--path-format=absolute",
                            "--git-common-dir"], cwd=REPO_ROOT if "REPO_ROOT" in globals() else ".",
                           capture_output=True, text=True, timeout=30)
        if r.returncode == 0:
            cand = pathlib.Path(r.stdout.strip()).parent / "private" / "curriculum-source" / "_SOT"
            if cand.is_dir():
                return cand
    except Exception:  # noqa: BLE001
        pass
    return here


SOT = _find_sot()
OUT_FILE = REPO_ROOT / "specs" / "modules" / "section-pages.yml"
DOCX_TO_PDF = REPO_ROOT / "scripts" / "docx_to_pdf.sh"

#: 轉好的 PDF 放這裡重複使用。全庫轉一次約兩分鐘，重跑時不該再等一次。
CACHE = pathlib.Path(
    os.environ.get("SECTION_PAGES_CACHE", tempfile.gettempdir() + "/lingoleap-section-pages")
)

#: LibreOffice 轉不出來的課 —— 頁碼定位不了，而原因跟定位無關。
#: 航母 skill 記載的解法是「把要的那塊拆成獨立 DOCX 再轉」(#2843 L0028/L0172)，
#: 那是另一件事的工作量。⛔ 不要因為想讓門變綠就給它們塞全份頁碼。
#: 列在這裡 = 看得見的欠債；不列 = 每次重跑都白等兩個 300 秒逾時。
CONVERT_BLOCKED = {
    "L0028": "LibreOffice 整份轉檔無窮迴圈（300s 逾時）。解法是拆 subset 再轉，見 extract-lesson-multimodal ②③",
    "L0172": "同上，實測 900s 仍逾時；需切成 7 份 subset",
}


class _FlowList(list):
    """頁碼用 flow style（`[3, 4]`）—— 這是給人讀的派工單，
    一個 spotlight 的頁碼展開成 12 行會讓整份檔失去可讀性。"""


yaml.add_representer(
    _FlowList,
    lambda dumper, data: dumper.represent_sequence("tag:yaml.org,2002:seq", data, flow_style=True),
    Dumper=yaml.SafeDumper,
)


def _flow(obj):
    if isinstance(obj, dict):
        return {k: (_FlowList(v) if k == "pages" and isinstance(v, list) else _flow(v)) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_flow(v) for v in obj]
    return obj


def _dump(obj) -> str:
    return yaml.safe_dump(_flow(obj), allow_unicode=True, sort_keys=False, width=200)


def normalise(text: str) -> str:
    """把版面差異磨掉，只留下可以比對的字。

    NFKC 收掉全形/半形差異，然後刪掉所有非中日韓文字與英數的字元 ——
    破折號、空白、圓圈序號、換行都不該影響「這一頁有沒有印這個大題名」。
    """
    text = unicodedata.normalize("NFKC", text)
    return re.sub(r"[^\w一-鿿]", "", text)


def page_count(pdf: pathlib.Path) -> int:
    out = subprocess.run(["pdfinfo", str(pdf)], capture_output=True, text=True).stdout
    m = re.search(r"^Pages:\s+(\d+)", out, re.M)
    if not m:
        raise RuntimeError(f"讀不出頁數：{pdf}")
    return int(m.group(1))


#: 一頁文字的指紋長度。⚠️ 不要用完整 sha256 —— 64 個十六進位字元會被
#: secret 掃描器判成 token（見 content_fidelity_attest.py 的同一個坑）。
PRINT_CHARS = 12


def page_print(text: str) -> str:
    """一頁的文字指紋。

    ⛔ **不要先 normalise**。第一版這麼做，結果指紋抓不到
    「三　語詞我最棒」→「三 🅐 語詞我最棒」的差異 —— 因為 normalise
    的工作就是把那類符號洗掉。而那正是 ⑤ 要抓的東西：兩份都 8 頁、
    字也一樣，但標題被塞了一個圈號，於是切節切不到。

    只壓掉連續空白（那在兩次轉檔之間本來就會浮動，且不影響切節）。

    🔴 **每 4 字元插一個連字號，不是為了好看。** 純十六進位串會撞上
    secret 掃描器的台灣身分證規則（字母 + 1/2 + 8 位數）—— 第一版
    172 課裡就有 7 個長成 `b26431196…`，pre-commit 直接擋。
    ⛔ 正確解法是改格式，不是去 touch bypass marker ——
    習慣繞掃描器，真的 secret 遲早會跟著過去。
    """
    squeezed = re.sub(r"[ \t]+", " ", text)
    squeezed = re.sub(r"\n{2,}", "\n", squeezed).strip()
    h = hashlib.sha256(squeezed.encode("utf-8")).hexdigest()[:PRINT_CHARS]
    return "-".join(h[i:i + 4] for i in range(0, len(h), 4))


def page_texts(pdf: pathlib.Path) -> list[str]:
    n = page_count(pdf)
    texts = []
    for p in range(1, n + 1):
        r = subprocess.run(
            ["pdftotext", "-f", str(p), "-l", str(p), "-layout", str(pdf), "-"],
            capture_output=True, text=True,
        )
        texts.append(normalise(r.stdout))
    return texts


def ensure_pdf(uid: str, drive_path: str) -> pathlib.Path:
    work = CACHE / uid
    pdf = work / "src.pdf"
    if pdf.is_file():
        return pdf
    src = SOT / drive_path
    if not src.is_file():
        raise FileNotFoundError(f"原稿不在：{src}")
    work.mkdir(parents=True, exist_ok=True)
    shutil.copy(src, work / "src.docx")
    r = subprocess.run(
        ["bash", str(DOCX_TO_PDF), str(work / "src.docx"), str(work), uid],
        capture_output=True, text=True, cwd=REPO_ROOT,
    )
    if r.returncode != 0 or not pdf.is_file():
        raise RuntimeError(f"轉檔失敗：{r.stderr.strip()[-300:]}")
    return pdf


def candidates(names: list[str], texts: list[str], ordinals: list[str] | None = None) -> list[list[int]]:
    """每個大題可能落在哪幾頁（1-based），已扣掉被更長的兄弟大題名吃掉的命中。

    🔴 **子字串會騙人。** L0029 的「閱讀理解」在全份 21 頁裡唯一的命中是第 19 頁，
    而那一頁印的其實是**另一個大題**「綜合閱讀理解」—— 前者是後者的子字串。
    第一版只做「從上一個大題往後找第一個命中」，於是游標被推到第 19 頁，
    **它後面的八個大題全部定位失敗**，而失敗看起來只是「定位不到」，
    沒有任何跡象指向真正的原因。

    所以命中要先扣掉被吃掉的那些：某一頁上「閱讀理解」出現 1 次、
    「綜合閱讀理解」也出現 1 次 → 那一次是後者的，前者在這一頁沒有真命中。

    （L0029 那個大題最後仍然定位不到，那是**對的** —— 學習單根本沒印
    「閱讀理解」四個字，`sections_present` 自己就註記了「沒有另外印大題圓圈」。
    定位不到要老實回報，不是找一個看起來合理的頁碼填進去。）
    """
    needles = [normalise(n) for n in names]
    ords = [normalise(o) if o else "" for o in (ordinals or [""] * len(names))]
    out: list[list[int]] = []
    for i, needle in enumerate(needles):
        if not needle:
            out.append([])
            continue
        # 真包含這個名字的其他大題名（自己與同名的不算）
        supersets = {s for j, s in enumerate(needles) if j != i and s != needle and needle in s}
        hits, titled = [], []
        for page_no, text in enumerate(texts, start=1):
            mine = text.count(needle)
            eaten = sum(text.count(s) for s in supersets)
            if mine > eaten:
                hits.append(page_no)
                # 🔴 命中不代表那是標題 —— 內文也會提到大題名（見下）
                if ords[i] and (ords[i] + needle) in text:
                    titled.append(page_no)
        # 有「序號緊接名稱」的頁就只留那些：那是標題的樣子，其餘是內文提及
        out.append(titled or hits)
    return out


def locate(names: list[str], texts: list[str], ordinals: list[str] | None = None) -> list[int | None]:
    """回傳每個大題的**起始頁**（1-based），定位不到給 None。

    大題在紙上一定是**由前往後**排的，所以指派必須單調不遞減。
    第一版用「貪心地取往後第一個命中」，一個錯誤命中就會把游標推過頭、
    毀掉它後面的每一個大題（見 `candidates` 的說明）。

    改成在所有候選裡挑「**能定位到最多大題**的單調指派」：一個大題定位錯
    或定位不到，不再連坐它後面的。同名大題（多文本課的兩篇）也是靠這個單調性
    分開的 —— 名字本身分不出第幾篇。

    搜尋空間很小（大題 ≤ 20、頁 ≤ 25），直接記憶化窮舉，不需要啟發式。
    """
    cands = candidates(names, texts, ordinals)
    n = len(names)
    from functools import lru_cache

    @lru_cache(maxsize=None)
    def best(i: int, floor: int) -> tuple[int, tuple[int | None, ...]]:
        """從第 i 個大題起、頁碼不得小於 floor，最多能定位幾個。"""
        if i == n:
            return 0, ()
        # 不指派這一個
        skipped_score, skipped_tail = best(i + 1, floor)
        chosen: tuple[int, tuple[int | None, ...]] = (skipped_score, (None,) + skipped_tail)
        for page in cands[i]:
            if page < floor:
                continue
            score, tail = best(i + 1, page)
            if score + 1 > chosen[0]:
                chosen = (score + 1, (page,) + tail)
            break  # 同一個大題取最早的可行頁；更晚的只會壓縮後面的空間
        return chosen

    return list(best(0, 1)[1])


def spans(starts: list[int | None], total: int) -> list[tuple[list[int], str]]:
    """起始頁 → 頁碼範圍，附上這個範圍是怎麼來的。

    含下一個大題的起始頁：本節的尾巴可能就印在那一頁的上半部。
    ⛔ 寧可多一頁也不要少一頁 —— 少一頁是抽不到內容（會被誤判成教材沒印），
    多一頁只是多讀一點。

    ## 定位不到的大題用**前後鄰居夾**，不是給全份

    有些大題名學習單根本沒印出來（L0075 的「語詞我最棒」全份文字層 0 命中，
    但下一個大題「語詞應用」印得好好的；L0029 的「閱讀理解」`sections_present`
    自己就註記了「沒有另外印大題圓圈」）。

    這種情況它仍然**夾在**前後兩個定位得到的大題之間 —— 大題在紙上是照順序排的。
    所以給 `[前一個大題的起始頁 .. 後一個大題的起始頁]`，並標成 `bracketed`
    讓消費端知道這個範圍是推出來的、不是看到標題定出來的。

    ⛔ 這**不是**「定位不到就給全份」的委婉說法：夾出來的範圍通常是 2~3 頁，
    而全份是 8~21 頁。兩者的差別正是拆分有沒有收益。前後都夾不到才給 `null`。
    """
    out: list[tuple[list[int], str]] = []
    for idx, start in enumerate(starts):
        if start is not None:
            nxt = next((s for s in starts[idx + 1:] if s is not None), None)
            end = nxt if nxt is not None else total
            out.append((list(range(start, max(start, end) + 1)), "located"))
            continue
        # 定位不到 → 用前後鄰居夾
        prev = next((s for s in reversed(starts[:idx]) if s is not None), None)
        nxt = next((s for s in starts[idx + 1:] if s is not None), None)
        lo = prev if prev is not None else 1
        hi = nxt if nxt is not None else total
        if prev is None and nxt is None:
            # 整課一個大題都沒定位到 —— 那是定位器壞了，不要拿全份頁碼粉飾
            out.append(([], "unlocated"))
            continue
        out.append((list(range(lo, max(lo, hi) + 1)), "bracketed"))
    return out


def build_one(uid: str) -> dict:
    lesson_file = LESSONS / uid / "v3" / "lesson.yml"
    lesson = yaml.safe_load(lesson_file.read_text(encoding="utf-8")) or {}
    rows = [r for r in (lesson.get("sections_present") or []) if isinstance(r, dict) and r.get("name")]
    if uid in CONVERT_BLOCKED:
        # 已登錄的轉檔失敗。回報成 blocked 而不是 error，也不是靜默跳過
        return {"uid": uid, "blocked": CONVERT_BLOCKED[uid]}
    drive_path = (lesson.get("source") or {}).get("drive_path")
    if not drive_path:
        return {"uid": uid, "error": "lesson.yml 沒有 source.drive_path"}
    pdf = ensure_pdf(uid, drive_path)
    texts = page_texts(pdf)
    names = [str(r["name"]) for r in rows]
    ordinals = [str(r.get("no") or "") for r in rows]
    page_spans = spans(locate(names, texts, ordinals), len(texts))
    return {
        "uid": uid,
        "pdf_pages": len(texts),
        # 每一頁文字的指紋（#2865）。⑤ 原本只比頁數，擋不住
        # 「頁數一樣但版面重排」—— 實測 L0001 兩次轉檔都是 8 頁，
        # 但標題從「三　語詞我最棒」變成「三 🅐 語詞我最棒」，
        # 頁數檢查放行，而抽取範圍已經變了。
        # 存指紋而不是全文：全文會讓這個檔膨脹到幾 MB。
        "page_prints": [page_print(t) for t in texts],
        "sections": [
            # name 一起存下來，讓 manifest 端能發現「來源改了但頁碼沒重定位」
            {"name": n, "pages": pages or None, "pages_source": how}
            for n, (pages, how) in zip(names, page_spans)
        ],
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--uid")
    ap.add_argument("--jobs", type=int, default=4)
    args = ap.parse_args()

    uids = [
        p.parent.parent.name
        for p in sorted(LESSONS.glob("L*/v3/_manifest.yml"))
        if not args.uid or p.parent.parent.name == args.uid
    ]
    if not uids:
        print("🔴 沒有要處理的課", file=sys.stderr)
        return 2
    if not SOT.is_dir():
        print(f"🔴 原稿目錄不在：{SOT}\n    這支只能在有 private/ 的本機跑，CI 跑不了（那是刻意的）", file=sys.stderr)
        return 2

    results, errors, blocked = {}, [], {}
    with cf.ThreadPoolExecutor(max_workers=args.jobs) as ex:
        for r in ex.map(lambda u: _safe(u), uids):
            if r.get("blocked"):
                blocked[r["uid"]] = r["blocked"]
            elif r.get("error"):
                errors.append(f"{r['uid']}: {r['error']}")
            else:
                results[r["uid"]] = {"pdf_pages": r["pdf_pages"],
                                     "page_prints": r["page_prints"],
                                     "sections": r["sections"]}

    unlocated = [
        {"lesson_uid": uid, "section": s["name"], "pages_source": s["pages_source"]}
        for uid, d in sorted(results.items())
        for s in d["sections"] if s["pages_source"] != "located"
    ]

    # 單課模式合併進既有檔，不要把其他 173 課清掉。
    # ⚠️ unlocated / convert_blocked 也要合併 —— 只合併 lessons 的話，
    # 跑一次 --uid 就會把另外 173 課的欠債清單抹掉，而那看起來像「問題都解決了」
    existing, prev_unlocated, prev_blocked = {}, [], {}
    if args.uid and OUT_FILE.is_file():
        prev = yaml.safe_load(OUT_FILE.read_text(encoding="utf-8")) or {}
        existing = prev.get("lessons") or {}
        prev_unlocated = [r for r in (prev.get("unlocated") or []) if r.get("lesson_uid") != args.uid]
        prev_blocked = dict(prev.get("convert_blocked") or {})
    existing.update(results)
    unlocated = sorted(prev_unlocated + unlocated, key=lambda r: (r["lesson_uid"], r["section"]))
    prev_blocked.update(blocked)
    blocked = prev_blocked

    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUT_FILE.write_text(
        _dump(
            {
                "generated_by": "scripts/build_section_pages.py",
                "note": (
                    "衍生檔，但**必須 commit** —— 它是 CI 唯一拿得到頁碼的地方"
                    "（頁碼要從 private/curriculum-source/ 的原稿轉 PDF 才推導得出來，CI 沒有那個目錄）。"
                    "改了 sections_present 之後要重跑這支，再重產 _manifest.yml。"
                ),
                "lessons": dict(sorted(existing.items())),
                # 定位不到的大題。⛔ 這裡有東西不代表可以拿全份頁碼頂替 ——
                # 消費端要看得到「這一節沒有頁碼」，而不是收到一個假的範圍
                "unlocated": unlocated,
                "convert_blocked": dict(sorted(blocked.items())),
            },
        ),
        encoding="utf-8",
    )

    print(f"✅ {len(results)} 課寫進 {OUT_FILE.relative_to(REPO_ROOT)}")
    if blocked:
        print(f"\n⚠️  {len(blocked)} 課轉不出 PDF（已登錄，不是新問題）：{', '.join(sorted(blocked))}")
    if unlocated:
        # 定位不到要看得見。⛔ 不要因此塞全份頁碼進去 —— 那會讓拆分的收益歸零
        hard = [r for r in unlocated if r["pages_source"] == "unlocated"]
        print(f"\n⚠️  {len(unlocated)} 個大題標題找不到（{len(unlocated)-len(hard)} 個用前後夾出範圍，{len(hard)} 個完全定位不到）：")
        for row in unlocated[:20]:
            print(f"    {row['pages_source']:<10} {row['lesson_uid']}: 「{row['section']}」")
    if errors:
        print(f"\n🔴 {len(errors)} 課失敗：")
        for line in errors[:20]:
            print(f"    {line}")
        return 1
    return 0


def _safe(uid: str) -> dict:
    try:
        return build_one(uid)
    except Exception as exc:  # noqa: BLE001 — 一課壞掉不該讓整輪停掉
        return {"uid": uid, "error": f"{type(exc).__name__}: {exc}"}


if __name__ == "__main__":
    raise SystemExit(main())
