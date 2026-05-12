/**
 * ZoomableImage — thumbnail that opens a fullscreen modal on click.
 *
 * Used by graphic-text comprehension layouts (#1504) so cramped image
 * thumbnails stay viewable while answering on the right, then can be
 * inspected at full size on demand.
 *
 * Esc + backdrop click close the modal. Body scroll is locked while open.
 */
import React, { useEffect, useRef, useState } from 'react';
import { useFocusTrap } from '../../hooks/useFocusTrap';

interface ZoomableImageProps {
  src: string;
  alt: string;
  caption?: string;
  className?: string;
}

const ZoomableImage: React.FC<ZoomableImageProps> = ({ src, alt, caption, className }) => {
  const [open, setOpen] = useState(false);
  const [imgError, setImgError] = useState(false);

  // WAI-ARIA Dialog focus management — trap Tab inside modal, restore focus on close.
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, open);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => { if (!imgError) setOpen(true); }}
        disabled={imgError}
        className={`group relative block w-full overflow-hidden rounded-lg border border-outline-variant bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed ${className ?? ''}`}
        aria-label={imgError ? `${alt}（圖片載入失敗）` : `放大圖片：${alt}`}
      >
        {imgError ? (
          <div className="w-full h-full min-h-[80px] flex flex-col items-center justify-center gap-1 text-on-surface-variant/50">
            <span className="material-symbols-outlined text-3xl">broken_image</span>
            <span className="text-[10px]">圖片載入失敗</span>
          </div>
        ) : (
          <>
            <img
              src={src}
              alt={alt}
              loading="lazy"
              className="w-full h-full object-contain transition-transform duration-200 group-hover:scale-[1.02]"
              onError={() => setImgError(true)}
            />
            <span className="pointer-events-none absolute top-1.5 right-1.5 inline-flex items-center justify-center w-7 h-7 rounded-full bg-on-surface/60 text-white opacity-0 group-hover:opacity-100 transition-opacity">
              <span className="material-symbols-outlined text-base">zoom_in</span>
            </span>
          </>
        )}
      </button>

      {open && (
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label={alt}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 md:p-8 animate-fade-in"
          onClick={() => setOpen(false)}
        >
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setOpen(false); }}
            className="absolute top-4 right-4 w-11 h-11 rounded-full bg-white/15 hover:bg-white/25 text-white flex items-center justify-center transition-colors"
            aria-label="關閉"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
          <figure
            className="max-w-6xl w-full max-h-full flex flex-col items-center gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={src}
              alt={alt}
              className="max-h-[80vh] w-auto max-w-full object-contain rounded-lg shadow-2xl"
            />
            {caption && (
              <figcaption className="text-sm text-white/90 text-center max-w-3xl">
                {caption}
              </figcaption>
            )}
          </figure>
        </div>
      )}
    </>
  );
};

export default ZoomableImage;
