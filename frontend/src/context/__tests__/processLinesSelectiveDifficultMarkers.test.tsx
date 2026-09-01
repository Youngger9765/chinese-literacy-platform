/**
 * processLinesSelective('difficult') must wrap ONLY the vocab-word character
 * runs with DIFFICULT_SPAN_START/END sentinel markers (#3022) so a downstream
 * renderer (components/zhuyin/difficultSpanRenderer.tsx) can apply the zhuyin
 * font to exactly those runs. Before this fix there was no such delimiter --
 * every caller applied the zhuyin font at the container level instead, which
 * is what actually caused the reported bug (font, not text processing, was
 * annotating everything).
 *
 * The polyphonic engine itself (tone selection / SS_MAPPING) is already
 * covered by polyphonicProcessor.test.ts -- mocked here to an identity
 * pass-through so this file only exercises the marker-wrapping logic added
 * for #3022.
 */
import React, { useEffect } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ZhuyinProvider, useZhuyin } from '../ZhuyinContext';
import { DIFFICULT_SPAN_START, DIFFICULT_SPAN_END } from '../../components/zhuyin/bopomoConstants';

vi.mock('../../components/zhuyin/polyphonicProcessor', () => ({
  PolyphonicProcessor: {
    instance: {
      isLoaded: true,
      process: (text: string) => [...text].map((char) => ({ char, styleSet: '0000' })),
      loadPolyphonicData: async () => {},
    },
  },
  buildZhuyinString: (processed: Array<{ char: string; styleSet: string }>) =>
    processed.map((p) => p.char).join(''),
}));

interface ProbeProps {
  lines: string[];
  vocabWords: string[];
}

const Probe: React.FC<ProbeProps> = ({ lines, vocabWords }) => {
  const { setZhuyinMode, processLinesSelective } = useZhuyin();
  useEffect(() => {
    setZhuyinMode('difficult');
  }, [setZhuyinMode]);

  const result = processLinesSelective(lines, vocabWords);
  return <pre data-testid="result">{JSON.stringify(result)}</pre>;
};

function renderProbe(lines: string[], vocabWords: string[]) {
  render(
    <ZhuyinProvider>
      <Probe lines={lines} vocabWords={vocabWords} />
    </ZhuyinProvider>,
  );
  return () => JSON.parse(screen.getByTestId('result').textContent!) as string[] | null;
}

describe("processLinesSelective('difficult') marker wrapping", () => {
  it('wraps only the vocabulary characters, leaves everything else untouched', () => {
    const getResult = renderProbe(['有龍在此'], ['龍爭虎鬥']);
    const result = getResult();
    expect(result).not.toBeNull();
    expect(result![0]).toBe(`有${DIFFICULT_SPAN_START}龍${DIFFICULT_SPAN_END}在此`);
  });

  it('wraps multiple non-adjacent difficult runs independently', () => {
    const getResult = renderProbe(['有龍在虎鬥'], ['龍爭虎鬥']);
    const result = getResult();
    expect(result![0]).toBe(
      `有${DIFFICULT_SPAN_START}龍${DIFFICULT_SPAN_END}在${DIFFICULT_SPAN_START}虎鬥${DIFFICULT_SPAN_END}`,
    );
  });

  it('treats interface/instruction text the same as any other line -- no markers when nothing matches (negative control)', () => {
    // This is the literal #3022 leak: instruction banners and button labels
    // share the same rendering pipeline as passage text in some components.
    // They must come back with zero markers when none of their characters
    // are in the vocabulary -- i.e. the *font* must never turn on for them.
    const getResult = renderProbe(['如何標記詞語？'], ['龍爭虎鬥']);
    const result = getResult();
    expect(result![0]).toBe('如何標記詞語？');
    expect(result![0]).not.toContain(DIFFICULT_SPAN_START);
    expect(result![0]).not.toContain(DIFFICULT_SPAN_END);
  });

  it('degrades to null (same as none mode) for an empty vocabulary -- no markers ever appear', () => {
    const getResult = renderProbe(['一段沒有語詞表的文章'], []);
    expect(getResult()).toBeNull();
  });

  it('does not wrap a run at all when the whole line is difficult (still gets exactly one wrapped run)', () => {
    const getResult = renderProbe(['龍爭虎鬥'], ['龍爭虎鬥']);
    const result = getResult();
    expect(result![0]).toBe(`${DIFFICULT_SPAN_START}龍爭虎鬥${DIFFICULT_SPAN_END}`);
  });
});
