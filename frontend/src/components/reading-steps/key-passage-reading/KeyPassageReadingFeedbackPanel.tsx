/**
 * KeyPassageReadingFeedbackPanel — Color-coded reading result (Issue #1960).
 *
 * Matches ParagraphReading ParagraphCard: show 朗讀結果 inline colors,
 * not the DiffDisplay 逐字比對 legend panel.
 */

import React, { useMemo } from 'react';
import { DiffToken } from '../../../types';
import { interleavePunctuation } from '../../../utils/textDiff';
import { ReadingDiffLegend, renderDiffTokenSpans } from '../readingDiffStyle';

export interface KeyPassageReadingFeedbackPanelProps {
  /** Token array from reading evaluation. undefined or empty → renders nothing. */
  diffTokens: DiffToken[] | undefined;
  /** Full lesson text — punctuation is interleaved for display. */
  targetText: string;
  /** Lesson paragraphs — when provided and join to targetText, split 朗讀結果 by paragraph. */
  paragraphs?: string[];
}

const KeyPassageReadingFeedbackPanel: React.FC<KeyPassageReadingFeedbackPanelProps> = ({
  diffTokens,
  targetText,
  paragraphs,
}) => {
  const readingResultTokens = useMemo(
    () => (diffTokens && diffTokens.length > 0 ? interleavePunctuation(targetText, diffTokens) : null),
    [targetText, diffTokens],
  );

  const paragraphTokenGroups = useMemo(() => {
    if (!readingResultTokens) return null;

    const paras =
      paragraphs?.length && paragraphs.join('') === targetText
        ? paragraphs
        : [targetText];

    let offset = 0;
    return paras.map((para, idx) => {
      const len = Array.from(para).length;
      const tokens = readingResultTokens.slice(offset, offset + len);
      offset += len;
      return { idx, tokens };
    });
  }, [readingResultTokens, paragraphs, targetText]);

  if (!paragraphTokenGroups || paragraphTokenGroups.length === 0) return null;

  return (
    <div className="bg-surface-container-lowest rounded-3xl shadow-editorial p-6">
      <p className="text-xs font-headline font-bold text-on-surface-variant uppercase tracking-wider mb-3">
        朗讀結果
      </p>
      {/* Issue #2498：補上色碼圖例（含藍色「通融」），與逐段朗讀一致 */}
      <div className="mb-4 pb-3 border-b border-on-surface/5">
        <ReadingDiffLegend title={null} />
      </div>
      <div className="space-y-4">
        {paragraphTokenGroups.map(({ idx, tokens }) => (
          <p key={idx} className="text-lg leading-relaxed indent-[2em]">
            {renderDiffTokenSpans(tokens, `p${idx}`)}
          </p>
        ))}
      </div>
    </div>
  );
};

export default KeyPassageReadingFeedbackPanel;
