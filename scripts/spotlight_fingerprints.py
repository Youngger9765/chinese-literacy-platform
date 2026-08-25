#!/usr/bin/env python3
"""聚光燈結構指紋 — 全 175 課的回歸 ratchet (#2727).

WHY THIS REPLACES THE dev7 / test15 FIXTURES
--------------------------------------------
The gate compared seven checked-in first-edition lessons against
`backend/data/lessons/spotlight/dev7/gold_manifest.json`. The re-ink deleted that whole
directory on purpose — those fixtures are keyed by first-edition lesson codes, which is
the identity the re-ink removed. So the gate has been exiting 1 on a FileNotFoundError
ever since, and nothing was running it: `content_evidence_gate` / `run_spotlight_dev_gate`
appear in no workflow and in no `specs/run-ci.sh`.

Seven lessons was also the wrong shape of coverage now. The fingerprint is cheap —
`fingerprint_spotlight` already existed and is reused unchanged — so this covers all 175
rather than a sample, keyed by `lesson_uid`.

WHAT A FINGERPRINT IS, AND WHY NOT A JUDGE
------------------------------------------
Structure only: strategy_type, block count, the histogram and sequence of block types,
question/guide/passage counts, null answers, MCQ leakage. Deterministic — the same tree
gives the same bytes, so a diff is a real change and never a model's mood. A vision judge
over rendered pages answers a different question (is this CONTENT right) and cannot be
compared across runs without manufacturing regressions in lessons nobody touched.

It cannot see a wrong sentence inside a block. It is not meant to: it is the ratchet that
says 「something moved」 before a full rebuild lands, which is exactly the guard that was
missing while #2713 and #2714 both plan to rebuild all 175.

Usage:
    python3 scripts/spotlight_fingerprints.py --write     # regenerate after an intended change
    python3 scripts/spotlight_fingerprints.py --check     # gate: exit 1 on any drift
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "backend"))

LESSONS_ROOT = REPO_ROOT / "backend" / "data" / "lessons"
FINGERPRINTS = REPO_ROOT / "backend" / "data" / "spotlight_fingerprints.json"


def _spotlight_files(vdir) -> list:
    """這個版本目錄裡的聚光燈，照帳本順序（#2916）。

    檔名帶各自的 slug，所以字母序是隨機的；帳本 `_manifest.yml` 才有真正的順序。
    沒有帳本時退回檔名序 —— 那時只有一份，順序沒有意義。
    """
    import yaml

    files = sorted(vdir.glob("spotlight.*.yml"))
    if len(files) < 2:
        return files
    man = vdir / "_manifest.yml"
    if not man.is_file():
        return files
    doc = yaml.safe_load(man.read_text(encoding="utf-8")) or {}
    order = [s.get("file") for s in (doc.get("sections") or []) if s.get("module") == "spotlight"]
    return sorted(files, key=lambda f: order.index(f.name) if f.name in order else 10 ** 6)


def _current() -> dict[str, dict]:
    """Fingerprint every lesson that has a spotlight, keyed by uid.

    ⚠️ Only the version the loader serves — the highest `v*` directory — not whichever
    version happens to sort last among the files that exist (#2747). The two are not the
    same: seven lessons have a `v2/spotlight.yml` and no `v3/` one, and `v3` is what is
    served. Globbing `*/v*/spotlight.yml` and letting the last write win fingerprinted
    that v2 file, so five lessons sat green in this ratchet against a spotlight no
    student can reach, while their step rendered its empty state.
    """
    import yaml

    from app.services.lesson_uid_loader import _latest_version, _is_uid_dir
    from app.services.spotlight_contract import fingerprint_spotlight

    out: dict[str, dict] = {}
    for uid_dir in sorted(p for p in LESSONS_ROOT.iterdir() if _is_uid_dir(p)):
        uid = uid_dir.name
        vdir = _latest_version(uid_dir)
        # 檔名現在是 `spotlight.{自己的 slug}.yml`（#2916），而且一課可能有好幾份 ——
        # 一份學習單印了兩篇課文時，每篇各有自己的聚光燈（L0111 就是）。
        # 順序照帳本，不照檔名字母序：檔名是不透明 id，字母序沒有意義。
        paths = _spotlight_files(vdir) if vdir else []
        if not paths:
            # Absent in the served version is itself a state worth recording: it is how
            # those seven lessons look to a student, and a lesson that starts or stops
            # having a spotlight is movement this ratchet must report.
            out[uid] = None
            continue
        # 一課好幾份時（多篇課每篇一份，#2916），把 blocks 照帳本順序串成一條，
        # 指紋仍然是**一個 dict**。
        #
        # 一開始寫成清單，形狀誠實但破壞了「每課一個 dict」的契約 ——
        # `curriculum_qa_spotlight._entry` 立刻 `TypeError: unhashable type: dict`。
        # 那個崩潰發生在「偵測到有東西動了」之後的報告階段，看起來像工具壞掉、
        # 不像內容變了。契約不該為了一課的新形狀而改，串起來一樣抓得到變動：
        # 任何一篇的 block 增減或改順序都會讓串起來的序列不同。
        blocks = []
        strategy = None
        for path in paths:
            doc = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
            spotlight = doc.get("spotlight") or {}
            blocks.extend(spotlight.get("blocks") or [])
            strategy = strategy or spotlight.get("strategy_type")
        # A lesson whose extraction failed is stored as {lesson, error} and has no
        # blocks. Recorded with a null fingerprint rather than skipped: going from
        # failed to extracted, or back, is exactly the kind of movement worth catching,
        # and skipping would make a lesson that stopped extracting look untouched.
        out[uid] = (
            fingerprint_spotlight({"strategy_type": strategy, "blocks": blocks})
            if blocks else None
        )
    return out


def _stored() -> dict[str, dict]:
    if not FINGERPRINTS.exists():
        raise SystemExit(
            f"no fingerprint baseline at {FINGERPRINTS.relative_to(REPO_ROOT)} — "
            f"run with --write once to create it.\n"
            f"⛔ Do NOT make a missing baseline pass silently. That is the defect this "
            f"file replaces: `content_evidence_gate._per_lesson_golden` returns None when "
            f"the golden is absent, and a lesson with no baseline is then indistinguishable "
            f"from a lesson that passed."
        )
    return json.loads(FINGERPRINTS.read_text(encoding="utf-8"))["lessons"]


def check() -> int:
    cur, old = _current(), _stored()

    gone = sorted(set(old) - set(cur))
    new = sorted(set(cur) - set(old))
    moved = sorted(uid for uid in set(cur) & set(old) if cur[uid] != old[uid])

    if not (gone or new or moved):
        print(f"SPOTLIGHT_FINGERPRINT_GATE=PASS  {len(cur)} lessons, none moved")
        return 0

    print("SPOTLIGHT_FINGERPRINT_GATE=FAIL", file=sys.stderr)
    if gone:
        print(f"  {len(gone)} lessons disappeared: {gone[:8]}", file=sys.stderr)
    if new:
        print(f"  {len(new)} lessons appeared: {new[:8]}", file=sys.stderr)
    for uid in moved[:6]:
        a, b = old[uid], cur[uid]
        if a is None or b is None:
            print(f"  {uid}: {'lost its spotlight' if b is None else 'gained a spotlight'}",
                  file=sys.stderr)
            continue
        # 多篇課的指紋是一份清單（一篇一個，#2916）。逐欄比對只對單份成立 ——
        # 之前這裡直接 `set(a) | set(b)`，遇到清單會 TypeError 掛掉，
        # 而那是這道門「發現有東西動了」之後才走的路：門會在報告階段死掉，
        # 看起來像工具壞了而不是內容變了。
        if isinstance(a, list) or isinstance(b, list):
            na = len(a) if isinstance(a, list) else (0 if a is None else 1)
            nb = len(b) if isinstance(b, list) else (0 if b is None else 1)
            if na != nb:
                print(f"  {uid}: 聚光燈份數 {na} → {nb}（多篇課每篇一份）", file=sys.stderr)
            else:
                print(f"  {uid}: {nb} 份聚光燈，內容有變", file=sys.stderr)
            continue
        diff = {k: (a.get(k), b.get(k)) for k in set(a) | set(b) if a.get(k) != b.get(k)}
        # type_sequence is long and its own summary; block_count already says it moved.
        diff.pop("type_sequence", None)
        print(f"  {uid}: {diff}", file=sys.stderr)
    if len(moved) > 6:
        print(f"  … and {len(moved) - 6} more moved", file=sys.stderr)
    print(
        "\n  If the change was intended, regenerate with --write and say WHY in the "
        "commit. A ratchet that is re-baselined without a reason is not a ratchet.",
        file=sys.stderr,
    )
    return 1


def write() -> int:
    cur = _current()
    have = sum(1 for v in cur.values() if v)
    FINGERPRINTS.write_text(
        json.dumps(
            {
                "description": (
                    "Structural fingerprints for every lesson's spotlight. Regenerate "
                    "with scripts/spotlight_fingerprints.py --write and state why."
                ),
                "lesson_count": len(cur),
                "with_spotlight": have,
                "lessons": dict(sorted(cur.items())),
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"  wrote {len(cur)} lessons ({have} with a spotlight) → "
          f"{FINGERPRINTS.relative_to(REPO_ROOT)}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args()
    if a.write == a.check:
        ap.error("pass exactly one of --write / --check")
    return write() if a.write else check()


if __name__ == "__main__":
    sys.exit(main())
