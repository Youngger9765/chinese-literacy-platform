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
// security self-review, 2026-11-13 — this is a documented class of gap in
// browser-side SVG sanitizers generically, not specific to this library).
// This hook closes it on the parsed DOM (not a second string regex pass,
// which would just reintroduce the parsing-gap problem this file exists
// to avoid): any attribute whose value contains a `javascript:` scheme is
// dropped outright, on every element, regardless of attribute name.
// Registered once at module load — DOMPurify hooks are global, not
// per-call.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (!node.hasAttributes?.()) return;
  for (const attr of Array.from(node.attributes)) {
    if (/javascript:/i.test(attr.value)) {
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
