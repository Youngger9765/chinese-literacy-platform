"""
Tests for parse_docx_lessons_bulk.py — story_structure_table extraction.

Covers:
  1. Format 1 (classic PSR): ≥2 PSR keywords in same row → G6-L22 style
  2. Format 2 (3-col header): 元素/段落 header row → G6-L24/25 style
  3. Format 3 (2-col title+PSR): title row + col0 PSR rows → G6-L23 style
  4. Graphic-text fallback: no table → synthesize from ❶❷ step paragraphs → G7-L29/30 style
  5. Negative: tables that should NOT match (朗讀速率, 生字, etc.)

Uses mock python-docx Table/Row/Cell objects to avoid docx file dependencies.
"""

import sys
import importlib.util
from pathlib import Path
from unittest.mock import MagicMock, PropertyMock

import pytest

# ---------------------------------------------------------------------------
# Load the module under test (not installed as a package)
# ---------------------------------------------------------------------------
_SCRIPT_PATH = Path(__file__).parent.parent / "scripts" / "parse_docx_lessons_bulk.py"


def _load_module():
    spec = importlib.util.spec_from_file_location("parse_docx_lessons_bulk", _SCRIPT_PATH)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


mod = _load_module()
extract_story_structure_table = mod.extract_story_structure_table
extract_graphic_text_structure = mod.extract_graphic_text_structure


# ---------------------------------------------------------------------------
# Helpers to build mock docx objects
# ---------------------------------------------------------------------------

def _make_cell(text: str) -> MagicMock:
    """Minimal mock of a python-docx TableCell."""
    cell = MagicMock()
    cell.text = text
    return cell


def _make_row(texts: list[str]) -> MagicMock:
    """Minimal mock of a python-docx TableRow."""
    row = MagicMock()
    row.cells = [_make_cell(t) for t in texts]
    return row


def _make_table(rows: list[list[str]]) -> MagicMock:
    """Minimal mock of a python-docx Table."""
    table = MagicMock()
    table.rows = [_make_row(r) for r in rows]
    return table


def _make_para(text: str) -> MagicMock:
    """Minimal mock of a python-docx Paragraph."""
    para = MagicMock()
    para.text = text
    return para


# ---------------------------------------------------------------------------
# Format 1 tests — classic PSR (G6-L22 style)
# Two PSR keywords appear in the SAME row
# ---------------------------------------------------------------------------

class TestFormat1ClassicPSR:
    def test_psr_keywords_in_row0(self):
        """Row 0 has ≥2 PSR keywords → matches Format 1."""
        tables = [
            _make_table([
                ["問題", "解決", "結果"],
                ["content A", "content B", "content C"],
            ])
        ]
        result = extract_story_structure_table(tables)
        assert result is not None
        assert len(result) == 2

    def test_psr_keywords_in_row1(self):
        """Row 1 has ≥2 PSR keywords (title in row0) → matches Format 1."""
        tables = [
            _make_table([
                ["課文標題", "課文標題", "課文標題"],
                ["問題", "問題", "內容描述"],
                ["解決", "解決", "解決內容"],
                ["結果", "結果內容"],
            ])
        ]
        result = extract_story_structure_table(tables)
        assert result is not None
        # Should extract all non-empty rows
        assert len(result) >= 2

    def test_two_keywords_minimum(self):
        """Exactly 2 PSR keywords triggers match."""
        tables = [
            _make_table([
                ["問題", "解決", "其他"],
                ["a", "b", "c"],
            ])
        ]
        result = extract_story_structure_table(tables)
        assert result is not None

    def test_one_keyword_insufficient(self):
        """Only 1 PSR keyword in row 0 AND row 1 → Format 1 does not match alone."""
        # This table should NOT match Format 1, but may match Format 3 if col0 has PSR
        tables = [
            _make_table([
                ["課文標題"],
                ["問題", "內容"],
            ])
        ]
        # One keyword per row but only 1 row with PSR — Format 3 needs ≥2 rows with col0 PSR
        # So this should return None
        result = extract_story_structure_table(tables)
        assert result is None


# ---------------------------------------------------------------------------
# Format 2 tests — 3-col header table (G6-L24/25 style)
# Row 0 contains 元素 or 段落; content rows have PSR in col0
# ---------------------------------------------------------------------------

class TestFormat2ThreeColHeader:
    def test_elements_header_with_psr_content(self):
        """Row 0 '元素/段落' header + col0 PSR content → matches Format 2."""
        tables = [
            _make_table([
                ["元素/段落", "提示", "重點"],
                ["問題/2", "不好的事", "白鯨困在冰原裡"],
                ["解決/3~6", "誰+做什麼", "政府派破冰船"],
                ["結果/6", "造成什麼改變", "白鯨游出冰原"],
            ])
        ]
        result = extract_story_structure_table(tables)
        assert result is not None
        assert len(result) == 4

    def test_duanfall_header_variant(self):
        """Row 0 just containing '段落' also matches."""
        tables = [
            _make_table([
                ["段落", "提示", "重點"],
                ["問題 /（1.2）", "困難描述", "歐洲人想遠航"],
                ["解決 /（3）", "行動", "荷蘭成立東印度公司"],
                ["結果 / 5", "改變", "得到龐大資金"],
            ])
        ]
        result = extract_story_structure_table(tables)
        assert result is not None

    def test_header_without_psr_col0_does_not_match(self):
        """元素 header but no PSR in col0 → no match."""
        tables = [
            _make_table([
                ["元素", "說明"],
                ["項目A", "描述A"],
                ["項目B", "描述B"],
            ])
        ]
        result = extract_story_structure_table(tables)
        assert result is None


# ---------------------------------------------------------------------------
# Format 3 tests — 2-col title+PSR rows (G6-L23 style)
# Row 0 is lesson title (no PSR); col0 of ≥2 subsequent rows has PSR keywords
# ---------------------------------------------------------------------------

class TestFormat3TwoColPSR:
    def test_title_row_plus_psr_content_rows(self):
        """Row 0 is title, rows 1-4 have 問題/解決/結果/迴響 in col0 → matches Format 3."""
        tables = [
            _make_table([
                ["老鷹紅豆的故事", "老鷹紅豆的故事"],
                ["問題", "農民製作毒餌導致大量鳥類中毒死亡"],
                ["解決 （誰＋做什麼）", "農民改用無毒農法"],
                ["結果", "老鷹紅豆友善耕作保護生態"],
                ["迴響 （結語）", "消費者支持購買老鷹紅豆"],
            ])
        ]
        result = extract_story_structure_table(tables)
        assert result is not None
        assert len(result) == 5

    def test_needs_at_least_two_psr_col0_rows(self):
        """Only 1 row with PSR keyword in col0 → Format 3 does not match."""
        tables = [
            _make_table([
                ["課文標題", "課文標題"],
                ["問題", "內容"],
                ["非PSR欄", "其他內容"],
            ])
        ]
        result = extract_story_structure_table(tables)
        assert result is None

    def test_deduplicates_merged_cells(self):
        """Merged cells (same text repeated) are deduplicated in output."""
        tables = [
            _make_table([
                ["課文標題", "課文標題"],   # merged — should appear once
                ["問題", "問題"],           # merged
                ["解決", "解決內容"],
                ["結果", "結果內容"],
            ])
        ]
        result = extract_story_structure_table(tables)
        assert result is not None
        # Row 0 should be deduplicated
        assert result[0] == ["課文標題"]


# ---------------------------------------------------------------------------
# Graphic-text fallback tests (G7-L29/30 style)
# ---------------------------------------------------------------------------

class TestGraphicTextFallback:
    def test_extracts_numbered_steps(self):
        """❶❷❸❹ step paragraphs → synthesized structure table."""
        paras = [
            _make_para("一段說明文字"),
            _make_para("❶先讀文字——抓到重點，想一想"),
            _make_para("❷再看圖——讀懂圖告訴我們什麼訊息"),
            _make_para("❸回到文字——從圖中找對應的訊息"),
            _make_para("❹整合文圖——把文和圖合起來想"),
        ]
        result = extract_graphic_text_structure(paras, "圖文整合閱讀策略")
        assert result is not None
        assert result[0] == ["圖文整合閱讀步驟"]
        assert len(result) == 5  # header + 4 steps

    def test_circled_numbers_also_match(self):
        """①②③④ (circled numbers) also captured."""
        paras = [
            _make_para("①先讀文字"),
            _make_para("②再看圖"),
            _make_para("③回到文字"),
        ]
        result = extract_graphic_text_structure(paras, "圖文整合閱讀策略")
        assert result is not None
        assert len(result) == 4  # header + 3 steps

    def test_non_graphic_strategy_returns_none(self):
        """Non-graphic strategy does not trigger fallback."""
        paras = [_make_para("❶step1"), _make_para("❷step2"), _make_para("❸step3")]
        result = extract_graphic_text_structure(paras, "摘要策略-問題.解決結構找重點")
        assert result is None

    def test_fewer_than_3_steps_returns_none(self):
        """Less than 3 steps → not enough content, returns None."""
        paras = [_make_para("❶step1"), _make_para("❷step2")]
        result = extract_graphic_text_structure(paras, "圖文整合閱讀策略")
        assert result is None

    def test_empty_paras_returns_none(self):
        result = extract_graphic_text_structure([], "圖文整合閱讀策略")
        assert result is None


# ---------------------------------------------------------------------------
# Negative tests — tables that must NOT be picked up as structure tables
# ---------------------------------------------------------------------------

class TestNegativeCases:
    def test_reading_rate_table_not_matched(self):
        """朗讀速率表（還要多加練習 / 計時）should not match."""
        tables = [
            _make_table([
                ["□ ＜210字", "□ 211~240字", "□ ＞241字"],
                ["還要多加練習。", "嗯，還不錯喲！", "哇嗚，超級厲害！"],
            ])
        ]
        result = extract_story_structure_table(tables)
        assert result is None

    def test_vocab_table_not_matched(self):
        """生字表 should not match."""
        tables = [
            _make_table([
                ["A.互比苗頭", "B.津津樂道", "C.開門見山"],
                ["F.鴉雀無聲", "G.悶不吭聲", "H.匪夷所思"],
            ])
        ]
        result = extract_story_structure_table(tables)
        assert result is None

    def test_empty_table_not_matched(self):
        """Empty table returns None."""
        table = MagicMock()
        table.rows = []
        result = extract_story_structure_table([table])
        assert result is None

    def test_no_tables_returns_none(self):
        result = extract_story_structure_table([])
        assert result is None
