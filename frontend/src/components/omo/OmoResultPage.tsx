/**
 * OmoResultPage — Phase 1b: per-question grading result cards + flag modal.
 *
 * Shown after grading completes (status=graded). Displays:
 *   - Overall score banner
 *   - Gap 1: "not a worksheet" banner if every answer is blank (issue #1921)
 *   - Gap 2: identifier candidates chip list (issue #1921)
 *   - Per-question cards: student answer, correct answer, AI score, confidence bar
 *   - Gap 3: "批改有誤?" expands reasoning + ai_confidence (issue #1921)
 *   - Flag button on each card → opens FlagModal to report incorrect grading
 *
 * Props:
 *   uploadId    — the graded OmoUpload id
 *   token       — JWT for API calls
 *   lessonTitle — display name for the header
 *   answers     — OmoAnswerItem[] from the graded upload
 *   overallScore — 0–1 float, percentage shown as 0–100
 *   onRetry     — go back to upload screen
 *   candidates  — OmoCandidate[] identifier results (Gap 2)
 */
import React, { useState } from 'react';
import { flagOmoAnswer, getOmoCropSignedUrl } from '../../services/omoApi';
import type { OmoAnswerItem, OmoCandidate } from '../../services/omoApi';

// ---------------------------------------------------------------------------
// Flag Modal
// ---------------------------------------------------------------------------

interface FlagModalProps {
  uploadId: number;
  questionId: string;
  token: string;
  onClose: () => void;
  onFlagged: (questionId: string) => void;
}

const PRESET_REASONS = [
  '我的答案應該是正確的',
  '批改標準不清楚',
  '圖片辨識有誤',
  '其他原因',
];

const FlagModal: React.FC<FlagModalProps> = ({
  uploadId,
  questionId,
  token,
  onClose,
  onFlagged,
}) => {
  const [reason, setReason] = useState(PRESET_REASONS[0]);
  const [customReason, setCustomReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectiveReason =
    reason === '其他原因' ? customReason.trim() || '其他原因' : reason;

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await flagOmoAnswer(uploadId, questionId, effectiveReason, token);
      onFlagged(questionId);
      onClose();
    } catch (err) {
      setError('標記失敗，請再試一次');
      setSubmitting(false);
    }
  };

  return (
    /* Modal backdrop */
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="標記 AI 批改問題"
    >
      <div
        className="w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-bold text-gray-900 mb-1">標記批改問題</h3>
        <p className="text-sm text-gray-500 mb-4">
          你認為 AI 批改這題有誤嗎？請說明原因，幫助我們改進。
        </p>

        <div className="flex flex-col gap-2 mb-4">
          {PRESET_REASONS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setReason(r)}
              className={`text-left px-4 py-2.5 rounded-xl border text-sm font-medium transition-colors
                ${reason === r
                  ? 'border-blue-500 bg-blue-50 text-blue-700'
                  : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                }`}
            >
              {r}
            </button>
          ))}
        </div>

        {reason === '其他原因' && (
          <textarea
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-400 mb-4"
            rows={3}
            maxLength={200}
            placeholder="請描述問題（最多 200 字）"
            value={customReason}
            onChange={(e) => setCustomReason(e.target.value)}
          />
        )}

        {error && (
          <p className="text-sm text-red-600 mb-3">{error}</p>
        )}

        <div className="flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="flex-1 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white text-sm font-semibold transition-colors"
          >
            {submitting ? '送出中…' : '送出標記'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Crop Modal
// ---------------------------------------------------------------------------

interface CropModalProps {
  imageUrl: string | null;
  questionId: string;
  error: string | null;
  loading: boolean;
  onClose: () => void;
}

const CropModal: React.FC<CropModalProps> = ({
  imageUrl,
  questionId,
  error,
  loading,
  onClose,
}) => (
  <div
    className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
    onClick={onClose}
    role="dialog"
    aria-modal="true"
    aria-label={`題目 ${questionId} 截圖`}
  >
    <div
      className="relative w-full max-w-3xl max-h-[90vh] bg-white rounded-2xl shadow-xl overflow-hidden"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50">
        <p className="text-sm font-bold text-gray-800">題目 {questionId} 截圖</p>
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 rounded-full hover:bg-gray-200 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400"
          aria-label="關閉截圖"
        >
          <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div className="p-4 max-h-[calc(90vh-56px)] overflow-auto bg-gray-100">
        {loading && (
          <div className="py-16 text-center text-sm text-gray-500">載入截圖中…</div>
        )}
        {!loading && error && (
          <div className="py-16 text-center text-sm text-red-600">{error}</div>
        )}
        {!loading && !error && imageUrl && (
          <img
            src={imageUrl}
            alt={`題目 ${questionId} 作答截圖`}
            className="mx-auto max-w-full rounded-lg bg-white"
          />
        )}
      </div>
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// Score badge helper
// ---------------------------------------------------------------------------

function ScoreBadge({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const colorClass =
    pct >= 80
      ? 'bg-green-100 text-green-700'
      : pct >= 50
      ? 'bg-yellow-100 text-yellow-700'
      : 'bg-red-100 text-red-700';

  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold ${colorClass}`}>
      {pct}%
    </span>
  );
}

// ---------------------------------------------------------------------------
// Gap 1: All-blank detector
// Condition: every answer either has empty student_answer AND
// reasoning contains "空白" (indicating AI saw nothing).
// Only when ALL answers match do we show the banner.
// ---------------------------------------------------------------------------

function computeIsAllBlank(answers: OmoAnswerItem[]): boolean {
  if (answers.length === 0) return false;
  return answers.every(
    (a) => !a.student_answer && a.reasoning.includes('空白'),
  );
}

// ---------------------------------------------------------------------------
// Gap 2: Candidate chips
// ---------------------------------------------------------------------------

interface CandidateChipsProps {
  candidates: OmoCandidate[];
}

const CandidateChips: React.FC<CandidateChipsProps> = ({ candidates }) => {
  const [expanded, setExpanded] = useState(false);

  if (candidates.length === 0) return null;

  const primary = candidates[0];
  const rest = candidates.slice(1);
  const primaryPct = Math.round(primary.confidence * 100);

  return (
    <div className="bg-blue-50 border border-blue-100 rounded-2xl px-4 py-3">
      <p className="text-xs text-blue-500 font-medium mb-1.5">AI 辨識結果</p>
      {/* Primary candidate */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-sm font-semibold text-gray-800">
          {primary.grade_code}·{primary.title}
        </span>
        <span className="text-xs text-blue-600 font-medium bg-blue-100 px-2 py-0.5 rounded-full shrink-0">
          信心 {primaryPct}%
        </span>
      </div>

      {/* "不是這課？" expander — only when there are additional candidates */}
      {rest.length > 0 && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-xs text-blue-500 hover:text-blue-700 transition-colors flex items-center gap-1"
            aria-expanded={expanded}
          >
            <span aria-hidden="true">{expanded ? '▲' : '▼'}</span>
            不是這課？
          </button>

          {expanded && (
            <div className="mt-2 flex flex-col gap-1.5 pl-2 border-l-2 border-blue-200">
              {rest.map((c) => (
                <div key={c.lesson_id} className="flex items-center justify-between gap-2">
                  <span className="text-xs text-gray-600">
                    {c.grade_code}·{c.title}
                  </span>
                  <span className="text-[10px] text-gray-400 shrink-0">
                    {Math.round(c.confidence * 100)}%
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Answer Card
// ---------------------------------------------------------------------------

interface AnswerCardProps {
  answer: OmoAnswerItem;
  onFlag: (questionId: string) => void;
  onViewCrop: (questionId: string) => void;
  flagged: boolean;
}

const AnswerCard: React.FC<AnswerCardProps> = ({ answer, onFlag, onViewCrop, flagged }) => {
  const confPct = Math.round(answer.ai_confidence * 100);
  // #1721: low confidence (< 0.7) → orange ⚠️ flag so teacher knows to manually verify
  const lowConfidence = answer.ai_confidence < 0.7;

  // Gap 3: reasoning panel toggle (replaces direct flag modal open on click)
  const [reasoningExpanded, setReasoningExpanded] = useState(false);

  const handleFlagButtonClick = () => {
    setReasoningExpanded((v) => !v);
  };

  return (
    <div className={`bg-white rounded-2xl border shadow-sm p-4 ${lowConfidence ? 'border-amber-300 ring-1 ring-amber-200' : 'border-gray-100'}`}>
      {/* Header row */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <p className="text-xs text-gray-400 mb-0.5 flex items-center gap-1">
            題目 {answer.question_id}
            {lowConfidence && (
              <span
                title={`AI 信心度 ${confPct}% 偏低，建議老師確認。理由：${answer.reasoning}`}
                aria-label={`AI 信心度偏低 (${confPct}%) — 需老師確認`}
                className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-medium cursor-help"
              >
                <span aria-hidden="true">⚠️</span>
                需老師確認
              </span>
            )}
          </p>
          <p className="text-sm text-gray-500 leading-relaxed line-clamp-2">
            {answer.reasoning}
          </p>
        </div>
        <ScoreBadge score={answer.score} />
      </div>

      {/* Answer comparison */}
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div className="bg-gray-50 rounded-xl p-3">
          <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-1">你的答案</p>
          <p className="text-sm font-medium text-gray-900 break-words">
            {answer.student_answer || '（未作答）'}
          </p>
        </div>
        <div className={`rounded-xl p-3 ${answer.score >= 0.8 ? 'bg-green-50' : 'bg-red-50'}`}>
          <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-1">正確答案</p>
          <p className="text-sm font-medium text-gray-900 break-words">
            {answer.correct_answer}
          </p>
        </div>
      </div>

      {/* AI confidence bar */}
      <div className="flex items-center gap-2 mb-3">
        <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-400 rounded-full transition-all"
            style={{ width: `${confPct}%` }}
            aria-label={`AI 信心度 ${confPct}%`}
          />
        </div>
        <span className="text-[10px] text-gray-400 shrink-0">AI {confPct}%</span>
      </div>

      {/* Gap 3: Reasoning expansion panel */}
      {reasoningExpanded && (
        <div
          role="region"
          aria-label="AI 批改依據"
          className="mb-3 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5"
        >
          <p className="text-[10px] text-amber-700 font-semibold uppercase tracking-wide mb-1">
            AI 批改依據
          </p>
          <p className="text-sm text-gray-700 leading-relaxed">
            {answer.reasoning}
          </p>
          <p className="text-xs text-gray-400 mt-1.5">
            AI 信心度：<span className="font-semibold text-gray-600">{confPct}%</span>
          </p>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex justify-end gap-3">
        {answer.crop_image_url && (
          <button
            type="button"
            onClick={() => onViewCrop(answer.question_id)}
            className="text-xs text-gray-500 hover:text-sky-600 transition-colors flex items-center gap-1"
          >
            <span aria-hidden="true">📷</span>
            看截圖
          </button>
        )}
        {flagged || answer.flag ? (
          <span className="text-xs text-orange-500 font-medium flex items-center gap-1">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5" aria-hidden="true">
              <path d="M2 3a1 1 0 011-1h10a1 1 0 01.707 1.707L10.414 7l3.293 3.293A1 1 0 0113 12H3a1 1 0 01-1-1V3z" />
            </svg>
            已標記
          </span>
        ) : (
          <button
            type="button"
            onClick={handleFlagButtonClick}
            className="text-xs text-gray-400 hover:text-orange-500 transition-colors flex items-center gap-1"
            aria-expanded={reasoningExpanded}
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5" aria-hidden="true">
              <path d="M2 3a1 1 0 011-1h10a1 1 0 01.707 1.707L10.414 7l3.293 3.293A1 1 0 0113 12H3a1 1 0 01-1-1V3z" />
            </svg>
            批改有誤？
          </button>
        )}
      </div>

      {/* Flag Modal (opened from reasoning panel via separate CTA) */}
      {/* Keep FlagModal accessible: show a "送出標記" button inside the expanded panel */}
      {reasoningExpanded && !flagged && !answer.flag && (
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            onClick={() => {
              setReasoningExpanded(false);
              onFlag(answer.question_id);
            }}
            className="text-xs text-orange-500 hover:text-orange-700 underline transition-colors"
          >
            送出標記給老師
          </button>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// OmoResultPage
// ---------------------------------------------------------------------------

interface OmoResultPageProps {
  uploadId: number;
  token: string;
  lessonTitle?: string;
  answers: OmoAnswerItem[];
  overallScore: number | null;
  onRetry: () => void;
  /** Gap 2: identifier candidates from backend */
  candidates?: OmoCandidate[];
}

const OmoResultPage: React.FC<OmoResultPageProps> = ({
  uploadId,
  token,
  lessonTitle,
  answers,
  overallScore,
  onRetry,
  candidates = [],
}) => {
  const [flaggingQuestionId, setFlaggingQuestionId] = useState<string | null>(null);
  const [flaggedIds, setFlaggedIds] = useState<Set<string>>(new Set());
  const [cropModal, setCropModal] = useState<{
    questionId: string;
    imageUrl: string | null;
    loading: boolean;
    error: string | null;
  } | null>(null);

  const overallPct = overallScore !== null ? Math.round(overallScore * 100) : null;

  // Gap 1: detect all-blank submission
  const isAllBlank = computeIsAllBlank(answers);

  const handleFlagged = (questionId: string) => {
    setFlaggedIds((prev) => new Set(prev).add(questionId));
  };

  const handleViewCrop = async (questionId: string) => {
    setCropModal({ questionId, imageUrl: null, loading: true, error: null });
    try {
      const signed = await getOmoCropSignedUrl(uploadId, questionId, token);
      setCropModal({
        questionId,
        imageUrl: signed.url ?? null,
        loading: false,
        error: signed.url ? null : '這題暫時沒有可預覽的截圖',
      });
    } catch (err) {
      setCropModal({
        questionId,
        imageUrl: null,
        loading: false,
        error: '截圖載入失敗，請稍後再試',
      });
    }
  };

  // Score emoji
  const scoreEmoji =
    overallPct === null ? '📊' : overallPct >= 80 ? '🏆' : overallPct >= 50 ? '📚' : '💪';

  return (
    <div className="flex flex-col gap-5 px-4 py-6 max-w-lg mx-auto">
      {/* Overall score banner */}
      <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-100 rounded-2xl p-5 text-center">
        <div className="text-4xl mb-2" aria-hidden="true">{scoreEmoji}</div>
        {lessonTitle && (
          <p className="text-sm text-blue-600 font-medium mb-1">{lessonTitle}</p>
        )}
        <p className="text-sm text-gray-500 mb-2">批改完成</p>
        {overallPct !== null ? (
          <p className="text-4xl font-bold text-gray-900">
            {overallPct}
            <span className="text-xl text-gray-400 ml-0.5">分</span>
          </p>
        ) : (
          <p className="text-gray-400 text-sm">成績計算中</p>
        )}
        <p className="text-xs text-gray-400 mt-2">共 {answers.length} 題</p>
      </div>

      {/* Gap 1: All-blank warning banner */}
      {isAllBlank && (
        <div
          role="alert"
          className="bg-amber-50 border border-amber-300 rounded-2xl px-4 py-4 flex flex-col items-center gap-3 text-center"
        >
          <div className="text-3xl" aria-hidden="true">📷</div>
          <div>
            <p className="text-sm font-semibold text-amber-800">
              這張看起來不是填寫過的學習單，請重拍學生作答
            </p>
            <p className="text-xs text-amber-600 mt-1">
              AI 在所有作答欄位都找不到手寫字跡
            </p>
          </div>
          <button
            type="button"
            onClick={onRetry}
            className="px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold transition-colors"
          >
            重新上傳
          </button>
        </div>
      )}

      {/* Gap 2: Candidate chips */}
      {candidates.length > 0 && (
        <CandidateChips candidates={candidates} />
      )}

      {/* Per-question cards */}
      {answers.length > 0 ? (
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-gray-600 px-1">各題詳情</h2>
          {answers.map((answer) => (
            <AnswerCard
              key={answer.question_id}
              answer={answer}
              onFlag={(qid) => setFlaggingQuestionId(qid)}
              onViewCrop={handleViewCrop}
              flagged={flaggedIds.has(answer.question_id)}
            />
          ))}
        </div>
      ) : (
        <div className="text-center py-8 text-gray-400 text-sm">
          尚無詳細批改資料
        </div>
      )}

      {/* Re-upload */}
      <button
        type="button"
        onClick={onRetry}
        className="w-full py-3 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
      >
        上傳另一份學習單
      </button>

      {/* Flag Modal */}
      {flaggingQuestionId && (
        <FlagModal
          uploadId={uploadId}
          questionId={flaggingQuestionId}
          token={token}
          onClose={() => setFlaggingQuestionId(null)}
          onFlagged={handleFlagged}
        />
      )}

      {cropModal && (
        <CropModal
          imageUrl={cropModal.imageUrl}
          questionId={cropModal.questionId}
          error={cropModal.error}
          loading={cropModal.loading}
          onClose={() => setCropModal(null)}
        />
      )}
    </div>
  );
};

export default OmoResultPage;
