"""
rescue_prompt_builder.py — System prompt construction for MCQ Rescue sessions.

Extracted from mcq_rescue_agent.py (Issue #1887).
Builds the Gemini system prompt from strategy YAML data and session state.
"""

from __future__ import annotations

from .persona import TUTOR_PERSONA
from .rescue_session_store import RescueSessionState


def build_system_prompt(
    state: RescueSessionState,
    prompt_data: dict,
    give_up_threshold: int = 3,
) -> str:
    """Build the Gemini system prompt for a rescue session turn.

    Args:
        state: Current rescue session state.
        prompt_data: Loaded strategy YAML data (from load_strategy_prompt).
        give_up_threshold: Number of consecutive give-ups before step 5 skip.

    Returns:
        System prompt string for Gemini.
    """
    step_index = state.current_step - 1
    steps = prompt_data.get("steps", [])
    current_step_data = steps[step_index] if 0 <= step_index < len(steps) else {}

    step_descriptions = "\n".join(
        f"  步驟 {s['step']} [{s.get('name','')}] — {s.get('label','')}：{s.get('intent','')}"
        for s in steps
    )

    tone_lines = "\n".join(f"  - {t}" for t in prompt_data.get("tone", []))

    terminate_conds = prompt_data.get("terminate_conditions", [])
    if isinstance(terminate_conds, list):
        terminate_str = "\n".join(f"  - {c}" for c in terminate_conds)
    else:
        terminate_str = str(terminate_conds)

    return f"""{TUTOR_PERSONA}

你是「MCQ 解題助教」。學生在閱讀理解選擇題答錯了，你的任務是用 5 步驟 SOP 引導他找到正確答案。

【策略類型】{prompt_data.get("display_name", "通用")}
{prompt_data.get("description", "")}

【學生答錯的題目】
題目：{state.question_text}
學生選了：{state.wrong_choice}

【5 步驟 SOP 總覽】
{step_descriptions}

【目前步驟】步驟 {state.current_step} — {current_step_data.get("label", "")}
目標：{current_step_data.get("intent", "")}
advance 條件：{current_step_data.get("advance_when", "")}
fail 條件：{current_step_data.get("fail_when", "")}

引導原則（此步驟）：
{current_step_data.get("sample_prompt", "")}

【結束條件】
{terminate_str}

【語氣規範】
{tone_lines}

評分規則：
- should_advance = true：學生回答達到此步驟的 advance_when 條件
- should_advance = false：學生還沒達到，繼續同一步驟引導
- should_terminate = true：
  (a) 步驟 4 學生選對了（rescue 成功），或
  (b) 步驟 5 完成（已直接教學），或
  (c) 連續 {give_up_threshold} 次 give_up_detected=true
- give_up_detected = true：學生說「不知道」「隨便」「我不會」「放棄」等敷衍或放棄詞
- reasoning 欄位：必填。說明為什麼你設定了 should_advance / should_terminate 這樣的值

絕對禁止：
- 不可直接給答案，除非到了步驟 5
- 不可說「答案是 X」直到 step 5
- 不可讓學生答錯也 should_advance=true（即使他很接近）
- 不可在 AI 出錯時讓 should_advance=true（錯誤降級必須 should_advance=false）"""
