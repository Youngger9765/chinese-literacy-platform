/**
 * GraphicTextLayout — 圖文整合左右雙欄 layout (Day 1 shell).
 *
 * Day 1 scope:
 * - Left pane: lesson paragraphs (independent scroll)
 * - Right pane: grid of image placeholders (independent scroll)
 *   Images are rendered as <img> tags using the GCS URL pattern.
 *   No ImageStrip / ImageViewer / zoom yet (Day 3-4).
 *
 * Related to #1341
 */
import React from 'react';
import { Story } from '../../../types';

/** GCS image base URL pattern (Day 2 will verify actual serving) */
const GCS_IMAGE_BASE = 'https://storage.googleapis.com/lingoleap-assets/lessons-images';

interface GraphicTextLayoutProps {
  story: Story;
}

const GraphicTextLayout: React.FC<GraphicTextLayoutProps> = ({ story }) => {
  const images = story.images ?? [];

  return (
    <div
      data-testid="graphic-text-layout"
      className="grid grid-cols-1 lg:grid-cols-2 h-full gap-0"
    >
      {/* Left pane: lesson text */}
      <div className="overflow-y-auto border-r border-outline-variant p-4 lg:p-6">
        <div className="space-y-4">
          {(story.paragraphs ?? story.content ?? []).map((para, idx) => (
            <p
              key={idx}
              data-paragraph-index={idx}
              className="text-on-surface leading-relaxed text-base"
            >
              {para}
            </p>
          ))}
        </div>
      </div>

      {/* Right pane: image gallery placeholder */}
      <div className="overflow-y-auto p-4 lg:p-6 bg-surface-container">
        {images.length === 0 ? (
          <div className="flex items-center justify-center h-48 text-on-surface-variant text-sm">
            暫無圖片
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {images.map((img, idx) => {
              // Build URL: GCS base / lesson_code / filename (strip "images/G7-LXX/" prefix if present)
              const rawFilename = img.filename ?? '';
              // filename in YAML is like "images/G7-L28/G7-L28-01.png"
              // We need to convert to GCS key: lingoleap-assets/lessons-images/G7-L28/G7-L28-01.png
              const parts = rawFilename.split('/');
              const lessonCode = story.lesson_code ?? (parts.length >= 2 ? parts[1] : '');
              const basename = parts[parts.length - 1];
              const imgUrl = `${GCS_IMAGE_BASE}/${lessonCode}/${basename}`;

              return (
                <div
                  key={idx}
                  className="rounded-lg overflow-hidden bg-surface-container-high border border-outline-variant"
                >
                  <img
                    src={imgUrl}
                    alt={img.caption || `圖 ${idx + 1}`}
                    loading="lazy"
                    className="w-full object-contain"
                    onError={(e) => {
                      // Fallback: grey placeholder on load error
                      const target = e.currentTarget;
                      target.style.display = 'none';
                      const fallback = target.nextElementSibling as HTMLElement | null;
                      if (fallback) fallback.style.display = 'flex';
                    }}
                  />
                  {/* Fallback placeholder (hidden until img error) */}
                  <div
                    className="hidden items-center justify-center h-24 text-xs text-on-surface-variant"
                    aria-hidden="true"
                  >
                    圖 {idx + 1}
                  </div>
                  {img.caption && (
                    <p className="text-xs text-on-surface-variant px-2 py-1">{img.caption}</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default GraphicTextLayout;
