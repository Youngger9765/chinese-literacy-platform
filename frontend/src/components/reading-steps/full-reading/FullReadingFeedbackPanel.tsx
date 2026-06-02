/**
 * FullReadingFeedbackPanel — Per-token diff display (Issue #1960).
 *
 * Extracted from FullReading.tsx result section.
 * Renders the 逐字比對 card using DiffDisplay when diffTokens are present.
 *
 * Intentionally minimal: only renders when tokens exist and length > 0.
 */

import React from 'react';
import DiffDisplay from '../../ui/DiffDisplay';

export interface DiffToken {
  type: string;
  text: string;
}

export interface FullReadingFeedbackPanelProps {
  /** Token array from analyzeFluency. undefined or empty → renders nothing. */
  diffTokens: DiffToken[] | undefined;
}

const FullReadingFeedbackPanel: React.FC<FullReadingFeedbackPanelProps> = ({ diffTokens }) => {
  if (!diffTokens || diffTokens.length === 0) return null;

  return (
    <div className="bg-surface-container-lowest rounded-3xl shadow-editorial p-6">
      <p className="text-xs font-headline font-bold text-on-surface-variant uppercase tracking-wider mb-3">逐字比對</p>
      <DiffDisplay tokens={diffTokens} showLegend className="text-lg" />
    </div>
  );
};

export default FullReadingFeedbackPanel;
