from .models import SessionState

PHASE_ORDER = ["factual", "inferential", "evaluative"]


def determine_phase(understood_count: int, total_attempts: int) -> str:
    # Advance phase based on understood count.
    # Phase sets the prompt for the NEXT question, so offset by 1:
    # count 0-1 → factual (Q1-Q2), 2-3 → inferential (Q3-Q4), 4+ → evaluative (Q5)
    if understood_count <= 1:
        return "factual"
    if understood_count <= 3:
        return "inferential"
    return "evaluative"


def rebuild_state_from_turns(
    turns: list,
    story_title: str,
    story_text: str,
    genre: str | None = None,
    reading_strategy: str | None = None,
    session_id: str = "",
    mispronounced_words: list[str] | None = None,
    accuracy: float | None = None,
    cpm: float | None = None,
    teacher_instructions: list[str] | None = None,
) -> SessionState:
    """Rebuild in-memory SessionState from persisted DialogueTurn rows."""
    state = SessionState(
        session_id=session_id,
        story_title=story_title,
        story_text=story_text,
        mispronounced_words=mispronounced_words,
        accuracy=accuracy,
        cpm=cpm,
        teacher_instructions=teacher_instructions,
        genre=genre,
        reading_strategy=reading_strategy,
    )

    # Replay turns to reconstruct conversation and scores
    for turn in turns:
        state.conversation.append({"role": turn.role, "text": turn.text})
        if turn.role == "student":
            state.total_attempts += 1
        elif turn.role == "feedback" and turn.is_correct:
            state.understood_count += 1
        if turn.phase:
            state.current_phase = turn.phase

    # Recalculate phase based on understood_count (mirrors process_answer logic)
    state.current_phase = determine_phase(state.understood_count, state.total_attempts)

    # Override with the phase of the latest turn if available
    for turn in reversed(turns):
        if turn.phase:
            state.current_phase = turn.phase
            break

    return state
