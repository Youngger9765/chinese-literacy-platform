"""
iap_allowlist_service.py — turns a raw GCP IAM Policy for
`roles/iap.httpsResourceAccessor` into the shape the admin allowlist page
shows (Issue #3720, read-only follow-up to #3719's IAP prep work).

Two layers, kept separate on purpose:
  - `parse_bindings_for_role` is pure (no I/O) — it takes IAM-policy-shaped
    dicts and returns the parsed view. This is what the unit tests exercise.
  - `get_iap_allowlist` is the orchestration: ask gcp_iap_client for the raw
    policies, and turn "not configured yet" / "GCP said no" into the same
    friendly not-ready state the admin page renders, instead of a 500.

Parsing rules (per the spec this was built against):
  - A member's IAM condition carries the grant's human name in its `title`
    and its expiry in its `expression`, which looks like
    `request.time < timestamp("2026-12-31T00:00:00Z")`.
  - A member with no condition at all = granted with no expiry ("已開通",
    no date).
  - A condition whose expression doesn't match the expected
    `request.time < timestamp(...)` shape is treated as "no expiry" rather
    than raising — this is a read-only display, not an access decision
    (IAP itself still enforces whatever the real condition says); we'd
    rather show the grant with a blank date than crash the whole page over
    one odd binding.
  - Members in the `ADMIN_DOMAIN` (junyiacademy.org) — whether as
    `domain:junyiacademy.org`, a `group:...@junyiacademy.org`, or an
    individual `user:...@junyiacademy.org` — are never listed individually;
    their presence just flips `junyi_domain_active` on, and the page shows
    one summary line instead.
  - `allUsers` / `allAuthenticatedUsers` are NOT domain members and are NOT
    dropped — a publicly-open IAP resource is exactly the kind of thing an
    admin needs to see, so it's surfaced as a flagged external grant.
  - The same email can appear in more than one binding (e.g. granted once,
    then re-granted with a later expiry) or in bindings from more than one
    Cloud Run service. Rows are merged by email: the furthest expiry wins
    (the person still has *a* live grant until then), and a no-expiry
    binding beats any dated one (permanent access is the more accurate risk
    picture to show, not a false "expires" promise).
"""

import logging
import re
from datetime import datetime, timezone

from . import gcp_iap_client

logger = logging.getLogger(__name__)

ADMIN_DOMAIN = "junyiacademy.org"

NOT_CONFIGURED_MESSAGE = "尚未設定 IAP（目前測試站未上鎖）"

_EXPIRY_RE = re.compile(r'request\.time\s*<\s*timestamp\(\s*"([^"]+)"\s*\)')

_PUBLIC_MEMBERS = {
    "allUsers": "⚠️ 公開存取（任何人，無需登入）",
    "allAuthenticatedUsers": "⚠️ 公開存取（任何已驗證的 Google 帳號）",
}


def _parse_expiry(expression: str) -> datetime | None:
    """Extract the expiry from a `request.time < timestamp("...")` condition.

    Returns None if the expression doesn't match that shape (malformed /
    unexpected condition) rather than raising — see module docstring.
    """
    if not expression:
        return None
    match = _EXPIRY_RE.search(expression)
    if not match:
        return None
    raw = match.group(1)
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        logger.warning("IAP allowlist: could not parse expiry timestamp %r", raw)
        return None


def _member_email(member: str) -> str:
    """Strip the `user:`/`group:`/`domain:`/`serviceAccount:` prefix."""
    if member in _PUBLIC_MEMBERS:
        return member
    _, _, identifier = member.partition(":")
    return identifier or member


def _is_junyi_domain_member(member: str, admin_domain: str) -> bool:
    if member == f"domain:{admin_domain}":
        return True
    email = _member_email(member)
    return email.endswith(f"@{admin_domain}")


def parse_bindings_for_role(
    bindings: list[dict],
    role: str,
    now: datetime,
    admin_domain: str = ADMIN_DOMAIN,
) -> dict:
    """Parse raw IAM policy bindings into the admin allowlist view.

    `bindings` is the `bindings` list of one or more merged IAM Policy
    dicts (see get_iap_allowlist). Only bindings for `role` are considered;
    everything else (e.g. roles/run.invoker grants to the IAP service
    agent) is ignored.
    """
    junyi_domain_active = False
    # email -> {"name": str, "expires_at": datetime | None}
    merged: dict[str, dict] = {}

    for binding in bindings:
        if binding.get("role") != role:
            continue

        condition = binding.get("condition") or {}
        title = (condition.get("title") or "").strip()
        expires_at = _parse_expiry(condition.get("expression", ""))

        for member in binding.get("members", []):
            if member not in _PUBLIC_MEMBERS and _is_junyi_domain_member(member, admin_domain):
                junyi_domain_active = True
                continue

            email = _member_email(member)
            name = _PUBLIC_MEMBERS.get(member, title)

            existing = merged.get(email)
            if existing is None:
                merged[email] = {"name": name, "expires_at": expires_at}
                continue

            # Merge: prefer a non-empty name already on file; a no-expiry
            # binding (None) always wins over any dated one; otherwise keep
            # whichever expiry is furthest out.
            if not existing["name"] and name:
                existing["name"] = name
            if existing["expires_at"] is not None:
                if expires_at is None or expires_at > existing["expires_at"]:
                    existing["expires_at"] = expires_at

    external_grants = []
    for email in sorted(merged):
        row = merged[email]
        expires_at = row["expires_at"]
        status = "expired" if (expires_at is not None and expires_at < now) else "active"
        external_grants.append(
            {
                "email": email,
                "name": row["name"],
                "status": status,
                "expires_at": expires_at.isoformat() if expires_at is not None else None,
            }
        )

    return {
        "junyi_domain_active": junyi_domain_active,
        "external_grants": external_grants,
    }


def get_iap_allowlist(now: datetime | None = None) -> dict:
    """Entry point for the admin route. Never raises.

    Returns either:
      {"configured": False, "message": "尚未設定 IAP（目前測試站未上鎖）"}
    or:
      {"configured": True, "junyi_domain_active": bool, "external_grants": [...]}
    """
    now = now or datetime.now(timezone.utc)

    if not gcp_iap_client.IAP_ALLOWLIST_SERVICES:
        return {"configured": False, "message": NOT_CONFIGURED_MESSAGE}

    try:
        policies = gcp_iap_client.fetch_iap_policies()
    except gcp_iap_client.IapFetchError as exc:
        logger.warning("IAP allowlist fetch failed (%s): %s", exc.reason, exc.detail)
        return {"configured": False, "message": NOT_CONFIGURED_MESSAGE}

    bindings: list[dict] = []
    for policy in policies:
        bindings.extend(policy.get("bindings", []))

    parsed = parse_bindings_for_role(bindings, gcp_iap_client.IAP_ROLE, now)
    return {"configured": True, **parsed}
