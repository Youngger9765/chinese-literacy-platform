/**
 * FigureBlockView — thin wrapper over the legacy FigureCard for a `figure` block.
 *
 * The schema `figure` block has NO lessonCode field (Gap G1); the GCS src is resolved
 * here via `buildImageSrc(asset, lessonCode)`, with `lessonCode` passed down from
 * LessonRenderer. Zoom/modal behavior is NOT re-implemented — FigureCard owns it.
 * When the asset is missing we render a labelled placeholder (never break the page).
 */
import React from 'react';
import { FigureCard, buildImageSrc } from '../../reading-steps/GraphicTextImageStrip';

interface Props {
  label?: string | null;
  caption?: string | null;
  asset?: string | null;
  lessonCode: string;
  /** 0-based index fallback for the figure numeral badge. */
  index: number;
}

const FigureBlockView: React.FC<Props> = ({ label, caption, asset, lessonCode, index }) => {
  if (asset && lessonCode) {
    return (
      <FigureCard
        src={buildImageSrc(asset, lessonCode)}
        alt={caption ?? label ?? '圖'}
        caption={caption ?? undefined}
        index={index}
        figureLabel={label ?? undefined}
      />
    );
  }
  return (
    <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4 text-base text-on-surface-variant text-center">
      {label ? `${label}（圖片）` : '圖表參考'}
      {asset ? <span className="block text-xs mt-1 opacity-60">{asset}</span> : null}
    </div>
  );
};

export default FigureBlockView;
