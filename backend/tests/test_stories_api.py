"""
Tests for the stories API and lesson_loader service.

The stories API serves the second-edition uid tree from in-memory data — no DB dependency.

Run with:
    cd /Users/young/project/chinese-literacy-platform-issue-142/backend
    python -m pytest tests/test_stories_api.py -v
"""

import sys
import os

# Allow running pytest from the repo root or from backend/
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest


def _all():
    from app.services.lesson_loader import get_all_lessons
    return get_all_lessons()
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


# Lesson 20001 no longer exists — the second edition renumbered the corpus and
# the first lesson is 20011 today. Naming the id here, derived from the corpus,
# rather than replacing one literal with another that will rot the same way.
FIRST_LESSON_ID = min(l["id"] for l in get_all_lessons())


class TestGetAllLessons:
    def test_returns_the_whole_corpus(self):
        """A ratchet, not a literal.

        This asserted exactly 175 and went red the day the corpus reached 179 —
        lessons being added is the intended direction, so an equality here
        reports success as failure. What is worth catching is the opposite:
        lessons disappearing because a loader stopped seeing part of the tree.

        The same reasoning is already written into
        test_grade_6_filter_returns_every_grade_6_lesson below; these two counts
        were left behind.
        """
        lessons = get_all_lessons()
        assert len(lessons) >= 175, (
            f"corpus shrank to {len(lessons)}; the loader is missing lessons it used to see"
        )

    def test_returns_list_of_dicts(self):
        lessons = get_all_lessons()
        assert isinstance(lessons, list)
        assert all(isinstance(l, dict) for l in lessons)

    def test_sorted_by_teaching_sequence(self):
        """Ordered by lesson_seq, which is not the same as id order.

        This used to assert the ids came out ascending. They do not, and that
        is deliberate: build_all_lessons sorts on lesson_seq
        (grade*1000 + lesson*10) so the library reads in teaching order across
        three series, with id only as a tiebreak. The id is an identifier, not
        a position — 20011 preceding 20001 is the grade ordering doing its job.

        Asserting on id was asserting that two unrelated numbers agree.
        """
        lessons = get_all_lessons()
        keys = [
            (l.get("lesson_seq") if isinstance(l.get("lesson_seq"), int) else 99000 + l["id"], l["id"])
            for l in lessons
        ]
        assert keys == sorted(keys), "lessons are not in teaching order"


class TestGetAvailableGrades:
    def test_returns_years_plus_collections(self):
        grades = get_available_grades()
        assert grades == ["4", "5", "6", "7", "8", "9", "品格教育", "文言文"]

    def test_returns_sorted_list(self):
        grades = get_available_grades()
        assert grades == sorted(grades)

    def test_returns_list_of_strings(self):
        grades = get_available_grades()
        assert all(isinstance(g, str) for g in grades)


class TestGetLessonById:
    def test_lesson_1_exists(self):
        lesson = get_lesson_by_id(FIRST_LESSON_ID)
        assert lesson is not None

    def test_lesson_1_title(self):
        lesson = get_lesson_by_id(FIRST_LESSON_ID)
        assert lesson["title"] == "十秒的背後"

    def test_lesson_1_grade(self):
        lesson = get_lesson_by_id(FIRST_LESSON_ID)
        assert lesson["grade"] == "4"

    def test_lesson_1_grade_code(self):
        lesson = get_lesson_by_id(FIRST_LESSON_ID)
        assert lesson["grade_code"] == "G4-L10"

    def test_lesson_1_id_equals_lesson_number(self):
        lesson = get_lesson_by_id(FIRST_LESSON_ID)
        assert lesson["id"] == FIRST_LESSON_ID
        assert lesson["lesson_number"] == FIRST_LESSON_ID

    def test_lesson_1_has_paragraphs(self):
        lesson = get_lesson_by_id(FIRST_LESSON_ID)
        assert isinstance(lesson["paragraphs"], list)
        assert len(lesson["paragraphs"]) > 0

    def test_lesson_1_has_vocabulary(self):
        lesson = get_lesson_by_id(FIRST_LESSON_ID)
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
    @pytest.mark.xfail(
        reason="二修抽取只產學習單；此欄位 0/175，登錄在 data/curriculum_qa/content_known_gaps.yaml#fields_not_extracted",
        strict=True,
    )
    def test_g4l01_detail_serves_key_reading_passage(self, client):
        """GET /api/stories/1 (戴資穎 G4-L01) must return a non-null key_reading.passage.

        If this fails, the 重點朗讀 step silently falls back to full text.
        """
        resp = client.get(f"/api/stories/{FIRST_LESSON_ID}")
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
        """沒有念順順的課要回 key_reading: null，不可以 500。

        ⚠️ 判準在 2026-08-31 改過。原本是「grade_code 不在
        `get_key_reading_passages()` 對照表 → 必為 null」——
        那個對照表是**一版**的人工掃描（134 筆），二修之後 150 課的念順順
        來自抽取器（`source: extract_key_reading_v3`），跟那張表沒有關係。
        於是這條在 L0011 上紅了：它不在一版表裡，卻正確地回了 379 字。

        現在的契約：**看服務端自己的 `has_key_reading`**，
        它為 false 的課（來源學習單沒有這個大題）才該是 null。
        """
        listing = client.get("/api/stories").json().get("stories", [])
        target = next((s for s in listing if not s.get("has_key_reading")), None)
        assert target is not None, "找不到任何 has_key_reading=false 的課可測 fallback"
        resp = client.get(f"/api/stories/{target['id']}")
        assert resp.status_code == 200, resp.text
        assert resp.json().get("key_reading") is None

        # 正向對照：has_key_reading=true 的課要真的給得出 passage ——
        # 少了它，「全部都回 null」也會讓上面那條綠。
        yes = next((s for s in listing if s.get("has_key_reading")), None)
        assert yes is not None, "一課 has_key_reading=true 的都沒有 —— 量具可能壞了"
        got = client.get(f"/api/stories/{yes['id']}").json().get("key_reading") or {}
        assert got.get("passage"), f"{yes['id']} 標了 has_key_reading 卻沒有 passage"

    def test_list_never_leaks_the_passage_and_flags_only_real_ones(self, client):
        """`has_key_reading` used to be true for most lessons — but that came from
        `key_reading_passages.yml`, first-edition data keyed by catalogue position.
        After the renumber it matched the WRONG lesson and reported true for a
        passage belonging to someone else (staging served G4-L10 《十秒的背後》 a
        bus-seat story). The flag now reflects only a passage the lesson itself
        carries, which for the second edition is none — a registered content gap,
        not a defect.

        The two invariants that still hold, and are what this locks: the list never
        ships the passage text itself, and the flag never claims a passage that is
        not the lesson's own."""
        resp = client.get("/api/stories?page_size=300")
        assert resp.status_code == 200, resp.text
        body = resp.json()
        stories = body["stories"]
        assert len(stories) == body["total"]
        assert all("key_reading" not in story for story in stories)
        assert {s.get("has_key_reading") for s in stories} <= {True, False}

    @pytest.mark.xfail(

        reason="二修抽取只產學習單；此欄位 0/175，登錄在 data/curriculum_qa/content_known_gaps.yaml#fields_not_extracted",

        strict=True,

    )

    def test_list_has_key_reading_matches_detail_key_reading(self, client):
        stories = client.get("/api/stories?page_size=300").json()["stories"]
        from app.services.lesson_layer_loaders import get_key_reading_passages
        kr_map = get_key_reading_passages()
        with_key_reading = next(story for story in stories if story["id"] == 1)
        without_key_reading = next(story for story in stories if story.get("grade_code") not in kr_map)

        with_detail = client.get(f"/api/stories/{with_key_reading['id']}").json()
        without_detail = client.get(f"/api/stories/{without_key_reading['id']}").json()

        assert with_detail["key_reading"] is not None
        assert without_detail["key_reading"] is None
        assert with_key_reading["has_key_reading"] is True
        assert without_key_reading["has_key_reading"] is False

    def test_zero_id_returns_none(self):
        assert get_lesson_by_id(20000) is None

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

    @pytest.mark.xfail(

        reason="二修抽取只產學習單；此欄位 0/175，登錄在 data/curriculum_qa/content_known_gaps.yaml#fields_not_extracted",

        strict=True,

    )

    def test_intro_has_author_and_background(self):
        lessons = get_all_lessons()
        for lesson in lessons:
            intro = lesson["intro"]
            assert "author" in intro, f"Lesson {lesson['lesson_number']} intro missing 'author'"
            assert "background" in intro, f"Lesson {lesson['lesson_number']} intro missing 'background'"

    @pytest.mark.xfail(

        reason="二修抽取只產學習單；此欄位 0/175，登錄在 data/curriculum_qa/content_known_gaps.yaml#fields_not_extracted",

        strict=True,

    )

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
        # The axis is a string and carries two non-year collections (#2683).
        valid_grades = {"4", "5", "6", "7", "8", "9", "文言文", "品格教育"}
        lessons = get_all_lessons()
        for lesson in lessons:
            assert lesson["grade"] in valid_grades, (
                f"Lesson {lesson['lesson_number']} has invalid grade: {lesson['grade']}"
            )

    @pytest.mark.xfail(

        reason="二修抽取只產學習單；此欄位 0/175，登錄在 data/curriculum_qa/content_known_gaps.yaml#fields_not_extracted",

        strict=True,

    )

    def test_category_is_mapped_string(self):
        valid_categories = {"Fable", "Science", "History", "Daily"}
        lessons = get_all_lessons()
        for lesson in lessons:
            assert lesson["category"] in valid_categories, (
                f"Lesson {lesson['lesson_number']} has unknown category: {lesson['category']}"
            )


class TestSearchLessons:
    def test_no_filter_returns_the_whole_corpus(self):
        results = search_lessons()
        all_lessons = get_all_lessons()
        # Against the corpus, not a literal: an unfiltered search must return
        # everything the loader has, whatever that number is today.
        assert len(results) == len(all_lessons), (
            f"unfiltered search returned {len(results)} of {len(all_lessons)} lessons"
        )

    def test_grade_6_filter_returns_every_grade_6_lesson(self):
        """Counted against the corpus rather than a literal: the second edition
        renumbered every lesson, so a hardcoded 15 asserted a fact about material
        that no longer exists."""
        from app.services.lesson_loader import get_all_lessons
        expected = [l for l in get_all_lessons() if str(l["grade"]) == "6"]
        results = search_lessons(grade="6")
        assert len(results) == len(expected) > 0

    def test_grade_6_filter_all_grade_6(self):
        results = search_lessons(grade="6")
        assert all(l["grade"] == "6" for l in results)

    def test_grade_filter_excludes_other_grades(self):
        for grade in ["4", "5", "7", "8", "9", "文言文", "品格教育"]:
            results = search_lessons(grade=grade)
            assert results, f"grade {grade} filter returned nothing"
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
        assert all(l["grade"] == "6" for l in grade6_sport)
        assert all("運動" in l["title"] for l in grade6_sport)

    def test_search_case_insensitive_for_ascii(self):
        # Title search lowercases both sides — confirm no crash on mixed input
        results = search_lessons(search="MeToo")
        assert isinstance(results, list)

    def test_search_no_match_returns_empty(self):
        results = search_lessons(search="ZZZ不存在的關鍵字XYZ")
        assert results == []

    # The xfail here said this field was 0/175, logged as a known gap. The gap
    # closed — the multimodal re-extraction fills it (intro 178/179, genre
    # 174/179, reading_benchmark 145/179 as of today) — but the marker stayed,
    # so strict xfail turned the field working into a failure. Removed: this is
    # a lock now, and it will notice if the field goes empty again.
    def test_genre_filter(self):
        results = search_lessons(genre="記敘文")
        assert len(results) > 0
        assert all(l["genre"] == "記敘文" for l in results)

    @pytest.mark.xfail(

        reason="二修抽取只產學習單；此欄位 0/175，登錄在 data/curriculum_qa/content_known_gaps.yaml#fields_not_extracted",

        strict=True,

    )

    def test_category_filter(self):
        results = search_lessons(category="Science")
        assert len(results) > 0
        assert all(l["category"] == "Science" for l in results)

    def test_multiple_filters_are_anded(self):
        results = search_lessons(grade=5, genre="記敘文")
        assert all(l["grade"] == "5" for l in results)
        assert all(l["genre"] == "記敘文" for l in results)


# ===========================================================================
# Integration tests — FastAPI HTTP layer
# ===========================================================================


class TestListStoriesEndpoint:
    def test_returns_200(self, client):
        resp = client.get("/api/stories")
        assert resp.status_code == 200

    def test_total_is_175(self, client):
        resp = client.get("/api/stories")
        data = resp.json()
        assert data["total"] == len(get_all_lessons())  # against the corpus, not a literal

    def test_response_has_stories_key(self, client):
        resp = client.get("/api/stories")
        data = resp.json()
        assert "stories" in data

    def test_response_has_grades_key(self, client):
        resp = client.get("/api/stories")
        data = resp.json()
        assert "grades" in data
        assert data["grades"] == ["4", "5", "6", "7", "8", "9", "品格教育", "文言文"]

    def test_default_page_size_caps_the_first_page(self, client):
        """The default page_size is 60 and the corpus is larger, so page 1 is a
        page — not the whole library. The old name asserted both 60 and 175 at once,
        which only held while the corpus was smaller than a page."""
        resp = client.get("/api/stories")
        data = resp.json()
        assert data["total"] > 60
        assert len(data["stories"]) == 60

    def test_grade_filter_returns_correct_count(self, client):
        resp = client.get("/api/stories?grade=6")
        assert resp.status_code == 200
        data = resp.json()
        expected = len([l for l in _all() if l["grade"] == "6"])
        assert data["total"] == expected
        assert len(data["stories"]) == min(expected, 60)   # default page_size

    def test_grade_filter_all_stories_are_correct_grade(self, client):
        resp = client.get("/api/stories?grade=6")
        data = resp.json()
        assert all(s["grade"] == "6" for s in data["stories"])

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
        assert data["total"] == len(get_all_lessons())  # against the corpus, not a literal

    def test_page2_page_size_10_returns_10_stories(self, client):
        resp = client.get("/api/stories?page=2&page_size=10")
        data = resp.json()
        assert len(data["stories"]) == 10

    def test_last_page_returns_the_remainder(self, client):
        """Computed from `total`. The old version hardcoded "page 6 has 7 stories",
        which was arithmetic about a 57-lesson catalogue."""
        total = client.get("/api/stories?page_size=1").json()["total"]
        size = 10
        last = -(-total // size)
        data = client.get(f"/api/stories?page={last}&page_size={size}").json()
        assert len(data["stories"]) == total - (last - 1) * size

    def test_page_beyond_total_returns_empty(self, client):
        resp = client.get("/api/stories?page=100&page_size=10")
        data = resp.json()
        assert data["stories"] == []
        assert data["total"] == len(get_all_lessons())  # total is always the unsliced count

    def test_pages_are_non_overlapping(self, client):
        resp1 = client.get("/api/stories?page=1&page_size=10")
        resp2 = client.get("/api/stories?page=2&page_size=10")
        ids_p1 = {s["id"] for s in resp1.json()["stories"]}
        ids_p2 = {s["id"] for s in resp2.json()["stories"]}
        assert ids_p1.isdisjoint(ids_p2)

    def test_all_pages_together_cover_the_whole_corpus(self, client):
        """Page count derived from `total`, not a literal. The old version walked a
        fixed 6 pages — right for 57 lessons, so it silently stopped a third of the
        way through 175 and still asserted full coverage."""
        total = client.get("/api/stories?page_size=1").json()["total"]
        page_size, all_ids = 10, set()
        for page in range(1, -(-total // page_size) + 1):
            resp = client.get(f"/api/stories?page={page}&page_size={page_size}")
            for story in resp.json()["stories"]:
                all_ids.add(story["id"])
        assert len(all_ids) == total

    def test_page_size_1_returns_1_story(self, client):
        resp = client.get("/api/stories?page=1&page_size=1")
        data = resp.json()
        assert len(data["stories"]) == 1
        assert data["total"] > 1

    def test_page_zero_returns_422(self, client):
        resp = client.get("/api/stories?page=0")
        assert resp.status_code == 422

    def test_page_size_over_the_cap_returns_422(self, client):
        """The cap is 300 (`page_size: int = Query(60, ge=1, le=300)`), not 100 —
        this asserted 101 and passed only because the corpus never reached it."""
        assert client.get("/api/stories?page_size=301").status_code == 422
        assert client.get("/api/stories?page_size=300").status_code == 200


class TestStoryListItemSchema:
    """Validate shape of items in the list response."""

    def test_story_list_item_has_required_fields(self, client):
        resp = client.get("/api/stories?page_size=1")
        story = resp.json()["stories"][0]
        required = ["id", "title", "grade", "grade_code", "genre", "category",
                    "char_count", "thumbnail_url", "has_key_reading"]
        for field in required:
            assert field in story, f"StoryListItem missing field: {field}"

    # The xfail here said this field was 0/175, logged as a known gap. The gap
    # closed — the multimodal re-extraction fills it (intro 178/179, genre
    # 174/179, reading_benchmark 145/179 as of today) — but the marker stayed,
    # so strict xfail turned the field working into a failure. Removed: this is
    # a lock now, and it will notice if the field goes empty again.
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
        resp = client.get(f"/api/stories/{FIRST_LESSON_ID}")
        assert resp.status_code == 200

    def test_lesson_1_title(self, client):
        resp = client.get(f"/api/stories/{FIRST_LESSON_ID}")
        data = resp.json()
        assert data["title"] == "十秒的背後"

    def test_lesson_1_grade(self, client):
        resp = client.get(f"/api/stories/{FIRST_LESSON_ID}")
        data = resp.json()
        assert data["grade"] == "4"

    def test_lesson_1_has_paragraphs(self, client):
        resp = client.get(f"/api/stories/{FIRST_LESSON_ID}")
        data = resp.json()
        assert "paragraphs" in data
        assert isinstance(data["paragraphs"], list)
        assert len(data["paragraphs"]) > 0
        assert all(isinstance(p, str) for p in data["paragraphs"])

    def test_lesson_1_has_vocabulary(self, client):
        resp = client.get(f"/api/stories/{FIRST_LESSON_ID}")
        data = resp.json()
        assert "vocabulary" in data
        assert isinstance(data["vocabulary"], list)
        assert len(data["vocabulary"]) > 0

    def test_vocabulary_item_has_word_and_definition(self, client):
        resp = client.get(f"/api/stories/{FIRST_LESSON_ID}")
        vocab = resp.json()["vocabulary"]
        for item in vocab:
            assert "word" in item
            assert "definition" in item

    # The xfail here said this field was 0/175, logged as a known gap. The gap
    # closed — the multimodal re-extraction fills it (intro 178/179, genre
    # 174/179, reading_benchmark 145/179 as of today) — but the marker stayed,
    # so strict xfail turned the field working into a failure. Removed: this is
    # a lock now, and it will notice if the field goes empty again.
    def test_lesson_1_has_intro(self, client):
        resp = client.get(f"/api/stories/{FIRST_LESSON_ID}")
        data = resp.json()
        assert "intro" in data
        assert "author" in data["intro"]
        assert "background" in data["intro"]

    @pytest.mark.xfail(

        reason="二修抽取只產學習單；此欄位 0/175，登錄在 data/curriculum_qa/content_known_gaps.yaml#fields_not_extracted",

        strict=True,

    )

    def test_lesson_1_has_thumbnail_url(self, client):
        resp = client.get(f"/api/stories/{FIRST_LESSON_ID}")
        data = resp.json()
        assert "thumbnail_url" in data
        assert "lesson-1.webp" in data["thumbnail_url"]

    # The xfail here said this field was 0/175, logged as a known gap. The gap
    # closed — the multimodal re-extraction fills it (intro 178/179, genre
    # 174/179, reading_benchmark 145/179 as of today) — but the marker stayed,
    # so strict xfail turned the field working into a failure. Removed: this is
    # a lock now, and it will notice if the field goes empty again.
    def test_lesson_1_has_reading_benchmark(self, client):
        resp = client.get(f"/api/stories/{FIRST_LESSON_ID}")
        data = resp.json()
        assert "reading_benchmark" in data
        assert data["reading_benchmark"] is not None
        assert "levels" in data["reading_benchmark"]

    def test_lesson_1_has_fill_in_blank(self, client):
        resp = client.get(f"/api/stories/{FIRST_LESSON_ID}")
        data = resp.json()
        assert "fill_in_blank" in data
        assert isinstance(data["fill_in_blank"], list)

    def test_lesson_1_has_multiple_choice(self, client):
        resp = client.get(f"/api/stories/{FIRST_LESSON_ID}")
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
        resp = client.get(f"/api/stories/{FIRST_LESSON_ID}")
        data = resp.json()
        assert data["id"] == FIRST_LESSON_ID
        assert data["lesson_number"] == FIRST_LESSON_ID

    def test_all_175_story_ids_are_accessible(self, client):
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

    @pytest.mark.xfail(

        reason="二修抽取只產學習單；此欄位 0/175，登錄在 data/curriculum_qa/content_known_gaps.yaml#fields_not_extracted",

        strict=True,

    )

    def test_lesson_3_worksheet_pdf_url_is_proxied_not_absolute_gcs(self, client):
        resp = client.get("/api/stories/20003")
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
        resp = client.get(f"/api/stories/{FIRST_LESSON_ID}")
        data = resp.json()
        for field in self.REQUIRED_DETAIL_FIELDS:
            assert field in data, f"StoryDetail missing field: {field}"

    def test_detail_extends_list_item_with_paragraphs(self, client):
        resp = client.get(f"/api/stories/{FIRST_LESSON_ID}")
        data = resp.json()
        assert "paragraphs" in data

    def test_char_count_is_int(self, client):
        resp = client.get(f"/api/stories/{FIRST_LESSON_ID}")
        assert isinstance(resp.json()["char_count"], int)

    def test_grade_is_str(self, client):
        resp = client.get(f"/api/stories/{FIRST_LESSON_ID}")
        assert isinstance(resp.json()["grade"], str)

    def test_detail_is_accessible_by_tree_id(self, client):
        """Addressed by the id the tree assigns. The old version pinned id 14 to a
        named lesson; the renumber moved every lesson, so asserting a specific title
        against a specific id is asserting the old catalogue, not the API."""
        from app.services.lesson_loader import get_all_lessons
        lesson = get_all_lessons()[13]
        resp = client.get(f"/api/stories/{lesson['id']}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["title"] == lesson["title"]
        assert data["grade"] == lesson["grade"]
