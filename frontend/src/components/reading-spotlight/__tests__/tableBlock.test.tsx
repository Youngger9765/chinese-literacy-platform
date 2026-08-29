/**
 * 聚光燈的表格練習 (#2713).
 *
 * The extractor used to label an image-less table as `figure` with `referent: 'table'`,
 * and the loader drops a figure that has no asset — 217 tables across 109 lessons
 * vanished, and the prompt above them was followed by nothing.
 *
 * They now arrive as `{type: 'table', rows}`. Until this renderer existed the switch's
 * `default:` branch printed the literal string `[table]` to the student, which is worse
 * than the blank it replaced.
 *
 * WHAT THE CELLS CONTAIN
 * ----------------------
 * This is the TEACHER's copy, so every 【 】 the student is meant to fill arrives filled:
 *
 *      把頭和四肢【    縮進龜殼     】
 *
 * The extractor empties them and keeps the values in `answers`, the arrangement
 * `ordering` already uses for `correct_order`. The renderer must never show `answers`,
 * and must turn each 【】 into somewhere to write.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// The renderer reads a token from AuthContext; the block under test does not depend on
// it, so the context is stubbed rather than the test being given a session.
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ token: 'test-token', user: null }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import BlockSequenceRenderer from '../BlockSequenceRenderer';
import type { SpotlightBlock } from '../../../types';

const table: SpotlightBlock = {
  type: 'table',
  rows: [
    ['動物例子', '重要細節'],
    ['柴棺龜、食蛇龜', '把頭和四肢【】'],
    ['穿山甲', '把身體捲成圓球，用【】保護自己'],
  ],
  answers: ['縮進龜殼', '硬鱗片'],
} as SpotlightBlock;

const renderBlocks = (blocks: SpotlightBlock[]) =>
  render(
    <BlockSequenceRenderer
      spotlight={{ lesson: 'L0002', strategy_name: '找重要細節',
                   strategy_type: 'detail', blocks } as never}
      onComplete={() => {}}
    />
  );

describe('spotlight table block', () => {
  it('shows every cell of the table', () => {
    const { container } = renderBlocks([table]);
    // Asserted against the rendered <table>, not with getByText: a cell's text appears
    // on both the <td> and an inner <span>, so a text query matches twice and throws
    // for a reason that has nothing to do with the content being there.
    const rendered = container.querySelector('table');
    expect(rendered).toBeTruthy();
    for (const text of ['動物例子', '重要細節', '柴棺龜、食蛇龜', '穿山甲', '保護自己']) {
      expect(rendered!.textContent).toContain(text);
    }
    expect(rendered!.querySelectorAll('tr').length).toBe(3);
  });

  it('never renders the marker答案', () => {
    const { container } = renderBlocks([table]);
    // Both the visible text and every input's value — an answer pre-filled into a box
    // is invisible to a textContent check, which is how a previous test in this repo
    // passed against a mutation.
    expect(container.textContent).not.toContain('縮進龜殼');
    expect(container.textContent).not.toContain('硬鱗片');
    const values = Array.from(container.querySelectorAll('input')).map(i => i.value);
    expect(values.join('')).not.toContain('縮進龜殼');
    expect(values.join('')).not.toContain('硬鱗片');
  });

  it('gives the student somewhere to write for each blank', () => {
    const { container } = renderBlocks([table]);
    // Two 【】 in the fixture → two inputs.
    expect(container.querySelectorAll('input').length).toBe(2);
  });

  it('does not fall through to the unknown-block branch', () => {
    const { container } = renderBlocks([table]);
    expect(container.textContent).not.toContain('[table]');
  });

  it('renders a table with no blanks as plain content', () => {
    const plain: SpotlightBlock = {
      type: 'table',
      rows: [['項目', '說明'], ['甲', '乙']],
    } as SpotlightBlock;
    const { container } = renderBlocks([plain]);
    expect(container.querySelectorAll('input').length).toBe(0);
    expect(screen.getByText('甲')).toBeTruthy();
  });
});
