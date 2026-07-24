"""
Tests for the stories API and lesson_loader service.

The stories API serves 57 YAML lessons from in-memory data — no DB dependency.

Run with:
    cd /Users/young/project/chinese-literacy-platform-issue-142/backend
    python -m pytest tests/test_stories_api.py -v
"""

import sys
import os

# Allow running pytest from the repo root or from backend/
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.lesson_loader import (
    get_all_lessons,
    get_available_grades,
    get_lesson_by_id,
    search_lessons,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def client():
    """Synchronous TestClient — no DB or external services needed."""
    with TestClient(app) as c:
        yield c


# ===========================================================================
# Unit tests — lesson_loader
# ===========================================================================


class TestGetAllLessons:
    def test_returns_57_lessons(self):
        lessons = get_all_lessons()
        assert len(lessons) == 57

    def test_returns_list_of_dicts(self):
        lessons = get_all_lessons()
        assert isinstance(lessons, list)
        assert all(isinstance(l, dict) for l in lessons)

    def test_sorted_by_lesson_number(self):
        lessons = get_all_lessons()
        ids = [l["lesson_number"] for l in lessons]
        assert ids == sorted(ids)


class TestGetAvailableGrades:
    def test_returns_all_six_grades(self):
        grades = get_available_grades()
        assert grades == [4, 5, 6, 7, 8, 9]

    def test_returns_sorted_list(self):
        grades = get_available_grades()
        assert grades == sorted(grades)

    def test_returns_list_of_ints(self):
        grades = get_available_grades()
        assert all(isinstance(g, int) for g in grades)


class TestGetLessonById:
    def test_lesson_1_exists(self):
        lesson = get_lesson_by_id(1)
        assert lesson is not None

    def test_lesson_1_title(self):
        lesson = get_lesson_by_id(1)
        assert lesson["title"] == "贏得喝采的輸家"

    def test_lesson_1_grade(self):
        lesson = get_lesson_by_id(1)
        assert lesson["grade"] == 4

    def test_lesson_1_grade_code(self):
        lesson = get_lesson_by_id(1)
        assert lesson["grade_code"] == "G4-1"

    def test_lesson_1_id_equals_lesson_number(self):
        lesson = get_lesson_by_id(1)
        assert lesson["id"] == 1
        assert lesson["lesson_number"] == 1

    def test_lesson_1_has_paragraphs(self):
        lesson = get_lesson_by_id(1)
        assert isinstance(lesson["paragraphs"], list)
        assert len(lesson["paragraphs"]) > 0

    def test_lesson_1_has_vocabulary(self):
        lesson = get_lesson_by_id(1)
        assert isinstance(lesson["vocabulary"], list)
        assert len(lesson["vocabulary"]) > 0

    def test_nonexistent_id_returns_none(self):
        assert get_lesson_by_id(9999) is None


# ===========================================================================
# 重點朗讀 key_reading contract (#2559 pilot) — regression lock
#
# Guards the exact bug code review caught: key_reading was declared on the wrong
# schema class (StoryCreateRequest instead of StoryDetail), so Pydantic silently
# dropped it from the served response → the pilot was a no-op. This asserts the
# SERVED HTTP layer, not just the loader dict.
# ===========================================================================


class TestKeyReadingContract:
    def test_g4l01_detail_serves_key_reading_passage(self, client):
        """GET /api/stories/1 (戴資穎 G4-L01) must return a non-null key_reading.passage.

        If this fails, the 重點朗讀 step silently falls back to full text.
        """
        resp = client.get("/api/stories/1")
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert "key_reading" in body, "StoryDetail response missing key_reading field"
        kr = body["key_reading"]
        assert kr is not None, "key_reading is null for the pilot lesson G4-L01"
        assert kr.get("passage"), "key_reading.passage is empty"
        # Issue #2562 新規則：只取老師 ☞ 指定的那一段（第三段＝奧運金牌賽段），
        # 取代舊 pilot 的「☞→全文結尾 376 字」。段落到「向心力！」結束。
        assert "小戴" in kr["passage"]
        assert kr["passage"].rstrip().endswith("向心力！")

    def test_lesson_without_key_reading_serves_null(self, client):
        """A lesson without key_reading must serve key_reading: null (fallback path),
        never 500 — proves the optional field degrades gracefully."""
        # Issue #2562: 需用「對照表沒有」的課（閱讀策略類、無念順順，如 G7-L23）。
        # 找一課 grade_code 不在對照表者，其詳情 key_reading 應為 null。
        from app.services.lesson_layer_loaders import get_key_reading_passages
        kr_map = get_key_reading_passages()
        listing = client.get("/api/stories").json().get("stories", [])
        target = next((s for s in listing if s.get("grade_code") not in kr_map), None)
        assert target is not None, "找不到任何不在對照表的課可測 fallback"
        resp = client.get(f"/api/stories/{target['id']}")
        assert resp.status_code == 200, resp.text
        assert resp.json().get("key_reading") is None

    def test_zero_id_returns_none(self):
        assert get_lesson_by_id(0) is None

    def test_negative_id_returns_none(self):
        assert get_lesson_by_id(-1) is None


class TestLessonRequiredFields:
    """Every lesson must expose the required schema fields."""

    REQUIRED_FIELDS = [
        "id",
        "lesson_number",
        "title",
        "grade",
        "grade_code",
        "genre",
        "category",
        "char_count",
        "thumbnail_url",
        "reading_strategy",
        "intro",
        "paragraphs",
    ]

    def test_all_lessons_have_required_fields(self):
        lessons = get_all_lessons()
        for lesson in lessons:
            missing = [f for f in self.REQUIRED_FIELDS if f not in lesson]
            assert missing == [], (
                f"Lesson {lesson.get('lesson_number')} missing fields: {missing}"
            )

    def test_intro_has_author_and_background(self):
        lessons = get_all_lessons()
        for lesson in lessons:
            intro = lesson["intro"]
            assert "author" in intro, f"Lesson {lesson['lesson_number']} intro missing 'author'"
            assert "background" in intro, f"Lesson {lesson['lesson_number']} intro missing 'background'"

    def test_thumbnail_url_pattern(self):
        """#2486: thumbnail_url is served via our same-origin /assets proxy —
        lingoleap-assets is now a private bucket, no more absolute GCS URLs."""
        lessons = get_all_lessons()
        for lesson in lessons:
            url = lesson["thumbnail_url"]
            assert url.startswith("/assets/stories/thumbnails/"), (
                f"Lesson {lesson['lesson_number']} has unexpected thumbnail_url: {url}"
            )
            assert not url.startswith("https://storage.googleapis.com/")
            assert f"lesson-{lesson['lesson_number']}.webp" in url

    def test_char_count_is_non_negative_int(self):
        lessons = get_all_lessons()
        for lesson in lessons:
            assert isinstance(lesson["char_count"], int)
            assert lesson["char_count"] >= 0

    def test_grade_values_are_valid(self):
        valid_grades = {4, 5, 6, 7, 8, 9}
        lessons = get_all_lessons()
        for lesson in lessons:
            assert lesson["grade"] in valid_grades, (
                f"Lesson {lesson['lesson_number']} has invalid grade: {lesson['grade']}"
            )

    def test_category_is_mapped_string(self):
        valid_categories = {"Fable", "Science", "History", "Daily"}
        lessons = get_all_lessons()
        for lesson in lessons:
            assert lesson["category"] in valid_categories, (
                f"Lesson {lesson['lesson_number']} has unknown category: {lesson['category']}"
            )


class TestSearchLessons:
    def test_no_filter_returns_all_57(self):
        results = search_lessons()
        assert len(results) == 57

    def test_grade_6_filter_returns_15(self):
        results = search_lessons(grade=6)
        assert len(results) == 15

    def test_grade_6_filter_all_grade_6(self):
        results = search_lessons(grade=6)
        assert all(l["grade"] == 6 for l in results)

    def test_grade_filter_excludes_other_grades(self):
        for grade in [4, 5, 7, 8, 9]:
            results = search_lessons(grade=grade)
            assert all(l["grade"] == grade for l in results), (
                f"Grade {grade} filter returned a lesson with wrong grade"
            )

    def test_search_by_title_keyword(self):
        # "麵" appears only in lesson 6 (第一百碗麵)
        results = search_lessons(search="麵")
        assert len(results) >= 1
        assert all("麵" in l["title"] for l in results)

    def test_search_by_grade_and_keyword_combined(self):
        # 運動 appears in multiple lessons; filtering to grade=6 narrows it
        all_sport = search_lessons(search="運動")
        grade6_sport = search_lessons(grade=6, search="運動")
        assert len(grade6_sport) <= len(all_sport)
        assert all(l["grade"] == 6 for l in grade6_sport)
        assert all("運動" in l["title"] for l in grade6_sport)

    def test_search_case_insensitive_for_ascii(self):
        # Title search lowercases both sides — confirm no crash on mixed input
        results = search_lessons(search="MeToo")
        assert isinstance(results, list)

    def test_search_no_match_returns_empty(self):
        results = search_lessons(search="ZZZ不存在的關鍵字XYZ")
        assert results == []

    def test_genre_filter(self):
        results = search_lessons(genre="記敘文")
        assert len(results) > 0
        assert all(l["genre"] == "記敘文" for l in results)

    def test_category_filter(self):
        results = search_lessons(category="Science")
        assert len(results) > 0
        assert all(l["category"] == "Science" for l in results)

    def test_multiple_filters_are_anded(self):
        results = search_lessons(grade=5, genre="記敘文")
        assert all(l["grade"] == 5 for l in results)
        assert all(l["genre"] == "記敘文" for l in results)


# ===========================================================================
# Integration tests — FastAPI HTTP layer
# ===========================================================================


class TestListStoriesEndpoint:
    def test_returns_200(self, client):
        resp = client.get("/api/stories")
        assert resp.status_code == 200

    def test_total_is_57(self, client):
        resp = client.get("/api/stories")
        data = resp.json()
        assert data["total"] == 57

    def test_response_has_stories_key(self, client):
        resp = client.get("/api/stories")
        data = resp.json()
        assert "stories" in data

    def test_response_has_grades_key(self, client):
        resp = client.get("/api/stories")
        data = resp.json()
        assert "grades" in data
        assert data["grades"] == [4, 5, 6, 7, 8, 9]

    def test_default_page_size_is_60_returns_all_57(self, client):
        resp = client.get("/api/stories")
        data = resp.json()
        # default page_size=60 > 57, so all stories fit on page 1
        assert len(data["stories"]) == 57

    def test_grade_filter_returns_correct_count(self, client):
        resp = client.get("/api/stories?grade=6")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 15
        assert len(data["stories"]) == 15

    def test_grade_filter_all_stories_are_correct_grade(self, client):
        resp = client.get("/api/stories?grade=6")
        data = resp.json()
        assert all(s["grade"] == 6 for s in data["stories"])

    def test_invalid_grade_too_high_returns_422(self, client):
        resp = client.get("/api/stories?grade=13")
        assert resp.status_code == 422

    def test_invalid_grade_zero_returns_422(self, client):
        resp = client.get("/api/stories?grade=0")
        assert resp.status_code == 422

    def test_search_filter_returns_matching_lessons(self, client):
        resp = client.get("/api/stories?search=麵")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] >= 1
        assert all("麵" in s["title"] for s in data["stories"])

    def test_search_no_match_returns_empty(self, client):
        resp = client.get("/api/stories?search=ZZZ不存在XYZ")
        data = resp.json()
        assert data["total"] == 0
        assert data["stories"] == []


class TestListStoriesPagination:
    def test_page1_page_size_10_returns_10_stories(self, client):
        resp = client.get("/api/stories?page=1&page_size=10")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["stories"]) == 10
        assert data["total"] == 57

    def test_page2_page_size_10_returns_10_stories(self, client):
        resp = client.get("/api/stories?page=2&page_size=10")
        data = resp.json()
        assert len(data["stories"]) == 10

    def test_last_page_returns_remaining_stories(self, client):
        # 57 total, page_size=10 → page 6 has 7 stories
        resp = client.get("/api/stories?page=6&page_size=10")
        data = resp.json()
        assert len(data["stories"]) == 7

    def test_page_beyond_total_returns_empty(self, client):
        resp = client.get("/api/stories?page=100&page_size=10")
        data = resp.json()
        assert data["stories"] == []
        assert data["total"] == 57  # total is always the unsliced count

    def test_pages_are_non_overlapping(self, client):
        resp1 = client.get("/api/stories?page=1&page_size=10")
        resp2 = client.get("/api/stories?page=2&page_size=10")
        ids_p1 = {s["id"] for s in resp1.json()["stories"]}
        ids_p2 = {s["id"] for s in resp2.json()["stories"]}
        assert ids_p1.isdisjoint(ids_p2)

    def test_all_pages_cover_all_57_stories(self, client):
        all_ids = set()
        for page in range(1, 7):  # ceil(57/10) = 6 pages
            resp = client.get(f"/api/stories?page={page}&page_size=10")
            for story in resp.json()["stories"]:
                all_ids.add(story["id"])
        assert len(all_ids) == 57

    def test_page_size_1_returns_1_story(self, client):
        resp = client.get("/api/stories?page=1&page_size=1")
        data = resp.json()
        assert len(data["stories"]) == 1
        assert data["total"] == 57

    def test_page_zero_returns_422(self, client):
        resp = client.get("/api/stories?page=0")
        assert resp.status_code == 422

    def test_page_size_over_100_returns_422(self, client):
        resp = client.get("/api/stories?page_size=101")
        assert resp.status_code == 422


class TestStoryListItemSchema:
    """Validate shape of items in the list response."""

    def test_story_list_item_has_required_fields(self, client):
        resp = client.get("/api/stories?page_size=1")
        story = resp.json()["stories"][0]
        required = ["id", "title", "grade", "grade_code", "genre", "category",
                    "char_count", "thumbnail_url"]
        for field in required:
            assert field in story, f"StoryListItem missing field: {field}"

    def test_story_list_item_has_intro(self, client):
        resp = client.get("/api/stories?page_size=1")
        story = resp.json()["stories"][0]
        assert "intro" in story
        assert "author" in story["intro"]
        assert "background" in story["intro"]

    def test_story_list_item_does_not_expose_paragraphs(self, client):
        # List endpoint returns StoryListItem, which has no paragraphs field
        resp = client.get("/api/stories?page_size=1")
        story = resp.json()["stories"][0]
        assert "paragraphs" not in story

    def test_thumbnail_url_is_string(self, client):
        """#2486: relative same-origin /assets path, not an absolute GCS URL."""
        resp = client.get("/api/stories?page_size=5")
        for story in resp.json()["stories"]:
            assert isinstance(story["thumbnail_url"], str)
            assert story["thumbnail_url"].startswith("/assets/")


class TestGetStoryDetailEndpoint:
    def test_lesson_1_returns_200(self, client):
        resp = client.get("/api/stories/1")
        assert resp.status_code == 200

    def test_lesson_1_title(self, client):
        resp = client.get("/api/stories/1")
        data = resp.json()
        assert data["title"] == "贏得喝采的輸家"

    def test_lesson_1_grade(self, client):
        resp = client.get("/api/stories/1")
        data = resp.json()
        assert data["grade"] == 4

    def test_lesson_1_has_paragraphs(self, client):
        resp = client.get("/api/stories/1")
        data = resp.json()
        assert "paragraphs" in data
        assert isinstance(data["paragraphs"], list)
        assert len(data["paragraphs"]) > 0
        assert all(isinstance(p, str) for p in data["paragraphs"])

    def test_lesson_1_has_vocabulary(self, client):
        resp = client.get("/api/stories/1")
        data = resp.json()
        assert "vocabulary" in data
        assert isinstance(data["vocabulary"], list)
        assert len(data["vocabulary"]) > 0

    def test_vocabulary_item_has_word_and_definition(self, client):
        resp = client.get("/api/stories/1")
        vocab = resp.json()["vocabulary"]
        for item in vocab:
            assert "word" in item
            assert "definition" in item

    def test_lesson_1_has_intro(self, client):
        resp = client.get("/api/stories/1")
        data = resp.json()
        assert "intro" in data
        assert "author" in data["intro"]
        assert "background" in data["intro"]

    def test_lesson_1_has_thumbnail_url(self, client):
        resp = client.get("/api/stories/1")
        data = resp.json()
        assert "thumbnail_url" in data
        assert "lesson-1.webp" in data["thumbnail_url"]

    def test_lesson_1_has_reading_benchmark(self, client):
        resp = client.get("/api/stories/1")
        data = resp.json()
        assert "reading_benchmark" in data
        assert data["reading_benchmark"] is not None
        assert "levels" in data["reading_benchmark"]

    def test_lesson_1_has_fill_in_blank(self, client):
        resp = client.get("/api/stories/1")
        data = resp.json()
        assert "fill_in_blank" in data
        assert isinstance(data["fill_in_blank"], list)

    def test_lesson_1_has_multiple_choice(self, client):
        resp = client.get("/api/stories/1")
        data = resp.json()
        assert "multiple_choice" in data
        assert isinstance(data["multiple_choice"], list)

    def test_nonexistent_story_returns_404(self, client):
        resp = client.get("/api/stories/9999")
        assert resp.status_code == 404

    def test_404_response_has_detail_key(self, client):
        resp = client.get("/api/stories/9999")
        data = resp.json()
        assert "detail" in data
        assert data["detail"] == "Story not found"

    def test_slug_format_returns_404_not_422(self, client):
        """Legacy sessions stored slug-format story_slugs (e.g. 'long-gao-de-mi-mi-3').
        The endpoint must return 404, not 422, so the frontend can handle it gracefully.
        Regression test for #366.
        """
        resp = client.get("/api/stories/long-gao-de-mi-mi-3")
        assert resp.status_code == 404

    def test_slug_format_with_hyphens_returns_404(self, client):
        """Another legacy slug format — must not crash with 422."""
        resp = client.get("/api/stories/some-slug-title")
        assert resp.status_code == 404

    def test_alpha_only_id_returns_404_not_422(self, client):
        """Purely alphabetic path params must return 404, not 422."""
        resp = client.get("/api/stories/abc")
        assert resp.status_code == 404

    def test_story_id_matches_lesson_number(self, client):
        resp = client.get("/api/stories/1")
        data = resp.json()
        assert data["id"] == 1
        assert data["lesson_number"] == 1

    def test_all_57_story_ids_are_accessible(self, client):
        """Smoke test: every lesson ID that loader knows about must return 200."""
        from app.services.lesson_loader import get_all_lessons
        for lesson in get_all_lessons():
            lid = lesson["id"]
            resp = client.get(f"/api/stories/{lid}")
            assert resp.status_code == 200, (
                f"Expected 200 for /api/stories/{lid}, got {resp.status_code}"
            )


class TestWorksheetPdfUrlIsProxied:
    """Regression test for #2486 (part 3) — worksheet_pdf_url leaked the raw
    absolute GCS URL through GET /api/stories/{id} for Layer-1 lessons whose
    worksheet_pdf_url came from the Layer-2 *enrichment* merge (#1666), even
    though load_layer2_lessons() itself already rewrote the field correctly
    for lessons served directly out of Layer-2.

    Found via real-browser QA against a live PR preview (not caught by the
    existing #2486 tests in test_asset_url_rewrite.py, which only exercise
    load_layer1_lessons() *before* enrichment and load_layer2_lessons()
    directly — neither one touches build_layer2_enrichment_index(), which is
    where the raw copy actually happened).

    Story id 3 (G4-L3, "長高的祕密") is the exact case reported: thumbnail_url
    was already correctly /assets/-prefixed (it isn't a Layer-2 enrichment
    field — see lesson_layer_loaders.py, it's synthesized fresh), but
    worksheet_pdf_url came back as the literal
    https://storage.googleapis.com/lingoleap-assets/... URL — which both (a)
    defeats the CSP frame-src widening (the iframe was never pointed at a
    *.run.app origin to begin with) and (b) would 403 the moment the bucket
    ACL goes private.
    """

    def test_lesson_3_worksheet_pdf_url_is_proxied_not_absolute_gcs(self, client):
        resp = client.get("/api/stories/3")
        assert resp.status_code == 200
        data = resp.json()
        assert data["worksheet_pdf_url"], "Expected lesson 3 to have a worksheet_pdf_url"
        assert data["worksheet_pdf_url"].startswith("/assets/worksheets/"), (
            f"worksheet_pdf_url must be proxied, got: {data['worksheet_pdf_url']!r}"
        )
        assert "storage.googleapis.com" not in data["worksheet_pdf_url"]

    def test_no_story_leaks_absolute_gcs_worksheet_pdf_url(self, client):
        """Sweep every served lesson — the bug was specific to lessons enriched
        from Layer-2 parsed data, not universal, so a single lesson isn't
        enough to prove the fix covers every affected id."""
        from app.services.lesson_loader import get_all_lessons

        offenders = []
        for lesson in get_all_lessons():
            resp = client.get(f"/api/stories/{lesson['id']}")
            assert resp.status_code == 200
            url = resp.json().get("worksheet_pdf_url")
            if url and "storage.googleapis.com" in url:
                offenders.append((lesson["id"], url))
        assert not offenders, f"Lessons with un-proxied worksheet_pdf_url: {offenders}"

    def test_no_story_leaks_absolute_gcs_worksheet_docx_url(self, client):
        from app.services.lesson_loader import get_all_lessons

        offenders = []
        for lesson in get_all_lessons():
            resp = client.get(f"/api/stories/{lesson['id']}")
            assert resp.status_code == 200
            url = resp.json().get("worksheet_docx_url")
            if url and "storage.googleapis.com" in url:
                offenders.append((lesson["id"], url))
        assert not offenders, f"Lessons with un-proxied worksheet_docx_url: {offenders}"


class TestStoryDetailSchema:
    """Validate StoryDetail response schema completeness."""

    REQUIRED_DETAIL_FIELDS = [
        "id", "lesson_number", "title", "grade", "grade_code",
        "genre", "category", "char_count", "thumbnail_url",
        "reading_strategy", "intro", "paragraphs",
    ]

    def test_detail_has_all_list_item_fields(self, client):
        resp = client.get("/api/stories/1")
        data = resp.json()
        for field in self.REQUIRED_DETAIL_FIELDS:
            assert field in data, f"StoryDetail missing field: {field}"

    def test_detail_extends_list_item_with_paragraphs(self, client):
        resp = client.get("/api/stories/1")
        data = resp.json()
        assert "paragraphs" in data

    def test_char_count_is_int(self, client):
        resp = client.get("/api/stories/1")
        assert isinstance(resp.json()["char_count"], int)

    def test_grade_is_int(self, client):
        resp = client.get("/api/stories/1")
        assert isinstance(resp.json()["grade"], int)

    def test_grade_14_detail_accessible(self, client):
        # L14 is grade 6
        resp = client.get("/api/stories/14")
        assert resp.status_code == 200
        data = resp.json()
        assert data["grade"] == 6
        assert data["title"] == "運動傷害，怎麼辦"
