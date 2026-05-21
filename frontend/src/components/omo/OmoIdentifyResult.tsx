/**
 * OmoIdentifyResult — Phase 1b post-upload identification result page.
 *
 * 3-tier confidence UX:
 *   conf >= 0.9 (HIGH):   single prominent confirm button + smaller "不是這個"
 *   0.4 <= conf < 0.9:    top-3 candidate cards, all clickable
 *   conf < 0.4 OR empty:  "看不清楚 😅" + retake + manual-pick modal
 *
 * Also handles:
 *   - from_cache=true + already_graded=true: "already graded" modal
 *   - /regrade endpoint for intentional re-grade
 *   - Polls through grading state until status=graded
 */
import React, { useEffect, useRef, useState } from 'react';
import { getOmoStatus, confirmOmoLesson, regradeOmo, getOmoLessons } from '../../services/omoApi';
import type { OmoCandidate, OmoStatus, OmoLessonSummary, OmoAnswerItem } from '../../services/omoApi';
import { OMO_CONF_HIGH, OMO_CONF_MEDIUM } from './omoConfidenceThresholds';

const POLL_INTERVAL_MS = 2000;
const MAX_POLLS = 30; // 60 seconds max

interface OmoIdentifyResultProps {
  uploadId: number;
  token: string;
  /** Set to true if backend returned from_cache=true AND already_graded=true */
  alreadyGraded?: boolean;
  /** The already-graded overall_score (if alreadyGraded=true) */
  cachedScore?: number | null;
  /** Called after the student confirms a lesson (and grading kicked off) */
  onConfirmed?: (lessonId: number) => void;
  /** Called if user wants to go back and re-upload */
  onRetry: () => void;
  /** Called when grading completes (status=graded) */
  onGraded?: (answers: OmoAnswerItem[], score: number | null, title?: string) => void;
}

const OmoIdentifyResult: React.FC<OmoIdentifyResultProps> = ({
  uploadId,
  token,
  alreadyGraded = false,
  cachedScore = null,
  onConfirmed,
  onRetry,
  onGraded,
}) => {
  const [status, setStatus] = useState<OmoStatus>('identifying');
  const [candidates, setCandidates] = useState<OmoCandidate[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [regrading, setRegrading] = useState(false);
  const [showAlreadyGraded, setShowAlreadyGraded] = useState(alreadyGraded);
  const [confirmedTitle, setConfirmedTitle] = useState<string | undefined>(undefined);

  // Manual picker state (for low-confidence / unclear case)
  const [showManualPicker, setShowManualPicker] = useState(false);
  const [lessons, setLessons] = useState<OmoLessonSummary[]>([]);
  const [loadingLessons, setLoadingLessons] = useState(false);

  const pollCount = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ---------------------------------------------------------------------------
  // Polling
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (alreadyGraded) return; // skip polling for cache hits

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
        if (data.status === 'graded') {
          if (intervalRef.current) clearInterval(intervalRef.current);
          onGraded?.(data.answers ?? [], data.overall_score ?? null, confirmedTitle);
        } else if (
          data.status !== 'pending' &&
          data.status !== 'identifying' &&
          data.status !== 'grading'
        ) {
          if (intervalRef.current) clearInterval(intervalRef.current);
        }
      } catch {
        // Transient network error — keep polling
      }
    };

    void poll();
    intervalRef.current = setInterval(poll, POLL_INTERVAL_MS);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [uploadId, token, alreadyGraded, onGraded, confirmedTitle]);

  // #1779: unmount safety net — main effect early-returns for alreadyGraded
  // path so its cleanup isn't registered, but handleRegrade may then start
  // an interval. This guarantees cleanup regardless of which code path armed
  // the interval.
  useEffect(() => {
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------
  const handleConfirm = async (lessonId: number, lessonTitle?: string) => {
    setConfirming(true);
    setShowManualPicker(false);
    if (lessonTitle) setConfirmedTitle(lessonTitle);
    try {
      await confirmOmoLesson(uploadId, lessonId, token);
      setConfirmed(true);
      onConfirmed?.(lessonId);
      setStatus('grading');
    } catch (err) {
      console.error('OMO confirm error:', err);
      setErrorMessage('確認失敗，請再試一次');
    } finally {
      setConfirming(false);
    }
  };

  const handleRegrade = async () => {
    setRegrading(true);
    setShowAlreadyGraded(false);
    try {
      await regradeOmo(uploadId, token);
      setStatus('grading');
      pollCount.current = 0;
      intervalRef.current = setInterval(async () => {
        pollCount.current += 1;
        if (pollCount.current > MAX_POLLS) {
          if (intervalRef.current) clearInterval(intervalRef.current);
          setErrorMessage('批改超時，請稍後重試');
          return;
        }
        try {
          const data = await getOmoStatus(uploadId, token);
          setStatus(data.status);
          if (data.status === 'graded') {
            if (intervalRef.current) clearInterval(intervalRef.current);
            onGraded?.(data.answers ?? [], data.overall_score ?? null, confirmedTitle);
          }
        } catch { /* ignore transient */ }
      }, POLL_INTERVAL_MS);
    } catch (err) {
      console.error('OMO regrade error:', err);
      setErrorMessage('重新批改失敗，請稍後再試');
    } finally {
      setRegrading(false);
    }
  };

  const handleOpenManualPicker = async () => {
    setShowManualPicker(true);
    if (lessons.length === 0) {
      setLoadingLessons(true);
      try {
        const list = await getOmoLessons(token);
        setLessons(list);
      } catch {
        setErrorMessage('無法載入課程清單，請重試');
      } finally {
        setLoadingLessons(false);
      }
    }
  };

  // ---------------------------------------------------------------------------
  // Already-graded modal
  // ---------------------------------------------------------------------------
  if (showAlreadyGraded) {
    const scoreDisplay =
      cachedScore !== null && cachedScore !== undefined
        ? `${Math.round(cachedScore * 100)} 分`
        : null;

    return (
      <div className="flex flex-col items-center gap-6 px-4 py-12 max-w-md mx-auto">
        <div className="text-5xl" aria-hidden="true">📋</div>
        <div className="text-center">
          <h1 className="text-xl font-bold text-gray-900">這張學習單已批改過</h1>
          {scoreDisplay && (
            <p className="mt-2 text-3xl font-bold text-green-600">{scoreDisplay}</p>
          )}
          <p className="mt-2 text-sm text-gray-500">要查看上次結果，或重新批改？</p>
        </div>
        <button
          type="button"
          onClick={async () => {
            try {
              const data = await getOmoStatus(uploadId, token);
              onGraded?.(data.answers ?? [], data.overall_score ?? null, undefined);
            } catch {
              onGraded?.([], cachedScore ?? null, undefined);
            }
          }}
          className="w-full py-3.5 px-6 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-colors"
        >
          看上次結果
        </button>
        <button
          type="button"
          onClick={handleRegrade}
          disabled={regrading}
          className="w-full py-3.5 px-6 border border-gray-300 hover:bg-gray-50 text-gray-700 font-semibold rounded-xl transition-colors disabled:opacity-60"
        >
          {regrading ? '重新批改中…' : '重新批改'}
        </button>
        <button type="button" onClick={onRetry} className="text-sm text-gray-400 hover:text-gray-600 py-1">
          上傳其他學習單
        </button>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Spinner states
  // ---------------------------------------------------------------------------
  if (status === 'pending' || status === 'identifying' || (status === 'grading' && !confirmed)) {
    return (
      <div className="flex flex-col items-center gap-6 px-4 py-12 max-w-md mx-auto">
        <div
          className="w-16 h-16 rounded-full border-4 border-blue-200 border-t-blue-600 animate-spin"
          aria-label={status === 'grading' ? 'AI 批改中' : 'AI 辨識中'}
          role="status"
        />
        <div className="text-center">
          <p className="font-semibold text-gray-800">
            {status === 'grading' ? 'AI 正在批改你的學習單' : 'AI 正在辨識你的學習單'}
          </p>
          <p className="mt-1 text-sm text-gray-500">通常需要 10～30 秒，請稍候…</p>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Error / failed
  // ---------------------------------------------------------------------------
  if (status === 'failed' || status === 'error') {
    return (
      <div className="flex flex-col items-center gap-6 px-4 py-8 max-w-md mx-auto">
        <div className="text-5xl" aria-hidden="true">😕</div>
        <div className="text-center">
          <p className="font-semibold text-gray-800">辨識失敗</p>
          <p className="mt-1 text-sm text-gray-500">
            {errorMessage ?? '無法辨識學習單，請重新拍照（確保光線充足、文字清晰）'}
          </p>
        </div>
        <button type="button" onClick={onRetry} className="w-full py-3.5 px-6 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-colors">
          重新上傳
        </button>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Graded — brief flash before parent navigates
  // ---------------------------------------------------------------------------
  if (status === 'graded') {
    return (
      <div className="flex flex-col items-center gap-6 px-4 py-12 max-w-md mx-auto">
        <div className="text-5xl" aria-hidden="true">✅</div>
        <div className="text-center">
          <p className="font-semibold text-gray-800">批改完成！</p>
          <p className="mt-1 text-sm text-gray-500">正在載入結果…</p>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Confirmed + waiting for grading
  // ---------------------------------------------------------------------------
  if (confirmed) {
    return (
      <div className="flex flex-col items-center gap-6 px-4 py-12 max-w-md mx-auto">
        <div
          className="w-16 h-16 rounded-full border-4 border-blue-200 border-t-blue-600 animate-spin"
          aria-label="批改中"
          role="status"
        />
        <div className="text-center">
          <p className="font-semibold text-gray-800">AI 正在批改中</p>
          <p className="mt-1 text-sm text-gray-500">通常需要 15～20 秒…</p>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Manual picker modal overlay
  // ---------------------------------------------------------------------------
  if (showManualPicker) {
    return (
      <div className="flex flex-col gap-4 px-4 py-8 max-w-md mx-auto">
        <div className="flex items-center gap-3 mb-2">
          <button
            type="button"
            onClick={() => setShowManualPicker(false)}
            className="p-1 rounded-lg text-gray-500 hover:text-gray-900 hover:bg-gray-100"
            aria-label="返回"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5" aria-hidden="true">
              <path fillRule="evenodd" d="M17 10a.75.75 0 01-.75.75H5.612l4.158 3.96a.75.75 0 11-1.04 1.08l-5.5-5.25a.75.75 0 010-1.08l5.5-5.25a.75.75 0 111.04 1.08L5.612 9.25H16.25A.75.75 0 0117 10z" clipRule="evenodd" />
            </svg>
          </button>
          <h1 className="font-bold text-gray-900">手動選課文</h1>
        </div>
        <p className="text-sm text-gray-500">這是哪一課的學習單？</p>

        {loadingLessons ? (
          <div className="flex justify-center py-8">
            <div className="w-8 h-8 rounded-full border-4 border-blue-200 border-t-blue-600 animate-spin" role="status" aria-label="載入中" />
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {lessons.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-4">目前沒有可選的課文</p>
            )}
            {lessons.map((lesson) => (
              <button
                key={lesson.lesson_id}
                type="button"
                disabled={confirming}
                onClick={() => handleConfirm(lesson.lesson_id, `${lesson.grade_code} ${lesson.title}`)}
                className="flex items-center gap-3 w-full bg-white border border-gray-200 hover:border-blue-400 hover:bg-blue-50 rounded-xl px-4 py-3 text-left transition-colors disabled:opacity-60"
              >
                <span className="shrink-0 text-xs font-semibold text-blue-600 bg-blue-100 rounded-lg px-2 py-1">
                  {lesson.grade_code}
                </span>
                <span className="font-medium text-gray-800 text-sm">{lesson.title}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // 3-tier confidence logic
  // ---------------------------------------------------------------------------
  const topCandidate = candidates[0] ?? null;
  const topConfidence = topCandidate?.confidence ?? 0;

  // Tier 3: no candidates OR low confidence
  if (!topCandidate || topConfidence < OMO_CONF_MEDIUM) {
    return (
      <div className="flex flex-col items-center gap-6 px-4 py-8 max-w-md mx-auto">
        <div className="text-5xl" aria-hidden="true">😅</div>
        <div className="text-center">
          <h1 className="text-xl font-bold text-gray-900">看不清楚</h1>
          <p className="mt-2 text-sm text-gray-500">
            AI 無法確認是哪一課（信心度太低）
            <br />請重新拍攝，或手動選課文。
          </p>
        </div>

        <button
          type="button"
          onClick={onRetry}
          className="w-full py-3.5 px-6 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-colors"
        >
          重拍
        </button>

        <button
          type="button"
          onClick={handleOpenManualPicker}
          className="w-full py-3.5 px-6 border border-gray-300 hover:bg-gray-50 text-gray-700 font-semibold rounded-xl transition-colors"
        >
          手動選課
        </button>
      </div>
    );
  }

  // Tier 1: high confidence
  if (topConfidence >= OMO_CONF_HIGH) {
    return (
      <div className="flex flex-col gap-6 px-4 py-8 max-w-md mx-auto">
        <div className="text-center">
          <div className="text-4xl mb-2" aria-hidden="true">🎯</div>
          <h1 className="text-xl font-bold text-gray-900">辨識結果</h1>
        </div>

        <div className="bg-blue-50 border-2 border-blue-300 rounded-2xl p-5">
          <p className="text-sm text-blue-600 font-medium mb-1">我們認為你的學習單是</p>
          <p className="text-2xl font-bold text-gray-900 leading-snug">
            {topCandidate.grade_code} {topCandidate.title}
          </p>
          <p className="mt-2 text-sm text-gray-500">{topCandidate.reasoning}</p>
          <div className="mt-3 flex items-center gap-1.5">
            <div
              className="h-2 rounded-full bg-blue-500 transition-all"
              style={{ width: `${Math.round(topConfidence * 100)}%`, maxWidth: '100%', minWidth: '4px' }}
            />
            <span className="text-xs text-gray-400">信心度 {Math.round(topConfidence * 100)}%</span>
          </div>
        </div>

        {/* Prominent confirm */}
        <button
          type="button"
          onClick={() => handleConfirm(topCandidate.lesson_id, `${topCandidate.grade_code} ${topCandidate.title}`)}
          disabled={confirming}
          className="w-full py-4 px-6 bg-green-600 hover:bg-green-700 disabled:opacity-60
            text-white font-bold text-lg rounded-xl transition-colors
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2"
        >
          {confirming ? '確認中…' : '對，是這個！'}
        </button>

        {/* Smaller "not this" */}
        <button
          type="button"
          disabled={confirming}
          onClick={handleOpenManualPicker}
          className="w-full py-2 px-4 text-sm text-gray-500 hover:text-gray-700 underline underline-offset-2 disabled:opacity-60"
        >
          不是這個，手動選課
        </button>

        <button type="button" onClick={onRetry} className="text-xs text-gray-400 hover:text-gray-600 py-1 text-center">
          重新上傳
        </button>
      </div>
    );
  }

  // Tier 2: medium confidence — show top-3 cards
  const topThree = candidates.slice(0, 3);
  return (
    <div className="flex flex-col gap-6 px-4 py-8 max-w-md mx-auto">
      <div className="text-center">
        <div className="text-4xl mb-2" aria-hidden="true">🤔</div>
        <h1 className="text-xl font-bold text-gray-900">可能是哪一課？</h1>
        <p className="mt-1 text-sm text-gray-500">AI 有點不確定，請選正確的課文</p>
      </div>

      <div className="flex flex-col gap-3">
        {topThree.map((c, idx) => (
          <button
            key={c.lesson_id}
            type="button"
            disabled={confirming}
            onClick={() => handleConfirm(c.lesson_id, `${c.grade_code} ${c.title}`)}
            className={`
              flex items-start gap-3 w-full rounded-2xl px-4 py-4 text-left transition-all
              border-2 hover:border-blue-400 hover:bg-blue-50
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500
              disabled:opacity-60
              ${idx === 0 ? 'border-blue-200 bg-white' : 'border-gray-200 bg-white'}
            `}
          >
            <div className="shrink-0 mt-0.5">
              <span className={`text-xs font-semibold rounded-lg px-2 py-1 ${idx === 0 ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-500'}`}>
                {c.grade_code}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className={`font-semibold text-gray-900 ${idx === 0 ? 'text-base' : 'text-sm'}`}>
                {c.title}
              </p>
              <p className="text-xs text-gray-400 mt-0.5 line-clamp-1">{c.reasoning}</p>
              <div className="mt-2 flex items-center gap-1.5">
                <div
                  className="h-1.5 rounded-full bg-blue-300"
                  style={{ width: `${Math.round(c.confidence * 100)}%`, maxWidth: '80px', minWidth: '4px' }}
                />
                <span className="text-xs text-gray-400">{Math.round(c.confidence * 100)}%</span>
              </div>
            </div>
          </button>
        ))}
      </div>

      <button
        type="button"
        disabled={confirming}
        onClick={handleOpenManualPicker}
        className="w-full text-sm text-gray-500 hover:text-gray-700 underline underline-offset-2 py-1 disabled:opacity-60"
      >
        都不是，手動選課
      </button>

      <button type="button" onClick={onRetry} className="text-xs text-gray-400 hover:text-gray-600 py-1 text-center">
        重新上傳
      </button>
    </div>
  );
};

export default OmoIdentifyResult;
