import React from 'react';
import ZoomableImage from '../ui/ZoomableImage';

interface GraphicTextImageStripProps {
  images: { filename: string; caption?: string }[];
  lessonCode?: string;
}

const GCS_IMAGE_BASE = 'https://storage.googleapis.com/lingoleap-assets/lessons-images';

const deriveLessonCode = (filename: string): string => {
  const parts = filename.split('/');
  if (parts.length >= 3 && parts[0] === 'images') {
    return parts[1];
  }
  if (parts.length >= 2) {
    return parts[parts.length - 2];
  }
  return filename.match(/^([A-Z]\d+-L\d+)/)?.[1] ?? '';
};

const GraphicTextImageStrip: React.FC<GraphicTextImageStripProps> = ({ images, lessonCode }) => {
  return (
    <div
      data-testid="graphic-text-image-pane"
      className="bg-surface-container-lowest rounded-3xl shadow-editorial p-4 md:p-5 flex flex-col w-full min-h-0 flex-[2]"
    >
      <div className="flex items-center gap-2 mb-3 shrink-0">
        <span className="material-symbols-outlined text-accent text-lg">photo_library</span>
        <span className="font-headline font-bold text-on-surface text-xs uppercase tracking-wider">
          圖文對照
        </span>
        <span className="text-xs text-on-surface-variant ml-2">{images.length} 張</span>
        <span className="text-[11px] text-on-surface-variant ml-auto hidden md:inline">點圖可放大</span>
      </div>
      {images.length === 0 ? (
        <div className="flex-1 min-h-0 flex items-center justify-center text-on-surface-variant text-sm">
          暫無圖片
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-x-auto custom-scrollbar">
          <div className="flex gap-3 h-full pr-2">
            {images.map((img, idx) => {
              const basename = img.filename.split('/').pop() ?? img.filename;
              const resolvedLessonCode = lessonCode || deriveLessonCode(img.filename);

              return (
                <figure
                  key={img.filename}
                  className="flex flex-col items-stretch shrink-0 h-full"
                  style={{ width: 'clamp(180px, 22vw, 260px)' }}
                >
                  <div className="flex-1 min-h-0">
                    <ZoomableImage
                      src={`${GCS_IMAGE_BASE}/${resolvedLessonCode}/${basename}`}
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
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default GraphicTextImageStrip;
