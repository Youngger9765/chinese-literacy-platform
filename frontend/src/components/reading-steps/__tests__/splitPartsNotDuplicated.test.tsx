import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import FullTextAnnotate from '../FullTextAnnotate';
import type { Story } from '../../../types';

/**
 * 一課拆成各篇的步驟之後，讀全文那一頁只能顯示**自己那一篇**（#2916）。
 *
 * 2026-08-25 staging 實測：學生停在第 1 篇的讀全文，頁面往下捲卻出現
 * 「第 2 篇 第23課 政府可以干預價格嗎？」整篇貼在同一頁。
 * 那是 #2752 的設計 —— 拆分還不存在時，多文本課本來就把所有篇塞一頁。
 * 拆分之後兩套同時生效：步驟已經分了，`multiTextParts` 又整份重畫一次。
 */
const BASE = {
  id: 20063, title: '物以稀為貴', level: '6', grade: '6', charCount: 100,
  content: ['第一篇的第一段。', '第一篇的第二段。'],
  thumbnail: '', category: 'Science', filename: 'x.yml',
} as unknown as Story;

const SPLIT: Story = {
  ...BASE,
  // 帳本有三列讀全文 → 這一課已經拆成各篇的步驟
  manifestSections: [
    { no: '一', name: '讀全文', module: 'full_text_annotate', slug: 'p3kud' },
    { no: '一', name: '讀全文', module: 'full_text_annotate', slug: '4uee3' },
    { no: '一', name: '讀全文', module: 'full_text_annotate', slug: '7wavn' },
  ],
  multiTextParts: [
    { lesson_heading: '第23課　政府可以干預價格嗎？', body: { paragraphs: ['第二篇的內容。'] } },
    { lesson_heading: '第24課　人力也有價格嗎？', body: { paragraphs: ['第三篇的內容。'] } },
  ] as never,
};

describe('拆成步驟的課，讀全文只顯示自己那一篇', () => {
  it('不把第 2、3 篇整個貼在第 1 篇的頁面下面', () => {
    render(<FullTextAnnotate story={SPLIT} onFinish={vi.fn()} sectionSlug="p3kud" />);
    expect(screen.getByText(/第一篇的第一段/)).toBeTruthy();
    expect(screen.queryByText(/第23課/)).toBeNull();
    expect(screen.queryByText(/第二篇的內容/)).toBeNull();
  });

  it('沒拆成步驟的舊課維持原樣（一頁到底）—— 不可以順手把它弄壞', () => {
    const legacy: Story = { ...BASE, multiTextParts: SPLIT.multiTextParts };
    render(<FullTextAnnotate story={legacy} onFinish={vi.fn()} sectionSlug="p3kud" />);
    expect(screen.getByText(/第23課/)).toBeTruthy();
  });
});
