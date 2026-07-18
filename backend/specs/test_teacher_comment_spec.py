import re

import pytest

from app.services.ai_generation.teacher_comment import generate_teacher_comment


EMOJI_RE = re.compile(
    "["
    "\U0001F300-\U0001FAFF"
    "\U00002700-\U000027BF"
    "\U00002600-\U000026FF"
    "]"
)


@pytest.mark.asyncio
async def test_teacher_comment_no_data_returns_empty_without_model_call(monkeypatch):
    calls = {"count": 0}

    async def fake_generate_structured_response(**kwargs):
        calls["count"] += 1
        return {"comment": "should not be generated"}

    monkeypatch.setattr(
        "app.services.ai_generation.teacher_comment.generate_structured_response",
        fake_generate_structured_response,
    )

    result = await generate_teacher_comment(
        story_title="沒有資料的課文",
        accuracy=None,
        cpm=None,
        error_chars=["錯"],
        comprehension_score=None,
    )

    assert result == ""
    assert calls["count"] == 0


@pytest.mark.asyncio
async def test_teacher_comment_model_exception_returns_empty(monkeypatch):
    async def fake_generate_structured_response(**kwargs):
        raise RuntimeError("mock teacher comment model outage")

    monkeypatch.setattr(
        "app.services.ai_generation.teacher_comment.generate_structured_response",
        fake_generate_structured_response,
    )

    result = await generate_teacher_comment(
        story_title="模型失敗的課文",
        accuracy=82.0,
        cpm=118.0,
        error_chars=["藍", "籃"],
        comprehension_score=73.0,
    )

    assert result == ""


@pytest.mark.asyncio
async def test_teacher_comment_normal_path_returns_comment_str_with_error_chars_and_no_emoji(monkeypatch):
    async def fake_generate_structured_response(**kwargs):
        return {"comment": "你已經能穩定朗讀，請再練習藍、籃這兩個容易混淆的字"}

    monkeypatch.setattr(
        "app.services.ai_generation.teacher_comment.generate_structured_response",
        fake_generate_structured_response,
    )

    result = await generate_teacher_comment(
        story_title="容易混淆的字",
        accuracy=91.0,
        cpm=146.0,
        error_chars=["藍", "籃"],
        comprehension_score=88.0,
    )

    # Contract: generate_teacher_comment returns the comment STRING (not a dict);
    # it extracts result.get("comment", "") from the structured LLM response.
    assert isinstance(result, str)
    assert result  # non-empty comment on the normal path
    assert "藍" in result
    assert "籃" in result
    assert EMOJI_RE.search(result) is None
