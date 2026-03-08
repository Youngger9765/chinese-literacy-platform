from datetime import datetime

from pydantic import BaseModel, Field


VALID_CATEGORIES = {"bug", "feature", "question", "other"}
VALID_STATUSES = {"open", "in_progress", "resolved", "closed"}


class FeedbackCreateRequest(BaseModel):
    category: str = Field(..., description="One of: bug, feature, question, other")
    title: str = Field(..., min_length=1, max_length=200)
    description: str | None = None
    page_url: str | None = Field(None, max_length=500)

    def model_post_init(self, __context: object) -> None:
        if self.category not in VALID_CATEGORIES:
            raise ValueError(f"category must be one of {VALID_CATEGORIES}")


class FeedbackStatusUpdateRequest(BaseModel):
    status: str = Field(..., description="One of: open, in_progress, resolved, closed")

    def model_post_init(self, __context: object) -> None:
        if self.status not in VALID_STATUSES:
            raise ValueError(f"status must be one of {VALID_STATUSES}")


class FeedbackResponse(BaseModel):
    id: int
    user_id: int
    user_name: str
    category: str
    title: str
    description: str | None
    page_url: str | None
    status: str
    created_at: datetime

    model_config = {"from_attributes": True}


class FeedbackListResponse(BaseModel):
    items: list[FeedbackResponse]
    total: int
    page: int
    page_size: int
