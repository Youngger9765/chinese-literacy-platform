"""Zhuyin (破音字) multiple-choice question generator — independent module (#3551).

## 這個模組在做什麼

generate_zhuyin_questions(lesson_uid) 給一課，吐出一批「這句話裡這個破音字
怎麼讀」的多選題（2 到 4 個選項）。純函數、不碰 DB、不寫任何資料、不 import
任何 quiz/contest 模組 —— 依賴只能單向：課堂挑戰（或未來任何呼叫端）可以呼叫
這支，這支完全不知道呼叫端是誰。

## 真值來源（逐一驗證過，見 PR 說明）

- 每個字在這個位置該讀什麼：backend/data/lessons/uid/v/zhuyin.json 的
  texts.ssz（每字一碼，點號代表預設槽 0000，數字 1 到 9 代表 ss01 到
  ss09）對照 backend/data/zhuyin/font_slot_readings.json 的
  slots.char.slot_name。這兩份檔都已經是 zhuyin module 的 owns_data
  （見 specs/modules/zhuyin/INTENT.md），本模組只讀，不碰、不改、不擁有。
- 誘答（這個字真實存在的其他讀音）：backend/data/zhuyin/font_readings.json
  的 poly.char.v。驗證過：全庫 2037 個破音字，font_slot_readings.json
  每個位置算出的讀音，都是 font_readings.json 那個字的 v 清單的子集（零例
  外），所以「正解一定找得到對應的誘答池」不是假設，是驗過的事實。

## 為什麼只收這三個 section

179 課裡，full_text_annotate（168 課）加上 classical_text／
modern_translation（10 篇文言文課，跟 full_text_annotate 完全不重疊）覆蓋
178／179 課。

key_reading（151 課）刻意不收 —— 抽樣確認它幾乎總是 full_text_annotate 的
子字串，收了只會重複出題。self_challenge（4 課）跟 served 開頭那些（答案、
選項、題幹等消費端重組出來的字串）也不收 —— 它們不是「學生在讀的課文本
體」。剩下的 1 課（L0136）在這三個 section 都沒有內容，會回空清單，這是
誠實的「這課沒有可出題的段落」，不是 bug。

## 停用字清單怎麼來的

對全庫 179 課、這三個 section，逐字數「這個字出現幾次」跟「幾次的正解不是
預設讀音」。occurrence 至少 100 次（樣本夠大）且非預設比例低於 2%（幾乎不
會讀錯）的字，就算這一次剛好落在預設讀音，也不是一道有意義的挑戰題 ——
65 個字落在這條線內，見下方 STOP_LIST，附實測次數的來源見 PR 說明。

只在「這個位置剛好是預設讀音」時才跳過 —— 同一個字落在非預設讀音的位置
不會被這份清單擋掉，因為那個位置的正解根本不是預設讀音，不滿足跳過條件。
清單管的是「太無聊的預設」，不是「這個字整體」。

這份清單是從真數據derive的，不是照 PRD 舉的例子照抄：PRD 原本舉例的
「的 了 著 地 得 一 不」裡只有「的」真的落在這條線內；了（2.34%）、地
（6.29%）、著（4.35%）略高於門檻；得（76%）、一（92.9%）、不（47.1%）的
非預設讀音其實很常見（多半是語氣助詞、輕聲、文法上的真實破音），用真數
據取代直覺才抓得準。
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
import random

from app.services.lesson_uid_loader import LESSONS_ROOT, _latest_version

_BACKEND_ROOT = Path(__file__).resolve().parents[2]
_FONT_READINGS_PATH = _BACKEND_ROOT / "data" / "zhuyin" / "font_readings.json"
_FONT_SLOT_READINGS_PATH = _BACKEND_ROOT / "data" / "zhuyin" / "font_slot_readings.json"

ACCEPTED_SECTIONS = (
    "full_text_annotate",
    "classical_text",
    "modern_translation",
)

_MIN_PARAGRAPH_LEN = 6

_MAX_SENTENCE_LEN = 40

_MAX_OPTIONS = 4

_SENTENCE_END = frozenset("。！？")

_CLAUSE_END = frozenset("。！？，、；：")

STOP_LIST = frozenset((
    "的", "有", "會", "大", "上", "可", "們", "中", "看", "說",
    "家", "都", "過", "麼", "同", "把", "那", "作", "更", "些",
    "身", "比", "從", "法", "正", "於", "無", "度", "平", "其",
    "文", "提", "日", "讀", "什", "員", "阿", "放", "解", "化",
    "嗎", "呢", "跑", "觀", "食", "期", "吃", "風", "石", "聽",
    "轉", "女", "色", "語", "甚", "遠", "親", "各", "傳", "論",
    "合", "百", "任", "車", "錢",
))


@dataclass(frozen=True)
class ZhuyinQuestion:
    """一道「這句話裡這個破音字怎麼讀」的多選題。"""

    id: str
    lesson_uid: str
    sentence: str
    target_index: int
    char: str
    options: list[str]
    answer_index: int


@lru_cache(maxsize=1)
def _font_readings() -> dict:
    raw = json.loads(_FONT_READINGS_PATH.read_text(encoding="utf-8"))
    return raw["poly"]


@lru_cache(maxsize=1)
def _font_slot_readings() -> dict:
    raw = json.loads(_FONT_SLOT_READINGS_PATH.read_text(encoding="utf-8"))
    return raw["slots"]


def _slot_name(digit: str) -> str:
    if digit == ".":
        return "0000"
    return "ss" + format(int(digit), "02d")


def _u16_chars(text: str) -> list[str]:
    out: list[str] = []
    for ch in text:
        if ord(ch) > 0xFFFF:
            enc = ch.encode("utf-16-le")
            out.append(enc[0:2].decode("utf-16-le", "surrogatepass"))
            out.append(enc[2:4].decode("utf-16-le", "surrogatepass"))
        else:
            out.append(ch)
    return out


def _char_spans(chars: list[str], delimiters: frozenset) -> list[tuple[int, int]]:
    spans: list[tuple[int, int]] = []
    start = 0
    for i, ch in enumerate(chars):
        if ch in delimiters:
            spans.append((start, i + 1))
            start = i + 1
    if start < len(chars):
        spans.append((start, len(chars)))
    return spans


def _extract_window(chars: list[str], pos: int) -> tuple[str, int]:
    sentence_spans = _char_spans(chars, _SENTENCE_END)
    s0, s1 = next(sp for sp in sentence_spans if sp[0] <= pos < sp[1])
    if s1 - s0 <= _MAX_SENTENCE_LEN:
        start, end = s0, s1
    else:
        clause_spans = _char_spans(chars, _CLAUSE_END)
        c0, c1 = next(sp for sp in clause_spans if sp[0] <= pos < sp[1])
        if c1 - c0 <= _MAX_SENTENCE_LEN:
            start, end = c0, c1
        else:
            half = _MAX_SENTENCE_LEN // 2
            start = max(s0, pos - half)
            end = min(s1, start + _MAX_SENTENCE_LEN)
            start = max(s0, end - _MAX_SENTENCE_LEN)
    sentence = "".join(chars[start:end])
    return sentence, pos - start


def _lesson_texts(lesson_uid: str) -> list[dict]:
    uid_dir = LESSONS_ROOT / lesson_uid
    if not uid_dir.is_dir():
        return []
    vdir = _latest_version(uid_dir)
    if vdir is None:
        return []
    path = vdir / "zhuyin.json"
    if not path.is_file():
        return []
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    texts = doc.get("texts")
    return texts if isinstance(texts, list) else []


def generate_zhuyin_questions(
    lesson_uid: str,
    *,
    limit: int | None = None,
    seed: int | None = None,
) -> list[ZhuyinQuestion]:
    """給一課，產生一批注音挑戰題。決定性：同樣的 lesson_uid 加同樣的 seed
    永遠得到同樣的結果。沒給 seed 時用 0 當預設種子。走訪順序固定為
    zhuyin.json 裡 texts 陣列原本的順序，段落內再按字元位置由左到右；
    limit 只是把這個固定順序的清單砍到前 N 筆。"""
    texts = _lesson_texts(lesson_uid)
    if not texts:
        return []

    poly = _font_readings()
    slots = _font_slot_readings()
    rng = random.Random(seed if seed is not None else 0)

    questions: list[ZhuyinQuestion] = []
    seen_dedupe: set[tuple[str, str, str]] = set()

    for item in texts:
        section = item.get("section")
        if section not in ACCEPTED_SECTIONS:
            continue
        text = item.get("text")
        ssz = item.get("ssz")
        if not isinstance(text, str) or not isinstance(ssz, str):
            continue
        chars = _u16_chars(text)
        if len(chars) < _MIN_PARAGRAPH_LEN:
            continue
        if len(chars) != len(ssz):
            continue

        slug = item.get("slug")
        slug_part = slug if slug else "-"
        idx = item.get("idx")
        idx_part = str(idx) if idx is not None else "p" + str(len(questions))

        for pos, ch in enumerate(chars):
            char_slots = slots.get(ch)
            if not char_slots:
                continue
            slot_name = _slot_name(ssz[pos])
            correct = char_slots.get(slot_name)
            if not correct:
                continue
            if slot_name == "0000" and ch in STOP_LIST:
                continue

            entry = poly.get(ch)
            if entry is None:
                continue
            readings = entry.get("v")
            if not isinstance(readings, list) or correct not in readings:
                continue

            others = [r for r in dict.fromkeys(readings) if r != correct]
            if not others:
                continue
            rng.shuffle(others)
            distractors = others[: _MAX_OPTIONS - 1]

            options = [correct] + distractors
            rng.shuffle(options)
            answer_index = options.index(correct)

            sentence, local_index = _extract_window(chars, pos)

            dedupe_key = (ch, correct, sentence)
            if dedupe_key in seen_dedupe:
                continue
            seen_dedupe.add(dedupe_key)

            qid = ":".join((lesson_uid, section, slug_part, idx_part, str(pos)))
            questions.append(ZhuyinQuestion(
                id=qid,
                lesson_uid=lesson_uid,
                sentence=sentence,
                target_index=local_index,
                char=ch,
                options=options,
                answer_index=answer_index,
            ))

    if limit is not None:
        questions = questions[:limit]
    return questions
