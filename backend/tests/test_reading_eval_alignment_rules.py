"""
Alignment and scoring rules for reading evaluation fallback path.

Mirrors frontend readingEvalRules.test.ts (R1–R6) for
_build_fallback_result / _normalize_text — no audio/STT API required.
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services.reading_evaluation_service import (
    _build_fallback_result,
    _normalize_text,
)
from app.services.stt.pinyin import is_homophone
from app.services.stt.algorithm import correct_homophones, compute_match_rate

MENGCHANGJUN_LINE = (
    "中國的戰國時期，有七個國家總是爭強鬥勝、互比苗頭，為了要在競爭中勝出，各國都在搶傑出的管理人才，"
    "其中最有名的人才，就是齊國的孟嘗君。孟嘗君是有錢的貴族，最讓人津津樂道的是他在家裡養了三千名食客，"
    "食客就是在家裡吃飯的客人，三千人開飯的場面一眼望不完，真是非常壯觀。"
    "只要自認為有本事的人來投奔孟嘗君，他二話不說，總是張開雙手歡迎。"
    "這些食客具備各式各樣的才能，可以隨時幫他解決各種問題。"
)

QIN_LINE = "公元前299年，秦昭王聽說孟嘗君的賢達，便邀請他到秦國當宰相。"

DUPLICATE_RENCAI = "管理人才有本事的人才有才能"


def _fallback(spoken: str, target: str) -> dict:
    return _build_fallback_result(spoken, target)


def _types(result: dict) -> list[str]:
    return [t["type"] for t in result["diff_tokens"]]


# ─── R1: punctuation excluded ───────────────────────────────────────────────


def test_r1_normalize_removes_punctuation():
    assert _normalize_text("媽媽說，你好。") == "媽媽說你好"


def test_r1_fallback_full_match_ignores_punctuation():
    target = "媽媽說，你好。"
    spoken = "媽媽說你好"
    result = _fallback(spoken, target)
    assert result["adjusted_match_rate"] >= 0.99


# ─── R2: missing chars ──────────────────────────────────────────────────────


def test_r2_detects_single_missing_char():
    target = "其中最有名的人才是齊國的孟嘗君"
    spoken = "其中有名的人才是齊國的孟嘗君"
    result = _fallback(spoken, target)
    missing = [t for t in result["diff_tokens"] if t["type"] == "missing"]
    assert any(t["char"] == "最" for t in missing)
    assert result["adjusted_match_rate"] < 1.0


def test_r2_partial_paragraph_low_match():
    spoken = "中國的戰國時期"
    result = _fallback(spoken, MENGCHANGJUN_LINE)
    assert result["adjusted_match_rate"] < 0.4
    assert result["stats"]["missing_count"] > 5


def test_r2_empty_speech_all_missing():
    result = _fallback("", "他們去公園玩耍")
    assert result["match_rate"] == 0.0
    assert result["stats"]["missing_count"] == len(_normalize_text("他們去公園玩耍"))


# ─── R3: no ghost-green on duplicate chars ───────────────────────────────────


def test_r3_only_first_rencai_pair_matches():
    spoken = "管理人才"
    result = _fallback(spoken, DUPLICATE_RENCAI)
    correct_ren = sum(
        1
        for t in result["diff_tokens"]
        if t["char"] == "人" and t["type"] in ("correct", "forgiven")
    )
    correct_cai = sum(
        1
        for t in result["diff_tokens"]
        if t["char"] == "才" and t["type"] in ("correct", "forgiven")
    )
    assert correct_ren == 1
    assert correct_cai == 1
    assert result["stats"]["missing_count"] > 0


def test_r3_partial_prefix_not_full_paragraph_score():
    spoken = "中國的戰國時期，有七個國家"
    result = _fallback(spoken, MENGCHANGJUN_LINE)
    assert result["adjusted_match_rate"] < 0.5


# ─── R4: number normalization ───────────────────────────────────────────────


def test_r4_299_spoken_as_chinese_digits():
    spoken = "公元前二百九十九年，秦昭王聽說孟嘗君的賢達，便邀請他到秦國當宰相。"
    result = _fallback(spoken, QIN_LINE)
    assert result["adjusted_match_rate"] >= 0.95


def test_r4_partial_through_digit_run():
    spoken = "公元前二百九十九年"
    target = "公元前299年，秦昭王"
    result = _fallback(spoken, target)
    assert result["stats"]["missing_count"] >= 3
    assert "missing" in _types(result)


def test_r4_fullwidth_digits_match_chinese_spoken():
    target = "公元前２９９年，秦昭王聽說孟嘗君的賢達，便邀請他到秦國當宰相。"
    spoken = "公元前二百九十九年，秦昭王聽說孟嘗君的賢達，便邀請他到秦國當宰相。"
    result = _fallback(spoken, target)
    assert result["adjusted_match_rate"] >= 0.95


def test_r4_liang_bai_spoken_matches_er_bai_target():
    result = _fallback("兩百個", "二百個人")
    assert result["stats"]["correct_count"] >= 2
    assert any(t["char"] == "人" and t["type"] == "missing" for t in result["diff_tokens"])


# ─── R5: homophone / near-sound forgiveness ─────────────────────────────────


def test_r5_homophone_forgiven_in_fallback():
    spoken = "他門去工園完刷"
    target = "他們去公園玩耍"
    result = _fallback(spoken, target)
    assert result["stats"]["forgiven_count"] >= 2
    assert result["adjusted_match_rate"] > result["match_rate"] or result["adjusted_match_rate"] >= 0.7


def test_r5_correct_homophones_improves_match_rate():
    spoken = "他門去公園玩耍"
    target = "他們去公園玩耍"
    corrected = correct_homophones(spoken, _normalize_text(target))
    assert compute_match_rate(corrected, target) >= compute_match_rate(spoken, target)


def test_r5_genuine_error_stays_wrong():
    result = _fallback("大樹", "小樹")
    assert any(t["type"] == "wrong" for t in result["diff_tokens"])
    assert not is_homophone("大", "小")


# ─── R6: scorable chars only ────────────────────────────────────────────────


def test_r6_bopomofo_stripped():
    assert _normalize_text("人ㄖㄣˊ") == "人"
    result = _fallback("人", "人ㄖㄣˊ")
    assert result["adjusted_match_rate"] >= 0.99


def test_r6_parenthetical_notes_stripped():
    target = "你好（旁白）世界"
    spoken = "你好世界"
    norm = _normalize_text(target)
    assert "旁白" not in norm
    result = _fallback(spoken, target)
    assert result["adjusted_match_rate"] >= 0.99
