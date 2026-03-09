"""
Notification service — email notification templates for the assignment system.

Current implementation: log-only (no actual email sending).
Future: integrate with SendGrid / AWS SES / Google Workspace SMTP.

Notification events:
  - new_assignment    : teacher assigns work to a classroom (student notified)
  - due_date_reminder : assignment due date is approaching (student notified)
  - assignment_submitted : student submits assignment (teacher notified)
  - assignment_graded : teacher grades a submission (student notified)
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Email template rendering (log-only for now)
# ---------------------------------------------------------------------------

@dataclass
class EmailMessage:
    to_user_id: int
    subject: str
    body_text: str  # plain-text version


def _render_new_assignment(
    *,
    student_name: str,
    story_title: str,
    classroom_name: str,
    due_date: datetime | None,
    assignment_type: str,
) -> EmailMessage:
    """Template: notify student of a new assignment."""
    due_str = due_date.strftime("%Y/%m/%d") if due_date else "未設定"
    type_label = "朗讀" if assignment_type == "reading" else "閱讀理解"
    subject = f"[LingoLeap] 新作業：{story_title}"
    body = (
        f"親愛的 {student_name} 同學，\n\n"
        f"老師已為您指派新的{type_label}作業。\n\n"
        f"  課文：{story_title}\n"
        f"  班級：{classroom_name}\n"
        f"  截止日期：{due_str}\n\n"
        f"請登入 LingoLeap 完成作業。\n\n"
        f"LingoLeap 學習平台"
    )
    return EmailMessage(to_user_id=0, subject=subject, body_text=body)


def _render_due_date_reminder(
    *,
    student_name: str,
    story_title: str,
    due_date: datetime,
    days_remaining: int,
) -> EmailMessage:
    """Template: remind student that due date is approaching."""
    subject = f"[LingoLeap] 作業提醒：{story_title} 還有 {days_remaining} 天到期"
    body = (
        f"親愛的 {student_name} 同學，\n\n"
        f"您的作業即將到期，請記得完成！\n\n"
        f"  課文：{story_title}\n"
        f"  截止日期：{due_date.strftime('%Y/%m/%d')}\n"
        f"  剩餘天數：{days_remaining} 天\n\n"
        f"請登入 LingoLeap 完成作業。\n\n"
        f"LingoLeap 學習平台"
    )
    return EmailMessage(to_user_id=0, subject=subject, body_text=body)


def _render_assignment_submitted(
    *,
    teacher_name: str,
    student_name: str,
    story_title: str,
    submitted_at: datetime,
) -> EmailMessage:
    """Template: notify teacher that a student submitted an assignment."""
    subject = f"[LingoLeap] 學生繳交作業：{student_name} — {story_title}"
    body = (
        f"親愛的 {teacher_name} 老師，\n\n"
        f"{student_name} 同學已繳交作業。\n\n"
        f"  課文：{story_title}\n"
        f"  繳交時間：{submitted_at.strftime('%Y/%m/%d %H:%M')}\n\n"
        f"請登入 LingoLeap 查看並批改作業。\n\n"
        f"LingoLeap 學習平台"
    )
    return EmailMessage(to_user_id=0, subject=subject, body_text=body)


def _render_assignment_graded(
    *,
    student_name: str,
    story_title: str,
    score: float | None,
) -> EmailMessage:
    """Template: notify student that their submission has been graded."""
    score_str = f"{round(score)}%" if score is not None else "（老師尚未評分）"
    subject = f"[LingoLeap] 作業批改完成：{story_title}"
    body = (
        f"親愛的 {student_name} 同學，\n\n"
        f"您的作業已批改完成。\n\n"
        f"  課文：{story_title}\n"
        f"  分數：{score_str}\n\n"
        f"請登入 LingoLeap 查看詳細結果。\n\n"
        f"LingoLeap 學習平台"
    )
    return EmailMessage(to_user_id=0, subject=subject, body_text=body)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def send_new_assignment_notification(
    *,
    student_id: int,
    student_name: str,
    story_title: str,
    classroom_name: str,
    due_date: datetime | None,
    assignment_type: str,
    db: "Session",
) -> None:
    """Notify a student that a new assignment has been created for them.

    Currently logs only. Replace _send() with real mailer when ready.
    """
    msg = _render_new_assignment(
        student_name=student_name,
        story_title=story_title,
        classroom_name=classroom_name,
        due_date=due_date,
        assignment_type=assignment_type,
    )
    msg.to_user_id = student_id
    _send(msg, event="new_assignment")


def send_due_date_reminder(
    *,
    student_id: int,
    student_name: str,
    story_title: str,
    due_date: datetime,
    days_remaining: int,
    db: "Session",
) -> None:
    """Remind a student that an assignment is due soon."""
    msg = _render_due_date_reminder(
        student_name=student_name,
        story_title=story_title,
        due_date=due_date,
        days_remaining=days_remaining,
    )
    msg.to_user_id = student_id
    _send(msg, event="due_date_reminder")


def send_assignment_submitted_notification(
    *,
    student_id: int,
    student_name: str,
    assignment_id: int,
    story_title: str,
    teacher_id: int,
    db: "Session",
) -> None:
    """Notify the teacher that a student submitted an assignment."""
    from ..models.user import User

    teacher = db.query(User).filter(User.id == teacher_id).first()
    teacher_name = teacher.name if teacher else f"老師 #{teacher_id}"

    msg = _render_assignment_submitted(
        teacher_name=teacher_name,
        student_name=student_name,
        story_title=story_title,
        submitted_at=datetime.now(tz=timezone.utc),
    )
    msg.to_user_id = teacher_id
    _send(msg, event="assignment_submitted", extra={"assignment_id": assignment_id, "student_id": student_id})


def send_assignment_graded_notification(
    *,
    student_id: int,
    student_name: str,
    story_title: str,
    score: float | None,
    db: "Session",
) -> None:
    """Notify a student that their submission has been graded."""
    msg = _render_assignment_graded(
        student_name=student_name,
        story_title=story_title,
        score=score,
    )
    msg.to_user_id = student_id
    _send(msg, event="assignment_graded")


# ---------------------------------------------------------------------------
# Internal send helper (log-only stub)
# ---------------------------------------------------------------------------

def _send(msg: EmailMessage, *, event: str, extra: dict | None = None) -> None:
    """Send an email notification.

    Currently a log-only stub. Replace with real mailer integration:
      - SendGrid: sendgrid.SendGridAPIClient
      - AWS SES: boto3.client('ses')
      - Google Workspace SMTP: smtplib + google-auth

    Args:
        msg: Rendered email message.
        event: Notification event name for log context.
        extra: Optional additional context for logging.
    """
    log_ctx = {"event": event, "to_user_id": msg.to_user_id, "subject": msg.subject}
    if extra:
        log_ctx.update(extra)
    logger.info("[notification] %s | to_user_id=%d | subject=%r", event, msg.to_user_id, msg.subject)
    logger.debug("[notification] body:\n%s", msg.body_text)
