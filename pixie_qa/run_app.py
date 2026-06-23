"""Pixie Runnable for the spotlight/keypoints multimodal vision judge.

Drives the REAL judge pipeline (render staging page -> Gemini 2.5-flash vision
verdict) the same way `spotlight_vision_judge.py --story-id N --step S` does.
Nothing is mocked: render hits live staging, the verdict comes from a real
Gemini vision call (the value-generating LLM, per eval-driven-dev rules).

The captured output is the judge's verdict label (wrap purpose="output"), plus
the full judge dict (wrap purpose="state") so evaluators can inspect reasoning.
"""

import asyncio
import os
import sys
from pathlib import Path

from pydantic import BaseModel
import pixie

# Vertex AI ADC must resolve to lingoleap-dev. A stray GOOGLE_APPLICATION_
# CREDENTIALS env points at another project's SA -> 403. Clear it so the genai
# client falls back to ADC (authorized_user, quota_project=lingoleap-dev).
os.environ.pop("GOOGLE_APPLICATION_CREDENTIALS", None)

REPO_ROOT = Path(__file__).resolve().parent.parent
for p in (str(REPO_ROOT / "scripts"), str(REPO_ROOT / "backend")):
    if p not in sys.path:
        sys.path.insert(0, p)

# Real production pipeline pieces (reused, not reimplemented).
from spotlight_vision_judge import (  # noqa: E402
    judge_screenshot,
    capture_fullpage,
)
from content_evidence_gate import (  # noqa: E402
    Browse,
    browse_login,
    fetch_story,
    l3_render_cell,
)

SHOTS_DIR = REPO_ROOT / "pixie_qa" / "results" / "_vision_shots"


class JudgeArgs(BaseModel):
    story_id: int
    step: str  # "reading-strategy" | "story-structure"


class VisionJudgeRunnable(pixie.Runnable[JudgeArgs]):
    """Drives the spotlight/keypoints vision judge for evaluation."""

    _sem: asyncio.Semaphore
    _browse: Browse
    _logged_in: bool

    @classmethod
    def create(cls) -> "VisionJudgeRunnable":
        inst = cls()
        # One shared headless browser session -> serialise all runs.
        inst._sem = asyncio.Semaphore(1)
        inst._logged_in = False
        return inst

    async def setup(self) -> None:
        SHOTS_DIR.mkdir(parents=True, exist_ok=True)
        self._browse = Browse()
        await asyncio.to_thread(self._browse.restart)
        await asyncio.sleep(2)
        ok = await asyncio.to_thread(browse_login, self._browse)
        if not ok:
            raise RuntimeError("demo login failed (still on /login)")
        self._logged_in = True

    async def run(self, args: JudgeArgs) -> None:
        async with self._sem:
            story = await asyncio.to_thread(fetch_story, args.story_id)
            render = await asyncio.to_thread(
                l3_render_cell, self._browse, story, args.step, SHOTS_DIR
            )
            shot_path = SHOTS_DIR / str(args.story_id) / f"{args.step}.png"

            if render["screenshot"]["bytes"] == 0 or render["render"][
                "on_login_page"
            ]:
                detail = {
                    "verdict": "render_failed",
                    "confidence": 0.0,
                    "reasoning": (
                        "render produced no usable screenshot "
                        f"(on_login={render['render']['on_login_page']}, "
                        f"loaded={render['render']['loaded']})"
                    ),
                    "suspected_actual_lesson": "",
                }
            else:
                await asyncio.to_thread(
                    capture_fullpage, self._browse, shot_path
                )
                detail = await asyncio.to_thread(
                    judge_screenshot, shot_path, story, args.step
                )

            # Output captured for evaluators: the verdict label is the scored
            # value; the full dict is state for reasoning audit.
            pixie.wrap(
                detail.get("verdict", "error"),
                purpose="output",
                name="vision_verdict",
                description="judge verdict label (faithful/cross_lesson/skeleton/figure_broken)",
            )
            pixie.wrap(
                detail,
                purpose="state",
                name="judge_detail",
                description="full judge output: verdict + confidence + reasoning + suspected_actual_lesson",
            )

    async def teardown(self) -> None:
        # Leave the browser session; gstack reuses it across runs.
        pass
