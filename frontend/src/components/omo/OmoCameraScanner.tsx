/**
 * OmoCameraScanner — in-browser document scanner (#2089 item 4, approach A).
 *
 * Opens the camera as a LIVE preview INSIDE the web page via getUserMedia — it
 * does NOT launch the phone's native camera app (the old `<input capture>`
 * flow). The student points at each worksheet page, taps the in-page shutter,
 * and the frame is captured to a JPEG File without ever leaving the page; they
 * keep shooting page after page, then tap 完成 to hand the whole batch back to
 * the upload queue. No native app round-trip, no separate save-to-PNG step.
 *
 * Lightweight by design: native getUserMedia + canvas only, no third-party
 * image library (no edge-detection / perspective-correction). The grader
 * tolerates skew / rotation / page-order via reference re-sort (#2091), so the
 * marginal value of auto-correction is low for now.
 *
 * Requires a secure context (HTTPS) — staging/prod qualify. On unsupported
 * browsers or denied permission it shows a clear message and the caller's
 * file-upload path stays available as the fallback.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';

interface OmoCameraScannerProps {
  /** Called with a captured JPEG File for each shutter press. */
  onCapture: (file: File) => void;
  /** Close the scanner (done / cancel / fatal error). */
  onClose: () => void;
  /** Pages already in the upload queue — shown as the running count. */
  pageCount: number;
  /** False when the queue is at its file cap — shutter is disabled. */
  canCapture: boolean;
}

type CamState = 'starting' | 'live' | 'error';

const CAPTURE_QUALITY = 0.9;

const OmoCameraScanner: React.FC<OmoCameraScannerProps> = ({
  onCapture,
  onClose,
  pageCount,
  canCapture,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [state, setState] = useState<CamState>('starting');
  const [errorMsg, setErrorMsg] = useState<string>('');
  // Brief shutter flash for capture feedback.
  const [flash, setFlash] = useState(false);

  const stopStream = useCallback(() => {
    const stream = streamRef.current;
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  // Start the camera on mount; stop all tracks on unmount.
  useEffect(() => {
    let cancelled = false;

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setErrorMsg('這個瀏覽器不支援網頁內相機，請改用「選擇照片或 PDF」上傳。');
        setState('error');
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' }, // rear camera for documents
            // Match the upload resize target (1280px longest side) so the
            // captured frame usually needs no second compression pass in
            // resizeImage — avoids stacking JPEG artifacts (#2094 review).
            width: { ideal: 1280 },
            height: { ideal: 1280 },
          },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {/* autoplay guard */});
        }
        setState('live');
      } catch (err) {
        const name = err instanceof DOMException ? err.name : '';
        if (name === 'NotAllowedError' || name === 'SecurityError') {
          setErrorMsg('沒有相機權限。請允許使用相機，或改用「選擇照片或 PDF」上傳。');
        } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
          setErrorMsg('找不到可用的相機，請改用「選擇照片或 PDF」上傳。');
        } else {
          setErrorMsg('無法開啟相機，請改用「選擇照片或 PDF」上傳。');
        }
        setState('error');
      }
    }

    start();
    return () => {
      cancelled = true;
      stopStream();
    };
  }, [stopStream]);

  const handleClose = useCallback(() => {
    stopStream();
    onClose();
  }, [stopStream, onClose]);

  const handleShutter = useCallback(() => {
    const video = videoRef.current;
    if (!video || state !== 'live' || !canCapture) return;
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return;

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, w, h);

    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const now = Date.now();
        const file = new File([blob], `scan-${now}.jpg`, {
          type: 'image/jpeg',
          lastModified: now,
        });
        onCapture(file);
        setFlash(true);
        setTimeout(() => setFlash(false), 150);
      },
      'image/jpeg',
      CAPTURE_QUALITY,
    );
  }, [state, canCapture, onCapture]);

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col" role="dialog" aria-label="掃描學習單">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 text-white">
        <button
          type="button"
          onClick={handleClose}
          className="text-sm font-medium px-3 py-1.5 rounded-lg hover:bg-white/10"
        >
          取消
        </button>
        <span className="text-sm font-semibold">
          {pageCount > 0 ? `已掃描 ${pageCount} 頁` : '對準學習單後按下快門'}
        </span>
        <button
          type="button"
          onClick={handleClose}
          disabled={pageCount === 0}
          className="text-sm font-bold px-3 py-1.5 rounded-lg text-emerald-300 hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          完成
        </button>
      </div>

      {/* Live preview / states */}
      <div className="relative flex-1 flex items-center justify-center overflow-hidden">
        <video
          ref={videoRef}
          playsInline
          muted
          className={`max-h-full max-w-full ${state === 'live' ? 'block' : 'hidden'}`}
        />
        {flash && <div className="absolute inset-0 bg-white opacity-80" aria-hidden="true" />}

        {state === 'starting' && (
          <div className="flex flex-col items-center gap-3 text-white/80">
            <div className="w-10 h-10 rounded-full border-4 border-white/30 border-t-white animate-spin" />
            <p className="text-sm">正在開啟相機…</p>
          </div>
        )}

        {state === 'error' && (
          <div className="flex flex-col items-center gap-4 px-8 text-center text-white/90">
            <span className="text-4xl" aria-hidden="true">📷</span>
            <p className="text-sm">{errorMsg}</p>
            <button
              type="button"
              onClick={handleClose}
              className="mt-2 px-5 py-2 rounded-xl bg-white text-gray-900 text-sm font-semibold"
            >
              返回上傳
            </button>
          </div>
        )}
      </div>

      {/* Shutter bar */}
      {state === 'live' && (
        <div className="flex flex-col items-center gap-2 pb-8 pt-4">
          {!canCapture && (
            <p className="text-xs text-amber-300">已達檔案數上限，請先完成或移除一些頁面</p>
          )}
          <button
            type="button"
            onClick={handleShutter}
            disabled={!canCapture}
            aria-label="拍攝這一頁"
            className="w-16 h-16 rounded-full bg-white ring-4 ring-white/40 active:scale-95 transition-transform disabled:opacity-40 disabled:cursor-not-allowed"
          />
          <p className="text-xs text-white/60">拍完一頁可直接翻頁繼續拍，完成後按右上角「完成」</p>
        </div>
      )}
    </div>
  );
};

export default OmoCameraScanner;
