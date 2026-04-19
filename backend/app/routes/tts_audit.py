"""
TTS Audit route — Issue #1120

GET /api/tts-audit/provenance
  Returns all entries from backend/data/tts-provenance.jsonl.
  Requires system_admin role.
  One-shot load (no streaming) to avoid race with ongoing batch writer.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse

from ..auth.dependencies import require_role

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/tts-audit",
    tags=["tts-audit"],
    dependencies=[require_role("system_admin")],
)

_PROVENANCE_PATH = Path(__file__).parent.parent.parent / "data" / "tts-provenance.jsonl"


@router.get("/provenance")
def get_provenance() -> JSONResponse:
    """Return all TTS provenance entries as a JSON array.

    Reads the entire JSONL in one shot so the response is consistent even
    while a batch job is appending to the file concurrently.
    """
    if not _PROVENANCE_PATH.exists():
        raise HTTPException(status_code=404, detail="tts-provenance.jsonl not found")

    entries: list[dict] = []
    try:
        # Read the full file once, then parse — avoids partial-line reads from
        # a concurrent appender.
        raw = _PROVENANCE_PATH.read_text(encoding="utf-8")
        for line in raw.splitlines():
            line = line.strip()
            if line:
                try:
                    entries.append(json.loads(line))
                except json.JSONDecodeError:
                    # Skip malformed lines (e.g. partial write at EOF)
                    logger.warning("Skipping malformed provenance line: %r", line[:80])
    except OSError as exc:
        logger.error("Failed to read provenance file: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to read provenance data")

    return JSONResponse(content={"total": len(entries), "entries": entries})
