"""Task brief's explicit requirement: "no child-to-child messaging
endpoints exist" for 五人對抗賽 — PRD §3.4/§11: assist is a private,
server-mediated answer submission, never a channel for one student's text/
choice to reach another student directly. This scans the ACTUAL registered
FastAPI routes (not just "I didn't build one, trust me") so adding a chat/
message/dm endpoint later would fail this test, not just escape notice.
"""
from __future__ import annotations

from app.main import app

from tests._route_walk import walk_routes

_BANNED_PATH_SUBSTRINGS = ("message", "chat", "dm", "whisper", "comment", "broadcast")


def _team_arena_routes() -> list[str]:
    # walk_routes, not a flat app.routes scan: newer FastAPI (CI runs an
    # unpinned version) nests include_router() routes, so a flat scan sees none.
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

    def test_exact_route_set_matches_prd_10(self):
        """PRD §10's API table lists exactly these 8 routes — pinning the
        full set (not just absence of banned substrings) means a new,
        innocuously-named endpoint (e.g. "/sessions/{code}/nudge") still
        forces a conscious update here rather than silently expanding the
        student-reachable surface."""
        expected = {
            "/api/team-arena/sessions",
            "/api/team-arena/sessions/{code}/join",
            "/api/team-arena/sessions/{code}/teams",
            "/api/team-arena/sessions/{code}/lane",
            "/api/team-arena/sessions/{code}/control",
            "/api/team-arena/sessions/{code}/state",
            "/api/team-arena/sessions/{code}/answer",
            "/api/team-arena/sessions/{code}/result",
        }
        assert set(_team_arena_routes()) == expected
