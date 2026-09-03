/**
 * LessonQrButton — show this lesson's QR code and download it as a PNG.
 *
 * Lives on two surfaces with different visual languages:
 *   - the admin 教材端 table (`variant="admin"`, compact bordered button)
 *   - the learning pages 讀全文-做記號 / 重點朗讀 (`variant="pill"`)
 *
 * The dialog itself is the same on both, deliberately: a teacher checking a
 * code in class and 教材端 checking one before pasting it into Word are doing
 * the same two-second check, and the thing being checked is the URL.
 *
 * Why a preview at all, rather than downloading straight away: downloading
 * blind gives you no way to tell a correct code from a wrong one until you
 * have already printed it and scanned it with a phone.
 */
import React, { useCallback, useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Download, Loader2, QrCode } from 'lucide-react';

import {
  buildLessonQrValue,
  QR_ENTRY_ORIGIN,
  qrCodeToDataUrl,
  qrFileName,
  triggerDownload,
  type LessonQrStep,
} from './lessonQr';

// The words a person sees. These are the steps' own names, not the admin
// panel's shorthand: the step is 重點朗讀, so the button says 「QR 重點」.
// Owner, seeing the first version: 「不對！！！是 QR重點」.
const STEP_LABEL: Record<LessonQrStep, string> = {
  'full-text-annotate': '全文',
  'key-passage-reading': '重點',
};

const TRIGGER_CLASS: Record<'admin' | 'pill', string> = {
  admin:
    'inline-flex items-center justify-center gap-1.5 rounded border border-gray-200 px-2.5 py-1.5 ' +
    'text-xs font-medium text-gray-600 hover:border-gray-300 hover:bg-gray-50 ' +
    'disabled:cursor-wait disabled:opacity-60',
  pill:
    'inline-flex items-center gap-2 rounded-full bg-surface-container-low px-4 py-2 shadow-sm ' +
    'text-sm font-medium text-on-surface hover:bg-surface-container-high ' +
    'disabled:cursor-wait disabled:opacity-60 transition-all',
};

/**
 * Rendered into document.body rather than in place.
 *
 * `position: fixed` resolves against the nearest ancestor that establishes a
 * containing block — any transform, filter, or contain on the way up does it,
 * and both shells have several. In place, the overlay laid itself out inside
 * the table row, so the QR appeared jammed between two columns instead of
 * centred. A portal is the only reliable fix; no combination of z-index or
 * overflow on the dialog itself escapes an ancestor's containing block.
 */
const QrPreviewDialog: React.FC<{
  title: string;
  value: string;
  dataUrl: string;
  filename: string;
  onClose: () => void;
}> = ({ title, value, dataUrl, filename, onClose }) => {
  // 監聽器只在掛載時裝一次。依賴 [onClose] 的話，父層每次重繪都會把它
  // 拔掉再裝回去 —— openPreview 的 finally 會 setIsGenerating(false)，
  // 那次重繪就落在 dialog 剛出現之後，Escape 打在縫裡就沒人接。
  // callback 走 ref，這樣既不churn、又不會抓到過期的 onClose。
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
      aria-label={title}
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-3 text-sm font-semibold text-gray-800">{title}</h3>
        <img src={dataUrl} alt={`${title} QR code`} className="mx-auto h-56 w-56" />
        <p className="mt-3 break-all rounded bg-gray-50 px-2 py-1.5 text-xs text-gray-500">{value}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
          >
            關閉
          </button>
          <button
            type="button"
            onClick={() => triggerDownload(dataUrl, filename)}
            className="inline-flex items-center gap-1.5 rounded bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-700"
          >
            <Download className="h-3.5 w-3.5" />
            下載 PNG
          </button>
        </div>
      </div>
    </div>
  ), document.body);
};

export interface LessonQrButtonProps {
  lessonId: number | string;
  step: LessonQrStep;
  lessonTitle: string;
  /** Text on the trigger. Defaults to 「QR 全文」/「QR 重點」. */
  label?: string;
  /** PNG filename stem, e.g. `qr-full` -> `qr-full-L07.png`. */
  filePrefix?: string;
  /**
   * 這一節**自己的**代號（#2916）。有就印短網址 `/q/{代號}`。
   * 一份學習單多篇課文時，每一篇的每一節各有各的代號 ——
   * 少了它，三篇的 QR 會全部指到同一個地方。
   */
  sectionSlug?: string | null;
  variant?: 'admin' | 'pill';
}

const LessonQrButton: React.FC<LessonQrButtonProps> = ({
  lessonId,
  step,
  lessonTitle,
  label,
  filePrefix,
  sectionSlug,
  variant = 'pill',
}) => {
  const [isGenerating, setIsGenerating] = useState(false);
  const [preview, setPreview] = useState<{ dataUrl: string; value: string } | null>(null);

  const openPreview = useCallback(async () => {
    setIsGenerating(true);
    try {
      // ⛔ 這裡本來傳 `window.location.origin` —— 也就是「在哪個站按下載」
      //    決定紙上印什麼。lessonQr.ts 的註解早就寫明不可以這樣做，
      //    但修只落在後台那支，這一支（老師在課堂上會按的那顆）漏掉了。
      //    2026-08-25 查證：PM 在 staging 產的那批 QR 每一張都指向測試站。
      const value = buildLessonQrValue(QR_ENTRY_ORIGIN, lessonId, step, sectionSlug);
      setPreview({ dataUrl: await qrCodeToDataUrl(value), value });
    } finally {
      setIsGenerating(false);
    }
  }, [lessonId, step, sectionSlug]);

  // ⚠️ 一定要 useCallback。寫成 `onClose={() => setPreview(null)}` 的話每次
  //    render 都是新的函式 identity，而 QrPreviewDialog 的 keydown effect 依賴
  //    它 —— 於是每次父層重繪都把 Escape 監聽器拔掉再裝回去。
  //    `openPreview` 的 finally 會 setIsGenerating(false)，那次重繪剛好落在
  //    dialog 出現之後，Escape 打在拔掉的那一瞬間就無效（2026-09-03 CI flaky，
  //    本地連跑兩次一綠一紅）。
  const closePreview = useCallback(() => setPreview(null), []);

  // 沒有代號就不出這顆按鈕 —— 印不出 slug 短網址就不該給 QR（#2916）。
  // 顯示一顆按不出東西的按鈕，比不顯示更糟。
  if (!sectionSlug) return null;

  const kind = STEP_LABEL[step];
  const text = label ?? `QR ${kind}`;
  const stem = filePrefix ?? (step === 'full-text-annotate' ? 'qr-full' : 'qr-key-reading');

  return (
    <>
      <button
        type="button"
        onClick={openPreview}
        disabled={isGenerating}
        // Only when the caller did not name the button itself. The admin table
        // renders two of these per row both reading "QR" and locates them by
        // that name; an aria-label would silently replace it and every one of
        // those lookups would stop matching.
        aria-label={label ? undefined : `顯示${kind}朗讀 QR code`}
        className={TRIGGER_CLASS[variant]}
        title={buildLessonQrValue(QR_ENTRY_ORIGIN, lessonId, step, sectionSlug)}
      >
        {isGenerating
          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
          : <QrCode className="h-3.5 w-3.5" />}
        {text}
      </button>
      {preview && (
        <QrPreviewDialog
          title={`${lessonTitle}／${kind}`}
          value={preview.value}
          dataUrl={preview.dataUrl}
          filename={qrFileName(stem, lessonId)}
          onClose={closePreview}
        />
      )}
    </>
  );
};

export default LessonQrButton;
