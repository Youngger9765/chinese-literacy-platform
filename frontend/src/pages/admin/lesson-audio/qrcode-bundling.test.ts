/**
 * Regression lock for #2622 — the QR library must really be bundled.
 *
 * What broke: `qrCodeToDataUrl` used
 *
 *     const moduleName = 'qrcode';
 *     await import(/* @vite-ignore *\/ moduleName)
 *
 * A non-literal specifier plus `@vite-ignore` tells Vite not to analyse or
 * bundle the module. The consequences were invisible to every gate we run:
 *
 *   vite build   passed — Vite was explicitly told to skip it
 *   npm run lint passed — nothing is wrong with the syntax
 *   vitest       passed — LessonAudioTable.test.tsx does vi.mock('qrcode')
 *
 * ...while in a browser the bare specifier cannot be resolved, so every QR
 * download threw. Confirmed by grepping the build output for the library's own
 * strings: zero hits before the fix, present after.
 *
 * These two tests deliberately do NOT mock 'qrcode'.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('#2622 qrcode bundling', () => {
  it('resolves and runs the real qrcode library, unmocked', async () => {
    const QRCode = (await import('qrcode')).default;

    const dataUrl = await QRCode.toDataURL('https://example.test/demo-reading/1/full', {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 512,
    });

    // A real PNG data URL, not an empty string or a stub's echo.
    expect(dataUrl.startsWith('data:image/png;base64,')).toBe(true);
    expect(dataUrl.length).toBeGreaterThan(500);
  });

  it('imports qrcode statically so the bundler can see it', () => {
    const raw = readFileSync(join(__dirname, 'LessonAudioTable.tsx'), 'utf-8');

    // Strip comments first. The explanation of this very bug mentions the
    // dangerous construct by name, and an assertion that matched anywhere in
    // the file would fail on its own documentation.
    const code = raw
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    // No dynamic import at all in this module — that is the construct whose
    // specifier the bundler cannot follow.
    expect(code).not.toMatch(/\bimport\s*\(/);
    // A literal top-level specifier is what makes Vite include the library.
    expect(code).toMatch(/^import QRCode from 'qrcode';$/m);
  });
});
