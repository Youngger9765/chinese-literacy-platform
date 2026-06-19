"""
spotlight_v2_loader.py — load checked-in block-sequence spotlight schemas (dev7).
"""

from app.services.spotlight_contract import DEV7_LESSONS, load_dev7_spotlight


def is_spotlight_v2_lesson(lesson_code: str) -> bool:
    return lesson_code in DEV7_LESSONS


def load_spotlight_v2(lesson_code: str) -> dict | None:
    if not is_spotlight_v2_lesson(lesson_code):
        return None
    return load_dev7_spotlight(lesson_code)
