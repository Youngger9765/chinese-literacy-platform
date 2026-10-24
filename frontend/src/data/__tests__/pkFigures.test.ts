/**
 * Art-source resolution — PK gamification MVP (launch-plan, 2026-10-17),
 * extended #3745 (all 7 figures now share the richer PNG set).
 *
 * Every PK figure now has a game-quality PNG illustration set committed
 * under frontend/public/story-assets/pk-<slug>/ (see each dir's
 * _prompts.json). This is the single place that decides which art source
 * wins per figure — every screen (VS, battle, result, opponent-select) must
 * go through pkFigureAssetPath/pkFigurePortraitUrl/pkFigureIconUrl, not
 * re-derive a path itself, so adding a figure's richer set here switches it
 * everywhere at once.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  pkFigureAssetPath,
  pkFigureIconUrl,
  pkFigurePortraitUrl,
  PK_FIGURES,
  type PkExpressionKey,
} from '../pkFigures';

const EXPRESSIONS: PkExpressionKey[] = [
  'idle',
  'thinking',
  'happy',
  'impressed',
  'frustrated',
  'victory',
  'defeat',
];

// slug -> art dir name is not 1:1 (pk-<slug> matches every current figure,
// kept explicit here so a future figure with a differently-named asset dir
// fails this test loudly instead of silently resolving to a 404 directory).
const ART_DIR: Record<string, string> = {
  'luo-binwang': 'pk-luo-binwang',
  'meng-haoran': 'pk-meng-haoran',
  'bai-juyi': 'pk-bai-juyi',
  'li-qingzhao': 'pk-li-qingzhao',
  'du-fu': 'pk-du-fu',
  'su-shi': 'pk-su-shi',
  'li-bai': 'pk-li-bai',
};

const PUBLIC_STORY_ASSETS = resolve(__dirname, '../../../public/story-assets');

describe('PK figure art-source resolution', () => {
  it('uses the PNG set for every figure (tier 1-7)', () => {
    for (const figure of PK_FIGURES) {
      const dir = ART_DIR[figure.slug];
      expect(dir, `no art dir mapping for slug ${figure.slug}`).toBeDefined();
      expect(pkFigureIconUrl(figure.tier)).toBe(`/story-assets/${dir}/icon.png`);
      for (const expression of EXPRESSIONS) {
        expect(pkFigurePortraitUrl(figure.tier, expression)).toBe(
          `/story-assets/${dir}/portrait-${expression}.png`
        );
      }
    }
  });

  it('pkFigureAssetPath is the single resolver both helpers go through', () => {
    expect(pkFigureAssetPath(7, 'portrait-happy.svg')).toBe('/story-assets/pk-li-bai/portrait-happy.png');
    expect(pkFigureAssetPath(4, 'portrait-happy.svg')).toBe('/story-assets/pk-li-qingzhao/portrait-happy.png');
  });

  it('every figure has all 8 PNG files (7 expressions + icon) actually present under public/', () => {
    for (const figure of PK_FIGURES) {
      const dir = ART_DIR[figure.slug];
      const dirPath = resolve(PUBLIC_STORY_ASSETS, dir);
      expect(existsSync(dirPath), `missing art dir: ${dirPath}`).toBe(true);

      const files = ['icon.png', ...EXPRESSIONS.map((e) => `portrait-${e}.png`)];
      for (const file of files) {
        const filePath = resolve(dirPath, file);
        expect(existsSync(filePath), `missing file: ${filePath}`).toBe(true);
      }
    }
  });
});
