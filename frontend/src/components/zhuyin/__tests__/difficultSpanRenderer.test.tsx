/**
 * Unit tests for splitDifficultSegments / renderDifficultAwareText (#3022).
 *
 * These are the "brain" of the #3022 fix: processLinesSelective('difficult')
 * now wraps only the vocab-word character runs in DIFFICULT_SPAN_START/END
 * markers, and this module is what turns that into "only these runs get the
 * zhuyin font, everything else stays serif" -- the two hard requirements from
 * the issue: (a) the zhuyin font must never cover a whole container in
 * difficult mode, (b) interface text must never receive it.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import {
  splitDifficultSegments,
  hasDifficultSpans,
  renderDifficultAwareText,
} from '../difficultSpanRenderer';
import { DIFFICULT_SPAN_START, DIFFICULT_SPAN_END } from '../bopomoConstants';

const wrap = (s: string) => `${DIFFICULT_SPAN_START}${s}${DIFFICULT_SPAN_END}`;

describe('splitDifficultSegments', () => {
  it('returns the whole string as a single plain segment when there are no markers', () => {
    const result = splitDifficultSegments('沒有難字的一句話');
    expect(result).toEqual([{ text: '沒有難字的一句話', difficult: false }]);
  });

  it('returns an empty array for an empty string', () => {
    expect(splitDifficultSegments('')).toEqual([]);
  });

  it('marks a single wrapped run as difficult, keeps the rest plain', () => {
    const text = `有${wrap('龍')}在此`;
    const result = splitDifficultSegments(text);
    expect(result).toEqual([
      { text: '有', difficult: false },
      { text: '龍', difficult: true },
      { text: '在此', difficult: false },
    ]);
  });

  it('handles a run that opens the string with no leading plain text', () => {
    const text = `${wrap('龍')}在此`;
    expect(splitDifficultSegments(text)).toEqual([
      { text: '龍', difficult: true },
      { text: '在此', difficult: false },
    ]);
  });

  it('handles a run that closes the string with no trailing plain text', () => {
    const text = `有${wrap('龍')}`;
    expect(splitDifficultSegments(text)).toEqual([
      { text: '有', difficult: false },
      { text: '龍', difficult: true },
    ]);
  });

  it('handles multiple non-adjacent difficult runs', () => {
    const text = `有${wrap('龍')}在${wrap('虎')}鬥`;
    expect(splitDifficultSegments(text)).toEqual([
      { text: '有', difficult: false },
      { text: '龍', difficult: true },
      { text: '在', difficult: false },
      { text: '虎', difficult: true },
      { text: '鬥', difficult: false },
    ]);
  });

  it('preserves an SS_MAPPING tone-variant selector inside a difficult run', () => {
    // buildZhuyinString() appends a real tone selector (e.g. 1) after a
    // character inside the wrapped run -- that must survive untouched, it is
    // what actually selects the correct bopomofo reading in the font.
    const toneSelector = '\u{E01E1}';
    const text = `有${wrap(`龍${toneSelector}`)}在此`;
    const result = splitDifficultSegments(text);
    expect(result[1]).toEqual({ text: `龍${toneSelector}`, difficult: true });
  });

  it('is a real positive/negative pair — a difficult run and plain text never swap labels', () => {
    const text = `${wrap('虎')}和平`;
    const result = splitDifficultSegments(text);
    const difficultChars = result.filter((s) => s.difficult).map((s) => s.text).join('');
    const plainChars = result.filter((s) => !s.difficult).map((s) => s.text).join('');
    expect(difficultChars).toBe('虎');
    expect(plainChars).toBe('和平');
  });

  describe('tolerant of a marker being cut off mid-string (karaoke-split half-lines)', () => {
    it('treats text with an unmatched trailing START as difficult through to the end', () => {
      const text = `平安${DIFFICULT_SPAN_START}龍爭`;
      expect(splitDifficultSegments(text)).toEqual([
        { text: '平安', difficult: false },
        { text: '龍爭', difficult: true },
      ]);
    });

    it('treats text with an unmatched leading END as difficult from the start', () => {
      const text = `虎鬥${DIFFICULT_SPAN_END}和平`;
      expect(splitDifficultSegments(text)).toEqual([
        { text: '虎鬥', difficult: true },
        { text: '和平', difficult: false },
      ]);
    });

    it('a START/END pair split exactly at the boundary still reconstructs correctly', () => {
      // Simulates KeyPassageReading's karaoke split: one half ends mid-span,
      // the other half begins mid-span.
      const first = `平安${DIFFICULT_SPAN_START}龍`;
      const second = `爭${DIFFICULT_SPAN_END}和平`;
      expect(splitDifficultSegments(first)).toEqual([
        { text: '平安', difficult: false },
        { text: '龍', difficult: true },
      ]);
      expect(splitDifficultSegments(second)).toEqual([
        { text: '爭', difficult: true },
        { text: '和平', difficult: false },
      ]);
    });
  });
});

describe('hasDifficultSpans', () => {
  it('is false for plain text', () => {
    expect(hasDifficultSpans('沒有難字')).toBe(false);
  });

  it('is true when a START marker is present', () => {
    expect(hasDifficultSpans(`${DIFFICULT_SPAN_START}龍`)).toBe(true);
  });

  it('is true when only an END marker is present (half a karaoke split)', () => {
    expect(hasDifficultSpans(`龍${DIFFICULT_SPAN_END}`)).toBe(true);
  });
});

describe('renderDifficultAwareText', () => {
  it('renders plain text (no markers) without wrapping it in any span', () => {
    const { container } = render(<div>{renderDifficultAwareText('沒有難字的一句話')}</div>);
    expect(container.querySelectorAll('span').length).toBe(0);
    expect(container.textContent).toBe('沒有難字的一句話');
  });

  it('applies the zhuyin font ONLY to the difficult run, and the serif font to the rest', () => {
    const text = `有${wrap('龍')}在此`;
    const { container } = render(<div>{renderDifficultAwareText(text)}</div>);
    const spans = Array.from(container.querySelectorAll('span'));
    expect(spans.length).toBe(3);

    const difficultSpan = spans.find((s) => s.textContent === '龍')!;
    const plainSpans = spans.filter((s) => s.textContent !== '龍');

    // jsdom's CSSOM re-serializes quoted font names ('X' -> "X"), same as a
    // real browser's inline style attribute -- compare on content, not on
    // exact punctuation.
    expect(difficultSpan.style.fontFamily).toContain('BpmfZihiSerif');
    for (const span of plainSpans) {
      expect(span.style.fontFamily).toContain('cwTeXKai');
      // Negative control: plain runs must NEVER carry the zhuyin font.
      expect(span.style.fontFamily).not.toContain('BpmfZihiSerif');
    }

    // Reassembled visible text must equal the raw content (markers invisible).
    expect(container.textContent).toBe('有龍在此');
  });

  it('never leaks the zhuyin font onto every character — only the exact marked run', () => {
    // Regression lock for the literal #3022 bug: applying the font at the
    // container level meant ALL characters got annotated once any zhuyin
    // mode was active. This asserts per-character font assignment instead.
    const text = `${wrap('龍')}爭${wrap('虎')}鬥`;
    const { container } = render(<div>{renderDifficultAwareText(text)}</div>);
    const spans = Array.from(container.querySelectorAll('span'));
    const byChar = new Map(spans.map((s) => [s.textContent, s.style.fontFamily]));

    expect(byChar.get('龍')).toContain('BpmfZihiSerif');
    expect(byChar.get('虎')).toContain('BpmfZihiSerif');
    expect(byChar.get('爭')).toContain('cwTeXKai');
    expect(byChar.get('爭')).not.toContain('BpmfZihiSerif');
    expect(byChar.get('鬥')).toContain('cwTeXKai');
    expect(byChar.get('鬥')).not.toContain('BpmfZihiSerif');
  });
});
