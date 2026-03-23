import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { getRecommendedVocab, type RecommendedVocabItem } from '../../services/progressApi';
import { useAuth } from '../../contexts/AuthContext';

/**
 * RecommendedVocab - Card showing top 10 recommended characters to practice.
 *
 * Each card shows: character (large), error count, related words.
 * Links to vocab practice step for that character.
 */
const RecommendedVocab: React.FC = () => {
  const { token, user } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState<RecommendedVocabItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchVocab = useCallback(async () => {
    if (!token || !user) return;
    try {
      setLoading(true);
      setError(null);
      const data = await getRecommendedVocab(token, user.id);
      setItems(data.items);
    } catch (err) {
      setError('載入推薦生字失敗');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [token, user]);

  useEffect(() => {
    fetchVocab();
  }, [fetchVocab]);

  const handlePractice = (_character: string) => {
    // Navigate to the write practice page — the character can be entered there
    navigate('/write');
  };

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="text-lg font-bold text-gray-900 mb-4">推薦練習生字</h3>
        <div className="flex items-center justify-center py-8">
          <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="text-lg font-bold text-gray-900 mb-4">推薦練習生字</h3>
        <p className="text-sm text-red-500">{error}</p>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="text-lg font-bold text-gray-900 mb-4">推薦練習生字</h3>
        <p className="text-sm text-gray-500">目前沒有需要加強練習的生字。</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <h3 className="text-lg font-bold text-gray-900 mb-4">推薦練習生字</h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
        {items.map((item) => (
          <button
            key={item.character}
            onClick={() => handlePractice(item.character)}
            className="flex flex-col items-center gap-2 p-4 rounded-xl border border-gray-200 bg-amber-50 hover:bg-amber-100 transition-colors group"
          >
            <span className="text-4xl font-bold text-gray-900 group-hover:text-accent transition-colors">
              {item.character}
            </span>
            <span className="text-xs text-gray-500">
              錯 {item.error_count} 次
            </span>
            {item.zhuyin && (
              <span className="text-xs text-gray-400">{item.zhuyin}</span>
            )}
            {item.related_words.length > 0 && (
              <span className="text-xs text-gray-400 truncate max-w-full">
                {item.related_words.join('、')}
              </span>
            )}
            <span className="text-xs font-medium text-accent opacity-0 group-hover:opacity-100 transition-opacity">
              去練習
            </span>
          </button>
        ))}
      </div>
    </div>
  );
};

export default RecommendedVocab;
