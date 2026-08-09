import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const liveTutorSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'ParagraphReading.tsx'),
  'utf-8',
);

describe('ParagraphReading layout — feedback drawer not mounted (#8bff6795)', () => {
  it('ParagraphReading.tsx does not import ParagraphReadingFeedbackDrawer (inline ParagraphCard feedback)', () => {
    expect(liveTutorSrc).not.toMatch(/ParagraphReadingFeedbackDrawer/);
  });
});
