/**
 * PkFigurePortrait — the ONE component every screen (VS / battle / result)
 * uses to render an AI figure's portrait, so "which art source wins" for a
 * given figure (data/pkFigures.ts's PNG-override map vs the SVG set) only
 * has to be decided in one place. `key={expression}` forces a clean element
 * swap on expression change rather than mutating `src` in place — the swap
 * itself is instant either way (PRD §10.5.3: "表情是瞬間切換...沒有淡入淡出"),
 * this just avoids a stale/broken image lingering mid-swap.
 */
import React from 'react';
import { pkFigurePortraitUrl, type PkExpressionKey } from '../../data/pkFigures';

interface PkFigurePortraitProps {
  tier: number;
  expression: PkExpressionKey;
  name: string;
  className?: string;
}

const PkFigurePortrait: React.FC<PkFigurePortraitProps> = ({ tier, expression, name, className }) => (
  <img
    key={expression}
    src={pkFigurePortraitUrl(tier, expression)}
    alt={name}
    className={className ?? 'h-full w-full object-contain'}
  />
);

export default PkFigurePortrait;
