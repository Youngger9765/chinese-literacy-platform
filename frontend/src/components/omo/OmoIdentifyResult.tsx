/**
 * OmoIdentifyResult — Phase 1b post-upload identification result page.
 *
 * Polls GET /api/omo/:id every 2 seconds until status transitions out of
 * "pending"/"identifying". Once "identified", shows a confidence-tiered UX:
 *
 *   HIGH (≥ 0.9)   — Big "對，是這個" button + small "不是這課" link
 *   MED  (0.4–0.9) — Three candidate cards for student to tap
 *   LOW  (< 0.4)   — "看不清楚" screen with retake + manual picker buttons
 *
 * Phase 1b:
 *   - already_graded modal: show cached score + prompt re-grade or view result
 *   - Polls through grading state, calls onGraded when status=graded
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  getOmoStatus,
  confirmOmoLesson,
  regradeOmo,
  getOmoLessons,
} from '../../services/omoApi';
import type { OmoCandidate, OmoStatus, OmoLessonItem } from '../../services/omoApi';

const POLL_INTERVAL_MS = 2000;
const MAX_POLLS = 60; // 120 seconds max (covers grading too)
const HIGH_CONFIDENCE = 0.9;
const MED_CONFIDENCE = 0.4;

interface OmoIdentifyResultProps {
  uploadId: number;
  token: string;
  /** Phase 1b: true if the upload is a dedup cache hit that is already graded */
  alreadyGraded?: boolean;
  /** Phase 1b: overall_score from the cached upload (0–1), or null if unavailable */
  cachedScore?: number | null;
  /** Called after the student confirms a lesson (grading kicks off) */
  onConfirmed?: (lessonId: number) => void;
  /** Called when polling detects status=graded */
  onGraded?: (uploadId: number) => void;
  /** Called if user wants to go back and re-upload */
  onRetry: () => void;
}

// ── Manual lesson picker modal ────────────────────────────────────────────────

interface LessonPickerModalProps {
  token: string;
  onSelect: (lessonId: number) => void;
  onClose: () => void;
}

const LessonPickerModal: React.FC<LessonPickerModalProps> = ({ token, onSelect, onClose }) => {
  const [lessons, setLessons] = useState<OmoLessonItem[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getOmoLessons(token).then((data) => {
      setLessons(data);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [token]);

  const filtered = query
    ? lessons.filter(
        (l) =>
          l.title.includes(query) ||
          l.grade_code.toLowerCase().includes(query.toLowerCase()),
      )
    : lessons;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="手動選課"
    >
      <div className="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-gray-100">
          <h2 className="font-bold text-gray-900">選擇課文</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100"
            aria-label="關閉"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
              <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
            </svg>
          </button>
        </div>

        {/* Search */}
        <div className="px-4 py-2 border-b border-gray-100">
          <input
            type="search"
            placeholder="搜尋課文名稱或年級…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm
              focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
            autoFocus
          />
        </div>

        {/* List */}
        <div className="overflow-y-auto flex-1 py-2">
          {loading && (
            <p className="text-center text-sm text-gray-400 py-8">載入中…</p>
          )}
          {!loading && filtered.length === 0 && (
            <p className="text-center text-sm text-gray-400 py-8">找不到符合的課文</p>
          )}
          {filtered.map((lesson) => (
            <button
              key={lesson.lesson_id}
              type="button"
              onClick={() => onSelect(lesson.lesson_id)}
              className="w-full flex items-center justify-between px-4 py-3 text-left
                hover:bg-blue-50 active:bg-blue-100 transition-colors"
            >
              <span className="font-medium text-gray-800 text-sm">{lesson.title}</span>
              <span className="text-xs text-gray-400 ml-3 shrink-0">{lesson.grade_code}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

// ── Main component ─────────────────────────────────────────────────────────────

const OmoIdentifyResult: React.FC<OmoIdentifyResultProps> = ({
  uploadId,
  token,
  alreadyGraded = false,
  cachedScore = null,
  onConfirmed,
  onGraded,
  onRetry,
}) => {
  const [status, setStatus] = useState<OmoStatus>('identifying');
  const [candidates, setCandidates] = useState<OmoCandidate[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [showLessonPicker, setShowLessonPicker] = useState(false);
  // Phase 1b: already-graded prompt state
  const [showAlreadyGraded, setShowAlreadyGraded] = useState(alreadyGraded);
  const [regrading, setRegrading] = useState(false);

  const pollCount = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // If already_graded, skip polling (we already have the info); else start polling
  useEffect(() => {
    if (alreadyGraded) return;

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

        const done =
          data.status !== 'pending' &&
          data.status !== 'identifying' &&
          data.status !== 'grading';
        if (done) {
          if (intervalRef.current) clearInterval(intervalRef.current);
          if (data.status === 'graded') {
            onGraded?.(uploadId);
          }
        }
      } catch (err) {
        // Transient network error — keep polling
        console.error('OMO poll error:', err);
      }
    };

    void poll();
    intervalRef.current = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [uploadId, token, alreadyGraded, onGraded]);

  const handleConfirm = async (lessonId: number) => {
    setConfirming(true);
    setShowLessonPicker(false);
    try {
      await confirmOmoLesson(uploadId, lessonId, token);
      setConfirmed(true);
      onConfirmed?.(lessonId);
      // Resume polling to catch graded state
      pollCount.current = 0;
      setStatus('grading');
      intervalRef.current = setInterval(async () => {
        pollCount.current += 1;
        if (pollCount.current > MAX_POLLS) {
          if (intervalRef.current) clearInterval(intervalRef.current);
          return;
        }
        try {
          const data = await getOmoStatus(uploadId, token);
          setStatus(data.status);
          if (data.status === 'graded') {
            if (intervalRef.current) clearInterval(intervalRef.current);
            onGraded?.(uploadId);
          }
        } catch (_) {}
      }, POLL_INTERVAL_MS);
    } catch (err) {
      console.error('OMO confirm error:', err);
      setErrorMessage('確認失敗，請再試一次');
    } finally {
      setConfirming(false);
    }
  };

  const handleRegrade = async () => {
    setRegrading(true);
    try {
      await regradeOmo(uploadId, token);
      setShowAlreadyGraded(false);
      setStatus('grading');
      // Start polling for grading completion
      pollCount.current = 0;
      intervalRef.current = setInterval(async () => {
        pollCount.current += 1;
        if (pollCount.current > MAX_POLLS) {
          if (intervalRef.current) clearInterval(intervalRef.current);
          return;
        }
        try {
          const data = await getOmoStatus(uploadId, token);
          setStatus(data.status);
          if (data.status === 'graded') {
            if (intervalRef.current) clearInterval(intervalRef.current);
            onGraded?.(uploadId);
          }
        } catch (_) {}
      }, POLL_INTERVAL_MS);
    } catch (err) {
      console.error('OMO regrade error:', err);
      setErrorMessage('重新批改失敗，請再試一次');
    } finally {
      setRegrading(false);
    }
  };

  // ── Phase 1b: already-graded modal ─────────────────────────────────────────
  if (showAlreadyGraded) {
    const scoreDisplay =
      cachedScore != null
        ? `${Math.round(cachedScore * 100)} 分`
        : '—';
    return (
      <div className="flex flex-col items-center gap-6 px-4 py-8 max-w-md mx-auto">
        <div className="text-5xl" aria-hidden="true">📋</div>
        <div className="text-center">
          <h1 className="text-xl font-bold text-gray-900">這張學習單已批改過</h1>
          {cachedScore != null && (
            <p className="mt-2 text-3xl font-bold text-blue-600">{scoreDisplay}</p>
          )}
          <p className="mt-2 text-sm text-gray-500">
            是同一張嗎？可以查看上次結果，或重新批改這次的作答
          </p>
        </div>
        <div className="flex flex-col gap-3 w-full">
          <button
            type="button"
            onClick={() => onGraded?.(uploadId)}
            className="w-full py-3.5 px-6 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-colors"
          >
            看上次結果
          </button>
          <button
            type="button"
            onClick={handleRegrade}
            disabled={regrading}
            className="w-full py-3 px-6 bg-white hover:bg-gray-50 text-gray-700 font-semibold
              rounded-xl border border-gray-300 transition-colors disabled:opacity-60"
          >
            {regrading ? '提交中…' : '重新批改'}
          </button>
        </div>
        <button
          type="button"
          onClick={onRetry}
          className="text-sm text-gray-400 hover:text-gray-600"
        >
          上傳不同的學習單
        </button>
        {errorMessage && (
          <p className="text-sm text-red-500">{errorMessage}</p>
        )}
      </div>
    );
  }

  // ── Polling states ──────────────────────────────────────────────────────────
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

  if (status === 'grading') {
    return (
      <div className="flex flex-col items-center gap-6 px-4 py-12 max-w-md mx-auto">
        <div
          className="w-16 h-16 rounded-full border-4 border-green-200 border-t-green-600 animate-spin"
          aria-label="批改中"
          role="status"
        />
        <div className="text-center">
          <p className="font-semibold text-gray-800">AI 正在批改你的作答</p>
          <p className="mt-1 text-sm text-gray-500">比對答案中，請稍候…</p>
        </div>
      </div>
    );
  }

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

  if (status === 'graded') {
    // Should already have triggered onGraded via polling; this is a fallback render
    return (
      <div className="flex flex-col items-center gap-6 px-4 py-12 max-w-md mx-auto">
        <div className="text-5xl" aria-hidden="true">✅</div>
        <p className="font-semibold text-gray-800">批改完成！</p>
      </div>
    );
  }

  // ── Confirmed — waiting for grading to start ────────────────────────────────
  if (confirmed) {
    return (
      <div className="flex flex-col items-center gap-6 px-4 py-12 max-w-md mx-auto">
        <div
          className="w-16 h-16 rounded-full border-4 border-green-200 border-t-green-600 animate-spin"
          aria-label="準備批改中"
          role="status"
        />
        <div className="text-center">
          <p className="font-semibold text-gray-800">確認完成！AI 正在批改</p>
          <p className="mt-1 text-sm text-gray-500">通常需要 15～45 秒，請稍候…</p>
        </div>
      </div>
    );
  }

  // ── Identified — 3-tier confidence UX ──────────────────────────────────────
  const topCandidate: OmoCandidate | null = candidates[0] ?? null;
  const topConfidence = topCandidate?.confidence ?? 0;

  // LOW confidence or no candidates
  if (!topCandidate || topConfidence < MED_CONFIDENCE) {
    return (
      <div className="flex flex-col items-center gap-6 px-4 py-8 max-w-md mx-auto">
        <div className="text-5xl" aria-hidden="true">😅</div>
        <div className="text-center">
          <h1 className="text-xl font-bold text-gray-900">看不清楚</h1>
          <p className="mt-1 text-sm text-gray-500">
            光線不足或字跡不清楚，AI 無法確定是哪一課
          </p>
        </div>
        <div className="flex flex-col gap-3 w-full">
          <button
            type="button"
            onClick={onRetry}
            className="w-full py-3.5 px-6 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-colors"
          >
            重拍
          </button>
          <button
            type="button"
            onClick={() => setShowLessonPicker(true)}
            className="w-full py-3 px-6 bg-white hover:bg-gray-50 text-gray-700 font-semibold
              rounded-xl border border-gray-300 transition-colors"
          >
            手動選課
          </button>
        </div>
        {showLessonPicker && (
          <LessonPickerModal
            token={token}
            onSelect={handleConfirm}
            onClose={() => setShowLessonPicker(false)}
          />
        )}
      </div>
    );
  }

  // HIGH confidence (≥ 0.9) — Big button + small "不是這課" link
  if (topConfidence >= HIGH_CONFIDENCE) {
    return (
      <div className="flex flex-col gap-6 px-4 py-8 max-w-md mx-auto">
        <div className="text-center">
          <div className="text-4xl mb-2" aria-hidden="true">🎯</div>
          <h1 className="text-xl font-bold text-gray-900">辨識結果</h1>
        </div>

        {/* Primary card */}
        <div className="bg-blue-50 border border-blue-200 rounded-2xl p-5">
          <p className="text-sm text-blue-600 font-medium mb-1">AI 很確定你的學習單是</p>
          <p className="text-2xl font-bold text-gray-900 leading-snug">
            {topCandidate.grade_code} {topCandidate.title}
          </p>
          <div className="mt-3 flex items-center gap-1.5">
            <div
              className="h-2 rounded-full bg-blue-500"
              style={{ width: `${Math.round(topConfidence * 100)}%`, maxWidth: '100%' }}
              aria-label={`信心度 ${Math.round(topConfidence * 100)}%`}
            />
            <span className="text-xs text-gray-400">
              信心度 {Math.round(topConfidence * 100)}%
            </span>
          </div>
        </div>

        {/* Big confirm button */}
        <button
          type="button"
          onClick={() => handleConfirm(topCandidate.lesson_id)}
          disabled={confirming}
          className="w-full py-4 px-6 bg-green-600 hover:bg-green-700 disabled:opacity-60
            text-white text-lg font-bold rounded-2xl transition-colors
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2"
        >
          {confirming ? '確認中…' : '對，是這個！'}
        </button>

        {/* Small "not this lesson" controls */}
        <div className="flex items-center justify-center gap-4">
          <button
            type="button"
            onClick={() => setShowLessonPicker(true)}
            className="text-sm text-gray-400 hover:text-gray-700 underline underline-offset-2"
          >
            不是這課，手動選
          </button>
          <span className="text-gray-200">|</span>
          <button
            type="button"
            onClick={onRetry}
            className="text-sm text-gray-400 hover:text-gray-700 underline underline-offset-2"
          >
            重新上傳
          </button>
        </div>

        {errorMessage && <p className="text-sm text-red-500 text-center">{errorMessage}</p>}

        {showLessonPicker && (
          <LessonPickerModal
            token={token}
            onSelect={handleConfirm}
            onClose={() => setShowLessonPicker(false)}
          />
        )}
      </div>
    );
  }

  // MED confidence (0.4–0.9) — Three candidate cards
  const displayCandidates = candidates.slice(0, 3);
  return (
    <div className="flex flex-col gap-6 px-4 py-8 max-w-md mx-auto">
      <div className="text-center">
        <div className="text-4xl mb-2" aria-hidden="true">🔍</div>
        <h1 className="text-xl font-bold text-gray-900">選一下是哪一課</h1>
        <p className="mt-1 text-sm text-gray-500">AI 找到幾個可能的課文，請選對的那個</p>
      </div>

      {/* Three candidate cards */}
      <div className="flex flex-col gap-3">
        {displayCandidates.map((candidate) => (
          <button
            key={candidate.lesson_id}
            type="button"
            onClick={() => handleConfirm(candidate.lesson_id)}
            disabled={confirming}
            className="w-full flex items-center justify-between bg-white border border-gray-200
              hover:border-blue-400 hover:bg-blue-50 active:bg-blue-100
              rounded-2xl px-5 py-4 text-left transition-colors
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400
              disabled:opacity-60"
          >
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-gray-900 text-base leading-snug">
                {candidate.title}
              </p>
              <p className="text-sm text-gray-400 mt-0.5">{candidate.grade_code}</p>
            </div>
            <div className="ml-4 shrink-0 text-right">
              <span className="text-sm font-semibold text-blue-600">
                {Math.round(candidate.confidence * 100)}%
              </span>
            </div>
          </button>
        ))}
      </div>

      {/* Manual picker fallback */}
      <div className="flex items-center justify-center gap-4">
        <button
          type="button"
          onClick={() => setShowLessonPicker(true)}
          className="text-sm text-gray-400 hover:text-gray-700 underline underline-offset-2"
        >
          都不是，手動選課
        </button>
        <span className="text-gray-200">|</span>
        <button
          type="button"
          onClick={onRetry}
          className="text-sm text-gray-400 hover:text-gray-700 underline underline-offset-2"
        >
          重新上傳
        </button>
      </div>

      {errorMessage && <p className="text-sm text-red-500 text-center">{errorMessage}</p>}

      {showLessonPicker && (
        <LessonPickerModal
          token={token}
          onSelect={handleConfirm}
          onClose={() => setShowLessonPicker(false)}
        />
      )}
    </div>
  );
};

export default OmoIdentifyResult;
