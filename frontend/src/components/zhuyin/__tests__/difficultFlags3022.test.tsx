/**
 * #3022 follow-up: the annotated branch of AnnotatedParagraph.
 *
 * Annotation offsets are raw-character indices, so that branch renders from
 * a PUA-stripped string -- which throws the DIFFICULT_SPAN markers away with
 * the selectors. Before the font was narrowed, difficult-mode ruby still
 * *appeared* there, but only as spillover from the container-wide font (the
 * bug). Narrowing the font without replacing it here means ruby vanishes for
 * the whole paragraph the moment a student marks one word -- and marking
 * words is the entire point of that screen.
 *
 * difficultFlagsByRawIndex() carries the marker information across the strip
 * as a per-UTF-16-code-unit flag array, so a slice by raw index can still be
 * rendered with the right runs marked.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { DIFFICULT_SPAN_START, DIFFICULT_SPAN_END } from '../bopomoConstants';
import { difficultFlagsByRawIndex, renderDifficultFlagged } from '../difficultSpanRenderer';
import { stripPUASelectors } from '../../reading-steps/annotationOffsets';

const wrap = (s: string) => `${DIFFICULT_SPAN_START}${s}${DIFFICULT_SPAN_END}`;

describe('#3022 difficultFlagsByRawIndex', () => {
  it('returns one flag per UTF-16 code unit of the stripped string', () => {
    const text = `小明看見${wrap('龍')}就跑`;
    const flags = difficultFlagsByRawIndex(text);
    expect(flags.length).toBe(stripPUASelectors(text).length);
  });

  it('flags exactly the marked run', () => {
    const text = `小明看見${wrap('龍')}就跑`;
    const stripped = stripPUASelectors(text);
    const flags = difficultFlagsByRawIndex(text);
    const marked = [...stripped].filter((_, i) => flags[i]).join('');
    expect(marked).toBe('龍');
  });

  it('handles two separate runs', () => {
    const text = `${wrap('龍')}和${wrap('鳳')}`;
    const stripped = stripPUASelectors(text);
    const flags = difficultFlagsByRawIndex(text);
    expect([...stripped].filter((_, i) => flags[i]).join('')).toBe('龍鳳');
  });

  it('returns all-false when there are no markers (none/all mode)', () => {
    const flags = difficultFlagsByRawIndex('沒有任何標記的一行');
    expect(flags.some(Boolean)).toBe(false);
    expect(flags.length).toBe('沒有任何標記的一行'.length);
  });

  // Tone selectors are the SAME PUA block as the markers and are stripped
  // too -- they must not be mistaken for markers nor consume a flag slot,
  // or every polyphonic character shifts the alignment by one.
  it('ignores tone selectors without consuming a flag slot', () => {
    const tone = '\u{E01E1}';
    const text = `爸${tone}爸${wrap('龍')}`;
    const stripped = stripPUASelectors(text);
    const flags = difficultFlagsByRawIndex(text);
    expect(flags.length).toBe(stripped.length);
    expect([...stripped].filter((_, i) => flags[i]).join('')).toBe('龍');
  });

  it('stays aligned across a slice, which is how the annotated branch uses it', () => {
    const text = `第一段${wrap('龍')}尾巴`;
    const stripped = stripPUASelectors(text);
    const flags = difficultFlagsByRawIndex(text);
    const start = 3, end = 4; // just the 龍
    expect(stripped.slice(start, end)).toBe('龍');
    expect(flags.slice(start, end)).toEqual([true]);
  });
});

describe('#3022 renderDifficultFlagged', () => {
  it('puts the zhuyin font on flagged characters only', () => {
    const { container } = render(
      <p>{renderDifficultFlagged('看見龍了', [false, false, true, false], 'k')}</p>,
    );
    const withFont = Array.from(container.querySelectorAll('span')).filter((el) =>
      (el as HTMLElement).style.fontFamily.includes('BpmfZihiSerif'),
    );
    expect(withFont.map((el) => el.textContent)).toEqual(['龍']);
  });

  it('renders the full text exactly once, nothing dropped or duplicated', () => {
    const { container } = render(
      <p>{renderDifficultFlagged('看見龍了', [false, false, true, false], 'k')}</p>,
    );
    expect(container.textContent).toBe('看見龍了');
  });

  it('adds no span at all when nothing is flagged', () => {
    const { container } = render(
      <p>{renderDifficultFlagged('看見龍了', [false, false, false, false], 'k')}</p>,
    );
    expect(container.querySelectorAll('span').length).toBe(0);
    expect(container.textContent).toBe('看見龍了');
  });
});
