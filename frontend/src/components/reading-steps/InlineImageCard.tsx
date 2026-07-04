/**
 * InlineImageCard — render a single image inline after its caption paragraph.
 *
 * Used by ReadingAnnotation + ComprehensionLayout when a paragraph is detected
 * as a `圖 N` caption row. Mirrors GraphicTextImageStrip's visual styling
 * (rounded card, shadow-editorial) so inline figures look consistent with the
 * fallback strip rendered at the end of the article.
 *
 * Click-to-zoom is handled by ZoomableImage (same modal as GraphicTextImageStrip).
 */
import React from 'react';
import ZoomableImage from '../ui/ZoomableImage';
import { ASSET_BASE } from '../../config/assetBase';

// Same-origin asset proxy (#2486) — lingoleap-assets is now a private GCS bucket.
const GCS_IMAGE_BASE = `${ASSET_BASE}/lessons-images`;

interface InlineImageCardProps {
  image: { filename: string; caption?: string };
  lessonCode?: string;
  /** Optional fallback alt-text label (e.g. `圖 1`). */
  fallbackLabel?: string;
}

/** Derive lesson code from `images/G7-L28/G7-L28-08.jpg` style filename. */
function deriveLessonCodeFromFilename(filename: string): string {
  const parts = filename.split('/').filter(Boolean);
  if (parts.length >= 2 && parts[0] === 'images') return parts[1];
  if (parts.length >= 2) return parts[parts.length - 2];
  return '';
}

const InlineImageCard: React.FC<InlineImageCardProps> = ({ image, lessonCode, fallbackLabel }) => {
  const resolvedLessonCode = lessonCode || deriveLessonCodeFromFilename(image.filename);
  const src = `${GCS_IMAGE_BASE}/${resolvedLessonCode}/${image.filename.split('/').pop()}`;
  return (
    <div
      data-testid="inline-image-card"
      className="bg-surface-container-lowest rounded-2xl shadow-editorial p-3 md:p-4 max-w-2xl mx-auto"
      style={{ WebkitUserSelect: 'none', userSelect: 'none' } as React.CSSProperties}
    >
      <div className="w-full h-64 md:h-80">
        <ZoomableImage
          src={src}
          alt={image.caption ?? fallbackLabel ?? '圖片'}
          caption={image.caption}
          className="h-full"
        />
      </div>
      {image.caption && (
        <p className="text-xs text-on-surface-variant mt-2 text-center">{image.caption}</p>
      )}
    </div>
  );
};

export default InlineImageCard;
