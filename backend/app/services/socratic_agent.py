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
    # Optional reading results from LiveTutor (Issue #17)
    mispronounced_words: list[str] | None = None
    accuracy: float | None = None
    cpm: float | None = None


class SessionStore:
    """In-memory session store with 30-minute TTL cleanup."""

    TTL_SECONDS = 30 * 60
    RATE_LIMIT = 30  # max requests per minute per session
    RATE_WINDOW = 60  # seconds

    def __init__(self):
        self._sessions: dict[str, SessionState] = {}
        self._rate_counts: dict[str, list[float]] = {}  # session_id -> [timestamps]

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

    def check_rate_limit(self, session_id: str) -> bool:
        """Return True if rate limit exceeded."""
        now = time.time()
        timestamps = self._rate_counts.get(session_id, [])
        # Remove old timestamps
        timestamps = [t for t in timestamps if now - t < self.RATE_WINDOW]
        if len(timestamps) >= self.RATE_LIMIT:
            return True
        timestamps.append(now)
        self._rate_counts[session_id] = timestamps
        return False


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
    REQUIRED_UNDERSTOOD = 5
    MAX_ANSWER_LENGTH = 500
    MAX_HISTORY_TURNS = 10

    def _build_system_prompt(self, state: SessionState) -> str:
        paragraphs = state.story_text.split("\n")
        numbered_text = "\n".join(
            f"[第{i}段] {p}" for i, p in enumerate(paragraphs) if p.strip()
        )

        # Build reading info section if data is available (Issue #17)
        reading_info = ""
        if state.mispronounced_words or state.accuracy is not None or state.cpm is not None:
            reading_info = "\n學生朗讀資訊：\n"
            if state.accuracy is not None:
                reading_info += f"- 正確率：{state.accuracy:.1f}%\n"
            if state.cpm is not None:
                reading_info += f"- 語速：{state.cpm:.0f} 字/分鐘\n"
            if state.mispronounced_words:
                reading_info += f"- 讀錯的字：{', '.join(state.mispronounced_words)}\n"
            reading_info += "→ 提問時可以特別關注這些字相關的段落和內容\n"

        return f"""你是一位溫暖、鼓勵學生的繁體中文閱讀助教，擅長用蘇格拉底式問答引導學生深入理解課文。

課文標題：{state.story_title}

課文內容（每段前標有段落索引）：
{numbered_text}
{reading_info}
你的任務：
1. 評估學生的回答是否展現了對問題的理解
2. 給予簡短、溫暖的回饋（1-2句）
3. 提出下一個蘇格拉底式問題，問題必須緊扣課文的關鍵內容

提問品質要求：
- 問題必須針對課文的核心訊息、角色動機、或重要細節，不要問太表面的問題
- factual 階段：聚焦課文中最重要的事件或細節，而非瑣碎資訊
- inferential 階段：引導學生思考因果關係、角色心理、或作者意圖
- evaluative 階段：讓學生連結自身經驗，表達對課文主題的看法
- 每個問題應指向課文中特定的段落或句子，幫助學生深入閱讀
- 不要重複問過的問題，每題都應該引導學生看到課文的新面向

評估規則：
- understood = true 的條件：學生的回答包含問題要求的**關鍵資訊**，且資訊正確
- understood = false 的條件：回答缺少關鍵資訊、資訊錯誤、太模糊籠統、或敷衍
- 「方向正確但不精確」不算理解。例如：問「玉山的稱號是什麼？」回答「高山」→ false（太籠統，沒有說出「東北亞第一高峰」）
- 學生必須展現他**讀過並理解課文**，而非只是用常識猜測。如果答案可以不看課文就說出來，要特別嚴格判斷
- 數字必須精確：課文說「四千公尺」，回答「400」或「300」→ false（差距太大）
- 數字容許小幅誤差：「將近四千」回答「3952」或「大約四千」→ true
- 人名、地名、專有名詞必須正確，不可張冠李戴
- 如果 understood = false，用不同方式重新問同一層次的問題（換個角度或給提示）
- 如果 understood = true，進入下一個層次的問題
- 當 understood=false 時，在 referenced_paragraph 填入答案所在段落的索引（從 0 開始）
- 當 understood=true 時，referenced_paragraph 設為 null

偵測敷衍回答：
- 如果學生回答「不知道」「不懂」「隨便」「沒有」等敷衍詞 → understood = false
- 回饋時不要責備，而是用更具體的提示引導，例如：「沒關係！讓我給你一個提示：看看第X段，作者提到了……你覺得這代表什麼？」
- 如果學生連續敷衍，縮小問題範圍，給更明確的選項式提示（例如：「你覺得主角是開心還是難過？從哪裡可以看出來？」）
- 如果學生的回答只有1-2個字且與課文無關 → understood = false，給予鼓勵並提供具體線索

問題層次（由淺入深）：
- factual：事實性問題（誰、什麼、在哪裡、發生什麼事）— 理解計數 1-2
- inferential：推論性問題（為什麼、怎麼會這樣、有什麼影響）— 理解計數 3-4
- evaluative：評估性問題（你覺得、如果是你、這個故事告訴我們什麼）— 理解計數 5

目前階段：{state.current_phase}
學生已理解的問題數：{state.understood_count}/{self.REQUIRED_UNDERSTOOD}

回饋風格：
- 語氣溫暖、友善，適合小學高年級至國中生
- 只用繁體中文
- 回饋要簡短（1-2句），然後直接問下一個問題
- 問題長度：15-40 個字"""

    async def start_session(
        self,
        session_id: str,
        story_title: str,
        story_text: str,
        mispronounced_words: list[str] | None = None,
        accuracy: float | None = None,
        cpm: float | None = None,
    ) -> AgentResponse:
        """Start a new session — generate the first question."""
        state = SessionState(
            session_id=session_id,
            story_title=story_title,
            story_text=story_text,
            mispronounced_words=mispronounced_words,
            accuracy=accuracy,
            cpm=cpm,
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
        # Rate limiting check
        if _store.check_rate_limit(session_id):
            raise ValueError("Rate limit exceeded. Please wait before sending another answer.")

        # Input validation
        if not student_answer or not student_answer.strip():
            raise ValueError("Answer cannot be empty")
        if len(student_answer) > self.MAX_ANSWER_LENGTH:
            raise ValueError(f"Answer too long (max {self.MAX_ANSWER_LENGTH} characters)")
        student_answer = student_answer.strip()

        state = _store.get(session_id)
        if state is None:
            raise ValueError(f"Session {session_id} not found or expired")

        state.conversation.append({"role": "student", "text": student_answer})
        state.total_attempts += 1

        # Truncate conversation history to keep only last N turns
        if len(state.conversation) > self.MAX_HISTORY_TURNS:
            # Keep first turn (initial question) + last MAX_HISTORY_TURNS-1 turns
            state.conversation = [state.conversation[0]] + state.conversation[-(self.MAX_HISTORY_TURNS - 1):]

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

            # Validate referenced_paragraph bounds
            num_paragraphs = len([p for p in state.story_text.split("\n") if p.strip()])
            if referenced_paragraph is not None:
                if not isinstance(referenced_paragraph, int) or referenced_paragraph < 0 or referenced_paragraph >= num_paragraphs:
                    logger.warning("Invalid referenced_paragraph %s (max %d), resetting to None", referenced_paragraph, num_paragraphs - 1)
                    referenced_paragraph = None

            # Validate phase
            if phase not in PHASE_ORDER:
                logger.warning("Invalid phase '%s', using current: %s", phase, state.current_phase)
                phase = state.current_phase

            # Validate question is non-empty
            if not question or not question.strip():
                question = _fallback_question(state)

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
            # Advance phase based on understood count.
            # Phase sets the prompt for the NEXT question, so offset by 1:
            # count 0-1 → factual (Q1-Q2), 2-3 → inferential (Q3-Q4), 4+ → evaluative (Q5)
            if state.understood_count <= 1:
                state.current_phase = "factual"
            elif state.understood_count <= 3:
                state.current_phase = "inferential"
            else:
                state.current_phase = "evaluative"
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
