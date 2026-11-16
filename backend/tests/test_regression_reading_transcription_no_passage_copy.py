"""#4066 — the transcriber must not be handed a passage it can copy.

Prod evidence (2026-11-17, saved prod attempts re-transcribed with and without
the passage in the prompt, same model/config): attempt 152 (lesson 20017) came
back as the passage verbatim (99.6%) while the same audio WITHOUT the passage
showed the child skipped the opening sentence and paraphrased several phrases
(74.9%). Attempt 120 (lesson 20145): 100% vs 62%. Given an ordered passage, the
model rewrites what the child actually said back into the reference text.

Lock: whatever hint the model gets must carry no reading order — no run of the
passage's characters long enough to copy back — while still offering every
character of the passage (proper nouns / homophones stay resolvable).
"""

import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import json
from unittest.mock import MagicMock, patch

import pytest

PASSAGE = (
    "歷史學家哈拉瑞在人類大歷史中提出一個很奇妙的觀點：智人之所以能成為地球上最有影響力的物種，"
    "不是因為我們跑得最快、力氣最大、牙齒最尖，而是因為我們會相信共同的故事。"
)
_CJK = re.compile(r"[一-鿿]")


def _longest_copied_run(prompt: str, passage: str) -> int:
    """Longest run of consecutive passage CJK chars that appears in the prompt's CJK stream."""
    p = "".join(_CJK.findall(passage))
    q = "".join(_CJK.findall(prompt))
    best = 0
    for i in range(len(p)):
        n = best + 1
        while i + n <= len(p) and p[i:i + n] in q:
            best, n = n, n + 1
    return best


def _resp():
    r = MagicMock()
    r.candidates = [MagicMock()]
    r.candidates[0].finish_reason = "STOP"
    r.text = json.dumps({"transcript": PASSAGE, "reasoning": "ok"})
    r.prompt_feedback = MagicMock()
    r.prompt_feedback.block_reason = None
    return r


async def _capture_prompt_texts(target_text: str) -> list[str]:
    """Run the PRODUCTION transcribe_reading_audio; return the user text parts, system prompt last."""
    from app.services import reading_transcription_service as rts

    seen: dict = {}

    async def fake_hedged(call, *, hedge_after):
        seen.update(call.keywords)
        return _resp()

    async def fake_to_thread(fn, *a, **k):
        return -10.0 if getattr(fn, "__name__", "") == "_max_volume_db" else b"ogg"

    with (
        patch("google.genai.Client", MagicMock()),
        patch.object(rts, "_hedged_call", new=fake_hedged),
        patch.object(rts.asyncio, "to_thread", new=fake_to_thread),
        patch.object(rts, "_check_safety_filter", new=lambda r: None),
    ):
        result = await rts.transcribe_reading_audio(
            audio_bytes=b"x", mime_type="audio/webm", target_text=target_text, duration_ms=20000,
        )
    assert result["method"] == "gemini", result  # the call really went through the prompt path
    texts = [p.text for c in seen["contents"] for p in c.parts if getattr(p, "text", None)]
    return texts + [seen["config"].system_instruction]


def test_run_detector_has_teeth():
    # positive control: the detector must see a verbatim passage as a long run
    assert _longest_copied_run("課文：" + PASSAGE, PASSAGE) == len(_CJK.findall(PASSAGE))
    # negative control: a code-point-sorted char set carries (almost) no order
    assert _longest_copied_run("".join(sorted(set(_CJK.findall(PASSAGE)))), PASSAGE) <= 3


@pytest.mark.asyncio
async def test_prompt_carries_no_copyable_run_of_the_passage():
    texts = await _capture_prompt_texts(PASSAGE)
    run = _longest_copied_run("\n".join(texts), PASSAGE)
    # 2–3 consecutive chars can line up by accident in a code-point-sorted list;
    # a copyable clause is far longer. Pre-fix this is the whole passage.
    assert run <= 3, f"prompt contains a {run}-char run of the passage in reading order"


@pytest.mark.asyncio
async def test_prompt_still_offers_every_passage_character():
    texts = await _capture_prompt_texts(PASSAGE)
    offered = set(_CJK.findall("\n".join(texts[:-1])))  # user parts only, not system prompt
    missing = set(_CJK.findall(PASSAGE)) - offered
    assert not missing, f"hint dropped passage characters (names/homophones unresolvable): {missing}"
