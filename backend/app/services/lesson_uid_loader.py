"""lesson_uid_loader.py — Phase 3 of the second-edition re-ink (#2692).

Reads the uid tree written by `scripts/build_lesson_uid_tree.py`:

    backend/data/lessons/<lesson_uid>/<version_id>/
        lesson.yml   spotlight.yml   keypoints.yml   assets/

WHY IDENTITY IS THE DIRECTORY NAME
----------------------------------
The loader this replaced merged two historical layers (`L*.yml` hand-built 2026-02,
`_parsed_2026-05-01/` batch-parsed 2026-05) on the lesson TITLE. That join is the
root defect the second-edition re-ink existed to remove: a title differing by one
punctuation mark left the row an empty shell, silently, and 26 lessons were
duplicated across the two layers. Both layers are now deleted.

Identity is the directory name and nothing else. It is never derived from a title
or a lesson code — those are properties, and both change between editions.
"""

from __future__ import annotations

import functools
from pathlib import Path
from typing import Any, Optional

import yaml

# backend/app/services/ → backend/
_BACKEND_ROOT = Path(__file__).resolve().parent.parent.parent
LESSONS_ROOT = _BACKEND_ROOT / "data" / "lessons"

# 一個大題一個模組。舊結構把語詞我最棒／閱讀理解／知識補給站三個大題擠進
# `sections`，而語詞應用、詞語複習連檔案都沒有 —— 抽取器抽不到那兩節，不只是
# 規則寫錯，是連放的地方都沒有。`sections` 留著讀舊版本（v2）。
#
# 文言文的大題集合跟白話課完全不同（文白句子比對／文白詞語比對／自我挑戰，
# 且導讀・古文今譯・原文沒有大題編號），所以那幾個模組也列在這裡；
# 缺檔的課直接跳過，不會因為多列而報錯。
MODULES = (
    # 課級
    "metadata",
    "errata",
    # 白話課大題
    "full_text_annotate",   # 一 讀全文-做記號
    "key_reading",          # 二 念順順
    "vocab_definitions",    # 三 語詞我最棒
    "vocab_application",    # 四 語詞應用
    "keypoints",            # 五 文章重點表
    "spotlight",            # 六 閱讀聚光燈
    "comprehension",        # 七 閱讀理解
    "vocab_review",         # 八 詞語複習
    "resources",            # 九 知識補給站
    # 文言文專屬
    "intro_guide",
    "modern_translation",
    "classical_text",
    "sentence_matching",
    "word_matching",
    "self_challenge",
    # 一般課也有的無編號元素 (#2752 Phase 2) — 目標策略框（70 課）與讀前自我
    # 檢核（58 課），兩者都印在「一 讀全文-做記號」之前，不掛在任何大題編號下。
    "goal_box",
    "self_check_before_reading",
    # 多文本合讀課 + 收尾書寫練習 (#2752 Phase 3)。
    "multi_text_parts",             # 第 2/3 篇（第 1 篇在 full_text_annotate）
    "cross_text_banner",            # 「跨課文習作／三篇合讀」過場字
    "keypoints_followup_questions", # 第一篇專屬追問（兩種形狀，見檔頭 schema_gap）
    "writing_practice",             # 語詞書寫練習／難字挑戰（多為大題九）
)

# ⛔ 不留 v2 的 `sections` / `body` 相容入口。
#
# #2683 刪掉兩個歷史 layer 時寫得很清楚：「both layers are deleted rather than kept
# behind a flag — a compatibility path would have preserved exactly the [problem]」。
# 同一個道理在這裡成立：留著讀舊檔名，會讓一棵只翻新了一部分的樹看起來很健康。
#
# 代價是明擺著的：還沒重抽的課會少掉那幾個大題。那不是要藏起來的事，是要數出來的事
# —— `scripts/module_migration_gate.py` 會列出還停在 v2 的課，數字降到 0 才算翻新完成。


def _is_uid_dir(p: Path) -> bool:
    """A uid dir is `L####` holding at least one `v*` version dir."""
    return (
        p.is_dir()
        and len(p.name) == 5
        and p.name[0] == "L"
        and p.name[1:].isdigit()
        and any(c.is_dir() and c.name.startswith("v") for c in p.iterdir())
    )


def _latest_version(uid_dir: Path) -> Optional[Path]:
    versions = sorted(
        (c for c in uid_dir.iterdir() if c.is_dir() and c.name.startswith("v")),
        key=lambda c: c.name,
    )
    return versions[-1] if versions else None


def _read_yaml(p: Path) -> Any:
    try:
        return yaml.safe_load(p.read_text(encoding="utf-8"))
    except Exception:
        return None


def _drop_assetless_table_figures(spotlight_doc: Any) -> None:
    """Remove figure blocks that point at a table and carry no image (#2455/#2463).

    `{"type": "figure", "referent": "table", "asset": null}` has nothing to render:
    the referent names a table's JSON, which is not an image. The frontend already
    skips them, so today they are invisible rather than broken — but they were only
    ever an extractor artefact, and `inject_per_practice_figures` puts them back
    every time the corpus is rebuilt. 89 of 143 lessons carry them after the
    second-edition rebuild.

    Dropping them here rather than leaning on the frontend guard means anything else
    that reads a spotlight — the eval gates, a future renderer, an export — sees the
    same block list the student does, instead of each consumer needing to know about
    a block type that renders to nothing. Only the assetless ones go: a figure with a
    real asset is a real figure whatever its referent says.
    """
    if not isinstance(spotlight_doc, dict):
        return
    inner = spotlight_doc.get("spotlight")
    target = inner if isinstance(inner, dict) else spotlight_doc
    blocks = target.get("blocks")
    if not isinstance(blocks, list):
        return
    target["blocks"] = [
        b for b in blocks
        if not (
            isinstance(b, dict)
            and b.get("type") == "figure"
            and b.get("referent") == "table"
            and not b.get("asset")
        )
    ]


@functools.lru_cache(maxsize=1)
def available_uids() -> tuple[str, ...]:
    """Every lesson_uid that has at least one version on disk."""
    if not LESSONS_ROOT.exists():
        return ()
    return tuple(sorted(p.name for p in LESSONS_ROOT.iterdir() if _is_uid_dir(p)))


@functools.lru_cache(maxsize=None)
def load_lesson(uid: str, version: Optional[str] = None) -> Optional[dict]:
    """Return the merged lesson dict for a uid, or None.

    `version=None` takes the highest version directory. Fail-closed: a missing
    `lesson.yml` means the directory is half-written and is treated as absent
    rather than served empty.
    """
    uid_dir = LESSONS_ROOT / uid
    if not uid_dir.is_dir():
        return None
    vdir = (uid_dir / version) if version else _latest_version(uid_dir)
    if not vdir or not vdir.is_dir():
        return None

    meta = _read_yaml(vdir / "lesson.yml")
    if not isinstance(meta, dict) or not meta.get("lesson_uid"):
        return None

    lesson: dict[str, Any] = dict(meta)
    lesson["version_id"] = vdir.name
    for mod in MODULES:
        data = _read_yaml(vdir / f"{mod}.yml")
        if not data:
            continue
        if mod == "spotlight":
            _drop_assetless_table_figures(data)
        # v3 的模組檔外層是 `{lesson_uid, version_id, section_no, <mod>: {…}}`。
        # 存包裝而不是內容，會讓每個消費端都要多剝一層 —— 而漏剝的那個不會報錯，
        # 只是欄位查不到（`key_reading.passage` 就是這樣被判定成缺 passage 而整節丟掉）。
        if isinstance(data, dict) and mod in data:
            inner = data[mod]
            if isinstance(inner, (dict, list)):
                if isinstance(inner, dict):
                    inner = {
                        **{k: v for k, v in data.items() if k in ("section_no",)},
                        **inner,
                    }
                lesson[mod] = inner
                continue
        lesson[mod] = data
    # 念順順 carries two things that fail independently: the passage a student reads
    # aloud, and the characters-per-minute target they read it against. #2722 gave the
    # eleven lessons whose passage is withheld a file holding only the target — correct
    # for the index, which gates on `passage`, and a 500 for the detail route, which
    # reads THIS dict and hands `key_reading` straight to a schema whose `passage` is a
    # required str.
    #
    # Split here rather than in either consumer, because both read this function and
    # only one of them was applying the gate.
    kr = lesson.get("key_reading")
    if isinstance(kr, dict):
        if kr.get("reading_benchmark") and not lesson.get("reading_benchmark"):
            lesson["reading_benchmark"] = kr["reading_benchmark"]
        if not kr.get("passage"):
            lesson.pop("key_reading")

    assets = vdir / "assets"
    lesson["assets"] = (
        sorted(p.name for p in assets.iterdir() if p.is_file()) if assets.is_dir() else []
    )
    return lesson


def load_all() -> list[dict]:
    """Every lesson in the tree, latest version each. Skips half-written dirs."""
    out = []
    for uid in available_uids():
        lesson = load_lesson(uid)
        if lesson:
            out.append(lesson)
    return out


def reset_cache() -> None:
    """Test-only: the caches are import-time singletons in production."""
    available_uids.cache_clear()
    load_lesson.cache_clear()
