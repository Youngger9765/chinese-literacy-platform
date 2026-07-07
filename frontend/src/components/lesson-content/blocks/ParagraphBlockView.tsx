/**
 * ParagraphBlockView — renders a `paragraph` block as a numbered line + 注音.
 *
 * Numbered-line + zhuyin markup extracted from the legacy StoryTextCard
 * (ComprehensionLayout.tsx:174-203); reuses the shared `useZhuyin()` processor so
 * bopomofo behavior stays consistent across the app.
 */
import React from 'react';
import { useZhuyin } from '../../../context/ZhuyinContext';

interface Props {
  text: string;
  /** 1-based line number badge (position within the lesson's paragraph run). */
  lineNumber?: number;
}

const ParagraphBlockView: React.FC<Props> = ({ text, lineNumber }) => {
  const { processZhuyin, zhuyinActive } = useZhuyin();
  const rendered = processZhuyin(text);
  const isMarkup = rendered !== text; // processor emitted ruby markup

  return (
    <div className="flex gap-3 items-start">
      {lineNumber != null && (
        <span className="text-xs font-headline font-bold text-on-surface-variant/30 pt-1 select-none shrink-0 w-5 text-right">
          {String(lineNumber).padStart(2, '0')}
        </span>
      )}
      <p
        className={`text-lg md:text-xl text-on-surface leading-[2rem] md:leading-[2.2rem] ${
          zhuyinActive ? 'tracking-[0.15em]' : ''
        }`}
        {...(isMarkup ? { dangerouslySetInnerHTML: { __html: rendered } } : {})}
      >
        {isMarkup ? undefined : text}
      </p>
    </div>
  );
};

export default ParagraphBlockView;
