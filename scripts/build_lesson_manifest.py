#!/usr/bin/env python3
"""產出每課的 `_manifest.yml` —— 分派的實體契約（#2843）。

## 這份檔是要交給誰的

Young 2026-08-21 會議上的比喻：

> 「它本身可以是一個航空母艦，是一個抽取器。但它每次要出發，
>   就是小小一隻飛機飛出去去做轟炸機、去做偵察機。」

manifest 就是**派工單**：總覽看完整張學習單，寫下「這課有哪幾個大題、
各對到哪個模組」，然後模組 skill 各自照單去抽自己那一節。

沒有它的話，每個模組 skill 都得自己重讀一次整份 PDF 判斷「有沒有我這一節」——
那就是現在「一個 skill 打遍天下」的成本結構。

## 跟 `sections_present` 的關係

`sections_present` 是**學習單自己印的目錄**（174/175 課有），是原始事實。
manifest 是它**加上模組歸屬**之後的產物 —— 多了 `module` 欄位，
還有「這課缺哪些模組、為什麼」。

⚠️ manifest 是**衍生檔**，不是真相來源。改 `sections_present` 或
`section-to-module.yml` 之後要重產。`--check` 就是在擋這種漂移。

用法：
    python3 scripts/build_lesson_manifest.py           # 產出
    python3 scripts/build_lesson_manifest.py --check   # 只比對（CI 用）
"""
from __future__ import annotations

import argparse
import re
import pathlib
import sys

import yaml

REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
LESSONS = REPO_ROOT / "backend" / "data" / "lessons"
MAP_FILE = REPO_ROOT / "specs" / "modules" / "section-to-module.yml"
GAPS_FILE = REPO_ROOT / "backend" / "data" / "curriculum_qa" / "content_known_gaps.yaml"
PAGES_FILE = REPO_ROOT / "specs" / "modules" / "section-pages.yml"


def _part_ordinal(part) -> int | None:
    """把 `part` 的各種寫法收斂成篇次序號；取不到回 None（＝共用區，不分篇）。"""
    if isinstance(part, bool) or part is None:
        return None
    if isinstance(part, int):
        return part
    m = re.search(r"\d+", str(part))
    return int(m.group()) if m else None


def build_one(version_dir: pathlib.Path, table: dict, gaps: dict, pages_db: dict,
              drift: list[str] | None = None) -> dict | None:
    lesson_file = version_dir / "lesson.yml"
    if not lesson_file.is_file():
        return None
    lesson = yaml.safe_load(lesson_file.read_text(encoding="utf-8")) or {}
    rows = lesson.get("sections_present") or []
    if not rows:
        return None

    uid = version_dir.parent.name
    not_sections = set(table.get("not_sections", []))
    # 篇次 → slug。`parts[]` 的順序就是第 1 篇、第 2 篇…（#2916）
    lesson_parts = lesson.get("parts") or []

    # 這一課每個模組有哪些檔（含各自的 slug 與 text_ref），依「指向第幾篇」排序。
    _module_files: dict[str, list] = {}
    _module_seen: dict[str, int] = {}
    # 課文的順序由**學習單自己印的目錄**（`sections_present`）決定 ——
    # 第 k 個「讀全文」列就是第 k 篇。檔案的 `part` 欄位只當**識別碼**
    # （我是第幾篇），拿來跟目錄的列對上，不是拿它來排序。
    #
    # ⛔ 不要用檔名字母序（slug 是不透明亂碼，排出來會是 篇2、篇3、篇1），
    #    也不要讓檔案自己決定順序 —— 那會變成第二套順序來源。
    _by_part: dict[int, str] = {}
    for f in sorted(version_dir.glob("full_text_annotate.*.yml")):
        doc = yaml.safe_load(f.read_text(encoding="utf-8")) or {}
        b = doc.get("full_text_annotate") if isinstance(doc.get("full_text_annotate"), dict) else doc
        pt = (b or {}).get("part") or (b or {}).get("part_no")
        _by_part[pt if isinstance(pt, int) else len(_by_part) + 1] = f.stem.partition(".")[2]
    _text_order: list[str] = []
    for r in rows:
        if not isinstance(r, dict) or "讀全文" not in str(r.get("name") or ""):
            continue
        pt = _part_ordinal(r.get("part")) or (len(_text_order) + 1)
        sl = _by_part.get(pt)
        if sl and sl not in _text_order:
            _text_order.append(sl)
    for sl in _by_part.values():           # 目錄沒點到的（單篇課沒有 part）補在後面
        if sl not in _text_order:
            _text_order.append(sl)
    for f in sorted(version_dir.glob("*.*.yml")):
        mod, _, sl = f.stem.partition(".")
        if not sl or mod in not_sections or mod.startswith("_"):
            continue
        doc = yaml.safe_load(f.read_text(encoding="utf-8")) or {}
        body = doc.get(mod) if isinstance(doc.get(mod), dict) else doc
        tr = (body or {}).get("text_ref")
        _module_files.setdefault(mod, []).append((sl, tr))
        _module_seen.setdefault(mod, 0)
    def _rank(item):
        sl, tr = item
        key = tr[0] if isinstance(tr, list) and tr else tr
        if mod_is_text := False:
            pass
        return (_text_order.index(key) if key in _text_order else len(_text_order), sl)
    for m in _module_files:
        if m == "full_text_annotate":
            _module_files[m].sort(key=lambda x: _text_order.index(x[0]) if x[0] in _text_order else 99)
        else:
            _module_files[m].sort(key=_rank)

    # 頁碼來自 committed 的 section-pages.yml，不是現場讀原稿 —— CI 沒有 private/，
    # 現場讀會讓 --check 恆紅（見 tests/test_corpus_gates_are_wired_2843.py 的 CANNOT_WIRE）
    drift = drift if drift is not None else []
    page_entry = (pages_db.get("lessons") or {}).get(uid) or {}
    page_rows = page_entry.get("sections") or []
    blocked_reason = (pages_db.get("convert_blocked") or {}).get(uid)

    sections = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        name = str(row.get("name") or "")
        if not name:
            continue
        module = None
        unresolved = False
        for m in table.get("matches", []):
            if m["needle"] in name:
                module = m["module"]
                break
        else:
            for u in table.get("unresolved", []):
                if u["needle"] in name:
                    unresolved = True
                    break
        entry = {"no": row.get("no"), "name": name, "module": module}
        if row.get("subtitle"):
            entry["subtitle"] = row["subtitle"]

        # 一課多篇時，同一個大題會出現好幾次（L0029 印兩個念順順）。
        # 光有 module 名分不出哪一列對哪一份檔 —— 所以這裡把**要載的檔名**寫死，
        # 消費端照著載就好，不必自己拼字串、也不必知道 slug 規則。
        #
        # `part` 直接沿用學習單目錄印的值（可能是 1/2/3，也可能是「前半」
        # 「篇次 1/3」這種自由文字 —— 那是原稿怎麼印就怎麼記，不強行正規化）。
        if row.get("part") is not None:
            entry["part"] = row["part"]
        if module:
            slug = None
            # 每一份模組檔都有自己的 slug（#2916）。同一個模組在一課裡出現多次時，
            # 用「它的 text_ref 指向第幾篇」把檔案排序，再依帳本順序配過去。
            # ⛔ 不能用檔名字母序 —— slug 是不透明亂碼，跟課本順序無關。
            cand = _module_files.get(module) or []
            # ⚠️ `.get(module, 0)` 不是防禦性寫法，是**新教材本來的狀態**（#3011）：
            #    `sections_present` 是學習單印的目錄（九個大題），而模組檔是一節一節
            #    慢慢抽的。學習單有、硬碟還沒有的那幾節根本不在 `_module_seen` 裡。
            #    這裡原本是 `_module_seen[module]` 直接 KeyError，而 main() 是
            #    先全部算完再寫 —— 所以**一課炸掉 = 175 課的派工單全部沒產出**。
            #    2026-08-31 加 體-L12~L15 時撞到（課文與念順順抽好，其餘七節還沒）。
            k = _module_seen.get(module, 0)
            if k < len(cand):
                sl, tr = cand[k]
                slug = sl
                if tr is not None:
                    entry["text_ref"] = tr
            _module_seen[module] = k + 1
            # `part` 是原稿怎麼印就怎麼記，五種寫法都出現過：
            #   1 / 2 / 3          （L0029、L0063、L0111）
            #   '1/2' '2/2'        （L0137）
            #   '篇次 1/3' '篇次3/3-(新聞短文)'（L0144）
            #   '三篇合讀' '前半' '後半'        ← 沒有篇次，是共用區或版面切分
            # 取第一個數字當篇次；取不到就是共用區，不給 slug。
            entry["slug"] = slug
            entry["file"] = f"{module}.{slug}.yml" if slug else f"{module}.yml"
        if unresolved:
            # 明說「還沒歸因」而不是留 module: null 讓人以為是漏填
            entry["module_unresolved"] = True

        # 按**位置**取頁碼，並用名字驗一次。位置對得上但名字對不上
        # = sections_present 改過而頁碼沒重定位 —— 那會讓飛機讀到隔壁那一節
        idx = len(sections)
        if idx < len(page_rows):
            stored = page_rows[idx]
            if str(stored.get("name")) != name:
                # ⛔ 不在這裡 raise。main() 是邊算邊寫，中途炸掉會留下
                # 「前 k-1 課新、其餘舊」的混合工作樹，而之後 --check 會指著那些舊的
                # 說「來源改了沒重產」—— 指向完全錯的原因。收集起來，跑完一次報完。
                drift.append(
                    f"{uid} 第 {idx + 1} 個大題對不上：manifest 要「{name}」，"
                    f"section-pages.yml 存的是「{stored.get('name')}」"
                )
            if stored.get("pages"):
                entry["pages"] = list(stored["pages"])
                if stored.get("pages_source") != "located":
                    # 標題沒印出來、範圍是靠前後鄰居夾的 —— 消費端該知道信心比較低
                    entry["pages_source"] = stored["pages_source"]
        sections.append(entry)

    # 重複模組的檔名是 `{module}.{slug}.yml`（#2916），拿整個 stem 會冒出
    # `key_reading.m7qxv` 這種不存在的模組名，跟 dispatch 永遠對不上
    produced = sorted(
        {p.stem.partition(".")[0] for p in version_dir.glob("*.yml")}
        - not_sections - {"_manifest"}
    )
    dispatched = sorted({s["module"] for s in sections if s["module"]})
    absent = sorted(gaps.get(uid, set()))

    # 每個模組要讀哪幾頁 = 它名下所有大題頁碼的聯集。
    # 這是拆分唯一的收益來源：飛機只讀這幾頁，不是全份
    dispatch_pages: dict[str, list[int]] = {}
    for section in sections:
        module = section.get("module")
        if module and section.get("pages"):
            dispatch_pages.setdefault(module, set()).update(section["pages"])  # type: ignore[arg-type]
    dispatch_pages = {k: sorted(v) for k, v in sorted(dispatch_pages.items())}

    # 哪幾個模組的頁碼是「夾出來的」而不是定位到的（#2857 N2）。
    # `pages_source: bracketed` 本來只寫在 sections[]，而飛機讀的是 dispatch_pages ——
    # 23 個低信心標記因此一個都到不了使用端，飛機拿到一段可能寬達 54% 的範圍
    # 卻不知道那是猜的。這裡把同一件事放到它讀得到的地方。
    low_confidence = sorted({
        section["module"]
        for section in sections
        if section.get("module") and section.get("pages")
        and section.get("pages_source") == "bracketed"
    })

    return {
        "lesson_uid": uid,
        "generated_by": "scripts/build_lesson_manifest.py",
        "note": (
            "衍生檔，不是真相來源。sections 來自 lesson.yml 的 sections_present，"
            "module 歸屬來自 specs/modules/section-to-module.yml。改了那兩者要重產。"
        ),
        "sections": sections,
        # 派工單：這課要出動哪幾個模組 skill
        "dispatch": dispatched,
        # 實際產出的模組檔 —— 跟 dispatch 對不上就是對帳門要抓的
        "produced": produced,
        # 學習單本身就沒印的那幾節（已逐課開原稿確認，見 content_known_gaps.yaml）
        "absent_from_source": absent,
        # 派工單的頁碼欄。⛔ 空的不代表「讀全份」，代表這課還沒定位過 ——
        # 飛機收到空的要回 BLOCKED，不要自己去讀全份（#2857）
        "pdf_pages": page_entry.get("pdf_pages"),
        "dispatch_pages": dispatch_pages,
        # ⚠️ 這幾個模組的 dispatch_pages 是用前後鄰居夾出來的，不是定位到的。
        # 飛機讀到自己在名單上 → 範圍可能過寬（實測最寬 54%），抽完要自己確認
        # 讀到的真的是自己那一節，別把隔壁的內容收進來。
        **({"low_confidence_pages": low_confidence} if low_confidence else {}),
        **({"pages_unavailable": blocked_reason} if blocked_reason else {}),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()

    table = yaml.safe_load(MAP_FILE.read_text(encoding="utf-8")) or {}
    gaps_data = yaml.safe_load(GAPS_FILE.read_text(encoding="utf-8")) or {}
    gaps = {
        e["lesson_uid"]: set(e["absent_modules"])
        for e in (gaps_data.get("modules_absent_from_source") or {}).get("lessons", [])
    }
    pages_db = yaml.safe_load(PAGES_FILE.read_text(encoding="utf-8")) or {} if PAGES_FILE.is_file() else {}

    drifted, drift = [], []
    # 先全部算完再寫。邊算邊寫的話，偵測到漂移時檔案早就落地了 ——
    # exit 1 會叫人「重新定位」，但工作樹已經是用**過期頁碼**產的那一份，
    # 而它看起來完全正常（每一課都有派工單、格式也對）。
    pending: list[tuple[pathlib.Path, str]] = []
    for version_dir in sorted(LESSONS.glob("L*/v3")):
        manifest = build_one(version_dir, table, gaps, pages_db, drift)
        if manifest is None:
            continue
        target = version_dir / "_manifest.yml"
        text = yaml.safe_dump(manifest, allow_unicode=True, sort_keys=False, width=200)
        if args.check:
            if not target.is_file() or target.read_text(encoding="utf-8") != text:
                drifted.append(version_dir.parent.name)
        else:
            pending.append((target, text))

    if drift:
        print(f"🔴 {len(drift)} 個大題的名字跟 section-pages.yml 對不上（來源改了但沒重定位）：")
        for line in drift[:15]:
            print(f"    {line}")
        print("\n跑 `python3 scripts/build_section_pages.py` 重新定位，再重產 manifest。")
        print("⛔ 一份都沒寫出去 —— 用過期頁碼產出來的派工單看起來完全正常。")
        return 1

    written = 0
    for target, text in pending:
        target.write_text(text, encoding="utf-8")
        written += 1

    if args.check:
        if drifted:
            print(f"🔴 {len(drifted)} 課的 _manifest.yml 跟來源對不上（來源改了但沒重產）：")
            print("    " + ", ".join(drifted[:12]) + (" …" if len(drifted) > 12 else ""))
            print("\n跑 `python3 scripts/build_lesson_manifest.py` 重產。")
            return 1
        print("✅ 所有 _manifest.yml 都跟來源一致")
        return 0

    if written == 0:
        # 產 0 份要當錯誤，不要印成功訊息
        print("🔴 沒有產出任何 manifest", file=sys.stderr)
        return 2
    print(f"✅ 產出 {written} 份 _manifest.yml")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
