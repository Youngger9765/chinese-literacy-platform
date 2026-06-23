"""Title-anchored content recovery mappings for Issue #2397."""

from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Any

from app.services.lesson_code_normalization import normalize_manifest_code


_REPO_ROOT = Path(__file__).resolve().parent.parent.parent
_MAPPING_PATH = _REPO_ROOT / "data" / "curriculum_qa" / "correct-mapping.json"


def _normalize_text(value: str | None) -> str:
    text = (value or "").strip()
    text = text.replace("祕", "秘").replace("臺", "台")
    text = re.sub(r"\s+", "", text)
    text = re.sub(r"[，。、「」『』（）()—─…:：!?！？\-\u3000]", "", text)
    return text


@lru_cache(maxsize=1)
def _load_mapping() -> dict[str, Any]:
    if not _MAPPING_PATH.exists():
        return {}
    return json.loads(_MAPPING_PATH.read_text(encoding="utf-8"))


def _keywords_match(blob: str, required_keywords: list[str] | None) -> bool:
    if not required_keywords:
        return True
    normalized_blob = _normalize_text(blob)
    return all(_normalize_text(keyword) in normalized_blob for keyword in required_keywords)


def get_spotlight_source_code(lesson_code: str, lesson_title: str | None = None) -> str | None:
    mapping = _load_mapping().get("spotlight", {})
    code = normalize_manifest_code(lesson_code)
    entry = mapping.get(code)
    if not isinstance(entry, dict):
        return None

    title_anchor = _normalize_text(entry.get("title_anchor", ""))
    normalized_title = _normalize_text(lesson_title)
    if title_anchor and normalized_title and title_anchor not in normalized_title:
        return None

    return normalize_manifest_code(entry.get("source_code", ""))


def get_story_structure_override(lesson_code: str, lesson_title: str | None = None) -> dict | None:
    mapping = _load_mapping().get("story_structure", {})
    code = normalize_manifest_code(lesson_code)
    entry = mapping.get(code)
    if not isinstance(entry, dict):
        return None

    title_anchor = _normalize_text(entry.get("title_anchor", ""))
    normalized_title = _normalize_text(lesson_title)
    if title_anchor and normalized_title and title_anchor not in normalized_title:
        return None

    rel_path = entry.get("structure_snapshot")
    if not rel_path:
        return None
    snapshot_path = _REPO_ROOT / rel_path
    if not snapshot_path.exists():
        return None

    payload = json.loads(snapshot_path.read_text(encoding="utf-8"))
    rows = payload.get("rows")
    if not isinstance(rows, list) or not rows:
        return None

    if not _keywords_match(json.dumps(payload, ensure_ascii=False), entry.get("required_keywords")):
        return None

    return payload
