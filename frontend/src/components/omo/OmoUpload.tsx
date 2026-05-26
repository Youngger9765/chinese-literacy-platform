/**
 * OmoUpload — paper worksheet upload UI.
 *
 * Issue #1974 (multi-page UX rewrite):
 *  - Encourage students to upload ALL pages of the worksheet (not just the first).
 *    Cross-page big questions used to be silently truncated when students only
 *    uploaded page 1.
 *  - Stages files in a queue (no immediate upload). User reviews thumbnails,
 *    can reorder (↑/↓), remove (✕), and add more pages before confirming.
 *  - Final 「上傳批改」 CTA shows page count + order summary.
 *
 * Integrated from staging during rebase:
 *  - Issue #1976: PDF upload supported (server-side pypdfium2 splits to pages).
 *    PDFs skip client-side resize and show a 📄 stub instead of a thumbnail.
 *    Per-MIME size cap: 10 MB image / 20 MB PDF.
 *  - Issue #1975: optional `onShowHistory` callback renders a「查看批改記錄」
 *    button in the initial CTA section.
 *
 * Phase 1b behaviour preserved:
 *  - Client-side resize (canvas.toBlob() ≤1280px / 85% quality) per image
 *  - "拍照" capture + "選擇圖片/PDF" file picker
 *  - Status-aware loading copy
 *  - Chinese error toasts
 *  - from_cache shortcut (server skips Gemini if SHA-256 hash hits)
 *  - lessonCodeHint forwarded to backend (Issue #1637)
 */
import React, { useEffect, useRef, useState } from 'react';
import { uploadOmoImages } from '../../services/omoApi';
import OmoUploadPagePreview from './OmoUploadPagePreview';

const MAX_FILES = 5;
const MAX_FILE_BYTES = 10 * 1024 * 1024;     // 10 MB per image (pre-resize)
const MAX_PDF_BYTES = 20 * 1024 * 1024;      // 20 MB per PDF (backend splits server-side)
const PDF_MIME = 'application/pdf';
const IMAGE_MIME = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const ACCEPTED_MIME = [...IMAGE_MIME, PDF_MIME];

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
  /**
   * Issue #1637: optional lesson code hint (e.g. "G5-L25") passed when the
   * student uploads from within a lesson reading page.  Forwarded to the
   * backend so it can skip Gemini fuzzy-match (faster + cheaper).
   */
  lessonCodeHint?: string;
  /**
   * Issue #1975: optional callback to view OMO batch grading history. When
   * provided, an extra「📋 查看批改記錄」button is rendered alongside the
   * initial camera + gallery CTAs. Parent owns the navigation target so this
   * component stays framework-agnostic.
   */
  onShowHistory?: () => void;
}

interface StagedPage {
  /** Stable id used as React key — survives reorders without remount/reflow. */
  id: number;
  file: File;
  /**
   * Object URL for image thumbnails. ``null`` for PDFs since `<img>` can't
   * render them — the page preview falls back to a 📄 icon stub.
   * Image URLs must be URL.revokeObjectURL'd when the page is removed.
   */
  previewUrl: string | null;
  isPdf: boolean;
}

// ---------------------------------------------------------------------------
// Resize helper — uses canvas to down-scale large photos
// ---------------------------------------------------------------------------

async function resizeImage(file: File): Promise<File> {
  // #1976: canvas / <img> can't render PDF — pass it through untouched and
  // let the backend's pypdfium2 render at server resolution.
  if (file.type === PDF_MIME) {
    return file;
  }
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

// Module-level counter for stable React keys across reorders. Resets per page
// load, which is fine since staged pages live within one OmoUpload mount.
let _stagedIdCounter = 0;
const nextStagedId = () => ++_stagedIdCounter;

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

const OmoUpload: React.FC<OmoUploadProps> = ({
  token,
  onUploaded,
  lessonCodeHint,
  onShowHistory,
}) => {
  const [staged, setStaged] = useState<StagedPage[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  // #1974 review-3: mirror `staged` into a ref so the unmount cleanup effect
  // (deps=[]) can see the LATEST queue instead of the empty mount-time value
  // captured by closure.
  const stagedRef = useRef<StagedPage[]>(staged);
  stagedRef.current = staged;

  const loadingMsg = useLoadingMessage(uploading);

  const hasStaged = staged.length > 0;
  const canAddMore = staged.length < MAX_FILES;

  // ── Revoke a page's object URL on remove/clear/unmount to avoid leaks ───
  const revokePageUrl = (page: StagedPage) => {
    if (!page.previewUrl) return;  // PDFs have no object URL to revoke
    try {
      URL.revokeObjectURL(page.previewUrl);
    } catch {
      // No-op: revoke is best-effort.
    }
  };

  // ── Add files to the queue (called by both camera + gallery inputs) ──────
  const handleAddFiles = (files: FileList | null) => {
    setError(null);
    if (!files || files.length === 0) return;

    const incoming = Array.from(files);
    const remaining = MAX_FILES - staged.length;

    if (remaining <= 0) {
      setError(`已達 ${MAX_FILES} 個檔案上限，請先移除一個`);
      return;
    }

    // #1974 review-2: when user picks more than the remaining slots, take the
    // first N and tell them — friendlier than rejecting the whole batch and
    // making them re-pick. Validation errors (size/MIME) still abort.
    const truncated = incoming.length > remaining;
    const accepted = truncated ? incoming.slice(0, remaining) : incoming;

    for (const f of accepted) {
      if (!ACCEPTED_MIME.includes(f.type)) {
        setError(`不支援「${f.name.split('.').pop()?.toUpperCase() ?? '?'}」格式，請選 JPG、PNG、WebP 或 PDF`);
        return;
      }
      // #1976: per-MIME size cap — images 10 MB, PDFs 20 MB.
      const isPdf = f.type === PDF_MIME;
      const cap = isPdf ? MAX_PDF_BYTES : MAX_FILE_BYTES;
      if (f.size > cap) {
        const mb = (f.size / (1024 * 1024)).toFixed(1);
        const capMb = cap / (1024 * 1024);
        const kind = isPdf ? 'PDF' : '圖片';
        setError(`「${f.name}」太大（${mb} MB），每個${kind}最多 ${capMb} MB`);
        return;
      }
    }

    const newPages: StagedPage[] = accepted.map((file) => {
      const isPdf = file.type === PDF_MIME;
      return {
        id: nextStagedId(),
        file,
        // PDFs use a 📄 stub in the queue preview — no object URL needed.
        previewUrl: isPdf ? null : URL.createObjectURL(file),
        isPdf,
      };
    });
    setStaged((prev) => [...prev, ...newPages]);

    if (truncated) {
      setError(
        `一次只能再加 ${remaining} 個，已取前 ${remaining} 個檔案，其餘 ${incoming.length - remaining} 個未加入`,
      );
    }
  };

  // ── Manipulate the staged queue ─────────────────────────────────────────
  const handleRemove = (idx: number) =>
    setStaged((prev) => {
      const target = prev[idx];
      if (target) revokePageUrl(target);
      return prev.filter((_, i) => i !== idx);
    });

  const handleMoveUp = (idx: number) => {
    if (idx <= 0) return;
    setStaged((prev) => {
      const next = [...prev];
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      return next;
    });
  };

  const handleMoveDown = (idx: number) => {
    setStaged((prev) => {
      if (idx >= prev.length - 1) return prev;
      const next = [...prev];
      [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
      return next;
    });
  };

  const handleClearAll = () => {
    staged.forEach(revokePageUrl);
    setStaged([]);
    setError(null);
  };

  // ── Revoke all object URLs on unmount ───────────────────────────────────
  // Reads stagedRef.current rather than the `staged` from closure to avoid the
  // empty-array stale-closure pin (deps=[] runs once at mount).  Re-running on
  // every staged change would revoke URLs we still need to display.
  useEffect(() => {
    return () => {
      stagedRef.current.forEach(revokePageUrl);
    };
  }, []);

  // ── Trigger the actual upload (resize + POST) ───────────────────────────
  const handleConfirmUpload = async () => {
    if (!hasStaged) return;
    setError(null);
    setUploading(true);
    try {
      const resized = await Promise.all(staged.map((s) => resizeImage(s.file)));
      const result = await uploadOmoImages(resized, token, lessonCodeHint);
      // #1974 review-2: clear queue + revoke object URLs after success so
      // re-mount or remount-less reuse of <OmoUpload> starts clean.
      staged.forEach(revokePageUrl);
      setStaged([]);
      onUploaded(result.upload_id);
    } catch (err) {
      const raw = err instanceof Error ? err.message : '';

      let msg = '上傳失敗，請再試一次';
      if (raw.includes('413') || raw.includes('太大')) {
        msg = '檔案太大，即使壓縮後仍超過限制，請重新拍攝或選較小的 PDF';
      } else if (raw.includes('400') || raw.includes('格式')) {
        msg = '檔案格式不對，請選 JPG、PNG 或 PDF';
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

  // ── Reset hidden file inputs so re-selecting the same file fires onChange ──
  const onCameraChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleAddFiles(e.target.files);
    e.target.value = '';
  };
  const onGalleryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleAddFiles(e.target.files);
    e.target.value = '';
  };

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col items-center gap-6 px-4 py-8 max-w-md mx-auto">
      {/* Header */}
      <div className="text-center">
        <div className="text-5xl mb-3" aria-hidden="true">📸</div>
        <h1 className="text-xl font-bold text-gray-900">上傳學習單（所有頁面）</h1>
        <p className="mt-1 text-sm text-gray-500">
          拍下或選擇紙本的<span className="font-semibold text-gray-700">每一頁</span>，
          也可直接上傳 PDF 掃描檔（AI 會合併批改，最多 {MAX_FILES} 個檔案）
        </p>
      </div>

      {/* Hidden inputs (always mounted so refs are stable) */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={onCameraChange}
      />
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*,application/pdf,.pdf"
        multiple
        className="hidden"
        onChange={onGalleryChange}
      />

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

      {/* Staged page queue */}
      {!uploading && hasStaged && (
        <div className="w-full flex flex-col gap-2">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-sm font-semibold text-gray-700">
              已選 {staged.length} 個檔案
            </h2>
            <button
              type="button"
              onClick={handleClearAll}
              className="text-xs text-gray-400 hover:text-red-500 underline"
            >
              全部清除
            </button>
          </div>
          {staged.map((page, idx) => (
            <OmoUploadPagePreview
              key={page.id}
              pageIndex={idx}
              totalPages={staged.length}
              previewUrl={page.previewUrl}
              fileName={page.file.name}
              isPdf={page.isPdf}
              onRemove={() => handleRemove(idx)}
              onMoveUp={() => handleMoveUp(idx)}
              onMoveDown={() => handleMoveDown(idx)}
            />
          ))}
          {staged.length >= 2 && (
            <p className="text-xs text-gray-400 px-1 mt-1">
              請依紙本順序排好（第 1 個 → 第 {staged.length} 個）
            </p>
          )}
        </div>
      )}

      {/* Initial CTAs (no staged) */}
      {!uploading && !hasStaged && (
        <div className="flex flex-col gap-3 w-full">
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
            選擇照片或 PDF
          </button>

          {/* #1975 — entry point to view previous OMO grading results */}
          {onShowHistory && (
            <button
              type="button"
              onClick={onShowHistory}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-6
                text-gray-600 hover:text-gray-900 hover:bg-gray-100 active:bg-gray-200
                text-sm font-medium rounded-xl
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2
                transition-colors"
            >
              <span aria-hidden="true">📋</span>
              查看批改記錄
            </button>
          )}
        </div>
      )}

      {/* Add-more + Confirm buttons (queue has at least one) */}
      {!uploading && hasStaged && (
        <div className="flex flex-col gap-3 w-full">
          {canAddMore && (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => cameraInputRef.current?.click()}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 px-4
                  bg-white hover:bg-gray-50 active:bg-gray-100
                  text-gray-700 text-sm font-medium rounded-xl
                  border border-gray-300
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2
                  transition-colors"
              >
                <span aria-hidden="true">📷</span>
                再拍一張
              </button>
              <button
                type="button"
                onClick={() => galleryInputRef.current?.click()}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 px-4
                  bg-white hover:bg-gray-50 active:bg-gray-100
                  text-gray-700 text-sm font-medium rounded-xl
                  border border-gray-300
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2
                  transition-colors"
              >
                <span aria-hidden="true">🖼️</span>
                再加照片/PDF
              </button>
            </div>
          )}

          {!canAddMore && (
            <p className="text-xs text-amber-600 text-center">
              已達 {MAX_FILES} 個檔案上限，請移除一個才能再加
            </p>
          )}

          <button
            type="button"
            onClick={handleConfirmUpload}
            className="w-full flex items-center justify-center gap-2 py-3.5 px-6
              bg-blue-600 hover:bg-blue-700 active:bg-blue-800
              text-white font-semibold rounded-xl
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2
              transition-colors"
          >
            <span aria-hidden="true">🚀</span>
            上傳批改（{staged.length} 個檔案）
          </button>
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
        支援 JPG、PNG、WebP（每張 ≤ 10 MB）或 PDF（≤ 20 MB，多頁自動拆開），最多 {MAX_FILES} 個檔案
        <br />
        <span className="text-gray-300">上傳前自動壓縮以節省時間</span>
      </p>
    </div>
  );
};

export default OmoUpload;
