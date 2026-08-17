#!/usr/bin/env python3
"""把多模態抽取的整份 YAML 拆成「一個大題一份」的模組檔

為什麼要拆
----------
學習單本身就是一題一模組。舊結構把三個大題（語詞我最棒／閱讀理解／知識補給站）
擠進 `sections.yml`，而語詞應用、詞語複習連檔案都沒有 —— 抽取器抽不到那兩節，
不只是規則寫錯，是**連放的地方都沒有**。

不用數字前綴命名：文言文的大題集合完全不同（文白句子比對／文白詞語比對／自我挑戰），
序號對不上。大題序號寫在檔案裡的 `section_no`。

用法：
    python3 scripts/split_lesson_modules.py \
        --src qa/content-evidence/2026-08-17-ab-L0002/new.yml \
        --out backend/data/lessons/L0002/v3
    python3 scripts/split_lesson_modules.py --all --version v3
"""
from __future__ import annotations

import argparse
import hashlib
import subprocess
import sys
from pathlib import Path

import yaml

REPO = Path(__file__).resolve().parent.parent

# 來源 key → (模組名, **預設**大題序號)。模組名同時是檔名與檔案內層的 key ——
# 兩者不一致等於又造一個「檔名說一件事、內容說另一件事」的坑（#2641 同型）。
# 序號 None = 不是大題（身分／課級屬性）。
#
# ⚠️ 這裡的序號只是**沒有資料時的退路**，真正的序號一律以該課的 `sections_present`
#    為準。原因：大題順序不是固定的 —— 實測 175 份原稿，**70 課重點表在前、
#    39 課聚光燈在前**（其餘 66 課缺其中一節）。寫死常數對那 39 課會把
#    `section_no` 標反（keypoints 標成五、spotlight 標成六，而學習單印的相反）。
#    四成不是例外，是另一種常態。
MODULES: dict[str, tuple[str, str | None]] = {
    "lesson":            ("lesson", None),
    "metadata":          ("metadata", None),
    "source_errata":     ("errata", None),
    # ⚠️ 不叫 body：那是 HTML 詞彙，說不出它在學習單上是哪一大題。
    # 對齊既有前端元件 FullTextAnnotate.tsx。
    "body":              ("full_text_annotate", "一"),
    "key_reading":       ("key_reading", "二"),
    "vocab_definitions": ("vocab_definitions", "三"),
    "vocab_application": ("vocab_application", "四"),
    "keypoints":         ("keypoints", "五"),
    "spotlight":         ("spotlight", "六"),
    "comprehension":     ("comprehension", "七"),
    "vocab_review":      ("vocab_review", "八"),
    "resources":         ("resources", "九"),
    # 以下三個是學習單上真的印出來的小節，但不佔大題號。2026-08-18 之前
    # 它們不在這張表裡，所以**整節被靜默丟掉** —— 15 課受影響，而七道門全綠
    # （門都在比 top-level key 更低的層級看東西）。現由 orphan_key_gate.py 守。
    "goal_box":          ("goal_box", None),                    # 開頭的「目標策略」框
    "self_check_before_reading": ("self_check_before_reading", None),  # 讀前自我檢核清單
    "writing_practice":  ("writing_practice", None),            # 「寫一寫」抄寫練習
    # 文言文專屬（大題集合與白話課不同）
    "intro_guide":       ("intro_guide", None),
    "modern_translation": ("modern_translation", None),
    "classical_text":    ("classical_text", None),
    "sentence_matching": ("sentence_matching", "一"),
    "word_matching":     ("word_matching", "二"),
    "self_challenge":    ("self_challenge", "六"),
}

# meta 底下的欄位怎麼分到 lesson.yml / metadata.yml
LESSON_FIELDS = {"lesson_uid", "catalog_slot", "title"}


SOT = REPO / "private/curriculum-source/_SOT"


def _drive_path(uid: str) -> str | None:
    """這一課的原稿在 SOT 底下的相對路徑（沿用 v2 記的，那是同一份教材）。"""
    for v in ("v3", "v2"):
        f = REPO / f"backend/data/lessons/{uid}/{v}/lesson.yml"
        if not f.is_file():
            continue
        dp = ((yaml.safe_load(f.read_text(encoding="utf-8")) or {}).get("source") or {}).get("drive_path")
        if dp:
            return dp
    return None


def _verified_docx_md5(drive_path: str | None, src_yaml: Path) -> str | None:
    """原稿指紋，**逐字門通過才蓋**。

    ⚠️ 只記不驗會造出假的新鮮感：教材更新後重新拆一次模組，就會把**新**原稿的
    指紋蓋到**舊**抽取結果上，於是那一課看起來是最新的，實際內容來自作廢的版本。
    2026-08-17 我就是這樣差點把 L0124 標成新鮮的。

    驗不過就回 None（欄位留空），代表「這份抽取跟現在的原稿對不上」——
    空著比蓋一個錯的指紋安全得多。
    """
    if not drive_path:
        return None
    p = SOT / drive_path
    if not p.is_file():
        # 檔名有全形/半形差異（`新奇!` vs `新奇！`），用課號前綴補救
        cands = list((SOT / Path(drive_path).parent).glob(f"{Path(drive_path).name[:6]}*.docx"))
        if len(cands) != 1:
            return None
        p = cands[0]
    gate = subprocess.run(
        [sys.executable, str(REPO / "scripts/verbatim_gate.py"),
         "--yaml", str(src_yaml), "--docx", str(p)],
        capture_output=True, text=True,
    )
    if "VERBATIM_GATE=PASS" not in gate.stdout:
        return None
    # ⚠️ 只取前 12 碼，而且**不能**留完整的 32 位 hex：那個長度的 hex 跟
    #    LINE channel secret / Azure key 同形狀，pre-commit 的祕密掃描器會把
    #    每一課的 lesson.yml 都判成外洩，整批 commit 全被擋（加前綴沒用，
    #    它抓的是 hex 本身）。
    #    12 碼 = 48 bit，對「這個 docx 有沒有被改過」綽綽有餘 —— 這裡要偵測的是
    #    出版方改稿，不是對抗刻意製造碰撞的人。
    return "md5-12:" + hashlib.md5(p.read_bytes()).hexdigest()[:12]


# `sections_present[].name` 上的大題名 → 模組名。抽取者照教材抄名字，
# 而教材的用字有幾種寫法，所以用「包含」比對而不是全等。
SECTION_NAME_TO_MODULE = [
    ("讀全文", "full_text_annotate"),
    ("念順順", "key_reading"),
    ("語詞我最棒", "vocab_definitions"),
    ("語詞應用", "vocab_application"),
    ("文章重點表", "keypoints"),
    ("重點表", "keypoints"),
    ("聚光燈", "spotlight"),
    ("閱讀理解", "comprehension"),
    ("詞語複習", "vocab_review"),
    ("知識補給站", "resources"),
    ("語詞書寫", "writing_practice"),
]


def _printed_section_numbers(data: dict) -> dict[str, str]:
    """模組名 → 教材**印出來**的大題序號。

    這是 `section_no` 的唯一正確來源。常數表只是退路 —— 大題順序在這批教材裡
    不固定（70 課重點表在前、39 課聚光燈在前），寫死會有四成標反。
    """
    out: dict[str, str] = {}
    for row in data.get("sections_present") or []:
        if not isinstance(row, dict):
            continue
        no = row.get("no") or row.get("No")
        name = str(row.get("name") or "")
        if no in (None, "", True, False) or not name:
            continue
        for needle, mod in SECTION_NAME_TO_MODULE:
            if needle in name:
                out.setdefault(mod, str(no))
                break
    return out


def _derive(data: dict) -> None:
    """補上「抽取時記了做法、但消費端要成品」的欄位。

    多模態抽取忠實記下教材寫的東西（念順順說「從第四段開始讀」），但 API 要的是
    **那段文字本身**。這裡從已抽到的內容推導，而不是回頭叫抽取器重抄一次 ——
    重抄會多一次出錯機會，而且逐字門已經驗過段落是對的。
    """
    body = data.get("body") or {}
    paras = [
        (p.get("text") if isinstance(p, dict) else p)
        for p in (body.get("paragraphs") or [])
    ]

    if paras and not body.get("char_count"):
        body["char_count"] = sum(len(p or "") for p in paras)

    kr = data.get("key_reading")
    if isinstance(kr, dict) and not kr.get("passage"):
        spans = kr.get("spans_paragraphs") or (
            [kr["start_paragraph"]] if kr.get("start_paragraph") else []
        )
        # 段號是 1-based（教材印的段號），paras 是 0-based
        picked = [paras[i - 1] for i in spans if isinstance(i, int) and 1 <= i <= len(paras)]
        if picked:
            kr["passage"] = "".join(picked)
            kr["start_text"] = picked[0][:24]
            kr["extent_chars"] = len(kr["passage"])
            kr["source"] = "derived-from-body"


def split(src: Path, out: Path, version: str, dry: bool) -> list[str]:
    data = yaml.safe_load(src.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise SystemExit(f"⛔ {src} 不是 mapping")

    meta = data.get("meta") or {}
    uid = meta.get("lesson_uid")
    if not uid:
        raise SystemExit(f"⛔ {src} 缺 meta.lesson_uid —— 沒有身分就不知道要放哪")

    # 教材上實際有哪些大題，是這一課的結構事實，值得單獨留一份
    written: list[str] = []
    payloads: dict[str, dict] = {}

    # 抽取當下原稿的 MD5。教材會被案主更新，而**更新過的抽取結果沒有任何徵兆**：
    # 逐字門比對的是本機那份原稿，同步之後它就跟著變成新的，一樣是綠的。
    # 把當時的指紋記在這裡，過期就變成 O(1) 查得到（scripts/sot_drift_check.py）。
    drive_path = _drive_path(uid)
    payloads["lesson.yml"] = {
        "lesson_uid": uid,
        "version_id": version,
        **{k: meta[k] for k in ("title", "catalog_slot") if k in meta},
        "sections_present": data.get("sections_present") or [],
        "source": {"extracted_by": "extract-lesson-multimodal",
                   "pdf_pages": meta.get("pdf_pages"),
                   "drive_path": drive_path,
                   "docx_md5": _verified_docx_md5(drive_path, src)},
    }
    payloads["metadata.yml"] = {
        "lesson_uid": uid,
        "version_id": version,
        **{k: v for k, v in meta.items() if k not in LESSON_FIELDS | {"pdf_pages"}},
    }

    _derive(data)

    printed = _printed_section_numbers(data)

    for key, (mod, default_no) in MODULES.items():
        if key in ("lesson", "metadata"):
            continue
        if key not in data or data[key] in (None, [], {}):
            continue
        payload: dict = {"lesson_uid": uid, "version_id": version}
        # 教材印的號碼優先；沒印才退回預設
        no = printed.get(mod, default_no)
        if no:
            payload["section_no"] = no
        # 內層 key == 模組名 == 檔名（去掉 .yml）
        payload[mod] = data[key]
        payloads[f"{mod}.yml"] = payload

    for fname, payload in payloads.items():
        written.append(fname)
        if dry:
            continue
        out.mkdir(parents=True, exist_ok=True)
        (out / fname).write_text(
            yaml.dump(payload, allow_unicode=True, sort_keys=False, width=10_000),
            encoding="utf-8",
        )
    return written


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", type=Path)
    ap.add_argument("--out", type=Path)
    ap.add_argument("--all", action="store_true",
                    help="掃 qa/content-evidence 下所有 new.yml / truth.yml")
    ap.add_argument("--version", default="v3")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    jobs: list[tuple[Path, Path]] = []
    if a.all:
        # 抽取結果的正式落點。`qa/content-evidence/*/new.yml` 是 A/B 實驗期間的
        # 過渡命名 —— 實驗結束後還叫 "new" 等於把臨時詞彙當永久。
        for p in sorted((REPO / "backend/data/lessons/_extracted").glob("*.yml")):
            data = yaml.safe_load(p.read_text(encoding="utf-8"))
            uid = ((data or {}).get("meta") or {}).get("lesson_uid")
            if uid:
                jobs.append((p, REPO / "backend/data/lessons" / uid / a.version))
    elif a.src and a.out:
        jobs.append((a.src, a.out))
    else:
        raise SystemExit("⛔ 需要 --src + --out，或 --all")

    if not jobs:
        print("⛔ 沒有任何來源 —— 視為失敗（別讓空跑看起來像成功）")
        return 1

    for src, out in jobs:
        files = split(src, out, a.version, a.dry_run)
        tag = "（dry-run）" if a.dry_run else ""
        print(f"{out.parent.name} → {len(files)} 個模組{tag}: {' '.join(sorted(files))}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
