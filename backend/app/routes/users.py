from fastapi import APIRouter

router = APIRouter(tags=["users"])


@router.get("/users/me")
def get_current_user():
    """Stub: returns current user info. Auth not yet implemented."""
    return {"message": "Auth not yet implemented"}
