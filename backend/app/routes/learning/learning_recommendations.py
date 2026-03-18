"""Recommendations routes.

Handles rule-based learning recommendations and AI-powered story recommendations (Issue #252).
"""
import logging
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ...auth.dependencies import get_current_user
from ...database import get_db
from ...models.user import User
from ...services.stuck_detection_service import build_recommendations, detect_stuck_points
from ...services.learning_path_service import recommend_next_stories
from ._helpers import verify_student_access

router = APIRouter(tags=["learning"])
logger = logging.getLogger(__name__)


# ── Rule-based Recommendations ────────────────────────────────────────────────

class RecommendationItem(BaseModel):
    type: str
    title: str
    description: str
    action: str


class RecommendationsResponse(BaseModel):
    recommendations: list[RecommendationItem]
    total: int


@router.get(
    "/learning/students/{student_id}/recommendations",
    response_model=RecommendationsResponse,
)
def get_recommendations(
    student_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return personalised learning recommendations for a student.

    Accessible by the student themselves or their teacher.

    Rule-based recommendations derived from stuck-point analysis.
    No AI call — always fast and always available.
    """
    verify_student_access(student_id, current_user, db)
    stuck_data = detect_stuck_points(student_id, db)
    recs = build_recommendations(stuck_data)
    logger.info(
        "Generated %d recommendations for student %d",
        len(recs),
        student_id,
    )
    return RecommendationsResponse(
        recommendations=[RecommendationItem(**r) for r in recs],
        total=len(recs),
    )


# ── AI Learning Path Recommendations (Issue #252) ────────────────────────────

class StoryRecommendationItem(BaseModel):
    story_slug: str
    title: str
    grade: int
    genre: str
    difficulty_match_score: int
    reason: str


class StoryRecommendationsResponse(BaseModel):
    recommendations: list[StoryRecommendationItem]
    total: int


@router.get(
    "/learning/recommendations/{student_id}",
    response_model=StoryRecommendationsResponse,
)
def get_story_recommendations(
    student_id: int,
    limit: int = Query(5, ge=1, le=20),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return AI-personalized story recommendations for a student (Issue #252).

    Algorithmic (no ML model) — analyzes:
      - Past LearningSession accuracy to estimate student grade level
      - CharacterError records to find weak spots
      - Unread stories scored by difficulty match + character coverage + variety

    Accessible by the student themselves, their teacher, or their parent.
    """
    verify_student_access(student_id, current_user, db)
    recs = recommend_next_stories(student_id, db, limit=limit)
    logger.info(
        "Story recommendations for student %d: %d results",
        student_id, len(recs),
    )
    return StoryRecommendationsResponse(
        recommendations=[StoryRecommendationItem(**r) for r in recs],
        total=len(recs),
    )
