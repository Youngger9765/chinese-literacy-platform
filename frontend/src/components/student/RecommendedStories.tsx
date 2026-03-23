/**
 * RecommendedStories — AI personalized learning path recommendations (Issue #252).
 *
 * Shows up to 5 story cards recommended for the student based on:
 * - Their estimated grade level (from past session accuracy)
 * - Weak characters that need reinforcement
 * - Genre variety to avoid repetition
 *
 * Each card includes:
 * - Story title and grade badge
 * - Genre tag
 * - "Why recommended" tooltip/inline explanation
 * - Start learning button
 */

import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { getStoryRecommendations, type StoryRecommendationItem } from '../../services/progressApi';
import { useAuth } from '../../contexts/AuthContext';

// ── Grade display helper ─────────────────────────────────────────────────────

function gradeLabel(grade: number): string {
  const labels: Record<number, string> = {
    4: '四年級',
    5: '五年級',
    6: '六年級',
    7: '七年級',
    8: '八年級',
    9: '九年級',
  };
  return labels[grade] ?? `${grade} 年級`;
}

// ── Tooltip component ────────────────────────────────────────────────────────

interface TooltipProps {
  text: string;
  children: React.ReactNode;
}

const Tooltip: React.FC<TooltipProps> = ({ text, children }) => {
  const [visible, setVisible] = useState(false);

  return (
    <span
      className="relative inline-block"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
    >
      {children}
      {visible && (
        <span
          role="tooltip"
          className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 rounded-lg bg-gray-900 px-3 py-2 text-xs text-white shadow-lg leading-relaxed"
        >
          {text}
          <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900" />
        </span>
      )}
    </span>
  );
};

// ── Story recommendation card ────────────────────────────────────────────────

interface StoryCardProps {
  rec: StoryRecommendationItem;
  onStart: () => void;
}

const StoryRecommendationCard: React.FC<StoryCardProps> = ({ rec, onStart }) => (
  <div className="flex flex-col gap-3 p-4 rounded-xl border border-gray-200 bg-white hover:shadow-md transition-shadow">
    {/* Header: grade + genre badges */}
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-accent text-white">
        {gradeLabel(rec.grade)}
      </span>
      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
        {rec.genre}
      </span>
    </div>

    {/* Title */}
    <h4 className="font-bold text-gray-900 text-sm leading-snug line-clamp-2">
      {rec.title}
    </h4>

    {/* Reason with tooltip trigger */}
    <div className="flex items-start gap-1.5 text-xs text-gray-500 leading-relaxed">
      <Tooltip text={rec.reason}>
        <span className="shrink-0 inline-flex items-center justify-center w-4 h-4 rounded-full bg-blue-100 text-blue-600 cursor-help font-bold">
          ?
        </span>
      </Tooltip>
      <span className="line-clamp-2">{rec.reason}</span>
    </div>

    {/* Start button */}
    <button
      type="button"
      onClick={onStart}
      className="mt-auto w-full py-2 rounded-lg bg-accent hover:bg-accent-hover text-white text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
    >
      開始學習
    </button>
  </div>
);

// ── Main component ────────────────────────────────────────────────────────────

const RecommendedStories: React.FC = () => {
  const { token, user } = useAuth();
  const navigate = useNavigate();
  const [recs, setRecs] = useState<StoryRecommendationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRecs = useCallback(async () => {
    if (!token || !user) return;
    try {
      setLoading(true);
      setError(null);
      const data = await getStoryRecommendations(token, user.id, 5);
      setRecs(data.recommendations);
    } catch (err) {
      setError('載入推薦課文失敗');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [token, user]);

  useEffect(() => {
    fetchRecs();
  }, [fetchRecs]);

  const handleStart = (storySlug: string) => {
    navigate(`/learn/${storySlug}/intro`);
  };

  // ── Loading ──────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="text-lg font-bold text-gray-900 mb-4">AI 為你推薦的課文</h3>
        <div className="flex items-center justify-center py-8">
          <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  // ── Error ────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="text-lg font-bold text-gray-900 mb-4">AI 為你推薦的課文</h3>
        <p className="text-sm text-red-500">{error}</p>
      </div>
    );
  }

  // ── Empty ────────────────────────────────────────────────────────────────
  if (recs.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="text-lg font-bold text-gray-900 mb-4">AI 為你推薦的課文</h3>
        <p className="text-sm text-gray-500">目前沒有推薦課文，請先完成一些練習！</p>
      </div>
    );
  }

  // ── Normal render ────────────────────────────────────────────────────────
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-bold text-gray-900">AI 為你推薦的課文</h3>
        <span className="text-xs text-gray-400">根據你的學習歷程個人化推薦</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
        {recs.map((rec) => (
          <StoryRecommendationCard
            key={rec.story_slug}
            rec={rec}
            onStart={() => handleStart(rec.story_slug)}
          />
        ))}
      </div>
    </div>
  );
};

export default RecommendedStories;
