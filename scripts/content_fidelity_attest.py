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
#: v2（#2720）：`review_reason` 加進 ANNOTATION_KEYS —— 那是我方寫的說明，
#:              不是原稿字串。判準變了，175 課全部重產。
GATE_VERSION = 2


#: 雜湊只留前 16 個十六進位字元。
#: ⚠️ 為什麼不存整串：完整的 64 字元 sha256 會被 secret 掃描器判成
#: Azure/CircleCI/Linode/LINE 的 token（實測一份證明觸發 62 次警報），
#: 於是每次 commit 都要 bypass —— 而習慣 bypass 就是真 secret 溜進去的方式。
#: 16 個十六進位字元 = 64 bit，對「內容有沒有被改過」這個用途遠遠夠用
#: （它防的是誤改與漂移，不是對抗蓄意偽造）。
HASH_CHARS = 16


def sha(path: pathlib.Path) -> str:
    """截短 + 每 4 字元分組。

    🔴 分組不是為了好看。純十六進位串會撞上 secret 掃描器的台灣身分證
    （字母 + 1/2 + 8 位數）與手機號規則 —— 174 份證明裡有十幾個中招。
    ⛔ 正確解法是改格式，不是去 touch bypass marker：習慣繞掃描器，
    真的 secret 遲早會跟著過去。（同一天 build_section_pages.page_print
    也踩過一模一樣的坑，處理方式一致。）
    """
    h = hashlib.sha256(path.read_bytes()).hexdigest()[:HASH_CHARS]
    return "-".join(h[i:i + 4] for i in range(0, len(h), 4))


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
        # ⚠️ 只認機器可讀那一行。刮中文散文那版把每一份都算成 4
        #    （半形冒號沒切到，加上同一行的「≥ 4」）。
        checked = None
        for line in out.split("\n"):
            if line.startswith("VERBATIM_GATE_CHECKED="):
                checked = int(line.split("=", 1)[1])
        if checked is None:
            print(f"  ⛔ {f.stem}：逐字門沒印出受檢數 —— 契約壞了，不當成通過",
                  file=sys.stderr)
            checked, passed = 0, False
        # 🔴 三態，不是兩態。
        #    「一個字串都沒驗到」跟「驗了而且對不上」是兩件完全不同的事，
        #    混成同一個紅燈會產生**沒有人修得掉的紅** —— 22 份 errata 的
        #    原文是單一個字（「五」印成「六」），短於 4 字門檻本來就驗不到，
        #    3 份的錯字印在圖片裡。把它們判 FAIL 不會讓資料變好，只會讓
        #    這道門的紅燈變成背景雜訊，然後真的壞掉那天沒人看。
        #    ⛔ 但也不可以判 PASS —— 那就是把「沒驗」講成「驗過了」。
        status = "pass" if passed else ("unverifiable" if checked == 0 else "fail")

        # errata 專屬補救：原文只有一個字（「五」印成「六」、找字格子某一格）
        # 的勘誤，逐字門的 4 字門檻碰不到 —— 但它們帶著 `locator`，
        # 用**位置**去查就精確驗得到。⛔ 這不是放寬判準，是換一種驗法：
        # 找字格子對 vocab_review.grid[列][欄]、段號對原稿的段號序列。
        # 實測 27 條裡 20 條這樣驗得過、0 條對不上。
        if f.stem == "errata" and status == "unverifiable":
            rl = subprocess.run(
                [sys.executable, str(REPO / "scripts" / "errata_locator_check.py"),
                 "--uid", uid, "--json"],
                capture_output=True, text=True, timeout=180,
            )
            try:
                tal = json.loads(rl.stdout)["tally"]
            except Exception:  # noqa: BLE001
                tal = None
            if tal and tal.get("fail"):
                status, checked = "fail", tal["pass"] + tal["fail"]
            elif tal and tal.get("pass") and not tal.get("unverifiable"):
                status, checked = "pass", tal["pass"]
            elif tal and tal.get("pass"):
                # 有些驗得過、有些仍驗不到 —— 誠實記成部分
                status, checked = "unverifiable", tal["pass"]
        results[f.stem] = {
            "yaml_sha256": sha(f),
            "checked": checked,
            "status": status,
            "passed": status == "pass",     # 舊欄位保留，別讓既有讀者壞掉
            "exit": r.returncode,
        }
        if status == "fail":
            worst = max(worst, 1)
        icon = {"pass": "✅", "fail": "🔴", "unverifiable": "🟡"}[status]
        note = "" if status != "unverifiable" else "  ← 驗不到（原文太短或印在圖上）"
        print(f"  {icon} {f.stem:26} 受檢 {checked:3} 字串{note}")

    doc = {
        "uid": uid,
        "gate_version": GATE_VERSION,
        "docx_sha256": docx_hash,
        "modules": results,
    }
    path = ATTEST_DIR / f"{uid}.json"
    path.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    total = sum(m["checked"] for m in results.values())
    unv = sum(1 for m in results.values() if m["status"] == "unverifiable")
    print(f"\n  {'✅' if worst == 0 else '🔴'} {uid}：{len(files)} 個模組 · 受檢 {total} 字串"
          f"{f' · 🟡 {unv} 個驗不到' if unv else ''} → {path.relative_to(REPO)}")
    if total == 0:
        # 整課一個字串都沒驗到 —— 那不是「這課沒問題」，是這課沒被驗過。
        print("  ⛔ 整課一個字串都沒被檢查 —— 那是沒驗到，不是通過", file=sys.stderr)
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
        elif rec.get("status", "pass" if rec.get("passed") else "fail") == "fail":
            problems.append(f"{mod}：證明記的是**沒通過**")

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
    unv = sum(1 for m in doc["modules"].values() if m.get("status") == "unverifiable")
    print(f"✅ {uid} 的內容忠實度證明有效"
          f"（{len(doc['modules'])} 個模組 · 受檢 {total} 字串"
          f"{f' · 🟡 {unv} 個驗不到' if unv else ''} · 判準 v{GATE_VERSION}）")
    return 0


# ── 全庫驗證（CI 用）─────────────────────────────────────────────────────
# 🔴 這一段存在的理由：門建了沒插電 = 比沒有門更糟，因為大家會以為它在看。
#    attest 只能在讀得到原稿的機器上跑，CI 讀不到 —— 所以 CI 驗的是「證明」。

RATCHET = ATTEST_DIR / "_ratchet.json"


def verify_all() -> int:
    """把每一課的證明都驗一次，並對「驗不到」的數量上棘輪。

    ⛔ 「驗不到」不可以無聲增加 —— 那會讓覆蓋率一點一點漏光，
    而每一次看起來都是綠的。所以記一個上限，只准往下不准往上。
    """
    # 🔴 走**證明檔**不是派工單。走派工單會漏掉「有證明但沒派工單」的課
    #    （實測 L0124 就是），於是這裡數 8、鎖直接數證明檔數 9 ——
    #    同一件事兩個數字。⛔ 棘輪的分母跟鎖的分母必須是同一個集合。
    uids = sorted({p.parent.parent.name for p in LESSONS.glob("L*/v3/_manifest.yml")}
                  | {p.stem for p in ATTEST_DIR.glob("L*.json")})
    missing, broken, unv_total, checked_total = [], [], 0, 0
    for uid in uids:
        path = ATTEST_DIR / f"{uid}.json"
        if not path.is_file():
            missing.append(uid)
            continue
        rc = verify_quiet(uid)
        if rc:
            broken.append(uid)
        doc = json.loads(path.read_text(encoding="utf-8"))
        for m in doc.get("modules", {}).values():
            checked_total += m.get("checked", 0)
            unv_total += m.get("status") == "unverifiable"

    base = json.loads(RATCHET.read_text(encoding="utf-8")) if RATCHET.is_file() else {}
    cap = base.get("unverifiable_max")

    print(f"\n  課數 {len(uids)} · 有證明 {len(uids) - len(missing)}"
          f" · 受檢 {checked_total} 字串 · 🟡 驗不到 {unv_total}")
    bad = False
    if missing:
        print(f"  🔴 {len(missing)} 課沒有證明：{' '.join(missing[:10])}")
        bad = True
    if broken:
        print(f"  🔴 {len(broken)} 課的證明不成立：{' '.join(broken[:10])}")
        bad = True
    if cap is None:
        print("  ⛔ 沒有棘輪基準檔 —— 先跑 --set-ratchet 記一個上限")
        bad = True
    elif unv_total > cap:
        print(f"  🔴 驗不到的從 {cap} 漲到 {unv_total} —— 覆蓋率在漏，不准無聲增加")
        bad = True
    elif unv_total < cap:
        print(f"  ✅ 驗不到的從 {cap} 降到 {unv_total} —— 記得跑 --set-ratchet 收緊")
    return 1 if bad else 0


def verify_quiet(uid: str) -> int:
    import io
    import contextlib
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        return verify(uid)


def set_ratchet() -> int:
    # 同上：走證明檔，跟 verify_all 與鎖同一個集合
    uids = sorted({p.parent.parent.name for p in LESSONS.glob("L*/v3/_manifest.yml")}
                  | {p.stem for p in ATTEST_DIR.glob("L*.json")})
    n = 0
    for uid in uids:
        path = ATTEST_DIR / f"{uid}.json"
        if not path.is_file():
            continue
        doc = json.loads(path.read_text(encoding="utf-8"))
        n += sum(1 for m in doc.get("modules", {}).values()
                 if m.get("status") == "unverifiable")
    RATCHET.write_text(json.dumps({"unverifiable_max": n}, indent=2) + "\n",
                       encoding="utf-8")
    print(f"  棘輪上限設為 {n} → {RATCHET.relative_to(REPO)}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--uid")
    ap.add_argument("--docx", type=pathlib.Path)
    ap.add_argument("--verify", action="store_true", help="CI 側：只驗證明，不需要原稿")
    ap.add_argument("--verify-all", action="store_true", help="CI 側：全庫驗證 + 棘輪")
    ap.add_argument("--set-ratchet", action="store_true", help="把現在的「驗不到」數記成上限")
    a = ap.parse_args()
    if a.set_ratchet:
        return set_ratchet()
    if a.verify_all:
        return verify_all()
    if not a.uid:
        print("⛔ 要給 --uid（或用 --verify-all / --set-ratchet）", file=sys.stderr)
        return 2
    if a.verify:
        return verify(a.uid)
    if not a.docx:
        print("⛔ 產證明要給 --docx", file=sys.stderr)
        return 2
    return attest(a.uid, a.docx)


if __name__ == "__main__":
    sys.exit(main())
