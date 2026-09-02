/**
 * #3022 — ParagraphCard's THREE text branches.
 *
 * The first pass at this fix converted only the locked/blurred branch, so
 * once ParagraphReading's container font was (correctly) narrowed to 'all',
 * 'difficult' mode rendered NO ruby at all in the branches a student
 * actually reads. Reverting ParagraphCard + ParagraphReading wholesale left
 * 493/493 tests green -- there was no lock on that file whatsoever.
 *
 * This locks all three: plain reading, karaoke highlighting, and blurred.
 */
import React from 'react';
import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import ParagraphCard from '../paragraph-reading/ParagraphCard';
import { DIFFICULT_SPAN_START, DIFFICULT_SPAN_END } from '../../zhuyin/bopomoConstants';

// karaokeEnabled comes from KaraokeContext, NOT from props -- passing it as a
// prop silently does nothing and the "karaoke branch" test quietly measures
// the plain branch instead. Mock it on so the branch is actually reached.
vi.mock('../../../context/KaraokeContext', () => ({
  useKaraoke: () => ({ karaokeEnabled: true, setKaraokeEnabled: vi.fn(), toggleKaraoke: vi.fn() }),
  KaraokeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const wrap = (s: string) => `${DIFFICULT_SPAN_START}${s}${DIFFICULT_SPAN_END}`;
const LINE = '小明看見龍就跑走了';
const MARKED = `小明看見${wrap('龍')}就跑走了`;

const base = {
  idx: 0,
  line: LINE,
  currentLineIndex: 0,
  isCelebrating: false,
  isAdvancing: false,
  fontSizePx: 20,
  zhuyinLine: MARKED,
  zhuyinAny: true, // 'difficult' -- NOT 'all'
  isSessionActive: false,
  isPreparing: false,
  isTtsLoading: false,
  utteranceRef: { current: null },
  ttsRafRef: { current: null },
  streamingUserInput: '',
  onGoToParagraph: vi.fn(),
  allStatuses: ['current'],
  onSelectParagraph: vi.fn(),
  // Only the props this lock exercises are listed; the rest are irrelevant
  // to font scoping and the component tolerates their absence at runtime.
} as unknown as React.ComponentProps<typeof ParagraphCard>;

/** Every element whose own inline style carries the zhuyin font. */
const fontBearers = (root: HTMLElement) =>
  Array.from(root.querySelectorAll('*')).filter((el) =>
    ((el as HTMLElement).style?.fontFamily ?? '').includes('BpmfZihiSerif'),
  );

describe('#3022 ParagraphCard applies the zhuyin font per run, in every branch', () => {
  it('plain reading branch: font on 龍 only, and the line still reads correctly', () => {
    const { container } = render(
      <ParagraphCard {...base} status="current" isTtsSpeaking={false} speakingProgress={0} />,
    );
    expect(fontBearers(container).map((el) => el.textContent)).toEqual(['龍']);
    // The markers must not survive into what the student sees or copies.
    expect(container.textContent).toContain(LINE);
    expect(container.textContent).not.toContain(DIFFICULT_SPAN_START);
    expect(container.textContent).not.toContain(DIFFICULT_SPAN_END);
  });

  it('karaoke branch: font on 龍 only, even when the split lands inside the run', () => {
    const { container } = render(
      <ParagraphCard
        {...base}
        status="current"
        isTtsSpeaking
        speakingProgress={5} // past 小明看見, inside/next to 龍
      />,
    );
    const marked = fontBearers(container).map((el) => el.textContent).join('');
    expect(marked, 'the vocab char must be in the zhuyin font while singing').toBe('龍');
    expect(container.textContent).not.toContain(DIFFICULT_SPAN_START);
  });

  // The split cuts the line in two and each half is rendered separately, so
  // a case where 龍 is in the SUNG half proves nothing about the unsung one.
  // Verified: breaking one half leaves the other half's case green.
  it('karaoke branch: font on 龍 when it is still in the UNSUNG half', () => {
    const { container } = render(
      <ParagraphCard
        {...base}
        status="current"
        isTtsSpeaking
        speakingProgress={2} // only 小明 sung; 龍 is ahead of the cursor
      />,
    );
    expect(fontBearers(container).map((el) => el.textContent).join('')).toBe('龍');
  });

  it('blurred branch: font on 龍 only', () => {
    const { container } = render(
      <ParagraphCard {...base} status="locked" isTtsSpeaking={false} speakingProgress={0} />,
    );
    expect(fontBearers(container).map((el) => el.textContent)).toEqual(['龍']);
  });

  // The negative control. Without it, "font is on 龍" would also pass if the
  // font were on everything.
  it('never puts the font on the whole paragraph', () => {
    const { container } = render(
      <ParagraphCard {...base} status="current" isTtsSpeaking={false} speakingProgress={0} />,
    );
    for (const el of fontBearers(container)) {
      expect(el.textContent, 'a font-bearing element must not hold the whole line').not.toContain('小明');
    }
  });
});
