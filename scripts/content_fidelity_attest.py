#!/usr/bin/env python3
"""內容忠實度證明：私有側跑逐字比對，產出可被 CI 驗證的證明（#2865 Layer ⑥）。

## 為什麼是「證明」而不是「一道 CI 門」

逐字門要讀原稿 DOCX，而原稿在 `private/curriculum-source/`（不進版控）——
**CI 永遠拿不到**。所以 `verbatim_gate.py` 雖然一直能跑，卻從沒進過 CI，
於是「抄的字對不對」這一層實際上**沒有人在守**：

    有 5 題嗎        ✅ 見證對帳
    欄位齊嗎         ✅ schema
    畫得出來嗎       ✅ render_coverage
    抄的字對嗎       ❌ 沒有人在看   ← 這一層

架構複審的判斷是切成兩個信任區：

```
私有執行器（讀得到原稿）   跑逐字比對 → 產出 attestation
CI（讀不到原稿）           不重跑比對，只驗「有沒有證明、雜湊對不對得上」
```

⇒ CI 的責任是「**沒有證明就不能進**」，不是自己重跑比對。

## 證明裡綁什麼

雜湊必須綁死三邊，任何一邊變了證明就失效：

    docx_sha256   原稿
    yaml_sha256   被檢查的產出
    gate_version  逐字門自己的版本（判準改了，舊證明不算數）

⛔ 少綁任何一個，證明就能被回收利用到不同的內容上 —— 那比沒有證明更糟，
因為它看起來像有守。

## 用法

    # 私有側：對一課的所有模組產證明
    python3 scripts/content_fidelity_attest.py --uid L0072 --docx <原稿.docx>

    # CI 側：驗證明還有效（不需要原稿）
    python3 scripts/content_fidelity_attest.py --verify --uid L0072

exit 0 = 全部通過 / 證明有效
exit 1 = 有對不上的字，或證明失效（內容改過了）
exit 2 = 材料不齊
"""
from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import subprocess
import sys

REPO = pathlib.Path(__file__).resolve().parents[1]
LESSONS = REPO / "backend" / "data" / "lessons"
ATTEST_DIR = REPO / "specs" / "modules" / "fidelity"

#: 逐字門的判準版本。⚠️ 改 verbatim_gate 的判準時**必須**加這個數字 ——
#: 否則舊證明會被當成「用新判準驗過」，而它其實不是。
GATE_VERSION = 1


#: 雜湊只留前 16 個十六進位字元。
#: ⚠️ 為什麼不存整串：完整的 64 字元 sha256 會被 secret 掃描器判成
#: Azure/CircleCI/Linode/LINE 的 token（實測一份證明觸發 62 次警報），
#: 於是每次 commit 都要 bypass —— 而習慣 bypass 就是真 secret 溜進去的方式。
#: 16 個十六進位字元 = 64 bit，對「內容有沒有被改過」這個用途遠遠夠用
#: （它防的是誤改與漂移，不是對抗蓄意偽造）。
HASH_CHARS = 16


def sha(path: pathlib.Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()[:HASH_CHARS]


def vdir(uid: str) -> pathlib.Path | None:
    vs = sorted((p for p in (LESSONS / uid).glob("v*") if p.is_dir()), key=lambda p: p.name)
    return vs[-1] if vs else None


def module_files(uid: str) -> list[pathlib.Path]:
    d = vdir(uid)
    if not d:
        return []
    return sorted(p for p in d.glob("*.yml")
                  if not p.name.startswith("_") and p.stem not in ("lesson", "metadata"))


def attest(uid: str, docx: pathlib.Path) -> int:
    if not docx.is_file():
        print(f"⛔ 讀不到原稿：{docx}", file=sys.stderr)
        return 2
    files = module_files(uid)
    if not files:
        print(f"⛔ {uid} 一份模組 yml 都沒有", file=sys.stderr)
        return 2

    ATTEST_DIR.mkdir(parents=True, exist_ok=True)
    docx_hash = sha(docx)
    results, worst = {}, 0

    for f in files:
        r = subprocess.run(
            [sys.executable, str(REPO / "scripts" / "verbatim_gate.py"),
             "--yaml", str(f), "--docx", str(docx)],
            capture_output=True, text=True, timeout=300,
        )
        out = r.stdout
        passed = "VERBATIM_GATE=PASS" in out
        # 「受檢 0 個字串」不是通過 —— 那是沒驗到。逐字門自己回 1，這裡照收。
        checked = 0
        for line in out.split("\n"):
            if "受檢字串" in line:
                digits = "".join(c for c in line.split("：")[-1] if c.isdigit())
                checked = int(digits) if digits else 0
        results[f.stem] = {
            "yaml_sha256": sha(f),
            "checked": checked,
            "passed": bool(passed),
            "exit": r.returncode,
        }
        if not passed:
            worst = max(worst, 1)
        print(f"  {'✅' if passed else '🔴'} {f.stem:26} 受檢 {checked:3} 字串")

    doc = {
        "uid": uid,
        "gate_version": GATE_VERSION,
        "docx_sha256": docx_hash,
        "modules": results,
    }
    path = ATTEST_DIR / f"{uid}.json"
    path.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    total = sum(m["checked"] for m in results.values())
    print(f"\n  {'✅' if worst == 0 else '🔴'} {uid}：{len(files)} 個模組 · 受檢 {total} 字串"
          f" → {path.relative_to(REPO)}")
    if total == 0:
        print("  ⛔ 一個字串都沒被檢查 —— 那是沒驗到，不是通過", file=sys.stderr)
        return 1
    return worst


def verify(uid: str) -> int:
    """CI 側：不需要原稿，只驗證明還對得上。"""
    path = ATTEST_DIR / f"{uid}.json"
    if not path.is_file():
        print(f"⛔ {uid} 沒有內容忠實度證明（{path.relative_to(REPO)}）\n"
              "   在讀得到原稿的機器上跑：\n"
              f"   python3 scripts/content_fidelity_attest.py --uid {uid} --docx <原稿>",
              file=sys.stderr)
        return 1

    doc = json.loads(path.read_text(encoding="utf-8"))
    if doc.get("gate_version") != GATE_VERSION:
        print(f"⛔ {uid} 的證明是用舊版判準產的"
              f"（證明 v{doc.get('gate_version')} / 現在 v{GATE_VERSION}）—— 要重產",
              file=sys.stderr)
        return 1

    problems = []
    for mod, rec in (doc.get("modules") or {}).items():
        f = (vdir(uid) or pathlib.Path("/nonexistent")) / f"{mod}.yml"
        if not f.is_file():
            problems.append(f"{mod}：證明裡有，但檔案不見了")
            continue
        if sha(f) != rec.get("yaml_sha256"):
            problems.append(f"{mod}：內容改過了，證明失效")
        elif not rec.get("passed"):
            problems.append(f"{mod}：證明記的是**沒通過**")
        elif not rec.get("checked"):
            problems.append(f"{mod}：受檢 0 個字串 —— 那是沒驗到")

    # 反向：有 yml 卻不在證明裡
    covered = set((doc.get("modules") or {}).keys())
    for f in module_files(uid):
        if f.stem not in covered:
            problems.append(f"{f.stem}：沒有被證明涵蓋")

    if problems:
        print(f"🔴 {uid} 的內容忠實度證明不成立：")
        for p in problems:
            print(f"    {p}")
        return 1

    total = sum(m["checked"] for m in doc["modules"].values())
    print(f"✅ {uid} 的內容忠實度證明有效"
          f"（{len(doc['modules'])} 個模組 · 受檢 {total} 字串 · 判準 v{GATE_VERSION}）")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--uid", required=True)
    ap.add_argument("--docx", type=pathlib.Path)
    ap.add_argument("--verify", action="store_true", help="CI 側：只驗證明，不需要原稿")
    a = ap.parse_args()
    if a.verify:
        return verify(a.uid)
    if not a.docx:
        print("⛔ 產證明要給 --docx", file=sys.stderr)
        return 2
    return attest(a.uid, a.docx)


if __name__ == "__main__":
    sys.exit(main())
