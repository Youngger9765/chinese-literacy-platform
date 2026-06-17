import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const liveTutorSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'LiveTutor.tsx'),
  'utf-8',
);

describe('LiveTutor layout — feedback drawer not mounted (#8bff6795)', () => {
  it('LiveTutor.tsx does not import LiveTutorFeedbackDrawer (inline ParagraphCard feedback)', () => {
    expect(liveTutorSrc).not.toMatch(/LiveTutorFeedbackDrawer/);
  });
});
