"""
Tests for app.services.iap_allowlist_service — pure parsing of a real-shaped
GCP IAM Policy into the admin allowlist view (Issue #3720).

No network / no google-auth here: `parse_bindings_for_role` takes raw
IAM-policy-shaped dicts, exactly as `gcp_iap_client.fetch_iap_policies()`
would return them. `get_iap_allowlist` tests monkeypatch the client module
to exercise the "not configured" / "GCP error" / "success" orchestration.
"""

import sys
import os
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest

from app.services import gcp_iap_client
from app.services.iap_allowlist_service import (
    ADMIN_DOMAIN,
    get_iap_allowlist,
    parse_bindings_for_role,
)

NOW = datetime(2026, 10, 23, 12, 0, 0, tzinfo=timezone.utc)
ROLE = "roles/iap.httpsResourceAccessor"


def _binding(members, title=None, expression=None):
    b = {"role": ROLE, "members": members}
    if title is not None or expression is not None:
        b["condition"] = {"title": title or "", "expression": expression or ""}
    return b


# ---------------------------------------------------------------------------
# gcp_iap_client — IAP policy request shape and Cloud Run resource path
# ---------------------------------------------------------------------------


def test_fetch_one_requests_iam_policy_version_3_for_conditional_bindings():
    response = MagicMock(status_code=200)
    response.json.return_value = {}
    session = MagicMock()
    session.post.return_value = response

    with (
        patch("google.auth.default", return_value=(MagicMock(), "lingoleap-dev")),
        patch("google.auth.transport.requests.AuthorizedSession", return_value=session),
    ):
        assert gcp_iap_client._fetch_one("some/resource") == {}

    session.post.assert_called_once_with(
        "https://iap.googleapis.com/v1/some/resource:getIamPolicy",
        json={"options": {"requestedPolicyVersion": 3}},
        timeout=10,
    )


def test_iap_resource_name_uses_project_number_by_default():
    resource = gcp_iap_client.iap_resource_name("lingoleap-frontend-staging")
    assert "958347263320" in resource
    assert "lingoleap-dev" not in resource


# ---------------------------------------------------------------------------
# parse_bindings_for_role — name / expiry / expired / no-condition
# ---------------------------------------------------------------------------


def test_member_with_future_expiry_is_active_with_name_and_date():
    bindings = [
        _binding(
            ["user:hans@example.com"],
            title="Hans 劉燁",
            expression='request.time < timestamp("2026-12-31T00:00:00Z")',
        )
    ]
    result = parse_bindings_for_role(bindings, ROLE, NOW, ADMIN_DOMAIN)
    assert result["external_grants"] == [
        {
            "email": "hans@example.com",
            "name": "Hans 劉燁",
            "status": "active",
            "expires_at": "2026-12-31T00:00:00+00:00",
        }
    ]


def test_member_with_past_expiry_is_expired():
    bindings = [
        _binding(
            ["user:old@example.com"],
            title="舊訪客",
            expression='request.time < timestamp("2026-01-01T00:00:00Z")',
        )
    ]
    result = parse_bindings_for_role(bindings, ROLE, NOW, ADMIN_DOMAIN)
    assert result["external_grants"] == [
        {
            "email": "old@example.com",
            "name": "舊訪客",
            "status": "expired",
            "expires_at": "2026-01-01T00:00:00+00:00",
        }
    ]


def test_member_without_condition_is_active_with_no_expiry_and_no_name():
    bindings = [_binding(["user:forever@example.com"])]
    result = parse_bindings_for_role(bindings, ROLE, NOW, ADMIN_DOMAIN)
    assert result["external_grants"] == [
        {
            "email": "forever@example.com",
            "name": "",
            "status": "active",
            "expires_at": None,
        }
    ]


def test_malformed_condition_expression_does_not_crash_and_shows_no_expiry():
    bindings = [
        _binding(
            ["user:weird@example.com"],
            title="怪怪的條件",
            expression="resource.name.startsWith('x')",  # not a request.time expression
        )
    ]
    result = parse_bindings_for_role(bindings, ROLE, NOW, ADMIN_DOMAIN)
    assert result["external_grants"] == [
        {
            "email": "weird@example.com",
            "name": "怪怪的條件",
            "status": "active",
            "expires_at": None,
        }
    ]


# ---------------------------------------------------------------------------
# Domain members — junyiacademy.org is summarized, not listed individually
# ---------------------------------------------------------------------------


def test_domain_wide_member_sets_junyi_domain_active_and_is_not_listed():
    bindings = [_binding(["domain:junyiacademy.org"])]
    result = parse_bindings_for_role(bindings, ROLE, NOW, ADMIN_DOMAIN)
    assert result["junyi_domain_active"] is True
    assert result["external_grants"] == []


def test_individual_junyi_user_is_not_listed_but_marks_domain_active():
    bindings = [_binding(["user:someone@junyiacademy.org"], title="內部同事")]
    result = parse_bindings_for_role(bindings, ROLE, NOW, ADMIN_DOMAIN)
    assert result["junyi_domain_active"] is True
    assert result["external_grants"] == []


def test_junyi_group_member_is_not_listed_but_marks_domain_active():
    bindings = [_binding(["group:staff@junyiacademy.org"])]
    result = parse_bindings_for_role(bindings, ROLE, NOW, ADMIN_DOMAIN)
    assert result["junyi_domain_active"] is True
    assert result["external_grants"] == []


def test_no_junyi_member_at_all_leaves_domain_inactive():
    bindings = [_binding(["user:hans@example.com"], title="Hans")]
    result = parse_bindings_for_role(bindings, ROLE, NOW, ADMIN_DOMAIN)
    assert result["junyi_domain_active"] is False


# ---------------------------------------------------------------------------
# Irrelevant bindings (other roles) are ignored
# ---------------------------------------------------------------------------


def test_bindings_for_other_roles_are_ignored():
    bindings = [
        {"role": "roles/run.invoker", "members": ["user:hans@example.com"]},
        _binding(["user:real@example.com"], title="真的這位"),
    ]
    result = parse_bindings_for_role(bindings, ROLE, NOW, ADMIN_DOMAIN)
    assert [g["email"] for g in result["external_grants"]] == ["real@example.com"]


# ---------------------------------------------------------------------------
# allUsers / allAuthenticatedUsers — surfaced, not silently dropped
# ---------------------------------------------------------------------------


def test_all_users_member_is_surfaced_as_a_flagged_grant():
    bindings = [_binding(["allUsers"])]
    result = parse_bindings_for_role(bindings, ROLE, NOW, ADMIN_DOMAIN)
    assert result["external_grants"][0]["email"] == "allUsers"
    assert "公開" in result["external_grants"][0]["name"]
    assert result["external_grants"][0]["status"] == "active"


# ---------------------------------------------------------------------------
# Same email granted via multiple resources/bindings — merged, not duplicated
# ---------------------------------------------------------------------------


def test_same_email_across_two_bindings_merges_to_one_row_keeping_name():
    bindings = [
        _binding(
            ["user:hans@example.com"],
            title="Hans 劉燁",
            expression='request.time < timestamp("2026-11-01T00:00:00Z")',
        ),
        _binding(
            ["user:hans@example.com"],
            expression='request.time < timestamp("2026-12-01T00:00:00Z")',
        ),
    ]
    result = parse_bindings_for_role(bindings, ROLE, NOW, ADMIN_DOMAIN)
    assert len(result["external_grants"]) == 1
    grant = result["external_grants"][0]
    assert grant["name"] == "Hans 劉燁"
    # Furthest/soonest-to-expire choice is a design decision: we keep the
    # *latest* expiry, since the person still has *a* live grant until then.
    assert grant["expires_at"] == "2026-12-01T00:00:00+00:00"
    assert grant["status"] == "active"


def test_same_email_with_one_no_expiry_binding_wins_as_permanent():
    bindings = [
        _binding(
            ["user:hans@example.com"],
            title="Hans 劉燁",
            expression='request.time < timestamp("2026-11-01T00:00:00Z")',
        ),
        _binding(["user:hans@example.com"]),  # no condition at all = forever
    ]
    result = parse_bindings_for_role(bindings, ROLE, NOW, ADMIN_DOMAIN)
    assert len(result["external_grants"]) == 1
    assert result["external_grants"][0]["expires_at"] is None
    assert result["external_grants"][0]["status"] == "active"


# ---------------------------------------------------------------------------
# get_iap_allowlist — orchestration: not-configured / GCP-error / success
# ---------------------------------------------------------------------------


def test_get_iap_allowlist_not_configured_when_no_services_set(monkeypatch):
    monkeypatch.setattr(gcp_iap_client, "IAP_ALLOWLIST_SERVICES", [])
    result = get_iap_allowlist(now=NOW)
    assert result["configured"] is False
    assert "尚未設定 IAP" in result["message"]


def test_get_iap_allowlist_not_configured_when_gcp_returns_403(monkeypatch):
    monkeypatch.setattr(gcp_iap_client, "IAP_ALLOWLIST_SERVICES", ["lingoleap-frontend-staging"])

    def _raise(*args, **kwargs):
        raise gcp_iap_client.IapFetchError("permission_denied", "no roles/iap.admin yet")

    monkeypatch.setattr(gcp_iap_client, "fetch_iap_policies", _raise)
    result = get_iap_allowlist(now=NOW)
    assert result["configured"] is False
    assert "尚未設定 IAP" in result["message"]


def test_get_iap_allowlist_success_merges_bindings_from_all_services(monkeypatch):
    monkeypatch.setattr(
        gcp_iap_client, "IAP_ALLOWLIST_SERVICES", ["frontend-staging", "backend-staging"]
    )
    policies = [
        {"bindings": [_binding(["user:hans@example.com"], title="Hans")]},
        {"bindings": [_binding(["domain:junyiacademy.org"])]},
    ]
    monkeypatch.setattr(gcp_iap_client, "fetch_iap_policies", lambda: policies)
    result = get_iap_allowlist(now=NOW)
    assert result["configured"] is True
    assert result["junyi_domain_active"] is True
    assert [g["email"] for g in result["external_grants"]] == ["hans@example.com"]
