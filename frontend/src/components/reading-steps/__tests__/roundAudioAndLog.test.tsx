import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import type { Story } from '../../../types';

/**
 * 維度 8（Audio）與 9（Log）—— 多文本課（#2930）。
 *
 * 2026-08-25 staging 實測：站在 `?p=7wavn`（第 3 篇），
 * 畫面顯示的是第 3 篇，但按「播放全文」送出的 TTS 文字**跟第 1 篇逐字相同**。
 *
 * 這兩個維度在此之前**一條鎖都沒有** —— 所以壞了沒有任何東西會紅。
 * 內容有鎖、URL 有鎖、QR 有鎖，唯獨「唸出來的是哪一篇」和
 * 「進度寫進哪個 key」沒有。
 */
const spoken: string[] = [];
vi.mock('../../../hooks/useTtsPlayback', () => ({
  useTtsPlayback: () => ({
    speakText: (t: string) => { spoken.push(t); },
    stopTts: vi.fn(), isLoading: false, isSpeaking: false,
    prefetchParagraph: vi.fn(), registerAudio: vi.fn(),
  }),
}));
vi.mock('../../../services/ttsApi', async (o) => ({
  ...(await o<typeof import('../../../services/ttsApi')>()),
  prefetchText: vi.fn(),
  speakText: (t: string) => { spoken.push(t); return Promise.resolve(); },
}));

import FullTextAnnotate from '../FullTextAnnotate';

const ROUND3 = ['第三篇的第一段。', '第三篇的第二段。'];
const ROUND1 = ['第一篇的第一段。', '第一篇的第二段。'];

const storyFor = (paras: string[]): Story => ({
  id: 20063, title: '物以稀為貴', level: '6', grade: '6', charCount: 100,
  content: paras, paragraphs: paras,
  thumbnail: '', category: 'Science', filename: 'x.yml',
  manifestSections: [
    { no: '一', name: '讀全文', module: 'full_text_annotate', slug: 'p3kud' },
    { no: '一', name: '讀全文', module: 'full_text_annotate', slug: '7wavn' },
  ],
} as unknown as Story);

// jsdom 沒有 scrollIntoView，而朗讀時會捲到當前段落。
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = function () {};

beforeEach(() => { spoken.length = 0; });

describe('維度 8：唸出來的必須是**當前這一篇**', () => {
  it('第 3 篇的頁面按播放，送出的是第 3 篇的字', async () => {
    render(<FullTextAnnotate story={storyFor(ROUND3)} onFinish={vi.fn()} sectionSlug="7wavn" />);
    const btn = await screen.findByRole('button', { name: /播放全文/ });
    fireEvent.click(btn);
    await waitFor(() => expect(spoken.length).toBeGreaterThan(0));
    expect(spoken.join('')).toContain('第三篇');
    // ⛔ 不是「有唸就好」——不可以唸到別篇
    expect(spoken.join('')).not.toContain('第一篇');
  });

  it('第 1 篇仍然唸第 1 篇 —— 不是「有換就算對」', async () => {
    render(<FullTextAnnotate story={storyFor(ROUND1)} onFinish={vi.fn()} sectionSlug="p3kud" />);
    const btn = await screen.findByRole('button', { name: /播放全文/ });
    fireEvent.click(btn);
    await waitFor(() => expect(spoken.length).toBeGreaterThan(0));
    expect(spoken.join('')).toContain('第一篇');
    expect(spoken.join('')).not.toContain('第三篇');
  });

  it('唸的內容跟畫面顯示的是同一份 —— 兩者不可以分岔', async () => {
    render(<FullTextAnnotate story={storyFor(ROUND3)} onFinish={vi.fn()} sectionSlug="7wavn" />);
    expect(screen.getByText(/第三篇的第一段/)).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: /播放全文/ }));
    await waitFor(() => expect(spoken.length).toBeGreaterThan(0));
    expect(spoken.join('')).toContain('第三篇的第一段');
  });
});
