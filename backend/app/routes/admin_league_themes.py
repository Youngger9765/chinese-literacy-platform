"""League Theme Studio API — system_admin-only CRUD + live validation +
preview data for 跨班賽季's storyline/chest/badge content.

Authorization follows the same pattern as admin_story_structure_lab.py:
router-level `dependencies=[require_role("system_admin")]`. See
tests/test_admin_league_themes_authz.py for the lowest-privilege-negative +
positive-control pattern (test_admin_story_structure_lab_authz.py).

⚠️ Persistence caveat: see league_theme_store.py's module docstring. Custom
themes / the active-default pointer / per-season assignment all live in an
in-memory store that does NOT survive a restart or span Cloud Run replicas
until a real `league_themes` table (+ `league_seasons.theme_key` column)
exists — not approved yet. This router is fully functional for local
dev/QA/preview purposes today; it is not yet safe to rely on in production
across multiple instances.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..auth.dependencies import get_current_user, require_role
from ..models.user import User
from ..schemas.league_theme import LeagueThemeSummary
from ..services import league_theme_service as svc
from ..services.league_theme_store import get_theme_store

router = APIRouter(
    prefix="/admin/league-themes",
    tags=["admin-league-themes"],
    dependencies=[require_role("system_admin")],
)


def _handle_service_error(exc: svc.ThemeServiceError) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail=exc.message)


class ValidateThemeRequest(BaseModel):
    """Deliberately NOT `LeagueTheme` itself — this endpoint must accept
    an invalid/partial payload (that's the point of live validation) and
    return structured errors rather than FastAPI's 422 on the request body
    itself before our own handler even runs."""

    payload: dict


class ValidateThemeResponse(BaseModel):
    valid: bool
    errors: list[dict]


class SetActiveThemeRequest(BaseModel):
    key: str


class AssignSeasonThemeRequest(BaseModel):
    key: str | None = None


@router.get("", response_model=list[LeagueThemeSummary])
def list_themes(current_user: User = Depends(get_current_user)) -> list[LeagueThemeSummary]:
    return svc.list_themes(get_theme_store())


@router.get("/active")
def get_active_theme(current_user: User = Depends(get_current_user)) -> dict:
    return svc.get_active_theme(get_theme_store()).model_dump()


@router.put("/active")
def set_active_theme(
    payload: SetActiveThemeRequest, current_user: User = Depends(get_current_user)
) -> dict:
    try:
        return svc.set_active_theme(get_theme_store(), payload.key).model_dump()
    except svc.ThemeServiceError as exc:
        raise _handle_service_error(exc)


@router.post("/validate", response_model=ValidateThemeResponse)
def validate_theme(payload: ValidateThemeRequest, current_user: User = Depends(get_current_user)) -> ValidateThemeResponse:
    theme, errors = svc.validate_theme_payload(payload.payload)
    return ValidateThemeResponse(valid=theme is not None, errors=errors)


@router.get("/{key}")
def get_theme(key: str, current_user: User = Depends(get_current_user)) -> dict:
    try:
        return svc.get_theme_or_404(get_theme_store(), key).model_dump()
    except svc.ThemeServiceError as exc:
        raise _handle_service_error(exc)


@router.put("/{key}")
def upsert_theme(
    key: str, payload: ValidateThemeRequest, current_user: User = Depends(get_current_user)
) -> dict:
    raw = dict(payload.payload)
    raw["key"] = key  # URL key is authoritative, not whatever the body says
    try:
        return svc.upsert_custom_theme(get_theme_store(), raw).model_dump()
    except svc.ThemeServiceError as exc:
        raise _handle_service_error(exc)


@router.delete("/{key}", status_code=204)
def delete_theme(key: str, current_user: User = Depends(get_current_user)) -> None:
    try:
        svc.delete_custom_theme(get_theme_store(), key)
    except svc.ThemeServiceError as exc:
        raise _handle_service_error(exc)


@router.put("/seasons/{season_id}")
def assign_season_theme(
    season_id: int,
    payload: AssignSeasonThemeRequest,
    current_user: User = Depends(get_current_user),
) -> dict:
    try:
        theme = svc.assign_season_theme(get_theme_store(), season_id, payload.key)
    except svc.ThemeServiceError as exc:
        raise _handle_service_error(exc)
    return {"season_id": season_id, "theme": theme.model_dump() if theme else None}


@router.get("/seasons/{season_id}")
def get_season_theme(season_id: int, current_user: User = Depends(get_current_user)) -> dict:
    from types import SimpleNamespace

    store = get_theme_store()
    key = store.get_season_theme_key(season_id)
    theme = svc.get_theme_for_season(store, SimpleNamespace(id=season_id))
    return {"season_id": season_id, "override_key": key, "effective_theme": theme.model_dump()}
