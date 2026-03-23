/**
 * DialogueHistory — shows the full Socratic comprehension dialogue for a past session.
 *
 * Route: /sessions/:sessionId/dialogue
 * Issue #242
 */

import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import {
  fetchDialogueHistory,
  DialogueTurnItem,
  DialogueHistoryResponse,
} from '../../services/learningApi';

// ── helpers ──────────────────────────────────────────────────────────────────

const PHASE_LABEL: Record<string, string> = {
  factual: '事實理解',
  inferential: '推論思考',
  evaluative: '評估反思',
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('zh-TW', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ── sub-components ────────────────────────────────────────────────────────────

const AiBubble: React.FC<{ text: string; phase: string | null }> = ({ text, phase }) => (
  <div className="flex gap-2.5">
    <div className="flex-shrink-0 w-7 h-7 rounded-full bg-accent flex items-center justify-center mt-1">
      <span className="text-white text-[10px] font-bold">AI</span>
    </div>
    <div className="flex-1 max-w-[85%]">
      {phase && (
        <span className="inline-block mb-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-accent-bg text-accent">
          {PHASE_LABEL[phase] ?? phase}
        </span>
      )}
      <div className="bg-accent-bg border border-accent-bg-subtle rounded-2xl rounded-tl-sm px-4 py-3">
        <p className="text-base text-accent-hover leading-relaxed">{text}</p>
      </div>
    </div>
  </div>
);

const StudentBubble: React.FC<{ text: string }> = ({ text }) => (
  <div className="flex gap-2.5 flex-row-reverse">
    <div className="flex-shrink-0 w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center mt-1">
      <svg className="w-3.5 h-3.5 text-gray-900" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
          d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
      </svg>
    </div>
    <div className="max-w-[85%]">
      <div className="bg-accent rounded-2xl rounded-tr-sm px-4 py-3">
        <p className="text-base text-white leading-relaxed">{text}</p>
      </div>
    </div>
  </div>
);

const FeedbackBubble: React.FC<{ text: string; isCorrect: boolean | null }> = ({ text, isCorrect }) => (
  <div className="mx-10">
    <div
      className={`rounded-xl px-3.5 py-2 text-sm border ${
        isCorrect
          ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
          : 'bg-amber-50 border-amber-300 text-amber-800'
      }`}
    >
      <span className="mr-1.5">{isCorrect ? '✓' : '💡'}</span>
      {text}
    </div>
  </div>
);

function renderTurn(turn: DialogueTurnItem): React.ReactNode {
  switch (turn.role) {
    case 'ai':
      return <AiBubble key={turn.id} text={turn.text} phase={turn.phase} />;
    case 'student':
      return <StudentBubble key={turn.id} text={turn.text} />;
    case 'feedback':
      return <FeedbackBubble key={turn.id} text={turn.text} isCorrect={turn.is_correct} />;
    default:
      return null;
  }
}

// ── main component ────────────────────────────────────────────────────────────

const DialogueHistory: React.FC = () => {
  const { sessionId } = useParams<{ sessionId: string }>();
  const { token } = useAuth();
  const navigate = useNavigate();

  const [data, setData] = useState<DialogueHistoryResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token || !sessionId) return;
    const id = parseInt(sessionId, 10);
    if (isNaN(id)) {
      setError('無效的對話 ID');
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError('');
    fetchDialogueHistory(token, id)
      .then(setData)
      .catch((err) => setError(err.message || '無法載入對話記錄'))
      .finally(() => setIsLoading(false));
  }, [token, sessionId]);

  // ── header ──
  const headerTitle = data?.story_slug
    ? `課文理解對話 — ${data.story_slug}`
    : '課文理解對話記錄';

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50">
      {/* Top bar */}
      <div className="sticky top-0 z-10 bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3">
        <button
          onClick={() => navigate(-1)}
          className="text-sm text-gray-500 hover:text-gray-700 transition-colors flex items-center gap-1"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
          </svg>
          返回
        </button>
        <div className="h-4 w-px bg-gray-200" />
        <h1 className="text-sm font-semibold text-gray-800 truncate flex-1">{headerTitle}</h1>
        {data && (
          <span className="text-xs text-gray-400 shrink-0">
            共 {data.total} 則訊息
          </span>
        )}
      </div>

      {/* Content */}
      <div className="max-w-2xl mx-auto px-4 py-6 space-y-5">
        {isLoading && (
          <div className="flex flex-col items-center gap-3 py-20">
            <div className="w-7 h-7 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-gray-400">載入中...</span>
          </div>
        )}

        {!isLoading && error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
            {error}
            <button
              onClick={() => navigate(-1)}
              className="ml-2 underline cursor-pointer"
            >
              返回
            </button>
          </div>
        )}

        {!isLoading && !error && data && data.turns.length === 0 && (
          <div className="text-center py-20">
            <div className="inline-flex items-center justify-center w-14 h-14 bg-accent-bg rounded-xl mb-4">
              <svg className="w-7 h-7 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <p className="text-sm font-medium text-gray-700 mb-1">這次學習沒有對話記錄</p>
            <p className="text-xs text-gray-500">課文理解對話記錄會顯示在這裡</p>
          </div>
        )}

        {!isLoading && !error && data && data.turns.length > 0 && (
          <>
            {/* Intro message */}
            <div className="flex gap-2.5">
              <div className="flex-shrink-0 w-7 h-7 rounded-full bg-accent flex items-center justify-center mt-1">
                <span className="text-white text-[10px] font-bold">AI</span>
              </div>
              <div className="flex-1">
                <div className="bg-accent-bg border border-accent-bg-subtle rounded-2xl rounded-tl-sm px-4 py-3">
                  <p className="text-base text-accent-hover leading-relaxed">
                    {data.story_slug
                      ? `你讀完了《${data.story_slug}》，以下是你的理解對話記錄。`
                      : '以下是你的課文理解對話記錄。'}
                  </p>
                </div>
                <p className="text-xs text-gray-400 mt-1 ml-1">
                  {formatDate(data.turns[0]?.created_at)}
                </p>
              </div>
            </div>

            {data.turns.map(renderTurn)}
          </>
        )}
      </div>
    </div>
  );
};

export default DialogueHistory;
