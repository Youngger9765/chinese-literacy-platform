"""Regression lock (#2461) — the 5 G8 lettered-slot lessons bind to their
verified catalog spotlight source via correct-mapping.json.

Each pending lesson (G8-L3a/L6a/L9b/L12a/L12b) is a multi-text sibling whose
spotlight strategy lives in the base/companion catalog lesson. Binding is
title-anchored in content_mapping_registry so it cannot leak onto a different
lesson that happens to normalize to the same code.

Sources were verified by reading each catalog spotlight's actual block text:
  G8-L3a 集中營裡的一門課  -> G8-L3  (主旨「外在被奪走，仍能決定態度回應遭遇」/不可逆)
  G8-L6a 甜蜜…農民        -> G8-L7  (可可豆/農民貧困/利潤分配/童工)
  G8-L9b 語言的足跡        -> G8-L12 (明寫「語言的足跡這篇文章」)
  G8-L12a 球場…指揮家      -> G8-L15 (啦啦隊是專業職業)
  G8-L12b 我的阿嬤        -> G8-L16 (作者和阿嬤的關係)
"""

import sys
from pathlib import Path

_BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

import pytest  # noqa: E402

from app.services.content_mapping_registry import get_spotlight_source_code  # noqa: E402
from app.services.spotlight_v2_loader import load_spotlight_v2  # noqa: E402

# (lesson_code, real staging title, expected verified source_code)
BINDINGS = [
    ("G8-L3a", "當壞事已不可逆轉：集中營裡的一門課", "G8-L3"),
    ("G8-L6a", "讓你口中的甜蜜成為遠方農民的希望", "G8-L7"),
    ("G8-L9b", "語言的足跡：從臺北萬華到南太平洋的航海之路", "G8-L12"),
    ("G8-L12a", "球場上的另類指揮家", "G8-L15"),
    ("G8-L12b", "我的阿嬤", "G8-L16"),
]


@pytest.mark.parametrize("code,title,source", BINDINGS)
def test_lettered_slot_binds_to_verified_source(code, title, source):
    assert get_spotlight_source_code(code, title) == source


@pytest.mark.parametrize("code,title,source", BINDINGS)
def test_binding_loads_nonempty_spotlight(code, title, source):
    sv = load_spotlight_v2(code, title)
    assert sv is not None, f"{code} should resolve a spotlight after binding"
    assert sv.get("blocks"), f"{code} spotlight should carry blocks"


@pytest.mark.parametrize("code,title,source", BINDINGS)
def test_title_anchor_blocks_wrong_lesson(code, title, source):
    # A lesson served at the same code key but with an unrelated title must NOT
    # pick up the binding — the title anchor is the anti-cross-binding guard.
    assert get_spotlight_source_code(code, "毫不相關的其他課文標題") is None
