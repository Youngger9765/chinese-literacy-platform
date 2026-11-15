/**
 * ArtGlyph — renders a `LeagueThemeArt` (PRD §13). `emoji` is a plain text
 * glyph; `svg` uses `dangerouslySetInnerHTML`.
 *
 * Defense in depth (CodeQL js/xss-through-dom, alert #66, 2026-11-13):
 * every `LeagueTheme`/`StoryPack` art value reaching the frontend has
 * already been through the backend's allow-list sanitizer (`sanitize_svg`
 * in backend/app/schemas/story_pack.py, enforced at create/update time),
 * but this component does NOT rely on that alone — CodeQL's DOM taint
 * analysis has no visibility into that cross-service contract, and a
 * regex-based allow-list sanitizer can itself have parsing gaps (nested
 * quotes, HTML comments, entity-encoded attributes). `DOMPurify.sanitize`
 * runs here too, so a value that somehow bypassed or outlived the backend
 * check (a future write path, a validator bug, a bad migration) still
 * cannot hand the browser a <script> tag or an on*= event handler. See
 * `__tests__/ArtGlyph.test.tsx` for the regression lock.
 */
import React from 'react';
import DOMPurify from 'dompurify';
import type { LeagueThemeArt } from '../../types/leagueTheme';

// DOMPurify's default AND `USE_PROFILES: { svg: true }` configs only scan a
// fixed allow-list of attribute NAMES (href/src/action/...) for dangerous
// URI schemes — presentation attributes that also take a `url(...)` value
// (fill/stroke/clip-path/mask/filter) are not on that list, so
// `fill="url(javascript:alert(1))"` on an SVG element survives
// `DOMPurify.sanitize()` untouched (confirmed by hand: see this module's
// security self-review, 2026-11-13).
//
// #4044 (fast-follow from #4043's critic-agent review, 2026-11-13): the
// first version of this hook only matched the literal `javascript:`
// substring — `vbscript:`, `data:text/html`, and whitespace/backslash-
// obfuscated variants of `javascript:` all survived untouched. Rather than
// add each newly-found scheme/obfuscation to a deny-list that will always
// be one bypass behind, these FIVE attributes now go through a shape
// ALLOW-list instead: the only `url(...)` value real SVG art legitimately
// needs here is an in-document fragment reference (`url(#someId)`, pointing
// at a `<linearGradient>`/`<filter>`/`<clipPath>`/`<mask>` defined elsewhere
// in the same SVG). Any other `url(...)` on these attributes — any scheme,
// any obfuscation style, present or future — does not match that shape and
// the whole attribute is removed, same as before. See
// `__tests__/ArtGlyph.test.tsx` for the full variant list this closes, and
// its positive controls proving the allow-list does not just strip every
// `url(...)` indiscriminately.
//
// This does NOT close the attack class for every attribute — only these
// five. `style` (which can carry `fill:url(javascript:...)` as CSS) and
// `marker-start`/`marker-mid`/`marker-end` (which also take `url(#id)`) are
// known residual gaps, left on the old substring-only check below. That is
// an acceptable residual *for this file's specific threat model* because
// the backend's `_SVG_ALLOWED_ATTRS` (backend/app/schemas/story_pack.py)
// does not currently allow any of `style`/`marker-start`/`marker-mid`/
// `marker-end` (nor, today, even `filter`/`clip-path`/`mask` — only `fill`
// and `stroke` are presently backend-allowed) — so none of them can reach
// this component through the only write path that exists. If the backend
// allow-list is ever widened to include one of these, add it to
// `URL_FUNCTION_ATTRS` below in the same change.
const URL_FUNCTION_ATTRS = new Set(['fill', 'stroke', 'filter', 'clip-path', 'mask']);

// `url(#id)`, optionally wrapped in matching single or double quotes
// (`url('#id')` / `url("#id")`), matching real SVG author output. The
// backreference (`\1`) requires the closing quote to match the opening one,
// so a mismatched-quote value like `url('#id")` is rejected outright. The id
// itself must start with a letter/underscore and contain only
// letters/digits/`_`/`:`/`.`/`-` (a practical XML-NCName-ish allow-list) —
// deliberately stricter than "no javascript:", since the only thing this
// pattern needs to express is "a same-document element id". `i` flag: CSS's
// `url()` function name is case-insensitive (`URL(#id)` is valid CSS), and
// without it a legitimate uppercase/mixed-case fragment reference would be
// over-stripped as a false positive (independent review finding, 2026-11-14).
const SAFE_FRAGMENT_URL = /^url\(\s*(['"]?)#[A-Za-z_][\w:.-]*\1\s*\)$/i;

// Registered once at module load — DOMPurify hooks are global, not
// per-call.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (!node.hasAttributes?.()) return;
  for (const attr of Array.from(node.attributes)) {
    const name = attr.name.toLowerCase();
    const value = attr.value;
    if (URL_FUNCTION_ATTRS.has(name) && /url\(/i.test(value)) {
      if (!SAFE_FRAGMENT_URL.test(value.trim())) {
        node.removeAttribute(attr.name);
      }
      continue;
    }
    // Residual coverage for every OTHER attribute (unchanged from the
    // original hook): a literal `javascript:` substring, case-insensitive.
    if (/javascript:/i.test(value)) {
      node.removeAttribute(attr.name);
    }
  }
});

interface ArtGlyphProps {
  art: LeagueThemeArt;
  className?: string;
}

const ArtGlyph: React.FC<ArtGlyphProps> = ({ art, className }) => {
  if (art.kind === 'emoji') {
    return (
      <span className={className} aria-hidden="true">
        {art.value}
      </span>
    );
  }
  // Backend-validated SVG (allow-list enforced before storage — see file
  // docstring), sanitized again here as a second line of defense before it
  // reaches dangerouslySetInnerHTML. This project's eslint config has no
  // react/no-danger rule to suppress, so there is nothing to disable here.
  const sanitized = DOMPurify.sanitize(art.value, { USE_PROFILES: { svg: true, svgFilters: true } });
  return <span className={className} aria-hidden="true" dangerouslySetInnerHTML={{ __html: sanitized }} />;
};

export default ArtGlyph;
