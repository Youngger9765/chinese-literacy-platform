#!/usr/bin/env python3
"""把抽取流程串成一條，決定性的部分全部自動跑（#2865）。

## 為什麼需要它

積木都做好了，但**沒有任何東西把它們串起來** —— 每一塊都是人手動跑的腳本。
「流程」只存在於 SKILL.md 的散文裡，而散文不會 fail-closed。

這支把 LLM 以外的每一步凍成一條指令，並在 LLM 前後各設一道門：

```
plan    ①定位原稿 → ②轉PDF → ③頁碼 → ④派工單 → ⑤PDF對帳 → 印出派工
          ↑ 全部決定性，任一步失敗就停

        （中間交給 N 架飛機 —— 唯一的 LLM 環節）

verify  ⑥b 見證對帳 + schema 檢查，逐個模組
          ↑ 全部決定性
```

⇒ LLM 只在中間，兩端都被腳本夾住。

## 用法

    # 派工前
    python3 scripts/run_extraction_pipeline.py plan --uid L0072
    python3 scripts/run_extraction_pipeline.py plan --uid L0072 --json   # 給程式吃

    # 飛機交件後
    python3 scripts/run_extraction_pipeline.py verify --uid L0072 --out /tmp/L0072

exit 0 = 每一步都過
exit 1 = 有門紅了 —— ⛔ 不要往下走
exit 2 = 材料不齊（原稿不在、派工單沒有、轉檔失敗）
        ⚠️ 這**不是**通過。
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import pathlib
import subprocess
import sys
import tempfile

import yaml

REPO = pathlib.Path(__file__).resolve().parents[1]
LESSONS = REPO / "backend" / "data" / "lessons"
def _sot() -> pathlib.Path:
    """原稿目錄。⚠️ `private/` 是 gitignore 的，**worktree 裡沒有** ——
    只有主 checkout 有。在 worktree 裡跑要回頭找主 checkout，
    否則會報「原稿不在」而那其實是路徑問題不是資料問題。"""
    here = REPO / "private" / "curriculum-source" / "_SOT"
    if here.is_dir():
        return here
    # worktree → 用 git 找主 checkout
    try:
        common = subprocess.run(["git", "rev-parse", "--path-format=absolute",
                                 "--git-common-dir"], cwd=REPO,
                                capture_output=True, text=True, timeout=30)
        if common.returncode == 0:
            main = pathlib.Path(common.stdout.strip()).parent
            cand = main / "private" / "curriculum-source" / "_SOT"
            if cand.is_dir():
                return cand
    except Exception:  # noqa: BLE001
        pass
    return here


SOT = _sot()
SCHEMAS = REPO / "specs" / "modules" / "schemas"


def _load(name: str):
    spec = importlib.util.spec_from_file_location(name, REPO / "scripts" / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _vdir(uid: str) -> pathlib.Path | None:
    vs = sorted((p for p in (LESSONS / uid).glob("v*") if p.is_dir()), key=lambda p: p.name)
    return vs[-1] if vs else None


def _step(n: str, ok: bool, detail: str = "", unverifiable: bool = False) -> None:
    """🔴 對不上 / 🟡 驗不了 / ✅ 過 —— 三態。

    ⛔ 「驗不了」跟「壞了」都印 🔴 的話，看的人分不出
    「這課有缺陷」與「這道門在這一頁上沒有判斷力」。
    實測 10 課有 4 課出現 🔴，逐一查才發現**四個都是 exit 2（驗不了）
    而不是缺陷** —— 那個顯示等於在製造假警報。
    """
    icon = "🟡" if unverifiable else ("✅" if ok else "🔴")
    print(f"  {icon} {n}{('  ' + detail) if detail else ''}")


def _reload_manifest(uid: str) -> dict | None:
    """重算頁碼之後派工單也變了，要重讀 —— 不然後面派的還是舊頁碼。"""
    vd = _vdir(uid)
    f = vd / "_manifest.yml" if vd else None
    if not f or not f.is_file():
        return None
    try:
        return yaml.safe_load(f.read_text(encoding="utf-8")) or None
    except yaml.YAMLError:
        return None


def plan(uid: str, as_json: bool, workdir: pathlib.Path | None,
         refresh_pages: bool = False) -> int:
    vdir = _vdir(uid)
    if not vdir:
        print(f"⛔ 找不到 {uid} 的版本目錄", file=sys.stderr)
        return 2

    # ① 定位原稿
    lesson_file = vdir / "lesson.yml"
    if not lesson_file.is_file():
        print(f"⛔ 沒有 {lesson_file}", file=sys.stderr)
        return 2
    lesson = yaml.safe_load(lesson_file.read_text(encoding="utf-8")) or {}
    drive_path = (lesson.get("source") or {}).get("drive_path")
    if not drive_path:
        print("⛔ lesson.yml 沒有 source.drive_path", file=sys.stderr)
        return 2
    docx = SOT / drive_path
    if not docx.is_file():
        print(f"⛔ 原稿不在：{docx}\n"
              "   這支要 private/curriculum-source/，CI 跑不了（那是刻意的）",
              file=sys.stderr)
        return 2
    if not as_json:
        _step("① 定位原稿", True, docx.name[:44])

    # ② DOCX → PDF
    work = workdir or pathlib.Path(tempfile.mkdtemp(prefix=f"{uid}-"))
    work.mkdir(parents=True, exist_ok=True)
    src = work / "src.docx"
    if not src.is_file():
        src.write_bytes(docx.read_bytes())
    pdf = next(iter(work.glob("*.pdf")), None)
    if pdf is None:
        r = subprocess.run(
            ["bash", str(REPO / "scripts" / "docx_to_pdf.sh"), str(src), str(work), uid],
            capture_output=True, text=True, timeout=600,
        )
        pdf = next(iter(work.glob("*.pdf")), None)
        if pdf is None:
            print(f"⛔ 轉檔失敗：{r.stderr.strip()[:200]}", file=sys.stderr)
            return 2
    if not as_json:
        _step("② DOCX → PDF", True, pdf.name)

    # ③④ 派工單（既有課直接讀；沒有就要先跑 build_section_pages + build_lesson_manifest）
    mf = vdir / "_manifest.yml"
    if not mf.is_file():
        print(f"⛔ 沒有派工單 {mf}\n"
              "   新課要先跑：build_section_pages.py → build_lesson_manifest.py\n"
              "   ⛔ 不要讓飛機讀全份頂替 —— 那是拆分要消滅的成本結構",
              file=sys.stderr)
        return 2
    manifest = yaml.safe_load(mf.read_text(encoding="utf-8")) or {}
    dispatch_pages = manifest.get("dispatch_pages") or {}
    if not as_json:
        _step("③④ 派工單", True, f"{len(dispatch_pages)} 個模組")

    # ⑤ 派工前對帳（②不穩的止血）
    r = subprocess.run(
        [sys.executable, str(REPO / "scripts" / "assert_pdf_matches_manifest.py"),
         "--uid", uid, "--pdf", str(pdf)],
        capture_output=True, text=True, timeout=180,
    )
    if r.returncode != 0 and refresh_pages:
        # 🔴 ② 的排版不穩讓這裡幾乎每次都擋下來（實測 20 次單轉 8 頁 9 次 /
        #    9 頁 11 次）。門是對的 —— 手上這份 PDF 真的不是算頁碼那份 ——
        #    但如果每一次都要人先去跑 build_section_pages，這條流程實務上
        #    就跑不動，而**跑不動的流程等於不存在**。
        #
        #    ⛔ 這不是放寬判準：重算之後 plan / 抽取 / verify 用的仍然是
        #    **同一份 PDF**，⑤ 保證的那件事一點都沒少。差別只在「誰去重算」。
        if not as_json:
            _step("⑤ PDF 對帳", False, "頁碼過期 → 重算中")
        rb = subprocess.run(
            # ⭐ 關鍵：把**管線手上這一份** PDF 傳進去。
            #    不傳的話它會自己再轉一份，而兩次獨立轉檔幾乎不會一致 ——
            #    重算出來的指紋來自第三份 PDF，這個修法永遠不會收斂。
            [sys.executable, str(REPO / "scripts" / "build_section_pages.py"),
             "--uid", uid, "--pdf", str(pdf)],
            capture_output=True, text=True, timeout=600,
        )
        if rb.returncode == 0:
            manifest = _reload_manifest(uid) or manifest
            r = subprocess.run(
                [sys.executable, str(REPO / "scripts" / "assert_pdf_matches_manifest.py"),
                 "--uid", uid, "--pdf", str(pdf)],
                capture_output=True, text=True, timeout=180,
            )

    if r.returncode != 0:
        if not as_json:
            _step("⑤ PDF 對帳", False, r.stdout.strip().split("\n")[0][:80])
            print("     💡 頁碼可能過期 —— 加 --refresh-pages 讓它自己重算",
                  file=sys.stderr)
        else:
            print(json.dumps({"uid": uid, "status": "BLOCKED",
                              "reason": r.stdout.strip()}, ensure_ascii=False))
        return 1 if r.returncode == 1 else 2
    if not as_json:
        _step("⑤ PDF 對帳", True, f"{manifest.get('pdf_pages')} 頁一致")

    # 派工
    low = set(manifest.get("low_confidence_pages") or [])
    sections = {s.get("module"): s.get("name")
                for s in (manifest.get("sections") or []) if s.get("module")}
    orders = []
    for mod, pages in sorted(dispatch_pages.items()):
        orders.append({
            "module": mod,
            "pages": pages,
            "section": sections.get(mod),
            "schema": str((SCHEMAS / f"{mod}.schema.json").relative_to(REPO))
                      if (SCHEMAS / f"{mod}.schema.json").is_file() else None,
            "low_confidence": mod in low,
        })

    if as_json:
        print(json.dumps({"uid": uid, "status": "READY", "pdf": str(pdf),
                          "pdf_pages": manifest.get("pdf_pages"),
                          "orders": orders}, ensure_ascii=False, indent=2))
        return 0

    print(f"\n  派工單（{len(orders)} 架）  PDF: {pdf}")
    for o in orders:
        flag = " 🟡低信心" if o["low_confidence"] else ""
        noschema = "" if o["schema"] else "  ⚠️無 schema"
        print(f"    {o['module']:24} p{o['pages']}  「{o['section'] or '?'}」{flag}{noschema}")
    print("\n  下一步：對每一架跑 extract-<module> skill，抽完用 verify 收")
    return 0


def verify(uid: str, out: pathlib.Path, workdir: pathlib.Path | None) -> int:
    vdir = _vdir(uid)
    if not vdir:
        print(f"⛔ 找不到 {uid}", file=sys.stderr)
        return 2
    mf = vdir / "_manifest.yml"
    if not mf.is_file():
        print(f"⛔ 沒有派工單", file=sys.stderr)
        return 2
    manifest = yaml.safe_load(mf.read_text(encoding="utf-8")) or {}
    sections = {s.get("module"): s.get("name")
                for s in (manifest.get("sections") or []) if s.get("module")}
    dispatch_pages = manifest.get("dispatch_pages") or {}

    work = workdir or out
    pdf = next(iter(work.glob("*.pdf")), None)
    if pdf is None:
        print(f"⛔ 在 {work} 找不到 PDF —— verify 需要飛機讀的那一份", file=sys.stderr)
        return 2

    # 課級檔沒有「大題」，派工單自然沒有它們的節名與頁碼 ——
    # 拿它們去跑對帳會得到「派工單沒有節名，驗不了」，那是**假警報**。
    # ⚠️ 但 schema 還是要驗，所以只從對帳排除，不從清單排除。
    # 課級檔與**無編號元素**（跨大題的框）都沒有節名，派工單自然對不到 ——
    # 拿它們跑對帳只會得到假警報。實測：metadata 174/174、goal_box 70/70、
    # errata 69/69、self_check_before_reading 58/58 課皆無節名。
    LESSON_LEVEL = {
        "lesson", "metadata", "errata",
        "goal_box", "self_check_before_reading", "multi_text_parts", "cross_text_banner",
    }
    produced = sorted(p for p in out.glob("*.yml") if not p.name.startswith("_"))
    if not produced:
        print(f"⛔ {out} 一份 yml 都沒有 —— 那是抽失敗，不是零模組", file=sys.stderr)
        return 2

    print(f"  {uid}：收到 {len(produced)} 份 yml")
    worst = 0
    unverifiable_mods: list[str] = []
    for f in produced:
        mod = f.stem
        # schema
        sf = SCHEMAS / f"{mod}.schema.json"
        if sf.is_file():
            try:
                from jsonschema import Draft7Validator
                bms = _load("build_module_schemas")
                doc = yaml.safe_load(f.read_text(encoding="utf-8")) or {}
                body = bms.payload_of(doc, mod) if isinstance(doc, dict) else {}
                errs = sorted(Draft7Validator(json.loads(sf.read_text())).iter_errors(body),
                              key=str)
                _step(f"{mod} · schema", not errs,
                      errs[0].message[:70] if errs else "")
                worst = max(worst, 1 if errs else 0)
            except Exception as exc:  # noqa: BLE001
                # 檢查自己壞掉要說出來，不可以當成通過
                _step(f"{mod} · schema", False, f"檢查失敗：{exc}")
                worst = max(worst, 2)
        else:
            _step(f"{mod} · schema", False, "沒有 schema 可驗（不是通過）")
            worst = max(worst, 2)

        # 必要欄位：schema 的 required 只要求最低限度，擋不住「少抽了一欄」。
        # L0011 實跑時 key_reading 沒抽 passage，八道門全綠 —— 而少了它
        # lesson_uid_loader 會丟掉整個模組，學生那一步直接不見。
        rf = subprocess.run(
            [sys.executable, str(REPO / "scripts" / "essential_fields_check.py"),
             # ⭐ 讀**這一輪的產出**，不是語料庫 —— 不傳 --dir 的話它會去驗舊資料，
             #    對新抽的東西一句話都沒說（實測踩過：我那份沒有 passage 卻回 ✅）
             "--uid", uid, "--dir", str(out)],
            capture_output=True, text=True, timeout=120,
        )
        if rf.returncode == 1 and f"/{mod}:" in rf.stdout:
            line = next((l.strip() for l in rf.stdout.split("\n")
                         if f"/{mod}:" in l), "少了必要欄位")
            _step(f"{mod} · 必要欄位", False, line[:70])
            worst = max(worst, 1)
        elif rf.returncode == 0:
            _step(f"{mod} · 必要欄位", True, "")

        # ⑥b 見證對帳
        if mod in LESSON_LEVEL:
            _step(f"{mod} · 見證對帳", True, "課級檔，沒有大題（不適用）")
            continue
        # ⛔ 不要在這裡自己判斷「驗不驗得了」—— 那是對帳門的職責。
        # 原本這裡在沒有節名時直接報紅，於是 keypoints 那種本來就沒有題號的模組
        # 被判成失敗（L0029）。判斷集中在門裡面，這裡只負責叫它。
        sec, pages = sections.get(mod), dispatch_pages.get(mod)
        if not (sec and pages):
            import importlib.util as _il
            _sp = _il.spec_from_file_location("wrg", REPO / "scripts" / "witness_reconcile_gate.py")
            _w = _il.module_from_spec(_sp); _sp.loader.exec_module(_w)
            if mod not in _w.NUMBERED_MODULES:
                _step(f"{mod} · 見證對帳", True, "非題號型模組（不適用）")
                continue
        if sec and pages:
            r = subprocess.run(
                [sys.executable, str(REPO / "scripts" / "witness_reconcile_gate.py"),
                 "--uid", uid, "--module", mod, "--pdf", str(pdf),
                 "--section", sec, "--yaml", str(f),
                 "--pages", ",".join(str(p) for p in pages)],
                capture_output=True, text=True, timeout=300,
            )
            tail = [l for l in (r.stdout + r.stderr).strip().split("\n") if l.strip()]
            # exit 2 = 這道門在這一頁上沒有判斷力（pdftotext 還原不出版面順序），
            # 不是「抽錯了」。⛔ 印成 🔴 會讓人以為那課壞了。
            _step(f"{mod} · 見證對帳", r.returncode == 0,
                  (tail[-1][:70] if tail else ""),
                  unverifiable=(r.returncode == 2))
            worst = max(worst, r.returncode)
            if r.returncode == 2:
                unverifiable_mods.append(mod)
        else:
            _step(f"{mod} · 見證對帳", False, "派工單沒有節名或頁碼，驗不了",
                  unverifiable=True)
            worst = max(worst, 2)
            unverifiable_mods.append(mod)

    if worst == 0:
        print("\n  ✅ 全部通過")
    elif worst == 1:
        print(f"\n  🔴 有門判定**對不上**（exit 1）")
    else:
        # 只有「驗不了」時要講清楚 —— 那不是缺陷
        print(f"\n  🟡 沒有任何一道門說它壞了，但 {len(unverifiable_mods)} 個模組"
              f"**驗不了**（exit 2）：{', '.join(unverifiable_mods) or '—'}")
        print("     ⛔ 這不是通過，也不是抽錯了。要驗只能換做法或人工看。")
    return worst


def main() -> int:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p1 = sub.add_parser("plan", help="派工前：轉檔 + 對帳 + 印派工單")
    p1.add_argument("--uid", required=True)
    p1.add_argument("--json", action="store_true")
    p1.add_argument("--workdir", type=pathlib.Path, default=None)
    p1.add_argument("--refresh-pages", action="store_true",
                    help="⑤ 對不上時自己重算頁碼再試一次（②不穩的常態解）")
    p2 = sub.add_parser("verify", help="飛機交件後：schema + 見證對帳")
    p2.add_argument("--uid", required=True)
    p2.add_argument("--out", required=True, type=pathlib.Path)
    p2.add_argument("--workdir", type=pathlib.Path, default=None)
    a = ap.parse_args()
    if a.cmd == "plan":
        return plan(a.uid, a.json, a.workdir, a.refresh_pages)
    return verify(a.uid, a.out, a.workdir)


if __name__ == "__main__":
    sys.exit(main())
