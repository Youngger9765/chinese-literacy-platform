"""TDD for #4050 wording bug: a question stem started with a stray closing
quote mark (「」呵呵，我猜別人都以為…」) — PM staging QA report: "部分題目開頭
殘留「」」（題庫資料被截斷）".

Root cause: zhuyin_challenge's sentence-boundary splitter
(`_SENTENCE_END = frozenset("。！？")`) only looks at the delimiter itself —
it has no notion that a closing quote/bracket immediately AFTER a 。！？
belongs to the sentence it closes, not the next one. The real passage this
came from (L0056/L0087 full_text_annotate, 段10) has:

    ...我也很『困擾』啊！」呵呵，我猜別人都以為我拿到比較大塊的餅呢！

Splitting on the ！ right before 」 put the bare 」 at the START of the next
sentence span instead of the END of the one it closes.
"""
from __future__ import annotations

from app.services.zhuyin_challenge import _CLAUSE_END, _SENTENCE_END, _char_spans, _u16_chars

# Real passage text (data/lessons/L0056/v3/full_text_annotate.wprr6.yml and
# data/lessons/L0087/v3/full_text_annotate.rpcyh.yml, 段10) — the sentence
# ending in a nested quote immediately followed by 呵呵.
REAL_PASSAGE = (
    "現在朋友問我過得好不好，我的回答總是：「喔，超讚的！」犯小人，我說："
    "「太精采了，這種經驗一百萬也買不到。」出國，回程飛機延誤，我說：「太棒了，"
    "還可以在國外多玩一天。」感染新冠病毒，我會說：「害我不能去工作，"
    "但在家裡看電視還能領薪水，我也很『困擾』啊！」呵呵，我猜別人都以為我拿到比較大塊的餅呢！"
)


def _sentence_texts(text: str) -> list[str]:
    chars = _u16_chars(text)
    spans = _char_spans(chars, _SENTENCE_END)
    return ["".join(chars[s:e]) for s, e in spans]


class TestClosingQuoteStaysWithItsOwnSentence:
    def test_closing_quote_after_sentence_end_is_not_left_on_the_next_sentence(self):
        sentences = _sentence_texts(REAL_PASSAGE)

        # The sentence ending in "...我也很『困擾』啊！" must carry its OWN
        # closing 」 — not leave it to start the next sentence.
        quote_sentence = next(s for s in sentences if "困擾" in s)
        assert quote_sentence.endswith("」"), quote_sentence

        # The next sentence ("呵呵，我猜...") must start with 呵呵, not a bare
        # leftover 」 (what PM staging QA actually saw rendered as a PK
        # question stem: 「」呵呵，我猜別人都以為…」).
        next_sentence = next(s for s in sentences if "呵呵" in s)
        assert not next_sentence.startswith("」"), next_sentence
        assert next_sentence.startswith("呵呵"), next_sentence

    def test_every_sentence_in_the_real_passage_has_balanced_quote_marks(self):
        """Positive control at the whole-passage level: every individual
        sentence span, once correctly split, must have an equal count of
        「 and 」 (a stray leading/trailing 」 breaks that balance)."""
        for s in _sentence_texts(REAL_PASSAGE):
            assert s.count("「") == s.count("」"), s

    def test_clause_splitting_is_unaffected_for_a_simple_sentence(self):
        """Positive control — a plain sentence with no adjacent quote marks
        at all must split exactly as before (no behavior change for the
        common case)."""
        simple = "今天天氣很好。我們去公園玩。"
        assert _sentence_texts(simple) == ["今天天氣很好。", "我們去公園玩。"]

    def test_clause_end_delimiters_also_absorb_a_trailing_closing_quote(self):
        """The same fix in _char_spans is shared by _CLAUSE_END (used for
        the long-sentence fallback window) — a comma immediately followed
        by a closing quote should stay together too."""
        text = "他說：「你好，」然後就走了"
        chars = _u16_chars(text)
        spans = _char_spans(chars, _CLAUSE_END)
        texts = ["".join(chars[s:e]) for s, e in spans]
        quote_clause = next(t for t in texts if "你好" in t)
        assert quote_clause.endswith("」"), quote_clause
