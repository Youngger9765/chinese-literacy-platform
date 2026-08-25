import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import LessonAudioTable from './LessonAudioTable';

/**
 * 多文本課在後台總表要**一篇一列**（#2916）。
 *
 * 2026-08-25 staging 實測：G6-L22 是一列、只有 2 個 QR（`p3kud` 與 `yprak`，
 * 都是篇 1 的），而它有三篇 —— 教材端拿到的六張碼有四張指錯地方，
 * 而且每一張都掃得開、頁面也正常，看不出錯。
 */
vi.mock('../../../contexts/AuthContext', () => ({ useAuth: () => ({ token: 't' }) }));
vi.mock('../../../hooks/useTtsPlayback', () => ({
  useTtsPlayback: () => ({
    speakText: vi.fn(), stopTts: vi.fn(), isLoading: false, isSpeaking: false,
    prefetchParagraph: vi.fn(), registerAudio: vi.fn(),
  }),
}));
vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,t') } }));
if (!HTMLMediaElement.prototype.play.toString().includes('patchedPlay')) {
  HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
}

const THREE_PARTS = [
  { slug: 'p3kud', part: 1, has_full: true, has_key: true, full_slug: 'p3kud', key_slug: 'yprak' },
  { slug: '4uee3', part: 2, has_full: true, has_key: true, full_slug: '4uee3', key_slug: '9a7x4' },
  { slug: '7wavn', part: 3, has_full: true, has_key: true, full_slug: '7wavn', key_slug: 'ajy9w' },
];

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (u: string) => ({
    ok: true, status: 200,
    json: async () => (String(u).includes('/api/stories/')
      ? { paragraphs: ['x'], key_reading: { passage: 'k' } }
      : { total: 1, grades: [6], stories: [{
          id: 20063, lesson_number: 22, title: '物以稀為貴', grade: 6, grade_code: 'G6-L22',
          genre: '說明文', category: 'Science', char_count: 100, thumbnail_url: '',
          reading_strategy: null, intro: { author: '', background: '' },
          has_key_reading: true, part_rounds: THREE_PARTS }] }),
  })) as never);
});

describe('後台總表：多文本課一篇一列', () => {
  it('三篇 → 三列，課程欄標出篇次', async () => {
    render(<LessonAudioTable />);
    await waitFor(() => expect(screen.getAllByText('物以稀為貴').length).toBeGreaterThan(0));
    const rows = screen.getAllByText('物以稀為貴').map((e) => e.closest('[role="row"]'));
    expect(rows).toHaveLength(3);
    const labels = rows.map((r) => r?.textContent ?? '');
    expect(labels.some((t) => t.includes('篇1'))).toBe(true);
    expect(labels.some((t) => t.includes('篇2'))).toBe(true);
    expect(labels.some((t) => t.includes('篇3'))).toBe(true);
  });

  it('六個 QR 互不相同，而且每一篇拿到自己的兩個碼', async () => {
    render(<LessonAudioTable />);
    await waitFor(() => expect(screen.getAllByText('物以稀為貴').length).toBe(3));
    const rows = screen.getAllByText('物以稀為貴').map((e) => e.closest('[role="row"]') as HTMLElement);
    const perRow = rows.map((r) =>
      within(r).getAllByRole('button', { name: 'QR' })
        .map((b) => b.getAttribute('title') ?? ''));
    const all = perRow.flat();
    expect(all).toHaveLength(6);
    expect(new Set(all).size).toBe(6);
    // 每一篇自己那兩個碼要在同一列
    expect(perRow[0].join()).toContain('/q/p3kud');
    expect(perRow[0].join()).toContain('/q/yprak');
    expect(perRow[1].join()).toContain('/q/4uee3');
    expect(perRow[2].join()).toContain('/q/ajy9w');
    // ⛔ 篇 1 的碼不可以出現在篇 2、篇 3 那一列 —— 那正是修之前的樣子
    expect(perRow[1].join()).not.toContain('/q/p3kud');
    expect(perRow[2].join()).not.toContain('/q/p3kud');
  });
});
