/**
 * FullReadingFeedbackPanel — Color-coded reading result (Issue #1960).
 *
 * Matches LiveTutor ParagraphCard: show 朗讀結果 inline colors,
 * not the DiffDisplay 逐字比對 legend panel.
 */

import React, { useMemo } from 'react';
import { DiffToken } from '../../../types';
import { interleavePunctuation } from '../../../utils/textDiff';

export interface FullReadingFeedbackPanelProps {
  /** Token array from reading evaluation. undefined or empty → renders nothing. */
  diffTokens: DiffToken[] | undefined;
  /** Full lesson text — punctuation is interleaved for display. */
  targetText: string;
}

const FullReadingFeedbackPanel: React.FC<FullReadingFeedbackPanelProps> = ({
  diffTokens,
  targetText,
}) => {
  const readingResultTokens = useMemo(
    () => (diffTokens && diffTokens.length > 0 ? interleavePunctuation(targetText, diffTokens) : null),
    [targetText, diffTokens],
  );

  if (!readingResultTokens || readingResultTokens.length === 0) return null;

  return (
    <div className="bg-surface-container-lowest rounded-3xl shadow-editorial p-6">
      <p className="text-xs font-headline font-bold text-on-surface-variant uppercase tracking-wider mb-3">
        朗讀結果
      </p>
      <p className="text-lg leading-relaxed">
        {readingResultTokens.map((t, i) => (
          <span
            key={i}
            className={
              t.type === 'punctuation' ? 'text-on-surface' :
              t.type === 'correct' ? 'text-emerald-600 font-medium' :
              t.type === 'forgiven' ? 'text-blue-500' :
              t.type === 'wrong' ? 'text-tertiary line-through' :
              t.type === 'missing' || t.type === 'unread' ? 'text-on-surface-variant/30' :
              'text-on-surface'
            }
          >
            {t.char}
          </span>
        ))}
      </p>
    </div>
  );
};

export default FullReadingFeedbackPanel;
