"""Story structure table helpers for QA / lab services."""

from __future__ import annotations

import json


def table_fingerprint(table: list) -> str:
    return json.dumps(table, ensure_ascii=False, sort_keys=True)
