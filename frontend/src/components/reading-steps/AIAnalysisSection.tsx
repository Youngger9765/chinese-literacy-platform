import React, { useState, useCallback } from 'react';
import { getAIAnalysis, AIAnalysisResponse } from '../../services/learningApi';
import { useAuth } from '../../contexts/AuthContext';

interface AIAnalysisSectionProps {
  storyTitle: string;
  accuracy: number;
  cpm: number;
  errorChars: string[];
  totalCharacters: number;
  /** DB session ID for server-side caching (Issue #415) */
  dbSessionId?: number | null;
  /** Comprehension score 0-100 from Socratic dialogue evaluation (Issue #415) */
  comprehensionScore?: number | null;
  /** Number of vocab characters practiced (Issue #415) */
  vocabPracticedCount?: number | null;
  /** Total vocab characters in lesson (Issue #415) */
  vocabTotalCount?: number | null;
  /** Dictation correct word count (Issue #415) */
  dictationCorrectCount?: number | null;
  /** Dictation total word count (Issue #415) */
  dictationTotalCount?: number | null;
}

const AIAnalysisSection: React.FC<AIAnalysisSectionProps> = ({
  storyTitle,
  accuracy,
  cpm,
  errorChars,
  totalCharacters,
  dbSessionId,
  comprehensionScore,
  vocabPracticedCount,
  vocabTotalCount,
  dictationCorrectCount,
  dictationTotalCount,
}) => {
  const { token } = useAuth();
  const [analysis, setAnalysis] = useState<AIAnalysisResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAnalysis = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const result = await getAIAnalysis(
        token,
        {
          storyTitle,
          accuracy,
          cpm,
          errorChars,
          totalCharacters,
          comprehensionScore,
          vocabPracticedCount,
          vocabTotalCount,
          dictationCorrectCount,
          dictationTotalCount,
        },
        dbSessionId ?? undefined,
      );
      setAnalysis(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI 分析失敗');
    } finally {
      setLoading(false);
    }
  }, [token, storyTitle, accuracy, cpm, errorChars, totalCharacters, dbSessionId, comprehensionScore, vocabPracticedCount, vocabTotalCount, dictationCorrectCount, dictationTotalCount]);

  // Not logged in
  if (!token) {
    return (
      <div className="p-6 bg-gray-50 rounded-2xl text-center">
        <p className="text-sm text-gray-400">請先登入以使用 AI 分析功能</p>
      </div>
    );
  }

  // Loading state
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-8 gap-3">
        <div className="w-8 h-8 border-3 border-accent border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-gray-500">小語老師正在分析你的朗讀表現...</p>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="p-6 bg-red-50 rounded-2xl text-center space-y-3">
        <p className="text-sm text-red-600 font-bold">無法產生 AI 分析</p>
        <p className="text-xs text-red-400">{error}</p>
        <button
          onClick={fetchAnalysis}
          className="text-sm text-accent hover:text-accent-hover font-bold"
        >
          重試
        </button>
      </div>
    );
  }

  // Initial state — show generate button
  if (!analysis) {
    return (
      <div className="flex flex-col items-center justify-center py-6 gap-4">
        <p className="text-sm text-gray-500">點擊下方按鈕，讓小語老師幫你分析朗讀表現</p>
        <button
          onClick={fetchAnalysis}
          className="inline-flex items-center gap-2 bg-accent hover:bg-accent-hover text-white px-6 py-3 rounded-xl font-bold transition-all shadow-md hover:shadow-lg"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          </svg>
          產生 AI 分析
        </button>
      </div>
    );
  }

  // Render analysis results
  return (
    <div className="space-y-5">
      {/* Summary card */}
      <div className="bg-accent/5 rounded-2xl p-5">
        <p className="text-sm text-gray-700 leading-relaxed">{analysis.analysis_summary}</p>
      </div>

      {/* Strengths */}
      {analysis.strengths.length > 0 && (
        <div>
          <p className="text-xs text-gray-500 font-bold mb-2">你的優點</p>
          <div className="flex flex-wrap gap-2">
            {analysis.strengths.map((s, idx) => (
              <span
                key={idx}
                className="inline-flex items-center gap-1 bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm font-medium px-3 py-1.5 rounded-lg"
              >
                <svg className="w-4 h-4 text-emerald-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                </svg>
                {s}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Areas for improvement */}
      {analysis.areas_for_improvement.length > 0 && (
        <div>
          <p className="text-xs text-gray-500 font-bold mb-2">可以加強的地方</p>
          <div className="flex flex-wrap gap-2">
            {analysis.areas_for_improvement.map((item, idx) => (
              <span
                key={idx}
                className="inline-flex items-center gap-1 bg-amber-50 border border-amber-200 text-amber-700 text-sm font-medium px-3 py-1.5 rounded-lg"
              >
                <svg className="w-4 h-4 text-amber-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
                {item}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Practice suggestions */}
      {analysis.practice_suggestions.length > 0 && (
        <div>
          <p className="text-xs text-gray-500 font-bold mb-2">練習建議</p>
          <div className="space-y-2">
            {analysis.practice_suggestions.map((suggestion, idx) => (
              <div key={idx} className="flex items-start gap-3 p-3 bg-slate-50 rounded-xl">
                <span className="w-6 h-6 rounded-full bg-accent/10 text-accent text-xs font-semibold flex items-center justify-center shrink-0">
                  {idx + 1}
                </span>
                <p className="text-sm text-gray-700">{suggestion}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Encouragement */}
      {analysis.encouragement_message && (
        <div className="bg-gradient-to-r from-accent/10 to-violet-100 rounded-2xl p-5 text-center">
          <p className="text-base font-bold text-accent">{analysis.encouragement_message}</p>
        </div>
      )}
    </div>
  );
};

export default AIAnalysisSection;
