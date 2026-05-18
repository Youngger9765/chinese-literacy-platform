"""Contract tests for `tables` field on StoryDetail (#1685).

Verifies that:
  - 圖文表整合 lessons (G7-L28, G7-L30) surface their extracted tables via the
    API as a list of {id, title, headers, rows[].cells, ...} dicts.
  - Lessons without tables (e.g. G6-L22 摘要策略) return `tables=None` so
    front-end can skip rendering — regression guard.

These run against the live yml in `_parsed_2026-05-01/` and shadow the parser
output. If the docx → yml parser is ever rerun and drops the manually
extracted tables, these tests fail loudly.
"""
import pytest

from app.schemas.story import StoryDetail, StoryIntroSchema
from app.services.lesson_loader import get_all_lessons


@pytest.fixture(scope="module")
def lessons_by_code():
    return {l["grade_code"]: l for l in get_all_lessons()}


def _build_detail(story):
    return StoryDetail(
        id=story["id"],
        lesson_number=story["lesson_number"],
        title=story["title"],
        grade=story["grade"],
        grade_code=story["grade_code"],
        genre=story["genre"],
        category=story["category"],
        char_count=story["char_count"],
        thumbnail_url=story["thumbnail_url"],
        reading_strategy=story["reading_strategy"],
        intro=StoryIntroSchema(**story["intro"]),
        paragraphs=story["paragraphs"],
        vocabulary=story["vocabulary"],
        tables=story.get("tables"),
    )


class TestTablesField:
    def test_g7_l30_has_two_tables(self, lessons_by_code):
        story = lessons_by_code["G7-L30"]
        detail = _build_detail(story)
        assert detail.tables is not None
        assert len(detail.tables) == 2
        ids = {t["id"] for t in detail.tables}
        assert ids == {"table-1", "table-2"}

    def test_g7_l30_table_1_structure(self, lessons_by_code):
        """表一 should have 3 headers, ≥10 rows, and 異同 section labels."""
        story = lessons_by_code["G7-L30"]
        t1 = next(t for t in story["tables"] if t["id"] == "table-1")
        assert t1["headers"] == ["比較項目", "白尾八哥", "臺灣冠八哥"]
        assert len(t1["rows"]) >= 10  # ≥ 5 同 + 5 異
        # Section label column present (used for vertical 異同 grouping)
        assert t1.get("section_label_col") == "異同"
        # Sections cover both 相同處 and 相異處
        sections = {r.get("section") for r in t1["rows"]}
        assert sections == {"相同處", "相異處"}
        # Every row has the same number of cells as headers
        for r in t1["rows"]:
            assert len(r["cells"]) == len(t1["headers"])

    def test_g7_l30_table_2_has_notes(self, lessons_by_code):
        """表二 should have 4 headers, 4 rows, and 2 footnotes."""
        story = lessons_by_code["G7-L30"]
        t2 = next(t for t in story["tables"] if t["id"] == "table-2")
        assert len(t2["headers"]) == 4
        assert len(t2["rows"]) == 4
        assert t2.get("notes") and len(t2["notes"]) == 2
        # Notes mention the data sources from the worksheet
        notes_text = " ".join(t2["notes"])
        assert "註1" in notes_text or "註 1" in notes_text
        assert "584" in notes_text

    def test_g7_l28_has_one_table(self, lessons_by_code):
        story = lessons_by_code["G7-L28"]
        detail = _build_detail(story)
        assert detail.tables is not None
        assert len(detail.tables) == 1
        t = detail.tables[0]
        assert t["id"] == "table-1"
        assert len(t["headers"]) == 2  # 元素/段落, 內容
        assert len(t["rows"]) == 5  # 研究問題 / 假說 / 實驗 / 結論 / 影響

    @pytest.mark.parametrize("code", ["G6-L22", "G7-L29", "G6-L23"])
    def test_non_graphic_table_lessons_return_none(self, lessons_by_code, code):
        """Regression: lessons without 紙本 tables must not get spurious data."""
        story = lessons_by_code.get(code)
        if story is None:
            pytest.skip(f"{code} not in current dataset")
        detail = _build_detail(story)
        assert detail.tables is None, f"{code} unexpectedly has tables"
