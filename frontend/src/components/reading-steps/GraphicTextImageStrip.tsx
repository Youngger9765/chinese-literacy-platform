import React from 'react';
import ZoomableImage from '../ui/ZoomableImage';

interface GraphicTextImageStripProps {
  images: { filename: string; caption?: string }[];
  /**
   * Lesson code (e.g. 'G7-L28') used to build GCS image URL.
   * Optional — falls back to the first path segment of `images[0].filename`
   * (e.g. 'images/G7-L28/G7-L28-08.jpg' → 'G7-L28') when not supplied.
   * Many lessons have `story.lesson_code === undefined` but `images[i].filename`
   * always carries the lesson directory, so the fallback is reliable (#1681).
   */
  lessonCode?: string;
}

const GCS_IMAGE_BASE = 'https://storage.googleapis.com/lingoleap-assets/lessons-images';

/** Derive lesson code from an image filename like `images/G7-L28/G7-L28-08.jpg`. */
function deriveLessonCodeFromFilename(filename: string): string {
  const parts = filename.split('/').filter(Boolean);
  // Skip leading 'images/' prefix when present.
  if (parts.length >= 2 && parts[0] === 'images') return parts[1];
  if (parts.length >= 2) return parts[parts.length - 2];
  return '';
}

const GraphicTextImageStrip: React.FC<GraphicTextImageStripProps> = ({ images, lessonCode }) => {
  const resolvedLessonCode =
    lessonCode || (images[0] ? deriveLessonCodeFromFilename(images[0].filename) : '');
  return (
    <div
      data-testid="graphic-text-image-pane"
      className="bg-surface-container-lowest rounded-3xl shadow-editorial p-4 md:p-5 flex flex-col w-full min-h-0 flex-[2]"
    >
      {/* #1706: header removed — collapsible parent shows icon/title/count. */}
      <div className="text-[11px] text-on-surface-variant text-right mb-2 shrink-0 hidden md:block">點圖可放大</div>
      {images.length === 0 ? (
        <div className="flex-1 min-h-0 flex items-center justify-center text-on-surface-variant text-sm">
          暫無圖片
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-x-auto custom-scrollbar">
          <div className="flex gap-3 h-full pr-2">
            {images.map((img, idx) => (
              <figure
                key={idx}
                className="flex flex-col items-stretch shrink-0 h-full"
                style={{ width: 'clamp(180px, 22vw, 260px)' }}
              >
                <div className="flex-1 min-h-0">
                  <ZoomableImage
                    src={`${GCS_IMAGE_BASE}/${resolvedLessonCode}/${img.filename.split('/').pop()}`}
                    alt={img.caption ?? `圖 ${idx + 1}`}
                    caption={img.caption}
                    className="h-full"
                  />
                </div>
                {img.caption && (
                  <figcaption className="text-[11px] text-on-surface-variant mt-1.5 line-clamp-2 shrink-0">
                    {img.caption}
                  </figcaption>
                )}
              </figure>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default GraphicTextImageStrip;
