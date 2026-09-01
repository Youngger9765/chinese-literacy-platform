/**
 * #3022 — splitZhuyinChars() and the DIFFICULT_SPAN_START marker.
 *
 * A tone selector always FOLLOWS its character, so attaching a selector to
 * the previous group is enough for those. DIFFICULT_SPAN_START is different:
 * it opens a run, so it comes BEFORE the character it marks. If that
 * character is the first thing in the line there is no previous group, and
 * the marker fell through to groups.push() as its own one-marker group.
 *
 * That phantom group is silent and load-bearing: groupIdxForProgress()
 * (ttsHighlight.ts) counts groups, so the karaoke boundary drifts by one
 * real character for the rest of any line that opens with a vocab word.
 *
 * There was no test file for this module at all before -- reverting the fix
 * left the whole suite green.
 */
import { describe, it, expect } from 'vitest';
import { splitZhuyinChars } from '../zhuyinUtils';
import { DIFFICULT_SPAN_START, DIFFICULT_SPAN_END } from '../../components/zhuyin/bopomoConstants';

const wrap = (s: string) => `${DIFFICULT_SPAN_START}${s}${DIFFICULT_SPAN_END}`;

describe('#3022 splitZhuyinChars with difficult-run markers', () => {
  it('groups == visible characters when a marked word opens the line', () => {
    const text = `${wrap('龍')}在天上飛`;
    expect(splitZhuyinChars(text).length).toBe('龍在天上飛'.length);
  });

  it('the opening marker rides on the character it marks, not its own group', () => {
    const groups = splitZhuyinChars(`${wrap('龍')}在天上飛`);
    expect(groups[0]).toContain('龍');
    expect(groups[0]).toContain(DIFFICULT_SPAN_START);
    expect(groups[1]).toBe('在');
  });

  it('groups == visible characters when the marked word is mid-line', () => {
    const text = `天上有${wrap('龍')}飛過`;
    expect(splitZhuyinChars(text).length).toBe('天上有龍飛過'.length);
  });

  it('handles two runs, one of them at the very start', () => {
    const text = `${wrap('龍')}和${wrap('鳳')}`;
    expect(splitZhuyinChars(text).length).toBe('龍和鳳'.length);
  });

  it('tone selectors still attach to the preceding character', () => {
    const tone = '\u{E01E1}';
    const groups = splitZhuyinChars(`爸${tone}爸`);
    expect(groups.length).toBe(2);
    expect(groups[0]).toContain(tone);
  });

  it('unmarked text is unchanged (negative control)', () => {
    expect(splitZhuyinChars('天上有龍飛過').length).toBe(6);
  });

  it('keeps a string that is nothing but markers rather than dropping it', () => {
    const groups = splitZhuyinChars(DIFFICULT_SPAN_START + DIFFICULT_SPAN_END);
    expect(groups.join('')).toBe(DIFFICULT_SPAN_START + DIFFICULT_SPAN_END);
  });
});
