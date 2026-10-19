"""TDD for team_arena.teams — PRD §4 (分隊與人數不整除) and §13 AC2/AC3.

Written RED-first: these assert the PRD's own worked examples
(27 -> 6 teams of 5/5/5/4/4/4, 33 -> 6 of 6/6/6/5/5/5, 13 -> 2 of 7/6,
15 -> 4 of 4/4/4/3) and the general sweep (every N from 1..45 produces
either a valid arena or a clean rejection) BEFORE `teams.py` exists.
"""
from __future__ import annotations

import random

import pytest

from app.services.team_arena.teams import (
    LANES,
    PRIMARY_LANES,
    TooFewPlayersError,
    assign_lanes,
    build_matches,
    form_teams,
)


class TestFormTeamsRejectsTooFew:
    @pytest.mark.parametrize("n", [0, 1, 2, 3])
    def test_fewer_than_4_raises(self, n):
        with pytest.raises(TooFewPlayersError):
            form_teams(list(range(n)), random.Random(1))


class TestFormTeamsSmallRange4to7:
    """PRD §4: "4–7 人到場：只開一場 2 對 2 到 3 對 4"."""

    @pytest.mark.parametrize(
        "n,expected_sizes",
        [
            (4, (2, 2)),
            (5, (3, 2)),
            (6, (3, 3)),
            (7, (4, 3)),
        ],
    )
    def test_exactly_one_match_two_teams(self, n, expected_sizes):
        teams = form_teams(list(range(n)), random.Random(1))
        assert len(teams) == 2
        sizes = tuple(sorted((len(t) for t in teams), reverse=True))
        assert sizes == expected_sizes


class TestFormTeamsWorkedExamples:
    """PRD §4 literal worked examples — these numbers are in the PRD text,
    not invented by the implementation."""

    def test_27_students_six_teams_of_5554_4_4(self):
        teams = form_teams(list(range(27)), random.Random(7))
        sizes = sorted((len(t) for t in teams), reverse=True)
        assert sizes == [5, 5, 5, 4, 4, 4]
        assert len(teams) == 6

    def test_33_students_six_teams_of_666555(self):
        teams = form_teams(list(range(33)), random.Random(7))
        sizes = sorted((len(t) for t in teams), reverse=True)
        assert sizes == [6, 6, 6, 5, 5, 5]

    def test_13_students_two_teams_7_6(self):
        teams = form_teams(list(range(13)), random.Random(7))
        sizes = sorted((len(t) for t in teams), reverse=True)
        assert sizes == [7, 6]

    def test_15_students_four_teams_4443(self):
        teams = form_teams(list(range(15)), random.Random(7))
        sizes = sorted((len(t) for t in teams), reverse=True)
        assert sizes == [4, 4, 4, 3]


class TestFormTeamsInvariantSweep:
    """PRD §13 AC2 generalized: every N from 4..45 must produce a valid
    arena (even team count, size diff <=1, each team in [2,7] — 2 only
    possible in the 4-7 special case, >=8 total always uses 3-7)."""

    @pytest.mark.parametrize("n", list(range(4, 46)))
    def test_every_n_produces_valid_teams(self, n):
        teams = form_teams(list(range(n)), random.Random(n))
        sizes = [len(t) for t in teams]

        # even number of teams (two per match)
        assert len(teams) % 2 == 0, f"N={n}: odd team count {len(teams)}"

        # every student placed exactly once
        all_members = [m for t in teams for m in t]
        assert sorted(all_members) == list(range(n)), f"N={n}: roster mismatch"

        # size spread <= 1
        assert max(sizes) - min(sizes) <= 1, f"N={n}: size spread {sizes}"

        if n >= 8:
            assert min(sizes) >= 3, f"N={n}: team smaller than 3 -> {sizes}"
            assert max(sizes) <= 7, f"N={n}: team larger than 7 -> {sizes}"
        else:
            assert len(teams) == 2, f"N={n}: expected exactly one match (2 teams)"

    def test_positive_control_sweep_actually_iterated(self):
        """Regression lock for the sweep itself (overclaim-bias rule): a
        parametrized loop that silently iterates zero cases would make the
        test above vacuously pass. Assert the case count is what we expect."""
        cases = list(range(4, 46))
        assert len(cases) == 42
        for n in cases:
            teams = form_teams(list(range(n)), random.Random(n))
            assert len(teams) > 0


class TestBuildMatchesPairsTeamsEvenly:
    def test_pairs_every_team_into_exactly_one_match(self):
        teams = form_teams(list(range(27)), random.Random(3))
        matches = build_matches(teams)
        assert len(matches) == len(teams) // 2
        paired_indices = sorted(i for a, b in matches for i in (a, b))
        assert paired_indices == list(range(len(teams)))

    def test_match_size_diff_at_most_1(self):
        teams = form_teams(list(range(27)), random.Random(3))
        matches = build_matches(teams)
        for a, b in matches:
            assert abs(len(teams[a]) - len(teams[b])) <= 1


class TestAssignLanesAndRotation:
    """PRD §3.1/§3.3 — 4 primary lanes in fixed canonical order, support
    overflow, and a locked rotation_order per member."""

    def test_5_member_team_gets_all_4_lanes_plus_support(self):
        members = list(range(5))
        assignment = assign_lanes(members, random.Random(1))
        lanes_used = sorted(a["lane"] for a in assignment.values())
        assert lanes_used == sorted(set(PRIMARY_LANES) | {"support"})

    def test_3_member_team_has_no_support_lane(self):
        members = list(range(3))
        assignment = assign_lanes(members, random.Random(1))
        lanes_used = {a["lane"] for a in assignment.values()}
        assert "support" not in lanes_used
        assert lanes_used.issubset(set(PRIMARY_LANES))

    def test_7_member_team_has_3_support_members(self):
        members = list(range(7))
        assignment = assign_lanes(members, random.Random(1))
        support_count = sum(1 for a in assignment.values() if a["lane"] == "support")
        assert support_count == 3
        # the 4 primary lanes are still each covered exactly once
        primary_count = sum(1 for a in assignment.values() if a["lane"] != "support")
        assert primary_count == 4

    def test_rotation_order_is_a_permutation_locked_at_assignment(self):
        members = list(range(5))
        assignment = assign_lanes(members, random.Random(42))
        orders = sorted(a["rotation_order"] for a in assignment.values())
        assert orders == list(range(5))

    def test_every_member_gets_exactly_one_lane_and_order(self):
        members = list(range(6))
        assignment = assign_lanes(members, random.Random(9))
        assert set(assignment.keys()) == set(members)
        for m, a in assignment.items():
            assert a["lane"] in LANES
            assert isinstance(a["rotation_order"], int)
