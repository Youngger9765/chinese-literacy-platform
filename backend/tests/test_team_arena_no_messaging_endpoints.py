"""No child-to-child messaging endpoints exist for 多人對抗賽 — PRD §0 v2
改版 H: "只能點選項，不能打字——跨學校的小學生之間不開任何文字或訊息管道".
Scans the ACTUAL registered FastAPI routes (not just "I didn't build one,
trust me") so adding a chat/message/dm endpoint later would fail this
test, not just escape notice.
"""
from __future__ import annotations

from app.main import app

from tests._route_walk import walk_routes

_BANNED_PATH_SUBSTRINGS = ("message", "chat", "dm", "whisper", "comment", "broadcast")


def _team_arena_routes() -> list[str]:
    return sorted({r.path for r in walk_routes(app) if r.path.startswith("/api/team-arena")})


class TestNoChildToChildMessaging:
    def test_scan_actually_finds_team_arena_routes(self):
        """Regression lock for the scan itself — a typo'd prefix would make
        the real test below vacuously pass."""
        routes = _team_arena_routes()
        assert len(routes) >= 8, f"expected at least 8 team_arena routes, got {routes}"

    def test_no_route_path_suggests_messaging(self):
        routes = _team_arena_routes()
        hits = [p for p in routes for term in _BANNED_PATH_SUBSTRINGS if term in p.lower()]
        assert not hits, f"found messaging-shaped route(s): {hits}"

    def test_exact_route_set_matches_prd_10_v2(self):
        """v2's API surface — pinning the full set (not just absence of
        banned substrings) means a new, innocuously-named endpoint (e.g.
        "/sessions/{code}/nudge") still forces a conscious update here
        rather than silently expanding the student-reachable surface."""
        expected = {
            "/api/team-arena/sessions",
            "/api/team-arena/sessions/{code}/join",
            "/api/team-arena/sessions/{code}/control",
            "/api/team-arena/sessions/{code}/state",
            "/api/team-arena/sessions/{code}/answer",
            "/api/team-arena/sessions/{code}/weapons",
            "/api/team-arena/sessions/{code}/suggest",
            "/api/team-arena/sessions/{code}/result",
        }
        assert set(_team_arena_routes()) == expected

    def test_suggestion_request_schema_is_a_single_option_key_not_free_text(self):
        """PRD rule H: 呼叫隊友的建議只能是選項 key（如 "A"），不是自由輸入文
        字欄位。Locks the schema shape itself, not just route paths."""
        from app.schemas.team_arena import TeamArenaSuggestRequest

        fields = TeamArenaSuggestRequest.model_fields
        assert set(fields.keys()) == {"choice_key"}

    def test_weapon_request_schema_is_a_fixed_enum_not_free_text(self):
        from app.schemas.team_arena import TeamArenaWeaponRequest
        from app.services.team_arena.weapons import WEAPON_KEYS

        with __import__("pytest").raises(Exception):
            TeamArenaWeaponRequest(weapon="anything the user typed")
        # A valid, fixed value is still accepted.
        TeamArenaWeaponRequest(weapon=WEAPON_KEYS[0])
