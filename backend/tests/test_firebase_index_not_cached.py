"""Field report 2026-10-13: a class hit the top-level error page 58 min after
a prod deploy. Firebase served index.html with its default max-age=3600, so
after a deploy a tablet kept loading the OLD index.html, whose hashed chunks
no longer existed, and ErrorBoundary's auto-reloads couldn't recover.

index.html and every SPA route must be revalidated (no-cache); hashed
/assets/* may be cached forever.
"""
import fnmatch
import json
from pathlib import Path

CFG = json.loads((Path(__file__).resolve().parents[2] / "firebase.json").read_text(encoding="utf-8"))


def _cache_control(hosting, path):
    """Last matching rule wins; extglob `!(*.*)` = last path segment has no dot."""
    value = None
    for rule in hosting.get("headers", []):
        src = rule["source"]
        if src == "**/!(*.*)":
            ok = "." not in path.rsplit("/", 1)[-1]
        else:
            ok = fnmatch.fnmatch(path, src) or fnmatch.fnmatch(path, src.replace("**/", ""))
        if ok:
            for h in rule["headers"]:
                if h["key"].lower() == "cache-control":
                    value = h["value"]
    return value


def test_every_hosting_target_revalidates_index_and_routes():
    assert CFG["hosting"], "no hosting targets"
    for h in CFG["hosting"]:
        for path in ("/", "/index.html", "/login", "/learn/20016/vocab-application", "/teacher/live/123456"):
            cc = _cache_control(h, path)
            assert cc and "no-cache" in cc, f"{h['target']} {path} -> {cc!r} (old index.html would outlive a deploy)"


def test_hashed_assets_stay_cacheable():
    for h in CFG["hosting"]:
        cc = _cache_control(h, "/assets/index-AbC123.js")
        assert cc and "immutable" in cc, f"{h['target']} assets -> {cc!r}"
