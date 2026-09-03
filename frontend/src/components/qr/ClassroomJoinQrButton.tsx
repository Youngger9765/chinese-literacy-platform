/**
 * ClassroomJoinQrButton — teacher-facing QR for "加入班級" (#3081).
 *
 * Shown next to the existing 複製代碼 / 重生代碼 buttons on the classroom
 * detail page's join-code panel. A teacher projects the popup; students scan
 * it with a tablet instead of typing the 6-char code by hand.
 *
 * The dialog structure (portal + ref-based Escape listener) is copied from
 * `LessonQrButton.tsx` on purpose, not abstracted into a shared component:
 * that file documents a real bug from re-attaching the keydown listener on
 * every render (the `openPreview` finally's `setIsGenerating(false)` landing
 * right after the dialog mounts), and copying the already-fixed shape is
 * safer than inventing a new one under a different name.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, QrCode } from 'lucide-react';

import { QR_ENTRY_ORIGIN, buildClassroomJoinQrValue, qrCodeToDataUrl } from './classroomJoinQr';

const ClassroomJoinQrDialog: React.FC<{
  classroomName: string;
  joinCode: string;
  value: string;
  dataUrl: string;
  onClose: () => void;
}> = ({ classroomName, joinCode, value, dataUrl, onClose }) => {
  // See LessonQrButton.tsx's QrPreviewDialog for why this is a ref, not a
  // plain [onClose] dependency: a stale-callback identity would make the
  // keydown listener detach/reattach on every re-render, and Escape can land
  // in the gap.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCloseRef.current(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return createPortal((
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`${classroomName} 加入班級 QR`}
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-lg bg-white p-6 shadow-xl text-center"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-1 text-sm font-semibold text-gray-500">投影給學生掃描加入</h3>
        <p className="mb-4 text-base font-bold text-gray-900">{classroomName}</p>
        <img
          src={dataUrl}
          alt={`${classroomName} 加入班級 QR code`}
          // 320px 見方（AC1：教室後排用平板掃得到）
          className="mx-auto h-80 w-80"
        />
        <p className="mt-4 font-mono text-3xl font-bold tracking-widest text-accent select-all">
          {joinCode}
        </p>
        <p className="mt-3 break-all rounded bg-gray-50 px-2 py-1.5 text-xs text-gray-400">
          {value}
        </p>
        <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
          這個 QR 長期有效，課後若要停用請按「重生代碼」
        </p>
        <button
          type="button"
          onClick={onClose}
          className="mt-4 w-full rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors cursor-pointer"
        >
          關閉
        </button>
      </div>
    </div>
  ), document.body);
};

export interface ClassroomJoinQrButtonProps {
  classroomName: string;
  /** The classroom's join code. No button renders without one (nothing to encode). */
  joinCode?: string | null;
}

const ClassroomJoinQrButton: React.FC<ClassroomJoinQrButtonProps> = ({ classroomName, joinCode }) => {
  const [isGenerating, setIsGenerating] = useState(false);
  const [preview, setPreview] = useState<{ dataUrl: string; value: string } | null>(null);

  const openPreview = useCallback(async () => {
    if (!joinCode) return;
    setIsGenerating(true);
    try {
      // ⛔ QR_ENTRY_ORIGIN, never `window.location.origin` — see
      // classroomJoinQr.ts and lessonQr.ts for why. Regression-locked in
      // ClassroomJoinQrButton.test.tsx.
      const value = buildClassroomJoinQrValue(QR_ENTRY_ORIGIN, joinCode);
      setPreview({ dataUrl: await qrCodeToDataUrl(value), value });
    } finally {
      setIsGenerating(false);
    }
  }, [joinCode]);

  const closePreview = useCallback(() => setPreview(null), []);

  if (!joinCode) return null;

  return (
    <>
      <button
        type="button"
        onClick={openPreview}
        disabled={isGenerating}
        aria-label="顯示加入班級 QR code"
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 text-sm hover:bg-gray-50 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {isGenerating
          ? <Loader2 className="h-4 w-4 animate-spin" />
          : <QrCode className="h-4 w-4" />}
        QR Code
      </button>
      {preview && (
        <ClassroomJoinQrDialog
          classroomName={classroomName}
          joinCode={joinCode}
          value={preview.value}
          dataUrl={preview.dataUrl}
          onClose={closePreview}
        />
      )}
    </>
  );
};

export default ClassroomJoinQrButton;
