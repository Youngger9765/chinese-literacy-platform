/**
 * ArtGlyph — renders a `LeagueThemeArt` (PRD §13). `emoji` is a plain text
 * glyph; `svg` uses `dangerouslySetInnerHTML` — this is safe ONLY because
 * every `LeagueTheme` reaching the frontend has already been through the
 * backend's strict allow-list sanitizer (`sanitize_svg` in
 * app/schemas/league_theme.py, enforced at theme create/update time, not
 * at render time). This component does not re-validate; it trusts the
 * content exactly as far as the backend contract is trusted, same as any
 * other field in the API response.
 */
import React from 'react';
import type { LeagueThemeArt } from '../../types/leagueTheme';

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
  // Server-sanitized SVG (allow-list validated before storage — see file
  // docstring); this project's eslint config has no react/no-danger rule
  // to suppress, so there is nothing to disable here.
  return (
    <span className={className} aria-hidden="true" dangerouslySetInnerHTML={{ __html: art.value }} />
  );
};

export default ArtGlyph;
