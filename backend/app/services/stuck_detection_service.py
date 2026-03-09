"""
Stub for stuck_detection_service (Issue #91).

This module provides minimal implementations for stuck-point detection
and recommendations. The full implementation is on the staging branch
and will be merged after the feature branch is integrated.
"""
from sqlalchemy.orm import Session


def detect_stuck_points(student_id: int, db: Session) -> dict:
    """Detect learning stuck-points for a student.

    Returns a dict with:
    - story_stuck: list of stories the student is stuck on
    - character_stuck: list of characters with repeated errors
    - is_declining: whether accuracy is declining
    - accuracy_trend: list of recent accuracy values
    """
    return {
        "story_stuck": [],
        "character_stuck": [],
        "is_declining": False,
        "accuracy_trend": [],
    }


def build_recommendations(stuck_data: dict) -> list[dict]:
    """Build learning recommendations from stuck-point data."""
    return []
