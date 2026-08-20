#!/usr/bin/env python3
"""從 runtime 更新重點表 manifest / snapshot

為什麼不用 build_keypoints_qa_manifest.py
-----------------------------------------
那支要 `private/curriculum-source/_online-schema`，而那個目錄在二修 SOT 收斂時
連同一修素材一起 archive 掉了 —— **它再也跑不起來**，錯誤訊息卻還印著叫人去跑它。

manifest 裡真正被 gate 比對的東西（`layout` = interaction_profile 的四個欄位）
本來就來自 runtime，所以直接從 runtime 取才是現在唯一成立的路徑。
`docx_keypoints` / `known_data_gap` 是舊 pipeline 帶進來的欄位，既有 entry 原樣保留，
不憑空造。

只動「runtime 跟 manifest 對不上」的那幾課，其餘一個字不改 —— 全表重生成會讓
這道 ratchet 變成「拿 runtime 比 runtime 的快照」，恆真，也就不再擋任何事。

用法：
    python3 scripts/refresh_keypoints_manifest.py --check   # 列出會改什麼
    python3 scripts/refresh_keypoints_manifest.py --write
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "scripts"))

QA_ROOT = ROOT / "backend/data/curriculum_qa"
MANIFEST_PATH = QA_ROOT / "keypoints_manifest.json"
SNAPSHOTS_DIR = QA_ROOT / "snapshots"
PROFILE_KEYS = ("mode", "layout", "fill_blank_count", "checkbox_count")


def runtime_profiles() -> dict[str, tuple[dict, dict, dict]]:
    """lesson_id → (profile, 完整 structure, lesson)。用 gate 讀的同一條路徑。"""
    from app.routes.stories import _format_yaml_structure_table, _sanitize_structure_for_client
    from app.services.lesson_code_normalization import normalize_manifest_code
    from app.services.lesson_loader import get_all_lessons
    from story_structure_qa import build_structure_from_lesson, loader_for_parsed_lesson

    lessons_by_code: dict[str, dict] = {}
    for lesson in get_all_lessons():
        code = normalize_manifest_code(lesson.get("grade_code") or lesson.get("lesson_code") or "")
        if code:
            lessons_by_code[code] = lesson

    out: dict[str, tuple[dict, dict, dict]] = {}
    for code, lesson in lessons_by_code.items():
        loader, _catalog = loader_for_parsed_lesson(code, lessons_by_code)
        if not loader:
            continue
        struct = build_structure_from_lesson(
            loader, _format_yaml_structure_table, _sanitize_structure_for_client
        )
        if not struct:
            continue
        prof = struct.get("interaction_profile") or {}
        out[code] = ({k: prof.get(k) for k in PROFILE_KEYS}, struct, lesson)
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--check", action="store_true")
    g.add_argument("--write", action="store_true")
    a = ap.parse_args()

    live = runtime_profiles()
    if not live:
        print("⛔ runtime 一課都讀不到 —— 視為失敗，別讓空跑看起來像成功")
        return 1

    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    entries = manifest.get("lessons") or []
    by_id = {e.get("lesson_id"): e for e in entries}

    changed, added = [], []

    for code, (prof, struct, lesson) in sorted(live.items()):
        entry = by_id.get(code)
        if entry is None:
            # runtime 認得、manifest 沒有 —— 通常是這一課剛翻新到 v3 才被 runtime 收進來
            added.append(code)
            if a.write:
                # 新增的課也要更新它的 snapshot —— 只寫 manifest 不寫 snapshot，
                # gate 下一輪會改抱怨 snapshot 對不上，看起來像沒修好。
                snap_new = SNAPSHOTS_DIR / code / "structure.json"
                if snap_new.is_file():
                    snap_new.write_text(
                        json.dumps(struct, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
                    )
                entries.append({
                    "lesson_id": code,
                    "lesson_uid": lesson.get("lesson_uid"),
                    "title": lesson.get("title"),
                    "layout": prof,
                    "docx_keypoints": None,     # 舊 pipeline 的欄位，沒有來源就留空，不造
                    "overall_pass": True,
                    "known_data_gap": False,
                })
            continue

        recorded = {k: (entry.get("layout") or {}).get(k) for k in PROFILE_KEYS}
        if recorded != prof:
            changed.append(f"{code}: {recorded} → {prof}")
            if a.write:
                entry["layout"] = prof

        snap = SNAPSHOTS_DIR / code / "structure.json"
        if snap.is_file():
            cur = json.loads(snap.read_text(encoding="utf-8"))
            cur_prof = {k: (cur.get("interaction_profile") or {}).get(k) for k in PROFILE_KEYS}
            if cur_prof != prof and a.write:
                snap.write_text(
                    json.dumps(struct, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
                )

    for line in changed:
        print(f"  △ {line}")
    for code in added:
        print(f"  ＋ {code} 新增（runtime 認得，manifest 原本沒有）")

    if a.write:
        summary = manifest.setdefault("summary", {})
        summary["total"] = len(entries)
        # ⚠️ `overall_pass` 有三種值，而 summary 只有兩欄，所以要先問清楚語意：
        #    舊 manifest 是 total=147 / pass=147 / unreviewed=29 —— 也就是
        #    **pass ＝ 沒有已知失敗**（未複核算在裡面），unreviewed 是它的子集。
        #    我第一版照字面把 pass 算成「明確 True 的」，於是 147→119，
        #    契約 `pass == total` 當場紅 —— 不是資料壞了，是我讀錯它的意思。
        summary["pass"] = sum(1 for e in entries if e.get("overall_pass") is not False)
        summary["fail"] = sum(1 for e in entries if e.get("overall_pass") is False)
        summary["unreviewed"] = sum(1 for e in entries if e.get("overall_pass") is None)
        manifest["lessons"] = sorted(entries, key=lambda e: e.get("lesson_id") or "")
        MANIFEST_PATH.write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        print(f"\n寫入 {len(changed)} 筆更新、{len(added)} 筆新增，總計 {len(entries)} 課")
    elif changed or added:
        print(f"\n共 {len(changed)} 筆要更新、{len(added)} 筆要新增（--write 才會改）")
    else:
        print("\nmanifest 與 runtime 一致")
    return 0


if __name__ == "__main__":
    sys.exit(main())
