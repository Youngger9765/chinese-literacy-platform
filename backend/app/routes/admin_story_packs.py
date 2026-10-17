"""Admin Story Pack Studio API (「劇情包管理」) — system_admin-only CRUD +
live validation + preview data for the world/story content a game mode
binds to (today: 跨班賽季's storyline/chest/badge content).

Generalized 2026-10-16 from `admin_league_themes.py` per Young's direction
— same endpoints, mode-agnostic naming (`story-packs` instead of
`league-themes`). The `seasons/{id}` endpoints remain league-specific
(league is the only consumer of story packs so far — Young's MVP-scope
correction explicitly deferred building a real adapter abstraction for
other modes); a future second consumer would get its own small assignment
endpoint, not share this one.

Authorization follows the same pattern as admin_story_structure_lab.py:
router-level `dependencies=[require_role("system_admin")]`. See
tests/test_admin_story_packs_authz.py for the lowest-privilege-negative +
positive-control pattern.

⚠️ Persistence: see story_pack_store.py's module docstring (2026-10-16 —
Young approved the migration). Custom pack content and per-season
assignment are durable (`story_packs` table, `league_seasons.
story_pack_key` FK) and shared across Cloud Run replicas; only the
platform-wide active-default pointer remains process-local (narrower scope
than Young's approval covered — see that docstring).
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..auth.dependencies import get_current_user, require_role
from ..database import get_db
from ..models.user import User
from ..schemas.story_pack import StoryPackSummary
from ..services import story_pack_service as svc
from ..services.story_pack_store import get_story_pack_store

router = APIRouter(
    prefix="/admin/story-packs",
    tags=["admin-story-packs"],
    dependencies=[require_role("system_admin")],
)


def _handle_service_error(exc: svc.StoryPackServiceError) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail=exc.message)


class ValidatePackRequest(BaseModel):
    """Deliberately NOT `StoryPack` itself — this endpoint must accept an
    invalid/partial payload (that's the point of live validation) and
    return structured errors rather than FastAPI's 422 on the request body
    itself before our own handler even runs."""

    payload: dict


class ValidatePackResponse(BaseModel):
    valid: bool
    errors: list[dict]


class SetActivePackRequest(BaseModel):
    key: str


class AssignSeasonPackRequest(BaseModel):
    key: str | None = None


@router.get("", response_model=list[StoryPackSummary])
def list_packs(
    current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> list[StoryPackSummary]:
    return svc.list_packs(get_story_pack_store(db))


@router.get("/active")
def get_active_pack(
    current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> dict:
    return svc.get_active_pack(get_story_pack_store(db)).model_dump()


@router.put("/active")
def set_active_pack(
    payload: SetActivePackRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    try:
        return svc.set_active_pack(get_story_pack_store(db), payload.key).model_dump()
    except svc.StoryPackServiceError as exc:
        raise _handle_service_error(exc)


@router.post("/validate", response_model=ValidatePackResponse)
def validate_pack(payload: ValidatePackRequest, current_user: User = Depends(get_current_user)) -> ValidatePackResponse:
    pack, errors = svc.validate_pack_payload(payload.payload)
    return ValidatePackResponse(valid=pack is not None, errors=errors)


@router.get("/{key}")
def get_pack(
    key: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> dict:
    try:
        return svc.get_pack_or_404(get_story_pack_store(db), key).model_dump()
    except svc.StoryPackServiceError as exc:
        raise _handle_service_error(exc)


@router.put("/{key}")
def upsert_pack(
    key: str,
    payload: ValidatePackRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    raw = dict(payload.payload)
    raw["key"] = key  # URL key is authoritative, not whatever the body says
    try:
        return svc.upsert_custom_pack(get_story_pack_store(db), raw).model_dump()
    except svc.StoryPackServiceError as exc:
        if exc.errors:
            # Issue 3615: hand the studio the same field-level Chinese errors
            # the live validator returns, not just a generic sentence.
            return JSONResponse(status_code=exc.status_code, content={"detail": exc.message, "errors": exc.errors})
        raise _handle_service_error(exc)


@router.delete("/{key}", status_code=204)
def delete_pack(
    key: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> None:
    try:
        svc.delete_custom_pack(get_story_pack_store(db), key)
    except svc.StoryPackServiceError as exc:
        raise _handle_service_error(exc)


@router.put("/seasons/{season_id}")
def assign_season_pack(
    season_id: int,
    payload: AssignSeasonPackRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    try:
        pack = svc.assign_season_pack(get_story_pack_store(db), season_id, payload.key)
    except svc.StoryPackServiceError as exc:
        raise _handle_service_error(exc)
    return {"season_id": season_id, "pack": pack.model_dump() if pack else None}


@router.get("/seasons/{season_id}")
def get_season_pack(
    season_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> dict:
    from types import SimpleNamespace

    store = get_story_pack_store(db)
    key = store.get_season_story_pack_key(season_id)
    pack = svc.get_pack_for_season(store, SimpleNamespace(id=season_id))
    return {"season_id": season_id, "override_key": key, "effective_pack": pack.model_dump()}
