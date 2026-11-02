"""Import the official MOE school directory into the `schools` table (#3804 §4.2).

Source data: backend/data/moe_schools/{elementary,junior_high,senior_high}.csv
(see that directory's README.md for the data.gov.tw URLs and two data
quirks this module works around — junior_high.csv bundles 12 academic
years in one file, senior_high.csv has one non-data footnote row).

Public surface:
  load_moe_school_rows(data_dir) -> list[dict]   # parse all three CSVs
  import_moe_schools(db, rows) -> ImportResult   # upsert by moe_school_code
"""
from __future__ import annotations

import csv
import os
from dataclasses import dataclass

from sqlalchemy.orm import Session

from ..models.school import School

MOE_DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "data", "moe_schools")

_JUNIOR_HIGH_YEAR = "115"  # the academic year to pull out of the multi-year file

_TRAD_TO_SIMP_VARIANT = {"臺": "台"}


def _normalize_variant_chars(s: str) -> str:
    for trad, simp in _TRAD_TO_SIMP_VARIANT.items():
        s = s.replace(trad, simp)
    return s


def _split_bracketed_code(raw: str) -> tuple[str | None, str | None]:
    """'[33]臺北市' -> ('33', '台北市'). Returns (None, None) if no bracket."""
    raw = (raw or "").strip()
    if not raw.startswith("["):
        return None, _normalize_variant_chars(raw) or None
    end = raw.find("]")
    if end == -1:
        return None, _normalize_variant_chars(raw) or None
    code = raw[1:end]
    name = _normalize_variant_chars(raw[end + 1 :])
    return code or None, name or None


def _is_public(raw: str | None) -> bool | None:
    if raw == "公立":
        return True
    if raw == "私立":
        return False
    return None


def _row_to_record(row: dict, school_level: str) -> dict | None:
    """One CSV row -> our normalized dict shape, or None to skip (footnote
    rows etc. have no 代碼/學校名稱)."""
    code = (row.get("代碼") or "").strip()
    name = (row.get("學校名稱") or "").strip()
    if not code or not name:
        return None

    county_code, county_name = _split_bracketed_code(row.get("縣市名稱", ""))

    return {
        "moe_school_code": code,
        "name": name,
        "is_public": _is_public(row.get("公/私立")),
        "county_code": county_code,
        "county_name": county_name,
        "school_level": school_level,
        "address": row.get("地址") or None,
        "phone": row.get("電話") or None,
    }


def parse_elementary_or_senior_csv(rows: list[dict], level: str) -> list[dict]:
    """Elementary and senior-high CSVs are single-academic-year files — every
    row is a candidate record, minus any non-data footnote rows."""
    out = []
    for row in rows:
        record = _row_to_record(row, level)
        if record is not None:
            out.append(record)
    return out


def parse_junior_high_csv(rows: list[dict], year: str = _JUNIOR_HIGH_YEAR) -> list[dict]:
    """junior_high.csv bundles every academic year (104-115) in one file —
    filter to the requested year before building records."""
    out = []
    for row in rows:
        if (row.get("學年度") or "").strip() != year:
            continue
        record = _row_to_record(row, "junior_high")
        if record is not None:
            out.append(record)
    return out


def _read_csv_rows(path: str) -> list[dict]:
    with open(path, encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def load_moe_school_rows(data_dir: str = MOE_DATA_DIR) -> list[dict]:
    """Parse all three official MOE CSVs into our normalized record shape."""
    elementary_rows = _read_csv_rows(os.path.join(data_dir, "elementary.csv"))
    junior_rows = _read_csv_rows(os.path.join(data_dir, "junior_high.csv"))
    senior_rows = _read_csv_rows(os.path.join(data_dir, "senior_high.csv"))

    records = []
    records += parse_elementary_or_senior_csv(elementary_rows, level="elementary")
    records += parse_junior_high_csv(junior_rows, year=_JUNIOR_HIGH_YEAR)
    records += parse_elementary_or_senior_csv(senior_rows, level="senior_high")
    return records


@dataclass
class ImportResult:
    created: int
    updated: int


# Fields on School that an MOE-sourced row owns and may overwrite on re-import.
# join_code / organization_id / admin_user_id etc. are NEVER touched here —
# they belong to the teacher-facing side of School, not the directory import.
_UPSERT_FIELDS = ("name", "is_public", "county_code", "county_name", "school_level", "address", "phone")


def import_moe_schools(db: Session, rows: list[dict]) -> ImportResult:
    """Upsert School rows keyed on moe_school_code. Idempotent: re-running
    with the same rows produces created=0, updated=0 on the second pass.

    Never touches schools where moe_school_code IS NULL (domain-auto-created
    / manually-created schools) — see PRD #3804 §4.2 "Young 的問題 2 答覆".
    """
    codes = [r["moe_school_code"] for r in rows]
    existing = {
        s.moe_school_code: s
        for s in db.query(School).filter(School.moe_school_code.in_(codes)).all()
    }

    created = 0
    updated = 0

    for row in rows:
        code = row["moe_school_code"]
        school = existing.get(code)

        if school is None:
            school = School(moe_school_code=code)
            for field in _UPSERT_FIELDS:
                setattr(school, field, row[field])
            db.add(school)
            created += 1
            continue

        changed = False
        for field in _UPSERT_FIELDS:
            if getattr(school, field) != row[field]:
                setattr(school, field, row[field])
                changed = True
        if changed:
            updated += 1

    db.commit()
    return ImportResult(created=created, updated=updated)
