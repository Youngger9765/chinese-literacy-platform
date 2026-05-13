/**
 * OmoIdentifyResult — Phase 1 post-upload identification result page.
 *
 * Polls GET /api/omo/:id every 2 seconds until status transitions out of
 * "pending"/"identifying". Once "identified", shows:
 *   "我們判斷你的學習單是 [grade] [title]，要繼續嗎？"
 * with a "確認" button (Phase 2 stub — wires to grading when ready).
 *
 * Also exposes the full top-3 candidate list in a collapsible "不確定？" section.
 */
import React, { useEffect, useRef, useState } from 'react';
import { getOmoStatus, confirmOmoLesson } from '../../services/omoApi';
import type { OmoCandidate, OmoStatus } from '../../services/omoApi';

const POLL_INTERVAL_MS = 2000;
const MAX_POLLS = 30; // 60 seconds max

interface OmoIdentifyResultProps {
  uploadId: number;
  token: string;
  /** Called after the student confirms a lesson (Phase 2 will navigate to grading) */
  onConfirmed?: (lessonId: number) => void;
  /** Called if user wants to go back and re-upload */
  onRetry: () => void;
}

const OmoIdentifyResult: React.FC<OmoIdentifyResultProps> = ({
  uploadId,
  token,
  onConfirmed,
  onRetry,
}) => {
  const [status, setStatus] = useState<OmoStatus>('identifying');
  const [candidates, setCandidates] = useState<OmoCandidate[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showAllCandidates, setShowAllCandidates] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const pollCount = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const poll = async () => {
      pollCount.current += 1;
      if (pollCount.current > MAX_POLLS) {
        if (intervalRef.current) clearInterval(intervalRef.current);
        setErrorMessage('辨識超時，請重新上傳');
        setStatus('failed');
        return;
      }
      try {
        const data = await getOmoStatus(uploadId, token);
        setStatus(data.status);
        setCandidates(data.candidates ?? []);
        if (data.error_message) setErrorMessage(data.error_message);
        if (data.status !== 'pending' && data.status !== 'identifying') {
          if (intervalRef.current) clearInterval(intervalRef.current);
        }
      } catch (err) {
        // Transient network error — keep polling
        console.error('OMO poll error:', err);
      }
    };

    // Immediate first poll
    void poll();
    intervalRef.current = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [uploadId, token]);

  const handleConfirm = async (lessonId: number) => {
    setConfirming(true);
    try {
      await confirmOmoLesson(uploadId, lessonId, token);
      setConfirmed(true);
      onConfirmed?.(lessonId);
    } catch (err) {
      console.error('OMO confirm error:', err);
      setErrorMessage('確認失敗，請再試一次');
    } finally {
      setConfirming(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Identifying / pending — spinner
  // ---------------------------------------------------------------------------
  if (status === 'pending' || status === 'identifying') {
    return (
      <div className="flex flex-col items-center gap-6 px-4 py-12 max-w-md mx-auto">
        <div
          className="w-16 h-16 rounded-full border-4 border-blue-200 border-t-blue-600 animate-spin"
          aria-label="AI 辨識中"
          role="status"
        />
        <div className="text-center">
          <p className="font-semibold text-gray-800">AI 正在辨識你的學習單</p>
          <p className="mt-1 text-sm text-gray-500">通常需要 10～30 秒，請稍候…</p>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Failed
  // ---------------------------------------------------------------------------
  if (status === 'failed') {
    return (
      <div className="flex flex-col items-center gap-6 px-4 py-8 max-w-md mx-auto">
        <div className="text-5xl" aria-hidden="true">😕</div>
        <div className="text-center">
          <p className="font-semibold text-gray-800">辨識失敗</p>
          <p className="mt-1 text-sm text-gray-500">
            {errorMessage ?? '無法辨識學習單，請重新拍照（確保光線充足、文字清晰）'}
          </p>
        </div>
        <button
          type="button"
          onClick={onRetry}
          className="w-full py-3.5 px-6 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-colors"
        >
          重新上傳
        </button>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Identified — show top candidate + confirm
  // ---------------------------------------------------------------------------
  const topCandidate = candidates[0] ?? null;
  const otherCandidates = candidates.slice(1);

  if (confirmed) {
    return (
      <div className="flex flex-col items-center gap-6 px-4 py-12 max-w-md mx-auto">
        <div className="text-5xl" aria-hidden="true">✅</div>
        <div className="text-center">
          <p className="font-semibold text-gray-800">已確認！</p>
          <p className="mt-1 text-sm text-gray-500">
            批改功能將在 Phase 2 上線，敬請期待
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 px-4 py-8 max-w-md mx-auto">
      {/* Header */}
      <div className="text-center">
        <div className="text-4xl mb-2" aria-hidden="true">🔍</div>
        <h1 className="text-xl font-bold text-gray-900">辨識結果</h1>
      </div>

      {topCandidate ? (
        <>
          {/* Primary identification card */}
          <div className="bg-blue-50 border border-blue-200 rounded-2xl p-5">
            <p className="text-sm text-blue-600 font-medium mb-1">我們判斷你的學習單是</p>
            <p className="text-2xl font-bold text-gray-900 leading-snug">
              {topCandidate.grade_code} {topCandidate.title}
            </p>
            <p className="mt-2 text-sm text-gray-500 leading-relaxed">
              {topCandidate.reasoning}
            </p>
            <div className="mt-3 flex items-center gap-1.5">
              <div
                className="h-2 rounded-full bg-blue-400 transition-all"
                style={{ width: `${Math.round(topCandidate.confidence * 100)}%`, maxWidth: '100%', minWidth: '4px' }}
                aria-label={`信心度 ${Math.round(topCandidate.confidence * 100)}%`}
              />
              <span className="text-xs text-gray-400">
                信心度 {Math.round(topCandidate.confidence * 100)}%
              </span>
            </div>
          </div>

          {/* Confirm button */}
          <button
            type="button"
            onClick={() => handleConfirm(topCandidate.lesson_id)}
            disabled={confirming}
            className="w-full py-3.5 px-6 bg-green-600 hover:bg-green-700 disabled:opacity-60
              text-white font-semibold rounded-xl transition-colors
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2"
          >
            {confirming ? '確認中…' : '✓ 沒錯，要繼續！'}
          </button>

          {/* Other candidates (collapsed) */}
          {otherCandidates.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => setShowAllCandidates((v) => !v)}
                className="w-full text-sm text-gray-500 hover:text-gray-700 underline underline-offset-2 py-1"
              >
                {showAllCandidates ? '收起' : '不確定？查看其他候選課文'}
              </button>

              {showAllCandidates && (
                <div className="mt-3 flex flex-col gap-2">
                  {otherCandidates.map((c) => (
                    <div
                      key={c.lesson_id}
                      className="flex items-center justify-between bg-gray-50 border border-gray-200 rounded-xl px-4 py-3"
                    >
                      <div>
                        <p className="font-medium text-gray-800 text-sm">
                          {c.grade_code} {c.title}
                        </p>
                        <p className="text-xs text-gray-400 mt-0.5 line-clamp-1">
                          {c.reasoning}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleConfirm(c.lesson_id)}
                        disabled={confirming}
                        className="ml-3 shrink-0 text-xs text-blue-600 hover:text-blue-800 font-semibold underline"
                      >
                        這個
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        /* No candidates returned (image unclear) */
        <div className="text-center">
          <p className="text-gray-700">AI 無法辨識圖片中的文字</p>
          <p className="mt-1 text-sm text-gray-500">請確保照片清晰、光線充足後重新拍攝</p>
        </div>
      )}

      {/* Re-upload link */}
      <button
        type="button"
        onClick={onRetry}
        className="w-full text-sm text-gray-400 hover:text-gray-600 py-1"
      >
        重新上傳
      </button>
    </div>
  );
};

export default OmoIdentifyResult;
