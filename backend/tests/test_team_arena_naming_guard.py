"""PRD §11 "為什麼不用那款遊戲的任何名稱" 的自我檢查: "實作 PR 加一條檢查：
前後端與文件中不得出現該遊戲的名稱、縮寫與公司名（禁用清單放在測試裡，不寫
進對外文案）".

This repo is PUBLIC and aimed at elementary/middle-school students — the
5v5-lane-pushing structure this mode borrows is a specific commercial
game's, and its name/abbreviation/publisher/characters must never appear
in our code, docs, or UI copy. The banned list itself lives here (a test
file), never in any user-facing string, per the PRD's own instruction.
"""
from __future__ import annotations

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]

# Deliberately generic words like "lane"/"support"/"tower" are NOT banned —
# this mode legitimately uses those as its own vocabulary (PRD §11: 路線/
# 塔/主堡/支援位/助攻). Only names that specifically identify the commercial
# game, its publisher, or its proprietary jargon are banned.
# Brand-identifying terms (publisher/product/proprietary place names) —
# scanned EVERYWHERE, including the PRD markdown itself, because the PRD
# never needs to name the brand to explain the rule (it already doesn't).
BANNED_BRAND_TERMS: tuple[str, ...] = (
    "League of Legends",
    "英雄聯盟",
    "LOL",
    "LoL",
    "Riot Games",
    "Riot",
    "召喚師峽谷",
    "Summoner's Rift",
    "Teamfight Tactics",
    "傳說對決",  # the Taiwan-market clone of the same genre — also banned
    "Arena of Valor",
    "Mobile Legends",
    "Dota",
    "Heroes of Newerth",
)

# Generic genre jargon the PRD §11 explicitly says not to reuse ("不用上／
# 中／下路、打野、英雄等該類遊戲的專有稱呼"). These are NOT scanned in .md
# files: the PRD's own sentence quoting this exact instruction legitimately
# contains them (it has to, to state the rule), which would otherwise make
# this guard flag the PRD for following its own instruction. Code/test/UI
# copy has no such excuse, so those still get the full check (see
# `_terms_for`).
BANNED_JARGON_TERMS: tuple[str, ...] = ("上路", "中路", "下路", "打野", "英雄")

BANNED_TERMS: tuple[str, ...] = BANNED_BRAND_TERMS + BANNED_JARGON_TERMS


def _terms_for(path: Path) -> tuple[str, ...]:
    """Markdown docs only get the brand-term check (see BANNED_JARGON_TERMS
    docstring above); code/test files get both lists."""
    return BANNED_BRAND_TERMS if path.suffix == ".md" else BANNED_TERMS

# Directories/globs scanned for the banned terms (code + the PRD/docs
# themselves, since the PRD explicitly also says "實作 PR ... 前後端與文件
# 中不得出現"). Deliberately NOT the whole `backend/tests` directory — that
# is proven too broad: `tests/_route_walk.py` contains "實際上路由好好的",
# whose "上...路" is an accidental substring match for the jargon term
# "上路" with nothing to do with this game mode. Scanning only this
# module's own `test_team_arena_*.py` siblings keeps the guard scoped to
# what it's actually supposed to police.
SCAN_PATHS: tuple[Path, ...] = (
    REPO_ROOT / "backend" / "app" / "models" / "team_arena.py",
    REPO_ROOT / "backend" / "app" / "services" / "team_arena",
    REPO_ROOT / "docs" / "prd" / "2026-10-18-team-arena-prd.md",
)
TEST_SIBLINGS_DIR = REPO_ROOT / "backend" / "tests"
TEST_SIBLINGS_GLOB = "test_team_arena_*.py"
# Frontend team_arena source isn't built yet (slice 3) — this glob picks it
# up automatically once it exists, without needing another edit here.
FRONTEND_GLOB = REPO_ROOT / "frontend" / "src"


def _iter_text_files():
    for base in SCAN_PATHS:
        if base.is_file():
            yield base
        elif base.is_dir():
            for path in base.rglob("*"):
                if path.is_file() and path.suffix in {".py", ".md", ".ts", ".tsx", ".js", ".jsx"}:
                    yield path
    if TEST_SIBLINGS_DIR.exists():
        for path in TEST_SIBLINGS_DIR.glob(TEST_SIBLINGS_GLOB):
            if path.is_file():
                yield path
    if FRONTEND_GLOB.exists():
        for path in FRONTEND_GLOB.rglob("*team_arena*"):
            if path.is_file():
                yield path
        for path in FRONTEND_GLOB.rglob("*TeamArena*"):
            if path.is_file():
                yield path


class TestNoBannedGameNamesAnywhereInTeamArena:
    def test_scan_finds_no_banned_terms(self):
        hits: list[str] = []
        for path in _iter_text_files():
            # Never scan this guard's own file — the banned list must live
            # somewhere, and that's here (PRD §11: "禁用清單放在測試裡").
            if path.name == "test_team_arena_naming_guard.py":
                continue
            try:
                text = path.read_text(encoding="utf-8")
            except (UnicodeDecodeError, OSError):
                continue
            for term in _terms_for(path):
                if term in text:
                    hits.append(f"{path.relative_to(REPO_ROOT)}: {term!r}")
        assert not hits, "Banned game name(s) found:\n" + "\n".join(hits)

    def test_scan_paths_actually_exist(self):
        """Regression lock for the scan itself (overclaim-bias: a glob over
        a typo'd/missing path silently scans nothing and always passes)."""
        existing = [p for p in SCAN_PATHS if p.exists()]
        assert len(existing) == len(SCAN_PATHS), f"expected every scan path to exist, got {existing}"
        assert TEST_SIBLINGS_DIR.exists()
        assert list(TEST_SIBLINGS_DIR.glob(TEST_SIBLINGS_GLOB)), (
            "expected the test-siblings glob to match at least this file itself"
        )

    def test_scan_actually_detects_a_planted_banned_term(self, tmp_path, monkeypatch):
        """Positive control: plant a banned term in a temp file under a
        patched scan root and confirm the scanner catches it — otherwise
        a broken glob could leave this whole guard vacuously green."""
        planted_dir = tmp_path / "team_arena"
        planted_dir.mkdir()
        planted_file = planted_dir / "planted.py"
        planted_file.write_text("# this file mentions League of Legends on purpose\n")

        monkeypatch.setattr(
            "tests.test_team_arena_naming_guard.SCAN_PATHS", (planted_dir,)
        )
        monkeypatch.setattr(
            "tests.test_team_arena_naming_guard.FRONTEND_GLOB", tmp_path / "does-not-exist"
        )

        hits = []
        for path in _iter_text_files():
            text = path.read_text(encoding="utf-8")
            for term in _terms_for(path):
                if term in text:
                    hits.append(f"{path}: {term!r}")
        assert hits, "positive control failed to detect a planted banned term"


class TestJargonTermsExcludedFromMarkdown:
    """Regression lock: PRD §11's own sentence instructing "不用上／中／下路
    、打野、英雄" legitimately contains "下路"/"打野"/"英雄" as literal
    substrings — scanning .md files for the jargon list would make this
    guard flag the PRD for stating its own rule. Brand terms still apply to
    .md (the PRD never needs to name the brand)."""

    def test_prd_doc_itself_contains_a_jargon_term_as_expected(self):
        prd_path = REPO_ROOT / "docs" / "prd" / "2026-10-18-team-arena-prd.md"
        text = prd_path.read_text(encoding="utf-8")
        assert any(term in text for term in BANNED_JARGON_TERMS), (
            "expected the PRD's own §11 sentence to literally contain a "
            "jargon term it instructs against using"
        )

    def test_terms_for_markdown_excludes_jargon(self):
        prd_path = REPO_ROOT / "docs" / "prd" / "2026-10-18-team-arena-prd.md"
        assert _terms_for(prd_path) == BANNED_BRAND_TERMS

    def test_terms_for_python_includes_jargon(self):
        py_path = REPO_ROOT / "backend" / "app" / "services" / "team_arena" / "teams.py"
        assert set(BANNED_JARGON_TERMS).issubset(set(_terms_for(py_path)))

    def test_jargon_term_in_a_code_file_is_still_caught(self, tmp_path, monkeypatch):
        """Positive control for the jargon half specifically — a .py file
        (not .md) using banned MOBA jargon must still be caught."""
        planted_dir = tmp_path / "team_arena"
        planted_dir.mkdir()
        (planted_dir / "planted.py").write_text("LANE_LABEL = \"上路\"\n")

        monkeypatch.setattr(
            "tests.test_team_arena_naming_guard.SCAN_PATHS", (planted_dir,)
        )
        monkeypatch.setattr(
            "tests.test_team_arena_naming_guard.FRONTEND_GLOB", tmp_path / "does-not-exist"
        )

        hits = []
        for path in _iter_text_files():
            text = path.read_text(encoding="utf-8")
            for term in _terms_for(path):
                if term in text:
                    hits.append(f"{path}: {term!r}")
        assert hits, "jargon term in a .py file was not caught"
