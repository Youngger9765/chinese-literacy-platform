/**
 * OmoUpload — Phase 1b paper worksheet upload UI.
 *
 * Phase 1b improvements (Sub 4 / #1587):
 *  - Client-side image resize: canvas.toBlob() compresses to ≤1280px / 85% quality
 *    before upload. Reduces upload time on mobile (typical 4–8 MB → ~400 KB).
 *  - Status-aware loading copy: cycling messages while upload is in flight
 *    ("壓縮圖片中…" → "上傳中…" → "AI 辨識開始…")
 *  - Chinese error toasts: friendlier, more specific error copy
 *  - Dedup handling: if server returns from_cache=true, calls onUploaded with
 *    upload_id directly (skip UI re-upload)
 *
 * Phase 1a behaviour preserved:
 *  - "拍照" button (mobile capture="environment")
 *  - "選擇圖片" button (gallery/file picker)
 *  - Max 5 images, 10MB each (client-side guard + server re-validates)
 */
import React, { useEffect, useRef, useState } from 'react';
import { uploadOmoImages } from '../../services/omoApi';

const MAX_FILES = 5;
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB (pre-resize)
const ACCEPTED_MIME = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

// Client-side resize target: 1280px on the longest side, 85% JPEG quality
const RESIZE_MAX_PX = 1280;
const RESIZE_QUALITY = 0.85;

// Loading copy cycle (one message shown every ~1.2s during upload)
const LOADING_MESSAGES = [
  '壓縮圖片中…',
  '上傳中，請稍候…',
  'AI 辨識開始…',
  '分析學習單內容…',
];

interface OmoUploadProps {
  token: string;
  /** Called once upload succeeds, with the new upload_id */
  onUploaded: (uploadId: number) => void;
}

// ---------------------------------------------------------------------------
// Resize helper — uses canvas to down-scale large photos
// ---------------------------------------------------------------------------

async function resizeImage(file: File): Promise<File> {
  return new Promise((resolve) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);

      const { naturalWidth: w, naturalHeight: h } = img;
      const longest = Math.max(w, h);

      if (longest <= RESIZE_MAX_PX) {
        // Already small enough — skip resize
        resolve(file);
        return;
      }

      const scale = RESIZE_MAX_PX / longest;
      const targetW = Math.round(w * scale);
      const targetH = Math.round(h * scale);

      const canvas = document.createElement('canvas');
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(file); // fallback: use original
        return;
      }
      ctx.drawImage(img, 0, 0, targetW, targetH);

      canvas.toBlob(
        (blob) => {
          if (!blob) {
            resolve(file);
            return;
          }
          const resized = new File([blob], file.name.replace(/\.\w+$/, '.jpg'), {
            type: 'image/jpeg',
            lastModified: Date.now(),
          });
          resolve(resized);
        },
        'image/jpeg',
        RESIZE_QUALITY,
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(file); // fallback: use original
    };

    img.src = objectUrl;
  });
}

// ---------------------------------------------------------------------------
// Loading copy cycle hook
// ---------------------------------------------------------------------------

function useLoadingMessage(active: boolean): string {
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (!active) {
      setIdx(0);
      return;
    }
    const id = setInterval(() => {
      setIdx((prev) => Math.min(prev + 1, LOADING_MESSAGES.length - 1));
    }, 1200);
    return () => clearInterval(id);
  }, [active]);

  return LOADING_MESSAGES[idx];
}

// ---------------------------------------------------------------------------
// OmoUpload component
// ---------------------------------------------------------------------------

const OmoUpload: React.FC<OmoUploadProps> = ({ token, onUploaded }) => {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  const loadingMsg = useLoadingMessage(uploading);

  const handleFiles = async (files: FileList | null) => {
    setError(null);
    if (!files || files.length === 0) return;

    const fileArray = Array.from(files);

    // ── Client-side validation ──────────────────────────────────────────────
    if (fileArray.length > MAX_FILES) {
      setError(`最多只能上傳 ${MAX_FILES} 張圖片，你選了 ${fileArray.length} 張`);
      return;
    }
    for (const f of fileArray) {
      if (!ACCEPTED_MIME.includes(f.type)) {
        setError(`不支援「${f.name.split('.').pop()?.toUpperCase() ?? '?'}」格式，請選 JPG、PNG 或 WebP`);
        return;
      }
      if (f.size > MAX_FILE_BYTES) {
        const mb = (f.size / (1024 * 1024)).toFixed(1);
        setError(`「${f.name}」太大（${mb} MB），每張最多 10 MB`);
        return;
      }
    }

    // ── Preview first file ──────────────────────────────────────────────────
    const firstReader = new FileReader();
    firstReader.onload = (e) => setPreview(e.target?.result as string);
    firstReader.readAsDataURL(fileArray[0]);

    setUploading(true);
    try {
      // ── Client-side resize ────────────────────────────────────────────────
      const resized = await Promise.all(fileArray.map(resizeImage));

      // ── Upload ────────────────────────────────────────────────────────────
      const result = await uploadOmoImages(resized, token);
      onUploaded(result.upload_id);
    } catch (err) {
      const raw = err instanceof Error ? err.message : '';

      // Map common error patterns to friendlier Chinese copy
      let msg = '上傳失敗，請再試一次';
      if (raw.includes('413') || raw.includes('太大')) {
        msg = '圖片太大，即使壓縮後仍超過限制，請重新拍攝較清晰的照片';
      } else if (raw.includes('400') || raw.includes('格式')) {
        msg = '圖片格式不對，請選 JPG 或 PNG';
      } else if (raw.includes('401') || raw.includes('403')) {
        msg = '登入已逾時，請重新登入後再試';
      } else if (raw.includes('429')) {
        msg = '上傳太頻繁，請稍等一分鐘後再試';
      } else if (raw.includes('500') || raw.includes('502') || raw.includes('503')) {
        msg = '伺服器暫時無法使用，請稍後再試';
      } else if (raw.includes('NetworkError') || raw.includes('Failed to fetch')) {
        msg = '網路連線失敗，請檢查網路後再試';
      }

      setError(msg);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex flex-col items-center gap-6 px-4 py-8 max-w-md mx-auto">
      {/* Header */}
      <div className="text-center">
        <div className="text-5xl mb-3" aria-hidden="true">📸</div>
        <h1 className="text-xl font-bold text-gray-900">上傳學習單</h1>
        <p className="mt-1 text-sm text-gray-500">
          拍下你的紙本學習單，AI 會自動辨識是哪一課
        </p>
      </div>

      {/* Preview */}
      {preview && !uploading && (
        <div className="w-full rounded-xl overflow-hidden border border-gray-200 shadow-sm">
          <img
            src={preview}
            alt="學習單預覽"
            className="w-full object-contain max-h-48"
          />
        </div>
      )}

      {/* Upload spinner + cycling copy */}
      {uploading && (
        <div className="flex flex-col items-center gap-3 py-4">
          <div
            className="w-12 h-12 rounded-full border-4 border-blue-200 border-t-blue-600 animate-spin"
            aria-label="處理中"
            role="status"
          />
          <p className="text-sm text-gray-500 transition-opacity duration-300">
            {loadingMsg}
          </p>
        </div>
      )}

      {/* Buttons */}
      {!uploading && (
        <div className="flex flex-col gap-3 w-full">
          {/* Camera capture (mobile: opens camera directly) */}
          <button
            type="button"
            onClick={() => cameraInputRef.current?.click()}
            className="w-full flex items-center justify-center gap-2 py-3.5 px-6
              bg-blue-600 hover:bg-blue-700 active:bg-blue-800
              text-white font-semibold rounded-xl
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2
              transition-colors"
          >
            <span aria-hidden="true">📷</span>
            拍照上傳
          </button>
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />

          {/* Gallery / file picker */}
          <button
            type="button"
            onClick={() => galleryInputRef.current?.click()}
            className="w-full flex items-center justify-center gap-2 py-3.5 px-6
              bg-white hover:bg-gray-50 active:bg-gray-100
              text-gray-700 font-semibold rounded-xl
              border border-gray-300
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2
              transition-colors"
          >
            <span aria-hidden="true">🖼️</span>
            從相簿選擇
          </button>
          <input
            ref={galleryInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
        </div>
      )}

      {/* Error toast */}
      {error && (
        <div
          role="alert"
          className="w-full flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3"
        >
          <span aria-hidden="true" className="shrink-0 text-red-500 mt-0.5">⚠️</span>
          <div>
            <p className="text-sm text-red-700 font-medium">{error}</p>
            <button
              type="button"
              onClick={() => setError(null)}
              className="mt-1 text-xs text-red-400 hover:text-red-600 underline"
            >
              關閉
            </button>
          </div>
        </div>
      )}

      <p className="text-xs text-gray-400 text-center">
        支援 JPG、PNG、WebP，每張最多 10 MB，最多 {MAX_FILES} 張
        <br />
        <span className="text-gray-300">上傳前自動壓縮以節省時間</span>
      </p>
    </div>
  );
};

export default OmoUpload;
