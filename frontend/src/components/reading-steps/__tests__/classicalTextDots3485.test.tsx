/**
 * #3485 — 原文 printed the worksheet's 斷詞 dots and 注釋 numbers as a bare
 * ASCII "." and digit (「賈人.某，至.直隸1界」). Runs over every 文言文
 * lesson's served classical_text (staging, 2026-10-13).
 */
import React from 'react';
import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import served from './fixtures/classicalText.served.json';
import ClassicalText from '../ClassicalText';
import { tokenizeClassical } from '../classicalTextTokens';
import type { Story } from '../../../types';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const lessons = Object.entries(served as Record<string, Any>);
const text = (p: Any) => (typeof p === 'string' ? p : p.text);

describe('#3485 原文 dots and note numbers', () => {
  it('fixture has dots and note digits to test against', () => {
    const all = lessons.flatMap(([, ct]) => ct.paragraphs.map(text)).join('');
    expect((all.match(/\./g) ?? []).length).toBeGreaterThan(100);
    expect(all).toMatch(/[一-鿿][0-9]/);
  });

  for (const [code, ct] of lessons) {
    it(`${code}: no bare "." left, every note digit becomes a superscript, no character lost`, () => {
      const { container } = render(
        <ClassicalText story={{ id: 1, title: 't', classicalText: ct } as unknown as Story} onFinish={vi.fn()} />,
      );
      const passage = [...container.querySelectorAll('p.font-serif')];
      expect(passage.length).toBe(ct.paragraphs.length);
      const raw = ct.paragraphs.map(text).join('');
      const dots = (raw.match(/\./g) ?? []).length;
      const notes = tokenizeClassical(raw, (ct.annotations ?? []).length).filter((t) => t.kind === 'note').length;
      const shown = passage.map((p) => p.textContent).join('');
      expect(shown).not.toContain('.');
      expect(container.querySelectorAll('p.font-serif sup')).toHaveLength(notes);
      // Same characters in the same order once the marks are taken out.
      const strip = (s: string) => s.replace(/[.·]/g, '').replace(/[0-9]/g, '');
      expect(strip(shown)).toBe(strip(raw));
      if (dots > 0) expect(container.textContent).toContain('斷詞');
      const src = ct.source_label || ct.source;
      if (src) expect(container.textContent).toContain(src);
    });
  }

  it('a number that is not a 注釋 index stays as text', () => {
    expect(tokenizeClassical('年9', 2)).toEqual([{ kind: 'text', value: '年9' }]);
    expect(tokenizeClassical('界1，', 2)).toEqual([
      { kind: 'text', value: '界' },
      { kind: 'note', value: 1 },
      { kind: 'text', value: '，' },
    ]);
    // 文-L5 prints the note number after the 斷詞 dot.
    expect(tokenizeClassical('胡賊.1攻', 2)).toEqual([
      { kind: 'text', value: '胡賊' },
      { kind: 'dot' },
      { kind: 'note', value: 1 },
      { kind: 'text', value: '攻' },
    ]);
  });

  it('文-L10 renders all three of its 注釋 numbers, including the one after 《素書》', () => {
    const ct = (served as Any)['文-L10'];
    const { container } = render(
      <ClassicalText story={{ id: 1, title: 't', classicalText: ct } as unknown as Story} onFinish={vi.fn()} />,
    );
    expect([...container.querySelectorAll('p.font-serif sup')].map((e) => e.textContent)).toEqual(['1', '2', '3']);
  });

  it('文-L5 renders both of its 注釋 numbers as superscripts', () => {
    const ct = (served as Any)['文-L5'];
    const { container } = render(
      <ClassicalText story={{ id: 1, title: 't', classicalText: ct } as unknown as Story} onFinish={vi.fn()} />,
    );
    expect([...container.querySelectorAll('p.font-serif sup')].map((e) => e.textContent)).toEqual(['1', '2']);
  });
});
