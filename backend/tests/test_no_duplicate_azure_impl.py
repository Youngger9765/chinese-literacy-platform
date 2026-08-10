"""There is exactly one _synthesize_azure, and it is the one in providers/.

`__init__.py` imported `_synthesize_azure` from `providers.azure` and then
defined a second copy of it further down the same file. Python keeps the later
definition, so the import was dead and every call went to the local copy.

The two drifted, invisibly. An entire evening's work — switching from urllib to
requests, adding retries, raising the read timeout — went into the providers
file and changed nothing at runtime, while `IncompleteRead` kept firing and kept
falling back to the mainland-accent voice. Tests passed the whole time, because
they imported from providers too.

A duplicate like this cannot be caught by reading either file on its own, so
this test reads both.
"""
from __future__ import annotations

import ast
import inspect
from pathlib import Path


def _top_level_functions(path: Path) -> list[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    return [n.name for n in tree.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))]


TTS_DIR = Path(__file__).resolve().parents[1] / "app" / "services" / "tts"


def test_init_does_not_redefine_what_it_imports():
    """Any name imported and then defined in the same module is a silent override."""
    init = TTS_DIR / "__init__.py"
    tree = ast.parse(init.read_text(encoding="utf-8"))

    imported = {
        alias.asname or alias.name
        for node in ast.walk(tree)
        if isinstance(node, ast.ImportFrom)
        for alias in node.names
    }
    defined = set(_top_level_functions(init))

    shadowed = sorted(imported & defined)

    # Six cache helpers (_gcs_get, _gcs_put, _get_gcs_bucket, _l1_put,
    # get_cached_tts, delete_tts_cache) are shadowed the same way. They are
    # known and tracked in specs/modules/tts/INTENT.md; removing them is a
    # separate change with its own blast radius, and pretending otherwise by
    # deleting them in passing is how the audio broke in the first place.
    #
    # Anything NOT on this list is new, and new is what this test is for.
    KNOWN = {
        "_gcs_get", "_gcs_put", "_get_gcs_bucket",
        "_l1_put", "get_cached_tts", "delete_tts_cache",
    }
    new_shadows = sorted(set(shadowed) - KNOWN)

    assert not new_shadows, (
        f"__init__.py imports and then redefines {new_shadows} — the import is "
        "dead and edits to the imported module do nothing at runtime"
    )
    assert "_synthesize_azure" not in shadowed, (
        "_synthesize_azure is shadowed again; an evening of fixes to "
        "providers/azure.py once had no runtime effect because of exactly this"
    )


def test_the_running_implementation_is_the_providers_one():
    """Guards the direction of the fix, not just the absence of a duplicate."""
    from app.services import tts
    from app.services.tts.providers import azure

    assert tts._synthesize_azure is azure._synthesize_azure


def test_the_running_implementation_uses_requests():
    """urllib fails ~12% of the time on Azure's chunked responses, and each
    failure becomes mainland-accent audio through the Google fallback."""
    from app.services import tts

    source = inspect.getsource(tts._synthesize_azure)
    assert "requests.post" in source
    assert "urlopen" not in source
