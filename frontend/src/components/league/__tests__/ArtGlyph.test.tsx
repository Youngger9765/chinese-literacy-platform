/**
 * CodeQL alert #66 (js/xss-through-dom): `ArtGlyph`'s `svg` branch feeds
 * `art.value` into `dangerouslySetInnerHTML` without any frontend-side
 * sanitization. The component's own docstring argues this is safe because
 * the backend's allow-list sanitizer (`sanitize_svg` in
 * backend/app/schemas/story_pack.py) already validated the value before
 * storage — but that is a cross-service trust claim CodeQL's DOM taint
 * analysis cannot see, and a regex-based allow-list sanitizer can itself
 * have parsing gaps (nested quotes, comments, entity-encoded attributes).
 * This locks in a frontend-side second line of defense: even if a
 * dangerous value somehow reaches this component (a future caller that
 * skips the backend validator, a validator bug, a different write path),
 * the component itself must not hand the browser a <script> tag or an
 * event-handler attribute.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import ArtGlyph from '../ArtGlyph';

describe('ArtGlyph XSS hardening (CodeQL #66)', () => {
  it('does not render a <script> tag or on*= event handler from a malicious svg value', () => {
    const malicious = {
      kind: 'svg' as const,
      value:
        '<svg xmlns="http://www.w3.org/2000/svg"><circle cx="5" cy="5" r="4" />' +
        '<script>window.__artGlyphXssFired = true;</script>' +
        '<image href="x" onerror="window.__artGlyphXssFired = true" />' +
        '<circle cx="1" cy="1" r="1" onload="window.__artGlyphXssFired = true" /></svg>',
    };

    const { container } = render(<ArtGlyph art={malicious} />);

    // The dangerous constructs must be gone from the rendered DOM.
    expect(container.innerHTML).not.toMatch(/<script/i);
    expect(container.innerHTML).not.toMatch(/onerror\s*=/i);
    expect(container.innerHTML).not.toMatch(/onload\s*=/i);
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('[onerror]')).toBeNull();
    expect(container.querySelector('[onload]')).toBeNull();

    // Sanity: if the sink had never run (e.g. the component threw, or
    // rendered nothing), the assertions above would pass vacuously. Prove
    // the component actually rendered *something* from this payload.
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('strips javascript: URIs from presentation attributes DOMPurify does not scan by default (fill/stroke url())', () => {
    // Self-review finding (2026-11-13): DOMPurify's default config AND its
    // `USE_PROFILES: { svg: true }` profile only check a fixed allow-list of
    // attribute NAMES for dangerous URI schemes (href/src/action/...) — they
    // do not scan `fill`/`stroke`/`clip-path`/`mask`/`filter`, which can also
    // carry a `url(...)` value. Confirmed by hand before adding the
    // `afterSanitizeAttributes` hook in ArtGlyph.tsx: without that hook, this
    // exact payload survives `DOMPurify.sanitize()` untouched.
    const malicious = {
      kind: 'svg' as const,
      value: '<svg xmlns="http://www.w3.org/2000/svg"><circle cx="5" cy="5" r="4" fill="url(javascript:alert(1))" /></svg>',
    };

    const { container } = render(<ArtGlyph art={malicious} />);

    expect(container.innerHTML).not.toMatch(/javascript:/i);
  });

  it('still renders benign, allow-list-shaped svg content untouched', () => {
    const benign = {
      kind: 'svg' as const,
      value:
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">' +
        '<circle cx="5" cy="5" r="4" fill="#ffcc00" /></svg>',
    };

    const { container } = render(<ArtGlyph art={benign} />);

    const circle = container.querySelector('circle');
    expect(circle).not.toBeNull();
    expect(circle?.getAttribute('fill')).toBe('#ffcc00');
  });

  it('renders emoji kind as plain text, unaffected by sanitization', () => {
    const { container } = render(<ArtGlyph art={{ kind: 'emoji', value: '🏆' }} />);
    expect(container.textContent).toBe('🏆');
  });
});
