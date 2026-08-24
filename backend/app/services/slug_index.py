"""slug → 這個大題在哪裡。QR 短網址的轉址表（#2916）。

## 為什麼要這一層

QR 印在紙上就是永久的。如果紙上印的是 `/learn/20063/key-passage-reading?p=4uee3`，
那就同時把**網域、路由名、課的流水號、篇次**四樣東西焊死在紙上 ——
其中每一樣我們都已經改過或還會改（2026-08-25 查證：step 名改過一次、
`{id}` 是抽取流水號不是課碼、而 PM 在 staging 產的那批 QR 全部指向測試站）。

改成紙上只印一個不帶語意的代號：

    https://<固定入口>/q/9a7x4

掃進來由這張表決定它現在該去哪。代號永不變，目的地是可以隨時改的設定。

⛔ 退役的 slug 永不重用 —— 舊紙本還在教室裡，重用等於把學生送到別的東西。
"""
from __future__ import annotations

import functools
from typing import Any

from .lesson_indexes import build_all_lessons

#: 模組 → 學生要走到的 step id。跟 `scripts/module_entry_gate.py` 的 ENTRY 同一份。
_MODULE_TO_STEP: dict[str, str] = {
    "full_text_annotate": "full-text-annotate",
    "key_reading": "key-passage-reading",
    "vocab_definitions": "vocab-definition",
    "vocab_application": "vocab-application",
    "keypoints": "keypoints-table",
    "comprehension": "comprehension",
    "spotlight": "spotlight",
    "vocab_review": "vocab-review",
    "resources": "knowledge-station",
}


@functools.lru_cache(maxsize=1)
def slug_index() -> dict[str, dict[str, Any]]:
    """全庫的 slug → {lesson_id, lesson_uid, module, step, name, text_ref}。

    來源是每一課的**帳本**（`_manifest.yml`）—— 順序與歸屬都以它為準，
    這裡不自己推導任何東西。
    """
    out: dict[str, dict[str, Any]] = {}
    for l in build_all_lessons():
        # row 上的 `manifest_sections` 就是帳本（`_manifest.yml`）送出來的那一份，
        # 每一列帶 name / type(模組) / slug / text_ref / part。
        for sec in l.get("manifest_sections") or []:
            slug = sec.get("slug")
            mod = sec.get("type")
            if not slug or not mod:
                continue
            step = _MODULE_TO_STEP.get(mod)
            if not step:
                continue
            out[slug] = {
                "lesson_id": l["id"],
                "lesson_uid": l.get("lesson_uid"),
                "grade_code": l.get("grade_code"),
                "title": l.get("title"),
                "module": mod,
                "step": step,
                "name": sec.get("name"),
                "part": sec.get("part"),
                "text_ref": sec.get("text_ref"),
            }
    return out


def resolve(slug: str) -> dict[str, Any] | None:
    """一個 slug 現在該去哪；查不到回 None（呼叫端要給誠實的空狀態，不要 404 裸奔）。"""
    return slug_index().get((slug or "").strip())


def target_path(entry: dict[str, Any]) -> str:
    """這個大題的頁面路徑。一課多篇時帶 `?p=` 圈起它所屬的那一輪。"""
    p = f"/learn/{entry['lesson_id']}/{entry['step']}"
    ref = entry.get("text_ref")
    if isinstance(ref, str) and ref:
        p += f"?p={ref}"
    return p
