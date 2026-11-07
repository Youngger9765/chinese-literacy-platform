"""Trusted-hop membership test for X-Forwarded-For resolution.

find_01RtSp6b2GvNCj76v7dhrLmg (high, CWE-799). See
``google_trusted_proxy_ranges.json`` for the full rationale -- short
version: Cloud Run's own ingress always appends the TRUE TCP peer it saw
as the LAST X-Forwarded-For entry, never a client-supplied value. On
``lingoleap-prod.web.app`` / ``lingoleap-staging.web.app`` that peer is
Firebase Hosting's own serving address (Firebase Hosting is itself a
Google first-party service), not the end user. This module answers "is
this address one of Google's own, so the entry before it -- not this one
-- is the real client" using a vendored allowlist derived from Google's
own announced network (``goog.json``) with every prefix that overlaps
Google Cloud's customer-rentable range (``cloud.json``) removed -- see the
ranges file's own ``_comment`` for why that subtraction is necessary
(``goog.json`` alone is NOT disjoint from ``cloud.json``).

Known, accepted residual risk (independent review, 2026-11-07): this
allowlist is still "all of Google's non-customer-rentable network", not
specifically "Firebase Hosting's serving range" -- no narrower published
list exists. If an attacker's own real IP (as Cloud Run sees it directly,
on the unrestricted *.run.app path) happens to fall inside some OTHER
Google-operated, non-customer block in this list (e.g. Google corporate
infrastructure, Googlebot's crawl range), their genuine last XFF entry
would be treated as a trusted hop and stripping would continue into an
earlier, client-supplied entry -- reopening spoofability for that narrow,
high-barrier population (requires actually controlling a host inside
Google's own infrastructure, not just renting a GCP VM, which this file
already excludes). Accepted the same way the previous "Firebase-path
coarsening" tradeoff was: it closes a far larger, trivially-exploitable-
by-anyone bug (every visitor through Firebase Hosting sharing one bucket)
at the cost of a narrower, much harder one. Revisit if Google ever
publishes a Firebase-Hosting-specific egress range.
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
