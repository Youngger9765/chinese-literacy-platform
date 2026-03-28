import React, { useEffect, useState, useCallback } from 'react';
import { getErrorPatterns, markErrorCorrected, type ErrorPatternItem } from '../../services/progressApi';
import { useAuth } from '../../contexts/AuthContext';

interface Props {
  storySlug?: string | null;
  onBatchPractice?: (characters: string[]) => void;
}

/**
 * ErrorPatternsCard - Shows frequently-errored characters with severity coding.
 *
 * Color-coded by severity:
 * - 2-3 errors = yellow (warning)
 * - 4+ errors = red (critical)
 *
 * When storySlug is provided, filters errors to that story only (threshold = 1 error).
 * Supports batch selection for launching practice on multiple characters at once.
 */
const ErrorPatternsCard: React.FC<Props> = ({ storySlug, onBatchPractice }) => {
  const { token, user } = useAuth();
  const [patterns, setPatterns] = useState<ErrorPatternItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const fetchPatterns = useCallback(async () => {
    if (!token || !user) return;
    try {
      setLoading(true);
      setError(null);
      setSelected(new Set());
      const data = await getErrorPatterns(token, user.id, storySlug ?? undefined);
      setPatterns(data.patterns);
    } catch (err) {
      setError('載入錯誤字型資料失敗');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [token, user, storySlug]);

  useEffect(() => {
    fetchPatterns();
  }, [fetchPatterns]);

  const handleMarkCorrected = async (character: string, type: 'practice' | 'mastered') => {
    if (!token || !user) return;
    try {
      setActionLoading(character);
      await markErrorCorrected(token, user.id, character, type);
      await fetchPatterns();
    } catch (err) {
      console.error('Failed to mark correction:', err);
    } finally {
      setActionLoading(null);
    }
  };

  const toggleSelect = (character: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(character)) {
        next.delete(character);
      } else {
        next.add(character);
      }
      return next;
    });
  };

  const practiceablePatterns = patterns.filter((p) => !p.is_corrected);

  const handleSelectAll = () => {
    if (selected.size === practiceablePatterns.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(practiceablePatterns.map((p) => p.character)));
    }
  };

  const handleBatchPractice = () => {
    if (onBatchPractice && selected.size > 0) {
      onBatchPractice(Array.from(selected));
    }
  };

  const getSeverityClass = (count: number): string => {
    if (count >= 4) return 'bg-red-50 border-red-200';
    return 'bg-yellow-50 border-yellow-200';
  };

  const getSeverityBadgeClass = (count: number): string => {
    if (count >= 4) return 'bg-red-100 text-red-700';
    return 'bg-yellow-100 text-yellow-700';
  };

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="text-lg font-bold text-gray-900 mb-4">常見錯字</h3>
        <div className="flex items-center justify-center py-8">
          <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="text-lg font-bold text-gray-900 mb-4">常見錯字</h3>
        <p className="text-sm text-red-500">{error}</p>
      </div>
    );
  }

  if (patterns.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="text-lg font-bold text-gray-900 mb-4">常見錯字</h3>
        <p className="text-sm text-gray-500">
          {storySlug ? '這篇課文沒有需要加強的錯字' : '目前沒有重複錯誤的字，繼續保持！'}
        </p>
      </div>
    );
  }

  const allSelected =
    practiceablePatterns.length > 0 && selected.size === practiceablePatterns.length;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-bold text-gray-900">常見錯字</h3>
        {onBatchPractice && practiceablePatterns.length > 0 && (
          <div className="flex items-center gap-2">
            <button
              onClick={handleSelectAll}
              className="text-xs font-medium text-blue-600 hover:text-blue-800 underline"
            >
              {allSelected ? '取消全選' : '全選'}
            </button>
            {selected.size > 0 && (
              <button
                onClick={handleBatchPractice}
                className="px-3 py-1.5 text-xs font-medium bg-accent text-white rounded-lg hover:bg-accent/90 transition-colors"
              >
                批量練習 ({selected.size})
              </button>
            )}
          </div>
        )}
      </div>
      <div className="space-y-3">
        {patterns.map((pattern) => (
          <div
            key={pattern.character}
            className={`rounded-lg border p-4 flex items-center justify-between ${
              pattern.is_corrected
                ? 'bg-green-50 border-green-200 opacity-60'
                : getSeverityClass(pattern.total_error_count)
            }`}
          >
            <div className="flex items-center gap-3">
              {onBatchPractice && !pattern.is_corrected && (
                <input
                  type="checkbox"
                  checked={selected.has(pattern.character)}
                  onChange={() => toggleSelect(pattern.character)}
                  className="w-4 h-4 rounded border-gray-300 text-accent cursor-pointer"
                  aria-label={`選擇 ${pattern.character}`}
                />
              )}
              <span className="text-3xl font-bold text-gray-900">{pattern.character}</span>
              <div>
                <div className="flex items-center gap-2">
                  <span
                    className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                      pattern.is_corrected
                        ? 'bg-green-100 text-green-700'
                        : getSeverityBadgeClass(pattern.total_error_count)
                    }`}
                  >
                    {pattern.is_corrected
                      ? '已掌握'
                      : `錯 ${pattern.total_error_count} 次`}
                  </span>
                  <span className="text-xs text-gray-500">
                    {pattern.sessions_with_error} 個課堂
                  </span>
                </div>
                {pattern.last_error_date && (
                  <span className="text-xs text-gray-400 mt-1 block">
                    最近錯誤：{new Date(pattern.last_error_date).toLocaleDateString('zh-TW')}
                  </span>
                )}
              </div>
            </div>

            {!pattern.is_corrected && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleMarkCorrected(pattern.character, 'practice')}
                  disabled={actionLoading === pattern.character}
                  className="px-3 py-1.5 text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors disabled:opacity-50"
                >
                  練習
                </button>
                <button
                  onClick={() => handleMarkCorrected(pattern.character, 'mastered')}
                  disabled={actionLoading === pattern.character}
                  className="px-3 py-1.5 text-xs font-medium bg-green-50 text-green-700 border border-green-200 rounded-lg hover:bg-green-100 transition-colors disabled:opacity-50"
                >
                  已掌握
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default ErrorPatternsCard;
