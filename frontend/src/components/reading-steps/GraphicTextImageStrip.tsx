/**
 * GraphicTextImageStrip — 圖文並陳圖片欄 (B1 redesign, issue #2085)
 *
 * Before (#1697): horizontal scroll strip, clamp(180px,22vw,260px) tiles,
 *   click opens fullscreen modal that covers the lesson text.
 *
 * After (B1):
 * - Vertical image gallery: each figure fills pane width (not a tiny tile).
 * - 中文序號 badges (圖一/圖二/…) positioned top-left of each figure.
 * - Enlarged captions (text-sm, no line-clamp).
 * - In-pane zoom: +/– controls scale the image within its container.
 *   NO fullscreen modal — text pane is never occluded.
 *
 * Layout context (ComprehensionLayout):
 *   Desktop (>=1024px): rendered in the left split pane (50% width) — image
 *   fills that pane width naturally, both text and images visible simultaneously.
 *   Portrait/tablet (<1024px): rendered above the text/exercise in a stacked
 *   layout, height capped ~40vh.
 *
 * The component is scroll-container-agnostic: its parent sets the height/
 * overflow-y; this component fills 100% of that space.
 */
import React, { useState } from 'react';

interface GraphicTextImageStripProps {
  images: { filename: string; caption?: string; figure_label?: string }[];
  /**
   * Lesson code (e.g. 'G7-L28') used to build GCS image URL.
   * Optional — falls back to the first path segment of `images[0].filename`
   * (e.g. 'images/G7-L28/G7-L28-08.jpg' -> 'G7-L28') when not supplied.
   * Many lessons have `story.lesson_code === undefined` but `images[i].filename`
   * always carries the lesson directory, so the fallback is reliable (#1681).
   */
  lessonCode?: string;
}

const GCS_IMAGE_BASE = 'https://storage.googleapis.com/lingoleap-assets/lessons-images';

/** Chinese numeral labels (1-based) for figure badges */
const CHINESE_NUMERALS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
export function chineseNumeral(n: number): string {
  return n <= CHINESE_NUMERALS.length ? CHINESE_NUMERALS[n - 1] : String(n);
}

export const GCS_IMAGE_BASE_URL = GCS_IMAGE_BASE;
export { deriveLessonCodeFromFilename };

/** Build the GCS URL for an image filename under a lesson directory. */
export function buildImageSrc(filename: string, lessonCode: string): string {
  const basename = filename.split('/').pop() ?? filename;
  return `${GCS_IMAGE_BASE}/${lessonCode}/${basename}`;
}

/** Derive lesson code from an image filename like `images/G7-L28/G7-L28-08.jpg`. */
function deriveLessonCodeFromFilename(filename: string): string {
  const parts = filename.split('/').filter(Boolean);
  // Skip leading 'images/' prefix when present.
  if (parts.length >= 2 && parts[0] === 'images') return parts[1];
  if (parts.length >= 2) return parts[parts.length - 2];
  return '';
}

/** Per-figure in-pane zoom controls (no fullscreen modal). */
const ZOOM_MIN = 1;
const ZOOM_MAX = 3;
const ZOOM_STEP = 0.5;

interface FigureCardProps {
  src: string;
  alt: string;
  caption?: string;
  index: number; // 0-based — fallback only when figureLabel absent
  /**
   * The REAL figure label from `image.figure_label` (e.g. '圖一'), #2085.
   * Array index is NOT figure order, so prefer this. Falls back to the
   * index-derived numeral only when no label is supplied.
   */
  figureLabel?: string;
}

export const FigureCard: React.FC<FigureCardProps> = ({ src, alt, caption, index, figureLabel: figureLabelProp }) => {
  const [scale, setScale] = useState(1);
  const [imgError, setImgError] = useState(false);

  const zoomIn = () => setScale((s) => Math.min(s + ZOOM_STEP, ZOOM_MAX));
  const zoomOut = () => setScale((s) => Math.max(s - ZOOM_STEP, ZOOM_MIN));
  const resetZoom = () => setScale(1);

  const figureLabel = figureLabelProp || `圖${chineseNumeral(index + 1)}`;

  return (
    <figure className="flex flex-col w-full mb-5 last:mb-0">
      {/* Image container — overflow:auto so zoomed content is scrollable within pane */}
      <div className="relative w-full overflow-hidden rounded-xl border border-outline-variant bg-surface-container-low">
        {/* 圖一/圖二/… badge — top-left, always visible */}
        <span className="absolute top-2 left-2 z-10 inline-flex items-center px-2 py-0.5 rounded-md bg-on-surface/70 text-white text-xs font-bold tracking-wide select-none pointer-events-none">
          {figureLabel}
        </span>

        {/* In-pane zoom controls — top-right; hidden when image failed */}
        {!imgError && (
          <div className="absolute top-2 right-2 z-10 flex items-center gap-1">
            <button
              type="button"
              onClick={zoomOut}
              disabled={scale <= ZOOM_MIN}
              aria-label="縮小"
              className="w-7 h-7 rounded-full bg-on-surface/60 hover:bg-on-surface/80 text-white flex items-center justify-center transition-colors disabled:opacity-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <span className="material-symbols-outlined text-base leading-none">remove</span>
            </button>
            {scale !== 1 && (
              <button
                type="button"
                onClick={resetZoom}
                aria-label="還原縮放"
                className="px-1.5 h-7 rounded-full bg-on-surface/60 hover:bg-on-surface/80 text-white text-[11px] font-bold flex items-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                {Math.round(scale * 100)}%
              </button>
            )}
            <button
              type="button"
              onClick={zoomIn}
              disabled={scale >= ZOOM_MAX}
              aria-label="放大"
              className="w-7 h-7 rounded-full bg-on-surface/60 hover:bg-on-surface/80 text-white flex items-center justify-center transition-colors disabled:opacity-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <span className="material-symbols-outlined text-base leading-none">add</span>
            </button>
          </div>
        )}

        {imgError ? (
          <div className="w-full h-40 flex flex-col items-center justify-center gap-1 text-on-surface-variant/50">
            <span className="material-symbols-outlined text-3xl">broken_image</span>
            <span className="text-xs">圖片載入失敗</span>
          </div>
        ) : (
          /**
           * Scrollable inner div: when scale > 1 the image overflows the container
           * and this div allows the user to pan by scrolling/touch-drag.
           * transform-origin: top left ensures the badge stays anchored.
           */
          <div
            className="w-full overflow-auto"
            style={{ cursor: scale > 1 ? 'grab' : 'default' }}
          >
            <img
              src={src}
              alt={alt}
              loading="lazy"
              onError={() => setImgError(true)}
              style={{
                display: 'block',
                width: '100%',
                transform: `scale(${scale})`,
                transformOrigin: 'top left',
                /**
                 * When scaled, we shrink the CSS width so the scaled
                 * rendered size equals the container width at scale 1.
                 * This avoids the image overflowing to the right before
                 * the overflow-auto div can scroll.
                 */
                ...(scale > 1 ? { width: `${(100 / scale).toFixed(1)}%` } : {}),
                transition: 'transform 0.15s ease',
              }}
            />
          </div>
        )}
      </div>

      {/* Caption — enlarged to text-sm, no line-clamp */}
      {caption ? (
        <figcaption className="mt-2 text-sm text-on-surface-variant leading-relaxed px-1">
          <span className="font-semibold text-on-surface">{figureLabel}：</span>
          {caption}
        </figcaption>
      ) : (
        <figcaption className="mt-1.5 text-sm text-on-surface-variant/60 px-1">
          {figureLabel}
        </figcaption>
      )}
    </figure>
  );
};

const GraphicTextImageStrip: React.FC<GraphicTextImageStripProps> = ({ images, lessonCode }) => {
  const resolvedLessonCode =
    lessonCode || (images[0] ? deriveLessonCodeFromFilename(images[0].filename) : '');

  return (
    <div
      data-testid="graphic-text-image-pane"
      className="w-full h-full flex flex-col min-h-0"
    >
      {images.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-on-surface-variant text-sm">
          暫無圖片
        </div>
      ) : (
        /* Scrollable vertical gallery — parent controls the height boundary */
        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar pr-1">
          {images.map((img, idx) => {
            const basename = img.filename.split('/').pop() ?? img.filename;
            const src = `${GCS_IMAGE_BASE}/${resolvedLessonCode}/${basename}`;
            return (
              <FigureCard
                key={idx}
                src={src}
                alt={img.caption ?? img.figure_label ?? `圖 ${idx + 1}`}
                caption={img.caption}
                index={idx}
                figureLabel={img.figure_label}
              />
            );
          })}
        </div>
      )}
    </div>
  );
};

export default GraphicTextImageStrip;
