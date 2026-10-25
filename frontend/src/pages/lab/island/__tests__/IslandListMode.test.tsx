/**
 * 清單模式（PRD §8）：舊裝置跑不動 3D 時，要有清單可以進關卡。
 * 用一般 <button> + aria-label，Playwright 用 getByRole 直接點，
 * 不需要座標掃描、也不需要只給 QA 用的隱藏機制（Young 2026-10-26 明令走這條）。
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import IslandListMode from '../IslandListMode';
import type { IslandStop } from '../islandTemplate';

const stops: IslandStop[] = [
  { name: '港口燈塔', step: 'lesson-intro', x: -3, z: 11, zone: 0, line: '...' },
  { name: '書卷長廊', step: 'full-text-annotate', x: -9, z: 5, zone: 0, line: '...' },
  { name: '字源館', step: 'vocab-definition', x: 12, z: -4, zone: 1, line: '...' },
  { name: '謎題神殿', step: 'comprehension', x: 23, z: -20, zone: 2, line: '...' },
];

describe('IslandListMode', () => {
  it('lists every station by name', () => {
    render(<IslandListMode stops={stops} doneIndexes={[]} unlockedZone={0} onEnter={vi.fn()} onClose={vi.fn()} />);
    stops.forEach((s) => expect(screen.getByText(s.name)).toBeTruthy());
  });

  it('shows 已亮燈 only for done stations, 未開始 for the rest in an unlocked zone', () => {
    render(<IslandListMode stops={stops} doneIndexes={[0]} unlockedZone={0} onEnter={vi.fn()} onClose={vi.fn()} />);
    const row0 = screen.getByText('港口燈塔').closest('li');
    const row1 = screen.getByText('書卷長廊').closest('li');
    expect(row0?.textContent).toContain('已亮燈');
    expect(row1?.textContent).toContain('未開始');
  });

  it('locked-zone stations show 還在霧裡 and have no 進入 button (region lock respected)', () => {
    render(<IslandListMode stops={stops} doneIndexes={[]} unlockedZone={0} onEnter={vi.fn()} onClose={vi.fn()} />);
    // zone 1 (字源館) and zone 2 (謎題神殿) are locked when unlockedZone=0
    const lockedRow = screen.getByText('字源館').closest('li');
    expect(lockedRow?.textContent).toContain('還在霧裡');
    expect(screen.queryByRole('button', { name: /進入字源館/ })).toBeNull();
    // zone 0 stations (open) DO have an enter button
    expect(screen.getByRole('button', { name: /進入港口燈塔/ })).toBeTruthy();
  });

  it('clicking 進入 calls onEnter with that station\'s index', async () => {
    const onEnter = vi.fn();
    render(<IslandListMode stops={stops} doneIndexes={[]} unlockedZone={0} onEnter={onEnter} onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /進入書卷長廊/ }));
    expect(onEnter).toHaveBeenCalledWith(1);
  });

  it('clicking 進入 on an already-done station still works (students can revisit)', async () => {
    const onEnter = vi.fn();
    render(<IslandListMode stops={stops} doneIndexes={[0]} unlockedZone={0} onEnter={onEnter} onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /進入港口燈塔/ }));
    expect(onEnter).toHaveBeenCalledWith(0);
  });

  it('close button calls onClose', async () => {
    const onClose = vi.fn();
    render(<IslandListMode stops={stops} doneIndexes={[]} unlockedZone={0} onEnter={vi.fn()} onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: '關閉清單' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('as more zones unlock, their stations stop being 還在霧裡', () => {
    render(<IslandListMode stops={stops} doneIndexes={[]} unlockedZone={2} onEnter={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText('字源館').closest('li')?.textContent).not.toContain('還在霧裡');
    expect(screen.getByText('謎題神殿').closest('li')?.textContent).not.toContain('還在霧裡');
    expect(screen.getByRole('button', { name: /進入謎題神殿/ })).toBeTruthy();
  });

  it('the whole thing is reachable by role for Playwright (dialog landmark)', () => {
    render(<IslandListMode stops={stops} doneIndexes={[]} unlockedZone={0} onEnter={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: '站點清單' })).toBeTruthy();
  });
});
