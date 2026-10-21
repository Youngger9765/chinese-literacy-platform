"""#3622: a 204 route whose function is annotated `-> None` and has no
`response_model=None` makes FastAPI 0.115.x raise at decoration time
("Status code 204 must not have a response body"), so `import app.main`
fails and every test that imports the app stops collecting. requirements.txt
does not pin FastAPI, so CI can resolve to that version on any day.

Scans EVERY route module statically (independent of the installed FastAPI
version, which is exactly what varies).
"""
from __future__ import annotations

import ast
from pathlib import Path

APP = Path(__file__).resolve().parents[1] / "app"
NO_BODY = {204, 304}


def _no_body_routes():
    for path in sorted(APP.rglob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for fn in ast.walk(tree):
            if not isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            for dec in fn.decorator_list:
                if not isinstance(dec, ast.Call):
                    continue
                kw = {k.arg: k.value for k in dec.keywords}
                status = kw.get("status_code")
                value = getattr(status, "value", None)
                if value is None and isinstance(status, ast.Attribute):
                    value = 204 if "204" in status.attr else 304 if "304" in status.attr else None
                if value in NO_BODY:
                    yield path.relative_to(APP.parent), fn, kw


def test_scan_finds_the_no_body_routes():
    # Positive control: the scan must actually see these routes.
    assert sum(1 for _ in _no_body_routes()) >= 10


def test_annotated_no_body_routes_declare_response_model_none():
    offenders = [
        f"{path}:{fn.lineno} {fn.name}"
        for path, fn, kw in _no_body_routes()
        if fn.returns is not None and "response_model" not in kw
    ]
    assert not offenders, "add response_model=None: " + ", ".join(offenders)
