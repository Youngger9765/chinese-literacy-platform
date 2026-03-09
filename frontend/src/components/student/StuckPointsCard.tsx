import React, { useEffect, useState, useCallback } from 'react';
import { getRecommendations, type RecommendationItem } from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';

const ACTION_ICON: Record<string, string> = {
  declining: '📉',
  story_stuck: '📖',
  character_stuck: '✍️',
  encouragement: '🌟',
};

/**
 * StuckPointsCard — student-facing learning suggestion panel (Issue #91).
 *
 * Shows personalised recommendations based on detected stuck-points.
 * Encouragement-only when no issues are found.
 */
const StuckPointsCard: React.FC = () => {
  const { token, user } = useAuth();
  const [recommendations, setRecommendations] = useState<RecommendationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRecommendations = useCallback(async () => {
    if (!token || !user) return;
    try {
      setLoading(true);
      setError(null);
      const data = await getRecommendations(token, user.id);
      setRecommendations(data.recommendations);
    } catch (err) {
      setError('載入學習建議失敗');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [token, user]);

  useEffect(() => {
    fetchRecommendations();
  }, [fetchRecommendations]);

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="text-lg font-bold text-gray-900 mb-4">老師建議你...</h3>
        <div className="flex items-center justify-center py-8">
          <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="text-lg font-bold text-gray-900 mb-4">老師建議你...</h3>
        <p className="text-sm text-red-500">{error}</p>
      </div>
    );
  }

  const isEncouragementOnly =
    recommendations.length === 1 && recommendations[0].type === 'encouragement';

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <h3 className="text-lg font-bold text-gray-900 mb-4">老師建議你...</h3>

      {isEncouragementOnly ? (
        <div className="flex items-start gap-3 bg-green-50 border border-green-200 rounded-lg p-4">
          <span className="text-2xl">🌟</span>
          <div>
            <p className="text-sm font-semibold text-green-800">{recommendations[0].title}</p>
            <p className="text-sm text-green-700 mt-1">{recommendations[0].description}</p>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {recommendations.map((rec, idx) => (
            <RecommendationCard key={idx} rec={rec} />
          ))}
        </div>
      )}
    </div>
  );
};

interface RecommendationCardProps {
  rec: RecommendationItem;
}

const RecommendationCard: React.FC<RecommendationCardProps> = ({ rec }) => {
  const borderClass =
    rec.type === 'declining'
      ? 'border-orange-200 bg-orange-50'
      : rec.type === 'story_stuck'
        ? 'border-yellow-200 bg-yellow-50'
        : rec.type === 'character_stuck'
          ? 'border-red-200 bg-red-50'
          : 'border-blue-200 bg-blue-50';

  const titleClass =
    rec.type === 'declining'
      ? 'text-orange-900'
      : rec.type === 'story_stuck'
        ? 'text-yellow-900'
        : rec.type === 'character_stuck'
          ? 'text-red-900'
          : 'text-blue-900';

  const descClass =
    rec.type === 'declining'
      ? 'text-orange-700'
      : rec.type === 'story_stuck'
        ? 'text-yellow-700'
        : rec.type === 'character_stuck'
          ? 'text-red-700'
          : 'text-blue-700';

  const icon = ACTION_ICON[rec.type] ?? '💡';

  return (
    <div className={`flex items-start gap-3 rounded-lg border p-4 ${borderClass}`}>
      <span className="text-xl flex-shrink-0">{icon}</span>
      <div className="min-w-0">
        <p className={`text-sm font-semibold ${titleClass}`}>{rec.title}</p>
        <p className={`text-sm mt-1 ${descClass}`}>{rec.description}</p>
        <p className={`text-xs font-medium mt-2 ${descClass}`}>
          建議動作：{rec.action}
        </p>
      </div>
    </div>
  );
};

export default StuckPointsCard;
