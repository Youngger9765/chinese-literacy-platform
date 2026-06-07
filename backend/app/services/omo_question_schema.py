"""OMO question schema extraction — builds per-question schema + grading prompt.

Extracted from omo_grader.py (issue #1879).

Responsibilities:
  - _resolve_letter_answer: maps A-G letter to vocabulary word by index
  - _build_question_schema: parses lesson YAML into a list of question dicts
    with allowed_values, mode (lettered/free_form), and correct_answer
  - _build_grading_prompt: builds the OCR system prompt with per-question
    allowed-value constraints (anti-fabrication, #1712)
"""

import logging

logger = logging.getLogger(__name__)


# Which UI step (step_sequence id, see frontend stepConfig.ts) each worksheet
# section maps to. Used to order graded results by the lesson's on-screen 關卡
# sequence (#2038 / #2089 item 2) instead of by question type.
#
# NOTE: keys are YAML SECTION names (fill_in_blank / multiple_choice /
# strategy_exercise), NOT the schema's question `type` field — strategy_exercise
# questions are emitted with type "fill_blank" but belong to "reading-strategy".
# Do not look this up via q["type"]; assign step at the section it is built in.
QUESTION_TYPE_TO_STEP = {
    "fill_blank": "vocab-application",       # 語詞應用
    "multiple_choice": "comprehension",      # 閱讀理解
    "strategy_exercise": "reading-strategy", # 閱讀聚光燈
}

# Video-link metadata markers. These are extremely specific to the YouTube-link
# region of a worksheet (片長 = clip length, 建議觀看 = recommended viewing). A
# real cloze sentence essentially never contains them — validated across all 57
# lessons (#2038): only G7-L28 id=1 and G7-L30 id=1 match, both genuine parse
# artifacts where the video caption region was mis-parsed as a fill-in blank.
_VIDEO_METADATA_MARKERS = ("片長", "建議觀看")


def _is_media_artifact(item) -> bool:
    """True when a fill_in_blank entry is a video-caption parse artifact, not a
    real question (#2038 — meeting §2「占位空格 / 示意 sample 被誤判為題目」).

    Signal: the blank's surrounding context carries video-link metadata
    (片長 / 建議觀看) AND it has no real cloze sentence. Such entries come from
    the worksheet's video-links region, not a gradeable blank — including them
    makes the grader hunt for handwriting that does not exist and can derange
    alignment of the real questions.
    """
    if not isinstance(item, dict):
        return False
    sentence = (item.get("sentence") or item.get("context") or "").strip()
    if sentence:
        return False  # a real cloze sentence is present → it is a question
    context_blob = (item.get("context_before") or "") + (item.get("context_after") or "")
    return any(marker in context_blob for marker in _VIDEO_METADATA_MARKERS)


def _vocab_bank_lookup(vocab_bank, key: str) -> str | None:
    """Return the word a worksheet letter maps to in vocab_bank, else None.

    vocab_bank is the paper worksheet's printed legend (letter→word). Keys are
    halfwidth single letters; match case-insensitively.
    """
    if not isinstance(vocab_bank, dict) or not vocab_bank:
        return None
    for k, v in vocab_bank.items():
        if str(k).strip().upper() == key:
            if isinstance(v, dict):
                return str(v.get("word") or v.get("term") or "") or None
            return str(v)
    return None


def _resolve_letter_answer(letter: str, vocabulary: list, vocab_bank=None) -> str:
    """Resolve A/B/C/... letter to the vocabulary word it stands for.

    Source of truth is the paper worksheet's printed legend (``vocab_bank``: a
    letter→word dict). Its keys can be NON-CONTIGUOUS (e.g. {A, D, E, G, H}) and
    need not match the lesson ``vocabulary`` list order, so resolve from
    vocab_bank first when it contains the letter (#2015 — index mapping marked
    correct answers wrong because it assumed A=vocabulary[0], B=vocabulary[1]…).

    Fallback (no vocab_bank, or the letter is absent from it): legacy index
    mapping where A=vocabulary[0], B=vocabulary[1], … (L22-L30 style).

    Returns the actual word, else the letter as-is.
    """
    if not isinstance(letter, str) or len(letter.strip()) != 1 or not letter.strip().isalpha():
        return str(letter)
    key = letter.strip().upper()
    # Worksheet legend wins when present (#2015).
    bank_word = _vocab_bank_lookup(vocab_bank, key)
    if bank_word is not None:
        return bank_word
    if not isinstance(vocabulary, list) or not vocabulary:
        return letter
    idx = ord(key) - ord("A")
    if not (0 <= idx < len(vocabulary)):
        return letter
    v = vocabulary[idx]
    if isinstance(v, dict):
        return str(v.get("word") or v.get("term") or letter)
    return str(v)


def _build_question_schema(lesson: dict) -> list[dict]:
    """Extract expected-answer schema from lesson YAML for the grading prompt.

    Each question dict includes `allowed_values` — the only legal student_answer
    values for that question (#1712 fix: prevents Gemini fabrication by giving
    it a finite value space to choose from).
    """
    questions = []
    vocabulary = lesson.get("vocabulary") or []
    vocab_words = [v.get("word", "") for v in vocabulary if v.get("word")]
    # Paper worksheet legend (letter→word). When present it is the source of
    # truth for lettered answers (#2015); its keys may be non-contiguous.
    vocab_bank = lesson.get("vocab_bank") if isinstance(lesson.get("vocab_bank"), dict) else None

    # Detect fill_in_blank mode: 'lettered' (student circles a letter) vs
    # 'free_form' (student handwrites a word). Mode is determined by whether ALL
    # fb answers are single letters within the worksheet's choice set.
    fb = lesson.get("fill_in_blank") or []
    fb_raw_items = list(fb.items()) if isinstance(fb, dict) else list(enumerate(fb))
    # Skip media artifacts here too (#2038 review): an artifact's non-letter
    # answer (e.g. '外來種') would otherwise drag fb_lettered to False and turn
    # a genuinely lettered lesson into free_form mode — scoring every fb wrong.
    fb_answers = []
    for _, item in fb_raw_items:
        if _is_media_artifact(item):
            continue
        ans = item.get("answer", "") if isinstance(item, dict) else str(item)
        fb_answers.append(ans)

    # The worksheet's legal letter set. When a vocab_bank legend is present, its
    # keys define the letters — and they can run PAST G (H, I, J, K …) when the
    # worksheet offers 8+ choices. Hardcoding A-G degraded those lessons to
    # free_form and scored a perfect student 0 (#2015). Fall back to A-G only for
    # legacy lessons (L22-L30 style) that have no vocab_bank.
    if vocab_bank:
        bank_letters = sorted(
            str(k).strip().upper()
            for k in vocab_bank.keys()
            if len(str(k).strip()) == 1 and str(k).strip().isalpha()
        )
    else:
        bank_letters = list("ABCDEFG")
    bank_letter_set = set(bank_letters)

    fb_lettered = bool(fb_answers) and all(
        isinstance(a, str) and len(a.strip()) == 1 and a.strip().upper() in bank_letter_set
        for a in fb_answers if a
    )
    if not fb_lettered:
        fb_allowed_letters = []
    elif vocab_bank:
        fb_allowed_letters = bank_letters
    else:
        n_letters = min(len(vocab_words), 7)
        fb_allowed_letters = [chr(ord("A") + i) for i in range(n_letters)]

    for key, item in fb_raw_items:
        qid = str(key) if isinstance(fb, dict) else f"fb_{key+1}"
        # #2038 Task A: skip video-caption parse artifacts so they never enter
        # the reference schema (root cause of meeting §2「占位空格誤判為填空題」).
        if _is_media_artifact(item):
            logger.info(
                "omo_question_schema: skipping media-artifact fill_in_blank %s "
                "(video-caption region, not a real question)", qid,
            )
            continue
        if isinstance(item, dict):
            raw_answer = item.get("answer", "")
            context = item.get("context", item.get("sentence", ""))
        else:
            raw_answer = str(item)
            context = ""
        correct_word = _resolve_letter_answer(raw_answer, vocabulary, vocab_bank)
        # #1712: lettered fb compares letter-vs-letter (student circles a letter).
        # `correct_answer` is what we score against in _score_answer.
        # `correct_word` is kept for display ("正解：規律").
        if fb_lettered:
            correct_for_scoring = str(raw_answer).strip().upper()
        else:
            correct_for_scoring = correct_word
        questions.append({
            "id": qid,
            "type": "fill_blank",
            "step": QUESTION_TYPE_TO_STEP["fill_blank"],
            "context": context,
            "correct_answer": correct_for_scoring,
            "correct_word": correct_word,
            "mode": "lettered" if fb_lettered else "free_form",
            "allowed_values": fb_allowed_letters if fb_lettered else vocab_words,
        })

    # multiple_choice section — accepts list[dict] or dict[str, dict]
    mc = lesson.get("multiple_choice") or []
    mc_items = mc.items() if isinstance(mc, dict) else enumerate(mc)
    for key, item in mc_items:
        qid = str(key) if isinstance(mc, dict) else f"mc_{key+1}"
        if isinstance(item, dict):
            correct = item.get("answer", "")
            context = item.get("question", item.get("sentence", ""))
        else:
            correct = str(item)
            context = ""
        questions.append({
            "id": qid,
            "type": "multiple_choice",
            "step": QUESTION_TYPE_TO_STEP["multiple_choice"],
            "context": context,
            "correct_answer": correct,
            "mode": "lettered",
            "allowed_values": ["A", "B", "C", "D"],
        })

    # strategy_exercise section (structured exercises in 7-lesson set)
    se = lesson.get("strategy_exercise") or {}
    if isinstance(se, dict):
        items = se.get("items") or se.get("questions") or []
        if isinstance(items, list):
            for i, item in enumerate(items):
                if isinstance(item, dict) and "answer" in item:
                    qid = item.get("id", f"se_{i+1}")
                    questions.append({
                        "id": qid,
                        "type": "fill_blank",
                        "step": QUESTION_TYPE_TO_STEP["strategy_exercise"],
                        "context": item.get("stem", item.get("question", "")),
                        "correct_answer": item.get("answer", ""),
                    })

    return questions


def _build_grading_prompt(questions: list[dict]) -> str:
    """Build OCR-only prompt with per-question allowed-value constraints.

    Design (fixes #1712 — round 3 of #1614/#1616):
    - Each question explicitly lists the legal student_answer values so Gemini
      cannot return a plausible-but-fabricated answer like 「良好」 when the
      choice set is A-G letters.
    - Reference (correct) answers stay HIDDEN per #1616 — Gemini sees the value
      SPACE but not which value is correct.
    - Empty answer is always legal — if Gemini can't see handwriting, it should
      say so instead of inventing.
    """
    def _format(q: dict) -> str:
        mode = q.get("mode", "free_form")
        allowed = q.get("allowed_values") or []
        if mode == "lettered":
            value_hint = "{" + ", ".join(allowed) + ', ""}'
            instr = "學生在題號旁圈一個字母。逐筆檢查圈圈/勾選/箭頭標記。"
        else:
            sample = "、".join(allowed[:6]) + ("…" if len(allowed) > 6 else "")
            value_hint = f'{{{sample}, ""}}'
            instr = "學生用鉛筆/原子筆在空格內手寫一個詞。逐字 OCR。"
        return (
            f"  - {q['id']} ({q['type']}): {q['context']}\n"
            f"      合法答案 = {value_hint}\n"
            f"      做法：{instr}"
        )

    questions_text = "\n".join(_format(q) for q in questions)
    return f"""你是 OCR 識字員。讀學生在學習單照片上的**手寫筆跡**。

== 絕對規則 ==
1. 只報告學生**實際用鉛筆/原子筆寫**的字 — 從照片像素讀出來的。
2. **禁止編造**：student_answer 必須是該題「合法答案」清單裡的值，或空字串 ""。
3. 看不到手寫、看不清、學生跳過 → student_answer=""，ai_confidence=0.0。
4. 不要把印刷的題目文字、題目選項、或正確答案當作學生作答。
5. 紅筆批改痕跡（✗ / 紅線 / 紅筆覆寫）= 老師批改 — student_answer 填學生**原本**寫的字（紅筆修改前），不是老師訂正的字。
6. 對 lettered 題（A/B/C/D…），只能回字母本身（單一大寫字母）— 不能回詞語。

== 模糊情況的處理（#1715 disambiguation） ==
7. **多個圈/猶豫筆跡**：學生圈了又劃掉、或同時圈兩個字母 → 取**最終確定**的那個（最濃、最完整、沒被劃掉的）；無法判斷哪個是最終 → student_answer=""，ai_confidence 標低。
8. **圈圈跨越兩個字母邊界**：圈圈中心離哪個字母最近就選哪個；若無法決定 → 回空。
9. **筆跡淡 / 模糊 / 被擦過**：勉強看到也不要硬猜 → 不確定就回空 + ai_confidence ≤ 0.5。
10. **ai_confidence 校準**：清楚看到 → 0.85-1.0；尚可辨識但有疑慮 → 0.5-0.85；勉強猜 → 0.0-0.5（後端會把 < 0.7 的視為無作答，請誠實標註不要灌水）。

== 題目清單（含合法答案清單） ==
{questions_text}

回傳 JSON 陣列，每題一筆：
[{{"question_id":"fb_1","student_answer":"<合法值或空字串>","ai_confidence":0.0~1.0,"reasoning":"50字內描述照片裡看到的筆跡"}}]"""
