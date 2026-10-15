"""Field report 2026-10-13: a class hit the top-level error page 58 min after
a prod deploy. Firebase served index.html with its default max-age=3600, so
after a deploy a tablet kept loading the OLD index.html, whose hashed chunks
no longer existed, and ErrorBoundary's auto-reloads couldn't recover.

Pages (index.html and every SPA route) must be revalidated (no-cache).
/api/** and /q/** are rewrites to the backend and must keep the backend's own
Cache-Control (no-store for user data, public max-age for TTS audio): the
first version of this fix used `**/!(*.*)` and overrode them on staging.
/assets/** (hashed build files and the backend asset proxy) stays immutable.
"""
import json
import re
from pathlib import Path

CFG = json.loads((Path(__file__).resolve().parents[2] / "firebase.json").read_text(encoding="utf-8"))


def _glob_to_re(src: str) -> re.Pattern:
    """Enough of Firebase's glob for these rules: `**`, `*`, and a leading
    `!(a|b|c)` segment."""
    out, i = "", 0
    while i < len(src):
        if src.startswith("!(", i):
            j = src.index(")", i)
            alts = src[i + 2 : j].split("|")
            out += "(?!(?:" + "|".join(map(re.escape, alts)) + ")(?:/|$))[^/]+"
            i = j + 1
        elif src.startswith("**", i):
            out += ".*"
            i += 2
        elif src[i] == "*":
            out += "[^/]*"
            i += 1
        else:
            out += re.escape(src[i])
            i += 1
    return re.compile("^" + out + "$")


def _cache_control(hosting, path):
    value = None
    for rule in hosting.get("headers", []):
        if _glob_to_re(rule["source"]).match(path):
            for h in rule["headers"]:
                if h["key"].lower() == "cache-control":
                    value = h["value"]
    return value


PAGES = ("/", "/index.html", "/login", "/learn/20016/vocab-application", "/teacher/live/123456",
         "/presentation/short.html")
BACKEND = ("/api/stories/20011", "/api/tts/sentence", "/api/health", "/q/abc123")


def test_pages_are_revalidated():
    assert CFG["hosting"]
    for h in CFG["hosting"]:
        for path in PAGES:
            cc = _cache_control(h, path)
            assert cc and "no-cache" in cc, f"{h['target']} {path} -> {cc!r}"


def test_backend_rewrites_keep_their_own_cache_control():
    for h in CFG["hosting"]:
        for path in BACKEND:
            assert _cache_control(h, path) is None, f"{h['target']} overrides backend Cache-Control on {path}"


def test_hashed_assets_stay_cacheable():
    for h in CFG["hosting"]:
        cc = _cache_control(h, "/assets/index-AbC123.js")
        assert cc and "immutable" in cc, f"{h['target']} assets -> {cc!r}"
