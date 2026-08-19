/**
 * #2752 regression lock: a 文言文 lesson's classical_text content must actually
 * render somewhere a student can reach — not just arrive intact in the API
 * response (that half is locked separately in api.classicalModules.test.ts +
 * backend/tests/test_classical_modules_entry_2752.py).
 *
 * `module_entry_gate.py` found L0155 had 2704 漢字 across 6 modules that loaded
 * fine into `story` but had ZERO step rendering them. This is the lock for the
 * `classical-text` step specifically (原文＋白話對照, the module_entry_gate
 * entry for both `classical_text` and folded-in `modern_translation`).
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Story } from '../../../types';
import ClassicalText from '../ClassicalText';

const BASE_STORY: Story = {
  id: '155',
  title: '不流血的戰爭',
  level: '文言文',
  content: [],
  thumbnail: '',
  category: 'History',
  filename: '',
  grade: '文言文',
};

describe('ClassicalText', () => {
  it('renders the 原文 paragraphs and the annotation glossary', () => {
    const story: Story = {
      ...BASE_STORY,
      classicalText: {
        paragraphs: ['桓公曰：「吾欲下魯梁。」'],
        annotations: [{ term: '綈', text: '古代一種光滑細澤的厚絲織品。' }],
      },
    };
    render(<ClassicalText story={story} onFinish={() => {}} />);
    expect(screen.getByText(/桓公曰/)).toBeInTheDocument();
    expect(screen.getByText('綈')).toBeInTheDocument();
    expect(screen.getByText(/光滑細澤的厚絲織品/)).toBeInTheDocument();
  });

  it('renders the 白話對照 translation when present', () => {
    const story: Story = {
      ...BASE_STORY,
      classicalText: { paragraphs: ['桓公曰：「吾欲下魯梁。」'] },
      modernTranslation: { paragraphs: ['齊桓公說：「我想拿下魯國和梁國。」'] },
    };
    render(<ClassicalText story={story} onFinish={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /顯示.*古文今譯/ }));
    expect(screen.getByText(/齊桓公說/)).toBeInTheDocument();
  });

  it('shows an honest empty state when the lesson has no classical_text (not a crash)', () => {
    render(<ClassicalText story={BASE_STORY} onFinish={() => {}} />);
    expect(screen.getByText(/本課尚無原文資料/)).toBeInTheDocument();
  });
});
