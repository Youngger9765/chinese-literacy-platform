"""
Teacher / student / class management service.

Stub: CRUD operations will be implemented once the DB layer and auth are set up.
"""


def create_teacher(email: str, name: str) -> dict:
    """Stub: create a teacher account."""
    raise NotImplementedError("create_teacher not yet implemented")


def get_teacher_by_email(email: str) -> dict | None:
    """Stub: look up a teacher by email."""
    raise NotImplementedError("get_teacher_by_email not yet implemented")


def create_student(name: str, class_id: str) -> dict:
    """Stub: add a student to a class."""
    raise NotImplementedError("create_student not yet implemented")


def get_students_in_class(class_id: str) -> list[dict]:
    """Stub: list all students in a class."""
    raise NotImplementedError("get_students_in_class not yet implemented")


def create_class(teacher_id: str, name: str) -> dict:
    """Stub: create a new class."""
    raise NotImplementedError("create_class not yet implemented")
