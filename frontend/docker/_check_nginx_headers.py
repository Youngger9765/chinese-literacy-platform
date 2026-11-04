#!/usr/bin/env python3
"""Helper for test-security-headers.sh — see that file's header comment for
the full "why" (issue #3850). Checks two rendered nginx configs:

  argv[1] = SPA-only output (BACKEND_INTERNAL_URL unset — production's
            Cloud Run frontend build)
  argv[2] = invoker-configured output (BACKEND_INTERNAL_URL + sidecar port
            set — staging/preview builds, which proxy /api, /assets, /q to
            the backend same-origin)

The SPA-only config has exactly one `location /`, which must carry all 5
headers (the 4 from firebase.json plus HSTS, which Cloud Run does not add
automatically the way Firebase Hosting does — confirmed via curl against
both, see PR description).

The invoker-configured config has several locations. Only `location /` and
`location /assets/` (the try_files-first, proxy-fallback one — these serve
the frontend's OWN static index.html / Vite JS-CSS bundle when the file
exists locally) may carry these headers. The proxy locations (`/api/`,
`@assets_backend` — the backend-fallback half of /assets/, `/q/`, and the
invoker-auth sidecar's `/_invoker_token` / `@invoker_token_unavailable`)
must NOT: those responses already carry backend/app/main.py's own
SecurityHeadersMiddleware headers, and nginx's `add_header` does not replace
an existing response header of the same name — it adds a second one, and
browsers enforce the intersection of multiple CSP headers. Adding a
same-origin-only frame-ancestors here would silently re-narrow the
backend's deliberately wider `frame-ancestors 'self' https://*.run.app` for
/assets/* (see backend/app/main.py's #2486 comment) back down to 'self'
only, breaking the worksheet PDF iframe on any Cloud-Run-direct deployment
where frontend and backend are different hosts.
"""
import re
import sys

REQUIRED = [
    ("X-Frame-Options", "SAMEORIGIN"),
    ("X-Content-Type-Options", "nosniff"),
    ("Referrer-Policy", "strict-origin-when-cross-origin"),
    ("Strict-Transport-Security", "max-age=31536000; includeSubDomains"),
]
CSP_NEEDLE = "frame-ancestors 'self'"

MUST_HAVE_INVOKER = ("/", "/assets/")
MUST_NOT_HAVE_INVOKER = (
    "/api/",
    "@assets_backend",
    "/q/",
    "/_invoker_token",
    "@invoker_token_unavailable",
)


def find_locations(text: str) -> dict[str, str]:
    """Return {location_name: body_text} for every top-level `location X { ... }`
    block. Brace-depth-counts rather than regex-matching the close, so it stays
    correct even if a location body ever grows a nested `{}` (none do today)."""
    locations: dict[str, str] = {}
    # Optional modifier (`=`, `~`, `~*`, `^~`) before the actual path/name —
    # render-nginx-conf.sh uses `location = /_invoker_token {` for an exact
    # match. Without skipping the modifier, group 1 below would capture "="
    # itself as the location's "name".
    for m in re.finditer(r"location\s+(?:(?:=|~\*|~|\^~)\s+)?(\S+)\s*\{", text):
        name = m.group(1)
        start = m.end()
        depth = 1
        i = start
        while depth > 0 and i < len(text):
            if text[i] == "{":
                depth += 1
            elif text[i] == "}":
                depth -= 1
            i += 1
        locations[name] = text[start : i - 1]
    return locations


def header_line(key: str, val: str) -> str:
    return f'add_header {key} "{val}" always;'


def assert_present(body: str, label: str, failures: list[str]) -> None:
    for key, val in REQUIRED:
        needle = header_line(key, val)
        if needle not in body:
            failures.append(f"{label}: missing `{needle}`")
    if CSP_NEEDLE not in body:
        failures.append(f"{label}: missing CSP directive containing `{CSP_NEEDLE}`")


def assert_absent(body: str, label: str, failures: list[str]) -> None:
    for key, _ in REQUIRED:
        if f"add_header {key} " in body:
            failures.append(
                f"{label}: unexpectedly carries `add_header {key}` "
                "(this route is proxied to backend, which sets its own headers — "
                "see this script's module docstring)"
            )
    if CSP_NEEDLE in body:
        failures.append(f"{label}: unexpectedly carries `{CSP_NEEDLE}`")


def main(spa_path: str, invoker_path: str) -> int:
    failures: list[str] = []

    with open(spa_path) as f:
        spa = f.read()
    spa_locs = find_locations(spa)
    if "/" not in spa_locs:
        failures.append("SPA-only config: no `location /` found at all")
    else:
        assert_present(spa_locs["/"], "SPA-only config, location /", failures)

    with open(invoker_path) as f:
        invoker = f.read()
    inv_locs = find_locations(invoker)

    for must_have in MUST_HAVE_INVOKER:
        if must_have not in inv_locs:
            failures.append(f"invoker config: no `location {must_have}` found")
        else:
            assert_present(
                inv_locs[must_have], f"invoker config, location {must_have}", failures
            )

    for must_not_have in MUST_NOT_HAVE_INVOKER:
        if must_not_have not in inv_locs:
            failures.append(
                f"invoker config: expected `location {must_not_have}` to exist "
                "(render-nginx-conf.sh's structure changed — update this test's "
                "location list, don't just delete the check)"
            )
        else:
            assert_absent(
                inv_locs[must_not_have],
                f"invoker config, location {must_not_have}",
                failures,
            )

    if failures:
        for f in failures:
            print("  - " + f)
        return 1

    print(
        f"  SPA-only location /, invoker-config locations {MUST_HAVE_INVOKER} "
        f"all carry the 5 headers; {MUST_NOT_HAVE_INVOKER} carry none of them"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1], sys.argv[2]))
