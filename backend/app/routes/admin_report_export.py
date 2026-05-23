"""
admin_report_export.py — Admin platform report CSV export endpoint.

Part of the organizations.py split (Issue #1890).
Covers: GET /admin/reports/export
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from ..auth.dependencies import require_role
from ..database import get_db
from ..models.user import User
from ..services.csv_report_builder import build_platform_report_csv, make_report_filename

router = APIRouter(tags=["admin"])
logger = logging.getLogger(__name__)

_ADMIN_EXPORT_ROW_LIMIT = 10_000


@router.get("/admin/reports/export")
def export_platform_report(
    school_id: int | None = Query(None),
    classroom_id: int | None = Query(None),
    current_user: User = require_role("system_admin"),
    db: Session = Depends(get_db),
):
    """Export platform-wide student progress as a UTF-8 BOM CSV (system_admin only).

    Optional filters: school_id, classroom_id.
    Columns: 學校名稱, 班級名稱, 學生姓名, 已完成課文數, 平均正確率, 總學習次數, 最近學習日期
    Raises 400 if result set exceeds the row limit (use filters to narrow).
    """
    try:
        csv_content, _ = build_platform_report_csv(
            db=db,
            school_id=school_id,
            classroom_id=classroom_id,
            row_limit=_ADMIN_EXPORT_ROW_LIMIT,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    filename = make_report_filename()
    # utf-8-sig encoding adds the UTF-8 BOM (EF BB BF)
    return StreamingResponse(
        iter([csv_content.encode("utf-8-sig")]),
        media_type="text/csv; charset=UTF-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
