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


def _step(n: str, ok: bool, detail: str = "") -> None:
    print(f"  {'✅' if ok else '🔴'} {n}{('  ' + detail) if detail else ''}")


def plan(uid: str, as_json: bool, workdir: pathlib.Path | None) -> int:
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
    if r.returncode != 0:
        if not as_json:
            _step("⑤ PDF 對帳", False, r.stdout.strip().split("\n")[0][:80])
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

    produced = sorted(p for p in out.glob("*.yml") if not p.name.startswith("_"))
    if not produced:
        print(f"⛔ {out} 一份 yml 都沒有 —— 那是抽失敗，不是零模組", file=sys.stderr)
        return 2

    print(f"  {uid}：收到 {len(produced)} 份 yml")
    worst = 0
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

        # ⑥b 見證對帳
        sec, pages = sections.get(mod), dispatch_pages.get(mod)
        if sec and pages:
            r = subprocess.run(
                [sys.executable, str(REPO / "scripts" / "witness_reconcile_gate.py"),
                 "--uid", uid, "--module", mod, "--pdf", str(pdf),
                 "--section", sec, "--yaml", str(f),
                 "--pages", ",".join(str(p) for p in pages)],
                capture_output=True, text=True, timeout=300,
            )
            tail = [l for l in (r.stdout + r.stderr).strip().split("\n") if l.strip()]
            _step(f"{mod} · 見證對帳", r.returncode == 0,
                  (tail[-1][:70] if tail else "")) 
            worst = max(worst, r.returncode)
        else:
            _step(f"{mod} · 見證對帳", False, "派工單沒有節名或頁碼，驗不了")
            worst = max(worst, 2)

    print(f"\n  {'✅ 全部通過' if worst == 0 else '🔴 有門沒過（exit %d）' % worst}")
    return worst


def main() -> int:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p1 = sub.add_parser("plan", help="派工前：轉檔 + 對帳 + 印派工單")
    p1.add_argument("--uid", required=True)
    p1.add_argument("--json", action="store_true")
    p1.add_argument("--workdir", type=pathlib.Path, default=None)
    p2 = sub.add_parser("verify", help="飛機交件後：schema + 見證對帳")
    p2.add_argument("--uid", required=True)
    p2.add_argument("--out", required=True, type=pathlib.Path)
    p2.add_argument("--workdir", type=pathlib.Path, default=None)
    a = ap.parse_args()
    if a.cmd == "plan":
        return plan(a.uid, a.json, a.workdir)
    return verify(a.uid, a.out, a.workdir)


if __name__ == "__main__":
    sys.exit(main())
