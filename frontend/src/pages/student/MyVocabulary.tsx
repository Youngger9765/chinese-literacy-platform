import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import ErrorPatternsCard from '../../components/student/ErrorPatternsCard';
import RecommendedVocab from '../../components/student/RecommendedVocab';
import { getStudentStorySlugs, StorySlugItem } from '../../services/progressApi';
import { useAuth } from '../../contexts/AuthContext';

/**
 * MyVocabulary page - "我的生字" (My Vocabulary) section.
 *
 * Shows:
 * 1. Story/lesson filter dropdown — narrow down errors by course
 * 2. Recommended vocab to practice (top 10 most-errored characters, unfiltered)
 * 3. Full list of frequently-errored characters with batch-practice selection
 *
 * Issue #438: Add story filter and batch practice entry point.
 */
const MyVocabulary: React.FC = () => {
  const { token, user } = useAuth();
  const navigate = useNavigate();

  const [storyItems, setStoryItems] = useState<StorySlugItem[]>([]);
  const [selectedSlug, setSelectedSlug] = useState<string>('');
  const [slugsLoading, setSlugsLoading] = useState(true);

  // Batch practice modal state
  const [batchChars, setBatchChars] = useState<string[]>([]);
  const [showBatchModal, setShowBatchModal] = useState(false);

  const fetchSlugs = useCallback(async () => {
    if (!token || !user) return;
    try {
      setSlugsLoading(true);
      const data = await getStudentStorySlugs(token, user.id);
      setStoryItems(data.stories ?? data.slugs.map((s) => ({ slug: s, title: s })));
    } catch (err) {
      console.error('Failed to load story slugs:', err);
    } finally {
      setSlugsLoading(false);
    }
  }, [token, user]);

  useEffect(() => {
    fetchSlugs();
  }, [fetchSlugs]);

  const handleBatchPractice = (characters: string[]) => {
    setBatchChars(characters);
    setShowBatchModal(true);
  };

  const handleStartBatchWrite = () => {
    setShowBatchModal(false);
    // Navigate to write practice; character can be entered there
    navigate('/write');
  };

  return (
    <div className="p-6 max-w-4xl mx-auto w-full overflow-y-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">我的生字</h1>
        <p className="text-sm text-gray-500 mt-1">
          根據你的學習紀錄，這些是需要加強練習的字
        </p>
      </div>

      {/* Story Filter */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <label htmlFor="story-filter" className="block text-sm font-medium text-gray-700 mb-2">
          按課文篩選
        </label>
        <div className="flex items-center gap-3">
          {slugsLoading ? (
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
              載入課文清單…
            </div>
          ) : (
            <select
              id="story-filter"
              value={selectedSlug}
              onChange={(e) => setSelectedSlug(e.target.value)}
              className="block w-full max-w-xs rounded-lg border border-gray-300 bg-white py-2 px-3 text-sm text-gray-700 shadow-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            >
              <option value="">全部課文</option>
              {storyItems.map(({ slug, title }) => (
                <option key={slug} value={slug}>
                  {title}
                </option>
              ))}
            </select>
          )}
          {selectedSlug && (
            <button
              onClick={() => setSelectedSlug('')}
              className="text-xs text-gray-400 hover:text-gray-600 underline"
            >
              清除篩選
            </button>
          )}
        </div>
      </div>

      {/* Recommended vocab — always show unfiltered top picks */}
      {!selectedSlug && <RecommendedVocab />}

      {/* Error patterns, filtered by story when a slug is selected */}
      <ErrorPatternsCard
        storySlug={selectedSlug || null}
        onBatchPractice={handleBatchPractice}
      />

      {/* Batch Practice Modal */}
      {showBatchModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          role="dialog"
          aria-modal="true"
          aria-label="批量練習"
        >
          <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full mx-4 p-6 space-y-5">
            <h2 className="text-lg font-bold text-gray-900">批量練習</h2>
            <p className="text-sm text-gray-600">
              你選了 <span className="font-semibold text-accent">{batchChars.length}</span> 個字：
            </p>
            <div className="flex flex-wrap gap-2">
              {batchChars.map((char) => (
                <span
                  key={char}
                  className="text-2xl font-bold text-gray-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2"
                >
                  {char}
                </span>
              ))}
            </div>
            <p className="text-xs text-gray-400">
              系統將帶你到筆順練習頁面，逐一練習這些生字。
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowBatchModal(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleStartBatchWrite}
                className="px-4 py-2 text-sm font-medium text-white bg-accent rounded-lg hover:bg-accent/90 transition-colors"
              >
                開始練習
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MyVocabulary;
