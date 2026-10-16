/**
 * Art-source resolution — PK gamification MVP (launch-plan, 2026-10-17).
 *
 * Li Bai (tier 7) has a richer, game-quality PNG illustration set already
 * committed under frontend/public/story-assets/pk-li-bai/ (see
 * _prompts.json there); the other six figures only have the earlier,
 * placeholder-quality SVG set under frontend/public/pk-art/figures/. This
 * is the single place that decides which art source wins per figure — every
 * screen (VS, battle, result, opponent-select) must go through
 * pkFigureAssetPath/pkFigurePortraitUrl/pkFigureIconUrl, not re-derive a
 * path itself, so adding a figure's richer set here switches it everywhere
 * at once.
 */
import { describe, it, expect } from 'vitest';
import { pkFigureAssetPath, pkFigureIconUrl, pkFigurePortraitUrl } from '../pkFigures';

describe('PK figure art-source resolution', () => {
  it('uses the PNG set for Li Bai (tier 7)', () => {
    expect(pkFigureIconUrl(7)).toBe('/story-assets/pk-li-bai/icon.png');
    expect(pkFigurePortraitUrl(7, 'idle')).toBe('/story-assets/pk-li-bai/portrait-idle.png');
    expect(pkFigurePortraitUrl(7, 'victory')).toBe('/story-assets/pk-li-bai/portrait-victory.png');
  });

  it('covers every PRD §10.5.3 expression for the Li Bai PNG override', () => {
    const expressions = ['idle', 'thinking', 'happy', 'impressed', 'frustrated', 'victory', 'defeat'] as const;
    for (const expression of expressions) {
      expect(pkFigurePortraitUrl(7, expression)).toBe(`/story-assets/pk-li-bai/portrait-${expression}.png`);
    }
  });

  it('falls back to the SVG set for every other figure', () => {
    expect(pkFigureIconUrl(1)).toBe('/pk-art/figures/1-luo-binwang/icon.svg');
    expect(pkFigurePortraitUrl(3, 'victory')).toBe('/pk-art/figures/3-bai-juyi/portrait-victory.svg');
    expect(pkFigurePortraitUrl(6, 'frustrated')).toBe('/pk-art/figures/6-su-shi/portrait-frustrated.svg');
  });

  it('pkFigureAssetPath is the single resolver both helpers go through', () => {
    expect(pkFigureAssetPath(7, 'portrait-happy.svg')).toBe('/story-assets/pk-li-bai/portrait-happy.png');
    expect(pkFigureAssetPath(2, 'portrait-happy.svg')).toBe('/pk-art/figures/2-meng-haoran/portrait-happy.svg');
  });
});
