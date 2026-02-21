"""
Socratic dialogue agent with answer evaluation.
Manages session state, evaluates student comprehension, and generates
follow-up questions using structured Gemini output.
"""

import time
import logging
from dataclasses import dataclass, field

from google.genai import types as genai_types

from .ai_service import generate_structured_response

logger = logging.getLogger(__name__)


@dataclass
class SessionState:
    session_id: str
    story_title: str
    story_text: str
    conversation: list[dict] = field(default_factory=list)  # {role, text}
    understood_count: int = 0
    total_attempts: int = 0
    current_phase: str = "factual"  # factual -> inferential -> evaluative
    created_at: float = field(default_factory=time.time)


class SessionStore:
    """In-memory session store with 30-minute TTL cleanup."""

    TTL_SECONDS = 30 * 60

    def __init__(self):
        self._sessions: dict[str, SessionState] = {}

    def get(self, session_id: str) -> SessionState | None:
        self._cleanup()
        return self._sessions.get(session_id)

    def save(self, state: SessionState) -> None:
        self._sessions[state.session_id] = state

    def _cleanup(self) -> None:
        now = time.time()
        expired = [
            sid for sid, s in self._sessions.items()
            if now - s.created_at > self.TTL_SECONDS
        ]
        for sid in expired:
            del self._sessions[sid]


# Module-level singleton
_store = SessionStore()


# Gemini response schema for structured output
EVALUATION_SCHEMA = {
    "type": "object",
    "properties": {
        "understood": {
            "type": "boolean",
            "description": "Whether the student's answer demonstrates understanding of the question",
        },
        "feedback": {
            "type": "string",
            "description": "Brief, warm feedback on the student's answer (1-2 sentences in Traditional Chinese)",
        },
        "question": {
            "type": "string",
            "description": "The next Socratic question in Traditional Chinese",
        },
        "phase": {
            "type": "string",
            "enum": ["factual", "inferential", "evaluative"],
            "description": "The phase of the next question",
        },
        "referenced_paragraph": {
            "type": "INTEGER",
            "description": "答錯時，答案所在的段落索引（從 0 開始）。答對時為 null。",
            "nullable": True,
        },
    },
    "required": ["understood", "feedback", "question", "phase"],
}

PHASE_ORDER = ["factual", "inferential", "evaluative"]


@dataclass
class AgentResponse:
    question: str
    feedback: str | None
    understood: bool | None
    understood_count: int
    required_count: int
    phase: str
    is_complete: bool
    referenced_paragraph: int | None = None


class SocraticAgent:
    REQUIRED_UNDERSTOOD = 3

    def _build_system_prompt(self, state: SessionState) -> str:
        return f"""你是一位溫暖、鼓勵學生的繁體中文閱讀助教，擅長用蘇格拉底式問答引導學生思考課文。

課文標題：{state.story_title}

課文內容：
{state.story_text}

你的任務：
1. 評估學生的回答是否展現了對問題的理解
2. 給予簡短、溫暖的回饋（1-2句）
3. 提出下一個蘇格拉底式問題

評估規則：
- 如果學生的回答展現理解（即使不完美但方向正確）→ understood = true
- 如果學生的回答偏離主題、完全錯誤、或明顯敷衍（如「不知道」「隨便」）→ understood = false
- 如果 understood = false，用不同方式重新問同一層次的問題（換個角度或給提示）
- 如果 understood = true，進入下一個層次的問題
- 當 understood=false 時，在 referenced_paragraph 填入答案所在段落的索引（從 0 開始）
- 當 understood=true 時，referenced_paragraph 設為 null

問題層次（由淺入深）：
- factual：事實性問題（誰、什麼、在哪裡、發生什麼事）
- inferential：推論性問題（為什麼、怎麼會這樣、有什麼影響）
- evaluative：評估性問題（你覺得、如果是你、這個故事告訴我們什麼）

目前階段：{state.current_phase}
學生已理解的問題數：{state.understood_count}/{self.REQUIRED_UNDERSTOOD}

回饋風格：
- 語氣溫暖、友善，適合小學高年級至國中生
- 只用繁體中文
- 回饋要簡短（1-2句），然後直接問下一個問題
- 問題長度：15-40 個字"""

    async def start_session(
        self, session_id: str, story_title: str, story_text: str
    ) -> AgentResponse:
        """Start a new session — generate the first question."""
        state = SessionState(
            session_id=session_id,
            story_title=story_title,
            story_text=story_text,
        )

        system_prompt = self._build_system_prompt(state)
        contents = [
            genai_types.Content(
                role="user",
                parts=[genai_types.Part(text="請開始提問。請提出第一個事實性問題。")],
            )
        ]

        try:
            result = await generate_structured_response(
                system_prompt=system_prompt,
                contents=contents,
                response_schema=EVALUATION_SCHEMA,
            )
            question = result.get("question", "這篇課文的主角是誰？")
            phase = result.get("phase", "factual")
        except Exception as e:
            logger.warning("AI service error in start_session: %s", e)
            question = "這篇課文的主角是誰？他（她）做了什麼事？"
            phase = "factual"

        state.current_phase = phase
        state.conversation.append({"role": "ai", "text": question})
        _store.save(state)

        return AgentResponse(
            question=question,
            feedback=None,
            understood=None,
            understood_count=0,
            required_count=self.REQUIRED_UNDERSTOOD,
            phase=phase,
            is_complete=False,
        )

    async def process_answer(
        self, session_id: str, student_answer: str
    ) -> AgentResponse:
        """Process a student's answer, evaluate understanding, return next question."""
        state = _store.get(session_id)
        if state is None:
            raise ValueError(f"Session {session_id} not found or expired")

        state.conversation.append({"role": "student", "text": student_answer})
        state.total_attempts += 1

        system_prompt = self._build_system_prompt(state)

        # Build Gemini contents from conversation
        contents: list[genai_types.Content] = [
            genai_types.Content(
                role="user",
                parts=[genai_types.Part(text="請開始提問。")],
            )
        ]
        for turn in state.conversation:
            role = "model" if turn["role"] == "ai" else "user"
            contents.append(
                genai_types.Content(
                    role=role,
                    parts=[genai_types.Part(text=turn["text"])],
                )
            )
        # Ensure last message is from user
        if contents[-1].role == "model":
            contents.append(
                genai_types.Content(
                    role="user",
                    parts=[genai_types.Part(text="請根據我的回答進行評估，然後繼續提問。")],
                )
            )

        try:
            result = await generate_structured_response(
                system_prompt=system_prompt,
                contents=contents,
                response_schema=EVALUATION_SCHEMA,
            )
            understood = result.get("understood", False)
            feedback = result.get("feedback", "")
            question = result.get("question", "")
            phase = result.get("phase", state.current_phase)
            referenced_paragraph = result.get("referenced_paragraph")
        except Exception as e:
            logger.warning("AI service error in process_answer: %s", e)
            understood = True  # Give benefit of doubt on error
            feedback = "謝謝你的回答！"
            question = _fallback_question(state)
            phase = state.current_phase
            referenced_paragraph = None

        if understood:
            state.understood_count += 1
            referenced_paragraph = None  # Clear on correct answer
            # Advance phase if understood
            current_idx = (
                PHASE_ORDER.index(state.current_phase)
                if state.current_phase in PHASE_ORDER
                else 0
            )
            if current_idx < len(PHASE_ORDER) - 1:
                state.current_phase = PHASE_ORDER[current_idx + 1]
            phase = state.current_phase

        is_complete = state.understood_count >= self.REQUIRED_UNDERSTOOD

        if not is_complete:
            state.conversation.append({"role": "ai", "text": question})

        _store.save(state)

        return AgentResponse(
            question=question,
            feedback=feedback,
            understood=understood,
            understood_count=state.understood_count,
            required_count=self.REQUIRED_UNDERSTOOD,
            phase=phase,
            is_complete=is_complete,
            referenced_paragraph=referenced_paragraph,
        )


def _fallback_question(state: SessionState) -> str:
    """Return a pre-written question when AI is unavailable."""
    fallback = {
        "factual": "這篇課文的主角是誰？他（她）做了什麼事？",
        "inferential": "為什麼主角要這樣做？你覺得他的理由合理嗎？",
        "evaluative": "讀完這篇課文，你有什麼感想？如果是你，你會怎麼做？",
    }
    return fallback.get(state.current_phase, fallback["factual"])


# Module-level agent singleton
socratic_agent = SocraticAgent()
