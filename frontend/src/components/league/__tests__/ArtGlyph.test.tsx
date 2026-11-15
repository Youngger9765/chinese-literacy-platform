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
 *
 * #4044 fast-follow (from #4043's critic-agent review, 2026-11-13): the
 * `afterSanitizeAttributes` hook only caught the literal `javascript:`
 * substring — `vbscript:`, `data:text/html`, and case/whitespace-obfuscated
 * variants still passed through `url(...)` on presentation attributes.
 * Fixed here by switching `fill`/`stroke`/`filter`/`clip-path`/`mask` from a
 * scheme DENY-list to a shape ALLOW-list: `url(...)` on those attributes is
 * only kept when it is an in-document fragment reference (`url(#someId)`,
 * the only legitimate shape — referencing a `<linearGradient>`/`<filter>`/
 * `<clipPath>`/`<mask>` defined elsewhere in the same SVG). Any other
 * `url(...)` shape is untrusted and the attribute is removed outright — this
 * closes the whole scheme-obfuscation class at once instead of adding one
 * more name to a list that will always be one behind the next bypass.
 *
 * The same review's second finding — a pre-existing `dangerouslySetInnerHTML`
 * site in `src/components/lesson-content/blocks/ParagraphBlockView.tsx` — was
 * investigated and is NOT fixed here: traced its `text` prop's only two
 * callers (`spotlight_to_lesson_content.py`'s backend adapter and the
 * frontend `storyToLesson()` fallback) back to `GET /api/stories/{id}`,
 * which resolves through `get_lesson_by_id()`
 * (`backend/app/services/lesson_loader.py`) — a file with zero `Session`/
 * `db.query` references, i.e. it can only ever serve the in-memory curriculum
 * uid-tree (`backend/data/lessons/`). The DB-backed `Text` table that a
 * teacher can write to (`teacher_texts.py`'s My Texts library, and the
 * separate admin `StoryManagementPanel`/`admin_stories.py` CRUD panel) is
 * never read by `get_lesson_by_id()`, so neither reaches this prop; the one
 * render path for teacher-authored text (`MyTextPreviewModal.tsx`) uses plain
 * JSX interpolation (`{para}`), which React escapes, not
 * `dangerouslySetInnerHTML`. See the PR description for the full trace.
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

  // #4044 — the fast-follow from #4043's critic-agent review: the hook only
  // caught the literal `javascript:` substring. Each case below is one of the
  // variants the review named, plus a couple more of the same shape. The
  // allow-list fix (see ArtGlyph.tsx) strips ANY `url(...)` on these
  // attributes that is not an in-document fragment reference — so it does
  // not matter which scheme or which obfuscation style is used; none of them
  // can match `url(#fragment)`.
  describe('scheme-agnostic url() hardening (#4044)', () => {
    const rendersStripped = (value: string, attrName: string, needle: RegExp) => {
      const { container } = render(<ArtGlyph art={{ kind: 'svg', value }} />);
      expect(container.innerHTML).not.toMatch(needle);

      // Sanity: not a vacuous pass from the whole node being dropped.
      const circle = container.querySelector('circle');
      expect(circle).not.toBeNull();

      // The allow-list REMOVES the whole attribute (it does not rewrite its
      // value) — so a selector by attribute NAME would never match post-fix
      // and silently skip the rest of this check (the bug an earlier version
      // of this helper had: `container.querySelector('[fill]')` is always
      // null once `fill` is removed, so its guarded assertion never ran).
      expect(circle!.hasAttribute(attrName)).toBe(false);

      // And prove the dangerous value did not just move to a DIFFERENT
      // attribute on the same element (the hook iterates every attribute,
      // so this should never happen, but that is the point of a lock: it
      // should fail loudly if that contract ever regresses).
      for (const attr of Array.from(circle!.attributes)) {
        expect(attr.value).not.toMatch(needle);
      }
    };

    it('strips a vbscript: scheme inside fill:url()', () => {
      rendersStripped(
        '<svg xmlns="http://www.w3.org/2000/svg"><circle cx="5" cy="5" r="4" fill="url(vbscript:msgbox(1))" /></svg>',
        'fill',
        /vbscript:/i,
      );
    });

    it('strips a data:text/html scheme inside stroke:url()', () => {
      rendersStripped(
        '<svg xmlns="http://www.w3.org/2000/svg"><circle cx="5" cy="5" r="4" stroke="url(data:text/html,<script>alert(1)</script>)" /></svg>',
        'stroke',
        /data:text\/html/i,
      );
    });

    it('strips a MiXeD-CaSe javascript: scheme inside filter:url()', () => {
      rendersStripped(
        '<svg xmlns="http://www.w3.org/2000/svg"><circle cx="5" cy="5" r="4" filter="url(JaVaScRiPt:alert(1))" /></svg>',
        'filter',
        /javascript:/i,
      );
    });

    it('strips a tab-obfuscated jav\\tascript: scheme inside clip-path:url()', () => {
      // The exact bypass the #4043 critic-agent review named: a literal tab
      // character splits "jav" from "ascript:" so a bare /javascript:/i
      // substring check never matches, even though the browser still parses
      // it as the javascript: scheme once whitespace inside a URL is ignored.
      rendersStripped(
        '<svg xmlns="http://www.w3.org/2000/svg"><circle cx="5" cy="5" r="4" clip-path="url(jav\tascript:alert(1))" /></svg>',
        'clip-path',
        /ascript:/i,
      );
    });

    it('strips an entity-obfuscated &#106;avascript: scheme inside mask:url()', () => {
      // `&#106;` is the decimal HTML entity for "j". The HTML parser decodes
      // it before the attribute ever reaches `node.attributes` (that is also
      // why the ORIGINAL narrow hook already caught plain entity-encoding —
      // this case guards against a regression where some future change reads
      // the raw un-decoded source instead of the live DOM attribute value).
      rendersStripped(
        '<svg xmlns="http://www.w3.org/2000/svg"><circle cx="5" cy="5" r="4" mask="url(&#106;avascript:alert(1))" /></svg>',
        'mask',
        /javascript:/i,
      );
    });

    it('strips javascript: wrapped in single quotes inside url()', () => {
      rendersStripped(
        "<svg xmlns=\"http://www.w3.org/2000/svg\"><circle cx=\"5\" cy=\"5\" r=\"4\" fill=\"url('javascript:alert(1)')\" /></svg>",
        'fill',
        /javascript:/i,
      );
    });

    it('strips javascript: wrapped in escaped double quotes inside url()', () => {
      rendersStripped(
        '<svg xmlns="http://www.w3.org/2000/svg"><circle cx="5" cy="5" r="4" fill="url(&quot;javascript:alert(1)&quot;)" /></svg>',
        'fill',
        /javascript:/i,
      );
    });

    it('strips a backslash-escaped javascript: scheme (CSS url-token escape) inside url()', () => {
      // CSS's url() token treats `\` + char as a literal escape of that one
      // char (not a denylist-visible "javascript:" substring once the
      // backslash sits between letters) — a plain substring/regex check on
      // the raw attribute text can miss this; the allow-list does not care,
      // since this value is not `url(#fragment)` either way.
      rendersStripped(
        '<svg xmlns="http://www.w3.org/2000/svg"><circle cx="5" cy="5" r="4" fill="url(java\\script:alert(1))" /></svg>',
        'fill',
        /script:/i,
      );
    });

    it('allows a legitimate in-document fragment reference: fill="url(#id)"', () => {
      // Positive control (rules/overclaim-bias.md: a strip-everything test
      // suite proves nothing by itself — it would pass identically if the
      // hook stripped ALL url() values, fragment refs included). This is the
      // one shape real SVG art legitimately needs: a <circle fill="url(#g)">
      // pointing at a <linearGradient id="g"> defined in the same document.
      const value =
        '<svg xmlns="http://www.w3.org/2000/svg">' +
        '<defs><linearGradient id="g"><stop offset="0" stop-color="#fff" /></linearGradient></defs>' +
        '<circle cx="5" cy="5" r="4" fill="url(#g)" /></svg>';

      const { container } = render(<ArtGlyph art={{ kind: 'svg', value }} />);

      const circle = container.querySelector('circle');
      expect(circle?.getAttribute('fill')).toBe('url(#g)');
      expect(container.querySelector('linearGradient#g')).not.toBeNull();
    });

    it('allows a quoted fragment reference: fill="url(\'#id\')"', () => {
      const value =
        '<svg xmlns="http://www.w3.org/2000/svg">' +
        '<defs><linearGradient id="g2"><stop offset="0" stop-color="#000" /></linearGradient></defs>' +
        '<circle cx="5" cy="5" r="4" fill="url(\'#g2\')" /></svg>';

      const { container } = render(<ArtGlyph art={{ kind: 'svg', value }} />);

      const circle = container.querySelector('circle');
      expect(circle?.getAttribute('fill')).toBe("url('#g2')");
    });

    it('allows an UPPERCASE URL(#id) — valid CSS, must not be over-stripped', () => {
      // Independent review finding: the outer `/url\(/i` detector is
      // case-insensitive, but SAFE_FRAGMENT_URL itself had no `i` flag — so
      // a legitimate `fill="URL(#g3)"` matched the outer check (so the hook
      // looked at it) and then FAILED the inner allow-list match (because it
      // requires a literal lowercase "url("), stripping a value that was
      // never dangerous. `url(...)` is case-insensitive in CSS; the
      // allow-list must be too.
      const value =
        '<svg xmlns="http://www.w3.org/2000/svg">' +
        '<defs><linearGradient id="g3"><stop offset="0" stop-color="#0f0" /></linearGradient></defs>' +
        '<circle cx="5" cy="5" r="4" fill="URL(#g3)" /></svg>';

      const { container } = render(<ArtGlyph art={{ kind: 'svg', value }} />);

      const circle = container.querySelector('circle');
      expect(circle?.getAttribute('fill')).toBe('URL(#g3)');
    });
  });
});
