/**
 * #3483 — run both classical modules over the data the backend actually
 * served on 2026-10-13 for all 12 文言文 lessons (fixture captured from
 * staging /api/stories/:id, worksheet notes stripped).
 *
 * Before the fix: 文白句子比對 threw on 7 lessons, 自我挑戰 threw on 2 and
 * silently dropped every question on 2 more. The expected counts below are
 * computed straight from the raw JSON, not through the normalizer, so a
 * normalizer that drops items cannot also lower the bar.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import served from './fixtures/classicalModules.served.json';
import ClassicalSentenceMatching from '../ClassicalSentenceMatching';
import ClassicalSelfChallenge from '../ClassicalSelfChallenge';
import { halfWidth } from '../classicalShapes';
import type { Story } from '../../../types';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const lessons = Object.entries(served as Record<string, { sentence_matching: Any; self_challenge: Any }>);
const story = (extra: Partial<Story>) => ({ id: 1, title: 't', ...extra }) as unknown as Story;

const rawSegments = (sm: Any): string[] => {
  if (!sm) return [];
  const parts = Array.isArray(sm.parts) ? sm.parts : [sm];
  return parts.flatMap((p: Any) => (p.segments ?? p.items ?? []).map((s: Any) => s.classical ?? s['文言']));
};

const rawQuestions = (sc: Any): string[] => {
  if (!sc) return [];
  const groups: Any[] = [];
  for (const k of ['part_one', 'part_two', 'quiz']) if (sc[k]) groups.push(sc[k]);
  if (sc.items) (Array.isArray(sc.items) ? sc.items : [sc.items]).forEach((g: Any) => groups.push(g));
  return groups.flatMap((g: Any) => (g.questions ?? g.items ?? []).map((q: Any) => q.stem ?? q.prompt));
};

describe('#3483 classical modules render every served shape', () => {
  it('fixture covers all three 文白句子比對 shapes and both 自我挑戰 shapes', () => {
    const sm = lessons.map(([, v]) => v.sentence_matching).filter(Boolean);
    expect(sm.some((x) => x.parts)).toBe(true);
    expect(sm.some((x) => x.segments)).toBe(true);
    expect(sm.some((x) => x.items && x.example)).toBe(true);
    const sc = lessons.map(([, v]) => v.self_challenge).filter(Boolean);
    expect(sc.some((x) => x.part_one)).toBe(true);
    expect(sc.some((x) => x.quiz && typeof x.passage === 'object')).toBe(true);
    expect(sc.some((x) => x.quiz && typeof x.passage === 'string')).toBe(true);
  });

  for (const [code, v] of lessons) {
    const segs = rawSegments(v.sentence_matching);
    it(`${code} 文白句子比對 shows all ${segs.length} segments`, () => {
      render(<ClassicalSentenceMatching story={story({ sentenceMatching: v.sentence_matching })} onFinish={vi.fn()} />);
      if (segs.length === 0) {
        expect(screen.getByText('本課尚無文白句子比對資料')).toBeTruthy();
        return;
      }
      expect(screen.getAllByRole('button', { name: '顯示答案' })).toHaveLength(segs.length);
      for (const s of segs) expect(document.body.textContent).toContain(s);
    });

    const qs = rawQuestions(v.self_challenge);
    it(`${code} 自我挑戰 shows all ${qs.length} questions`, () => {
      render(<ClassicalSelfChallenge story={story({ selfChallenge: v.self_challenge })} onFinish={vi.fn()} />);
      if (!v.self_challenge) {
        expect(screen.getByText('本課尚無自我挑戰資料')).toBeTruthy();
        return;
      }
      expect(qs.length).toBeGreaterThan(0);
      expect(screen.getAllByRole('button', { name: '顯示答案' })).toHaveLength(qs.length);
      for (const q of qs) expect(document.body.textContent).toContain(q);
      const passage = typeof v.self_challenge.passage === 'string' ? v.self_challenge.passage : v.self_challenge.passage.classical;
      expect(document.body.textContent).toContain(passage);
    });
  }

  it('full-width answer letters resolve to their option text', () => {
    expect(halfWidth('Ｃ')).toBe('C');
    const sc = (served as Any)['文-L5'].self_challenge;
    render(<ClassicalSelfChallenge story={story({ selfChallenge: sc })} onFinish={vi.fn()} />);
    const buttons = screen.getAllByRole('button', { name: '顯示答案' });
    buttons.forEach((b) => b.click());
    expect(document.body.textContent).toContain('C. 依據文意，「向許百金」的「許」意思是「許諾」');
  });
});
