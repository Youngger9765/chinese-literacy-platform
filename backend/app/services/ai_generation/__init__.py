"""
ai_generation subpackage — AI content generation split by task.

Public API is identical to the former monolithic ai_generation.py.
All names are re-exported here so existing imports continue to work:

    from app.services.ai_generation import generate_exit_ticket  # still works
    from app.services.ai_generation import EXIT_TICKET_SCHEMA    # still works
"""

from .exit_ticket import (  # noqa: F401
    EXIT_TICKET_SCHEMA,
    generate_exit_ticket,
    grade_exit_ticket,
)
from .sentence_practice import (  # noqa: F401
    EXAMPLE_SENTENCES_SCHEMA,
    SENTENCE_VALIDATION_SCHEMA,
    generate_example_sentences,
    validate_student_sentence,
)
from .story_structure import (  # noqa: F401
    STORY_STRUCTURE_SCHEMA,
    generate_story_structure,
    grade_story_structure,
)
from .strategy_practice import (  # noqa: F401
    STRATEGY_VALIDATION_SCHEMA,
    validate_strategy_answer,
)
from .teacher_comment import (  # noqa: F401
    TEACHER_COMMENT_SCHEMA,
    generate_teacher_comment,
)

__all__ = [
    # Schemas
    "EXIT_TICKET_SCHEMA",
    "EXAMPLE_SENTENCES_SCHEMA",
    "SENTENCE_VALIDATION_SCHEMA",
    "STORY_STRUCTURE_SCHEMA",
    "STRATEGY_VALIDATION_SCHEMA",
    "TEACHER_COMMENT_SCHEMA",
    # Exit Ticket
    "generate_exit_ticket",
    "grade_exit_ticket",
    # Sentence Practice
    "generate_example_sentences",
    "validate_student_sentence",
    # Story Structure
    "generate_story_structure",
    "grade_story_structure",
    # Strategy Practice (閱讀聚光燈 free-text grading)
    "validate_strategy_answer",
    # Teacher Comment
    "generate_teacher_comment",
]
