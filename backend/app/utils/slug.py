"""Slug normalization utilities for story identifiers."""


def normalize_story_slug(slug: str) -> str:
    """Normalize story slug to canonical format (plain number string, e.g. '6').

    Accepts multiple input formats:
    - "6"   → "6"
    - "06"  → "6"
    - "L6"  → "6"
    - "L06" → "6"
    - "l06" → "6"

    Falls back to the input (stripped of L/l prefix) for non-numeric slugs.
    """
    stripped = slug.lstrip("Ll")
    try:
        return str(int(stripped))
    except ValueError:
        return stripped
