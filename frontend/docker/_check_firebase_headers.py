#!/usr/bin/env python3
"""Helper for test-security-headers.sh — see that file's header comment for
the full "why" (issue #3850). This checks ONE thing: every `hosting` target
in firebase.json carries the 4 security headers, with the exact values this
repo deliberately chose, on every page-serving `source` glob — and does NOT
try to be clever about other sources (api/assets/q keep relying on
backend/app/main.py's own SecurityHeadersMiddleware; see the nginx checker
for why duplicating headers onto those routes is actively harmful, not just
redundant).
"""
import json
import sys

REQUIRED = {
    "X-Frame-Options": "SAMEORIGIN",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
}
CSP_NEEDLE = "frame-ancestors 'self'"
PAGE_SOURCES = ("/", "/!(api|assets|q)", "/!(api|assets|q)/**")


def main(path: str) -> int:
    with open(path) as f:
        data = json.load(f)

    failures = []
    targets = data.get("hosting", [])
    if not targets:
        print(f"no `hosting` targets found in {path}")
        return 1

    for target in targets:
        name = target.get("target", "<unnamed>")
        entries_by_source = {}
        for entry in target.get("headers", []):
            entries_by_source[entry.get("source")] = entry

        for src in PAGE_SOURCES:
            entry = entries_by_source.get(src)
            if entry is None:
                failures.append(f"{name} {src}: no `headers` entry for this source at all")
                continue
            keys = {h["key"]: h["value"] for h in entry.get("headers", [])}
            for want_key, want_val in REQUIRED.items():
                got = keys.get(want_key)
                if got != want_val:
                    failures.append(
                        f"{name} {src}: {want_key} == {got!r}, want {want_val!r}"
                    )
            csp = keys.get("Content-Security-Policy", "")
            if CSP_NEEDLE not in csp:
                failures.append(
                    f"{name} {src}: Content-Security-Policy {csp!r} "
                    f"does not contain {CSP_NEEDLE!r}"
                )

    if failures:
        for f in failures:
            print("  - " + f)
        return 1

    print(
        f"  {len(targets)} hosting target(s) x {len(PAGE_SOURCES)} page source(s) "
        "all carry the 4 headers with the expected values"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
