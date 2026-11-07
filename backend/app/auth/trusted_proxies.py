"""Trusted-hop membership test for X-Forwarded-For resolution.

find_01RtSp6b2GvNCj76v7dhrLmg (high, CWE-799). See
``google_trusted_proxy_ranges.json`` for the full rationale and the actual
log evidence -- short version: Cloud Run's own ingress always appends the
TRUE TCP peer it saw as the LAST X-Forwarded-For entry, never a
client-supplied value. On ``lingoleap-prod.web.app`` /
``lingoleap-staging.web.app`` that peer is Firebase Hosting's own serving
address, not the end user. This module answers "is this address the one
Firebase Hosting's serving layer actually uses, so the entry before it --
not this one -- is the real client".

Coordinator review, 2026-11-07, narrowed this twice from the first
version: (1) the allowlist used to be Google's entire non-customer-
rentable network (94 prefixes derived from ``goog.json`` minus
``cloud.json``) -- too broad, since it included ranges an attacker could
plausibly send requests from that are NOT Firebase Hosting (e.g. Google
Apps Script egress, general Google corporate infrastructure). It is now
exactly ONE prefix, anchored to real observed traffic (see the ranges
file). (2) ``real_ip_from_xff`` itself (not this module) now steps back at
most ONE hop regardless of what this allowlist contains, so even if a
future entry here turns out to be broader than intended, a multi-hop
forged chain still cannot reach past the single genuine Cloud-Run-
appended entry. The two narrowings are independent defenses, not
substitutes for each other.

Second coordinator review, same day, MEDIUM: ``66.249.64.0/19`` is ALSO
Googlebot's published crawl range, not Firebase-Hosting-exclusive --
treating membership in it as proof of "this hop is Firebase Hosting" is
not strictly true. Accepted as a residual risk rather than reverted,
because the entry this module is asked about is ``parts[-1]`` --
Cloud Run's own platform layer appends that value from the TCP peer it
actually saw; it is not client-suppliable. For this prefix to produce a
wrong trust decision, a request would have to arrive at Cloud Run with a
genuine TCP connection sourced from inside 66.249.64.0/19 (crawlers do
not let a caller set a custom X-Forwarded-For, so this is not a
request-smuggling vector by itself) -- and even then, authenticated
traffic is keyed per-user in ``GlobalRateLimitMiddleware`` regardless of
which IP this function returns, so the residual exposure is limited to
anonymous-request rate-limit keying, not authn/authz. Stronger options
for later, not implemented here: (a) restrict Cloud Run ingress to
internal-and-cloud-load-balancing only, so nothing reaches this code
path except through Firebase Hosting's actual egress; (b) have the
front end (Firebase Hosting rewrite) inject a shared-secret header and
verify it here with ``hmac.compare_digest`` instead of trusting an IP
range at all. Do not widen this allowlist beyond the one empirically
observed prefix without new log evidence.
"""

from __future__ import annotations

import ipaddress
import json
import pathlib
from functools import lru_cache

_RANGES_PATH = pathlib.Path(__file__).with_name("google_trusted_proxy_ranges.json")

IPNetwork = ipaddress.IPv4Network | ipaddress.IPv6Network


@lru_cache(maxsize=1)
def _trusted_networks() -> tuple[IPNetwork, ...]:
    """Parsed, cached once per process -- this file never changes at
    runtime (see its own `_comment` for how/when it is refreshed)."""
    data = json.loads(_RANGES_PATH.read_text(encoding="utf-8"))
    networks: list[IPNetwork] = []
    for cidr in data.get("ipv4", []) + data.get("ipv6", []):
        try:
            networks.append(ipaddress.ip_network(cidr, strict=False))
        except ValueError:
            # A malformed entry must never take down IP resolution for
            # every request -- skip it, don't crash the process.
            continue
    return tuple(networks)


def is_trusted_hop(ip: str) -> bool:
    """True if *ip* belongs to Google's own first-party network (the
    address Firebase Hosting's serving layer would present to Cloud Run),
    False for anything else -- including Google Cloud CUSTOMER ranges,
    which are a different, disjoint list on purpose.

    Malformed/empty input is never trusted (fail closed: an unparsable
    address is treated as the real, untrusted client -- never silently
    skipped as if it were a Google hop).
    """
    ip = (ip or "").strip()
    if not ip:
        return False
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    return any(addr in network for network in _trusted_networks())
