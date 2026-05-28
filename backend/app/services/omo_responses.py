"""OMO Pydantic response schemas + response builder helpers.

Extracted from backend/app/routes/omo.py as part of the 4-module split.
AnalysisBy: issue #1770 — routes/omo.py 1197-line refactor.

Contains:
- All Pydantic request/response models used by the OMO routes
- _build_upload_response(): DB ORM → OmoUploadResponse translator
"""

from typing import Literal, Optional

from pydantic import BaseModel, Field

from ..models.omo_upload import OmoUpload


# ── Pydantic schemas ───────────────────────────────────────────────────────────

class LessonSummaryResponse(BaseModel):
    """Simplified lesson entry for the manual picker in the 3-tier confidence UX."""
    lesson_id: int
    grade_code: str
    title: str


class LessonCandidateResponse(BaseModel):
    lesson_id: int
    grade_code: str
    title: str
    confidence: float
    reasoning: str
    # #1775: canonical Story.id resolved at identifier service boundary.
    # None when the lesson exists in the YAML catalog but has no matching DB row.
    # Frontend should prefer story_id over lesson_id for /api/stories lookups.
    story_id: Optional[int] = None


class AnswerFlagInfo(BaseModel):
    flagged_by: int
    reason: str
    flagged_at: str


class AnswerItem(BaseModel):
    question_id: str
    student_answer: str
    # Optional: multiple_choice questions can have answer=null (no correct answer
    # in YAML — used for open-ended questions like mc_2 in L24).
    correct_answer: Optional[str] = None
    score: float
    ai_confidence: float
    reasoning: str
    # #2011 follow-up: the question prompt from lesson YAML, surfaced in the
    # result page header. Optional — uploads graded before this field was
    # added will have it as None; frontend falls back to "題目 {question_id}".
    context: Optional[str] = None
    source_attempt_id: Optional[int] = None
    position: Optional[dict] = None
    crop_image_url: Optional[str] = None
    flag: Optional[AnswerFlagInfo] = None


class OmoUploadResponse(BaseModel):
    upload_id: int
    status: Literal["pending", "identifying", "identified", "grading", "graded", "error"]
    candidates: list[LessonCandidateResponse]
    answers: list[AnswerItem]
    overall_score: Optional[float] = None
    ai_overall_confidence: Optional[float] = None
    progress: Optional[dict] = None
    error_message: Optional[str] = None
    # Phase 1b dedup fields
    from_cache: bool = False         # True if this response reuses a prior upload (same image hash)
    already_graded: bool = False     # True if the cached upload already has status=graded


class OmoAttemptResponse(BaseModel):
    upload_id: int
    attempt_id: int
    attempt_idx: int
    status: str
    message: str


class OmoConfirmRequest(BaseModel):
    confirmed_lesson_id: int


class OmoConfirmResponse(BaseModel):
    upload_id: int
    lesson_id: int
    status: str
    message: str


class OmoRegradeResponse(BaseModel):
    upload_id: int
    status: str
    message: str


class FlagRequest(BaseModel):
    reason: str = "AI 辨識不正確"


class SignedUrlResponse(BaseModel):
    url: Optional[str]
    expires_in_seconds: int = 3600


class CropSignedUrlResponse(BaseModel):
    url: Optional[str]
    expires_in_seconds: int = 3600


class OmoSignedImageInfo(BaseModel):
    attempt_id: int
    index: int
    url: Optional[str] = None


class OmoByLessonResponse(BaseModel):
    upload_id: Optional[int] = None
    status: Optional[str] = None
    has_prior_upload: bool = False
    images: list[OmoSignedImageInfo] = Field(default_factory=list)


class OmoHistoryItem(BaseModel):
    """Compact representation of one OMO upload for the history list (#1975)."""
    upload_id: int
    lesson_id: Optional[int] = None
    lesson_title: Optional[str] = None
    grade_code: Optional[str] = None
    status: str
    overall_score: Optional[float] = None
    answers_count: int = 0
    created_at: str   # ISO-8601
    thumbnail_url: Optional[str] = None


class OmoHistoryResponse(BaseModel):
    """Paginated list of the current user's OMO uploads, newest first."""
    total: int
    limit: int
    offset: int
    items: list[OmoHistoryItem] = Field(default_factory=list)


# ── Response builder helpers ───────────────────────────────────────────────────

def _build_upload_response(upload: OmoUpload) -> OmoUploadResponse:
    """Convert ORM object to response schema."""
    candidates = []
    if upload.identification and isinstance(upload.identification, list):
        candidates = [
            LessonCandidateResponse(
                lesson_id=c["lesson_id"],
                grade_code=c.get("grade_code", ""),
                title=c.get("title", ""),
                confidence=c.get("confidence", 0.0),
                reasoning=c.get("reasoning", ""),
                # #1775: story_id may already be in the stored JSON (new uploads)
                # or absent for uploads made before this fix (None is acceptable).
                story_id=c.get("story_id"),
            )
            for c in upload.identification
        ]

    answers = []
    if upload.answers and isinstance(upload.answers, list):
        for a in upload.answers:
            flag_info = None
            if a.get("flag"):
                flag_info = AnswerFlagInfo(
                    flagged_by=a["flag"].get("flagged_by", 0),
                    reason=a["flag"].get("reason", ""),
                    flagged_at=a["flag"].get("flagged_at", ""),
                )
            answers.append(AnswerItem(
                question_id=a.get("question_id", ""),
                student_answer=a.get("student_answer", ""),
                correct_answer=a.get("correct_answer", ""),
                score=a.get("score", 0.0),
                ai_confidence=a.get("ai_confidence", 0.0),
                reasoning=a.get("reasoning", ""),
                context=a.get("context"),  # #2011 follow-up; None for pre-existing uploads
                source_attempt_id=a.get("source_attempt_id"),
                position=a.get("position"),
                crop_image_url=a.get("crop_image_url"),
                flag=flag_info,
            ))

    return OmoUploadResponse(
        upload_id=upload.id,
        status=upload.status,  # type: ignore[arg-type]
        candidates=candidates,
        answers=answers,
        overall_score=upload.overall_score,
        ai_overall_confidence=upload.ai_overall_confidence,
        progress=upload.progress or {},
        error_message=upload.error_message,
        from_cache=False,
        already_graded=False,
    )
