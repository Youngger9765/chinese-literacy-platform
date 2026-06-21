"""
spotlight_figure_images.py — derive story.images[] from spotlight_v2 figure blocks.

BlockSequenceRenderer matches figure_label (圖一…) to story.images for GCS URLs.
Catalog lessons often have fig assets in spotlight YAML but empty parsed images[].
"""

from __future__ import annotations

import re
from typing import Any

_CN = ("零", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十")


def figure_label_from_asset(asset: str) -> str | None:
    m = re.search(r"fig(\d+)", asset, re.IGNORECASE)
    if not m:
        return None
    n = int(m.group(1))
    if 1 <= n <= 10:
        return f"圖{_CN[n]}"
    return f"圖{n}"


def images_from_spotlight(spotlight: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not spotlight:
        return []
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for block in spotlight.get("blocks") or []:
        if block.get("type") != "figure":
            continue
        asset = (block.get("asset") or "").strip()
        if not asset:
            continue
        label = figure_label_from_asset(asset)
        bind = block.get("bind_paragraph")
        if not label and bind:
            bm = re.search(r"圖([一二三四五六七八九十\d])", str(bind))
            if bm:
                label = f"圖{bm.group(1)}"
        if not label:
            label = f"圖{len(out) + 1}"
        if label in seen:
            continue
        seen.add(label)
        entry: dict[str, Any] = {
            "filename": asset.split("/")[-1],
            "figure_label": label,
        }
        if bind:
            entry["caption"] = str(bind)[:200]
        out.append(entry)
    return out


def merge_spotlight_images(
    existing: list[dict[str, Any]] | None,
    spotlight: dict[str, Any] | None,
) -> list[dict[str, Any]]:
    """Keep parsed lesson images; fill gaps from spotlight figure assets."""
    base = list(existing or [])
    derived = images_from_spotlight(spotlight)
    if not derived:
        return base
    if not base:
        return derived
    by_label = {
        img.get("figure_label"): img
        for img in base
        if img.get("figure_label")
    }
    for img in derived:
        label = img.get("figure_label")
        if label and label not in by_label:
            by_label[label] = img
    return list(by_label.values())
