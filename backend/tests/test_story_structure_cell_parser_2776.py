"""Regression locks for issue #2776 — three keypoints-table defects found by
sweeping L0011 element-by-element.

A) single-blank fields never counting/submitting — that bug lives entirely
   in the frontend key convention (`StoryStructureTable.tsx`); see the
   matching vitest file `StoryStructureTable.singleBlankDenominator.test.tsx`.
B) a sentence with two blanks, each with its own small option set, getting
   flattened into one checkbox list and losing the sentence — this file.
C) "單選" instructions rendering as an unconstrained multi-select checkbox —
   `detect_select_mode` here + the vitest file `StoryStructureTable.selectMode.test.tsx`
   for the widget-level enforcement.
"""
from __future__ import annotations

import pathlib
import sys

import pytest
import yaml

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from app.services.story_structure_cell_parser import (  # noqa: E402
    cell_to_structure_fields,
    detect_select_mode,
    normalize_paren_blanks_to_brackets,
    parse_inline_choice_groups,
)

L0011_RESULT_RAW = (
    "(單選，請打勾)\n"
    "結果，小戴（　）球賽，\n"
    "卻（　）全國人民的尊敬。\n"
    "第一個空格：□①贏了 ②輸了\n"
    "第二個空格：①贏得 □②失去"
)


class TestParseInlineChoiceGroups:
    def test_two_slot_lines_become_two_groups(self):
        value_s = normalize_paren_blanks_to_brackets(L0011_RESULT_RAW)
        groups = parse_inline_choice_groups(value_s)
        assert groups is not None
        assert len(groups) == 2
        assert groups[0]["options"] == ["贏了", "輸了"]
        assert groups[0]["correct_options"] == [1]  # 輸了 has no □
        assert groups[1]["options"] == ["贏得", "失去"]
        assert groups[1]["correct_options"] == [0]  # 贏得 has no □

    def test_a_single_slot_line_is_not_this_shape(self):
        """一句話只有一個空格配一組選項——那是普通 checkbox，不是這個形狀。"""
        text = "第一個空格：□①贏了 ②輸了"
        assert parse_inline_choice_groups(text) is None

    def test_no_slot_lines_returns_none(self):
        assert parse_inline_choice_groups("這個故事發生的情境？□①A ②B") is None


class TestCellToStructureFieldsInlineChoice:
    def test_l0011_result_becomes_inline_choice_with_sentence_preserved(self):
        """#2776 核心案例：句子留著、選項照空格分組，不是攤平成一組 4 選項。"""
        row = cell_to_structure_fields("結果", L0011_RESULT_RAW)
        assert row["interactive_type"] == "inline_choice"
        assert "第一個空格" not in row["value"]
        assert "第二個空格" not in row["value"]
        assert "結果，小戴" in row["value"]
        assert "全國人民的尊敬" in row["value"]
        assert row["blanks"] == [
            {"options": ["贏了", "輸了"], "correct_option": 1},
            {"options": ["贏得", "失去"], "correct_option": 0},
        ]

    def test_ordinary_checkbox_is_unaffected(self):
        """普通單一空格的 checkbox 不受影響——形狀不對，走原本的路。"""
        row = cell_to_structure_fields(
            "背景", "這個故事發生的情境？(多選，請打勾)\n①奧運金牌賽 □②世界大學運動會 ③全國關注的比賽"
        )
        assert row["interactive_type"] == "checkbox"
        assert row["options"] == ["奧運金牌賽", "世界大學運動會", "全國關注的比賽"]
        assert row["select_mode"] == "multi"

    def test_ordinary_fill_blank_is_unaffected(self):
        row = cell_to_structure_fields("主角", "【戴資穎】")
        assert row["interactive_type"] == "fill_blank"
        assert row["hint"] == "戴資穎"
        assert "blanks" not in row


class TestDetectSelectMode:
    def test_single(self):
        assert detect_select_mode("在重要比賽，仍然選擇：(單選，請打勾)") == "single"

    def test_multi(self):
        assert detect_select_mode("這個故事發生的情境？(多選，請打勾)") == "multi"

    def test_neither_present_is_unset(self):
        """舊 AI 產生的題目沒有這句指示語——回 None，前端維持原本的多選行為。"""
        assert detect_select_mode("下列哪個是阿耀遇到的問題？") is None


class TestNumberedListMarkersAreNotBlanks:
    """`(1)`／`(2)` 是段落編號，不是要填的空格（#2776 附帶修復，25 課 / 93 處）。"""

    def test_bare_ordinal_in_parens_is_left_alone(self):
        out = normalize_paren_blanks_to_brackets("(1)棉花肺實驗的問題")
        assert out == "(1)棉花肺實驗的問題"

    def test_real_blank_with_prose_answer_still_converts(self):
        out = normalize_paren_blanks_to_brackets("電子煙對人體（無害）。")
        assert out == "電子煙對人體【 無害 】。"

    def test_l0102_no_longer_gets_phantom_blanks(self):
        row = cell_to_structure_fields(
            "對網紅實驗的批判",
            "(1)棉花肺實驗的問題\n"
            "→A.棉花不等於人的肺。B.很多有害物質根本【　】。",
        )
        # 沒有 (1)/(2) 被誤判成 【 1 】【 2 】 混進答案清單。
        assert "1" not in [
            h for h in (row.get("blank_hints") or [row.get("hint")]) if h
        ]


class TestCorpusWideRegressionCounts:
    """全庫斷言用數量，不是「至少一課對」——跟 #2776 issue 的驗收條件對齊。

    這三個數字是修好之後量出來的真實狀態（見
    `docs/evidence/2026-08-19-keypoints-audit/`）。之後有人再改這支 parser，
    這裡會告訴他數字有沒有意外變動，而不是靠人工重新掃一次語料庫。
    """

    LESSONS = pathlib.Path(__file__).resolve().parent.parent / "data" / "lessons"
    MIN_SCANNED = 100

    def _rows(self):
        from app.routes.stories import _format_yaml_structure_table, _sanitize_structure_for_client
        from app.services.keypoints_to_structure import keypoints_to_structure_table

        scanned = 0
        for d in sorted(self.LESSONS.iterdir()):
            f = d / "v3" / "keypoints.yml"
            if not (d.is_dir() and d.name.startswith("L") and f.exists()):
                continue
            doc = yaml.safe_load(f.read_text(encoding="utf-8")) or {}
            try:
                table = keypoints_to_structure_table(doc.get("keypoints") or {})
            except Exception:
                continue
            if not table:
                continue
            scanned += 1
            served = _sanitize_structure_for_client(_format_yaml_structure_table(table))

            def walk(rows):
                for row in rows or []:
                    yield d.name, row
                    yield from walk(row.get("sub_rows"))

            yield from walk(served.get("rows"))
        if scanned < self.MIN_SCANNED:
            pytest.fail(f"只掃到 {scanned} 課（下限 {self.MIN_SCANNED}）—— 這條在測空氣")

    def test_inline_choice_defect_is_down_to_the_known_l0011_l0102_pair(self):
        """修好之前這是 `checkbox` 型、value 帶 "第N個空格" 的殘留字樣——
        兩課符合乾淨形狀（blanks 數 == 真空格數）的都已轉成 inline_choice；
        L0102 那一列另外混了一個沒有標準答案的自由文字空格，不符合這個
        乾淨形狀，刻意不強行套用、留在 checkbox（見 PR 說明的已知缺口）。
        """
        lessons_with_leftover_marker = set()
        for uid, row in self._rows():
            value = str(row.get("value") or "")
            if row.get("interactive_type") == "checkbox" and "個空格" in value:
                lessons_with_leftover_marker.add(uid)
        assert lessons_with_leftover_marker == {"L0102"}, (
            f"預期只剩 L0102 這個已知缺口，實際：{sorted(lessons_with_leftover_marker)}"
        )

    def test_single_select_instruction_always_carries_select_mode_single(self):
        """指示語寫「單選」的 checkbox 列，一律要標 select_mode=single——
        不然前端就沒有依據擋掉多選。"""
        offenders = []
        for uid, row in self._rows():
            if row.get("interactive_type") != "checkbox":
                continue
            value = str(row.get("value") or "")
            if "單選" in value and "多選" not in value and "複選" not in value:
                if row.get("select_mode") != "single":
                    offenders.append((uid, row.get("label")))
        assert not offenders, f"指示語寫單選卻沒標 select_mode=single：{offenders}"
