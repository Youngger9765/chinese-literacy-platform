"""Every value the MOE directory import writes must fit its School column.

Regression lock for the 2026-11-02 staging deploy failure: the data
migration b2c3d4moe02 crashed Postgres with
`value too long for type character varying(10)` because school_level values
"junior_high" / "senior_high" are 11 characters. CI runs on SQLite, which
does not enforce VARCHAR lengths, so the suite stayed green. This test checks
lengths explicitly against the model so the gap cannot reopen on SQLite.
"""

from sqlalchemy import String

from app.models.school import School
from app.services.moe_school_import import load_moe_school_rows


def test_every_imported_value_fits_its_school_column():
    rows = load_moe_school_rows()
    assert len(rows) > 3000, "directory should load thousands of schools"

    columns = School.__table__.columns
    too_long = []
    checked = 0
    for row in rows:
        for field, value in row.items():
            col = columns.get(field)
            if col is None or not isinstance(value, str):
                continue
            if isinstance(col.type, String) and col.type.length is not None:
                checked += 1
                if len(value) > col.type.length:
                    too_long.append((field, value, col.type.length))

    assert checked > 0, "no length-bounded string field was checked"
    assert too_long == [], f"values exceed column length: {sorted(set(too_long))[:10]}"
