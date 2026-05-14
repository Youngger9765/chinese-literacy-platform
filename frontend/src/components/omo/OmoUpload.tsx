/**
 * OmoUpload — Phase 1 paper worksheet upload UI.
 *
 * Renders a single-page upload experience:
 *  - "拍照" button (camera capture on mobile: capture="environment")
 *  - "選擇圖片" button (file picker from gallery/disk)
 *  - Upload progress spinner
 *  - Error display
 *
 * After upload returns 201 the parent routes to OmoIdentifyResult with the upload_id.
 * Max 5 images, 10MB each — validated client-side for UX (backend re-validates).
 */
import React, { useRef, useState } from 'react';
import { uploadOmoImages } from '../../services/omoApi';

const MAX_FILES = 5;
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
const ACCEPTED_MIME = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

interface OmoUploadProps {
  token: string;
  /** Called once upload succeeds, with the new upload_id.
   *  Phase 1b: opts contains alreadyGraded + cachedScore for dedup cache hits.
   */
  onUploaded: (
    uploadId: number,
    opts?: { alreadyGraded?: boolean; cachedScore?: number | null },
  ) => void;
}

const OmoUpload: React.FC<OmoUploadProps> = ({ token, onUploaded }) => {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = async (files: FileList | null) => {
    setError(null);
    if (!files || files.length === 0) return;

    const fileArray = Array.from(files);

    // Client-side validation (backend also validates)
    if (fileArray.length > MAX_FILES) {
      setError(`最多只能上傳 ${MAX_FILES} 張圖片`);
      return;
    }
    for (const f of fileArray) {
      if (!ACCEPTED_MIME.includes(f.type)) {
        setError(`不支援的檔案格式：${f.name}（請使用 JPG、PNG 或 WebP）`);
        return;
      }
      if (f.size > MAX_FILE_BYTES) {
        setError(`圖片太大：${f.name}（每張最多 10 MB）`);
        return;
      }
    }

    // Show a local preview for the first file
    const reader = new FileReader();
    reader.onload = (e) => setPreview(e.target?.result as string);
    reader.readAsDataURL(fileArray[0]);

    setUploading(true);
    try {
      const result = await uploadOmoImages(fileArray, token);
      onUploaded(result.upload_id, {
        alreadyGraded: result.already_graded ?? false,
        cachedScore: result.overall_score ?? null,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '上傳失敗，請再試一次';
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

      {/* Upload spinner */}
      {uploading && (
        <div className="flex flex-col items-center gap-3 py-4">
          <div
            className="w-12 h-12 rounded-full border-4 border-blue-200 border-t-blue-600 animate-spin"
            aria-label="上傳中"
            role="status"
          />
          <p className="text-sm text-gray-500">上傳中，請稍候…</p>
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

      {/* Error */}
      {error && (
        <div
          role="alert"
          className="w-full flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3"
        >
          <span aria-hidden="true" className="shrink-0 text-red-500">⚠️</span>
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      <p className="text-xs text-gray-400 text-center">
        支援 JPG、PNG、WebP，每張最多 10 MB，最多 {MAX_FILES} 張
      </p>
    </div>
  );
};

export default OmoUpload;
