/* eslint-disable no-use-before-define -- pre-existing pattern, not TDZ risk (#2289) */
/**
 * AchievementsPage — full gamification dashboard for students.
 *
 * Route: /achievements
 * Issue #26
 *
 * Shows:
 *   - XP level and progress bar (PointsBadge)
 *   - Streak indicator (StreakIndicator)
 *   - All badges (AchievementCard) — unlocked first, then locked
 */

import React, { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import PointsBadge, { LevelInfo } from '../../components/gamification/PointsBadge';
import StreakIndicator, { StreakData } from '../../components/gamification/StreakIndicator';
import AchievementCard, { BadgeInfo } from '../../components/gamification/AchievementCard';
import { getGamificationSummary, GamificationSummary } from '../../services/gamificationApi';

const AchievementsPage: React.FC = () => {
  const { user, token } = useAuth();
  const [summary, setSummary] = useState<GamificationSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user || !token) return;
    setLoading(true);
    getGamificationSummary(user.id, token)
      .then(setSummary)
      .catch((err) => setError(err.message ?? '載入失敗'))
      .finally(() => setLoading(false));
  }, [user, token]);

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[40vh]">
        <div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (error || !summary) {
    return (
      <div className="max-w-lg mx-auto mt-12 p-6 rounded-2xl bg-red-50 border border-red-200 text-center">
        <div className="text-3xl mb-2">😕</div>
        <div className="text-red-700 font-bold">{error ?? '資料載入失敗'}</div>
      </div>
    );
  }

  const unlockedBadges: BadgeInfo[] = summary.badges;
  const allBadges: BadgeInfo[] = summary.all_badges;
  const lockedBadges = allBadges.filter((b) => !b.unlocked);

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="text-center">
        <h1 className="text-2xl font-bold text-gray-800">我的成就</h1>
        <p className="text-gray-500 text-sm mt-1">學習積分、連續紀錄與成就徽章</p>
      </div>

      {/* Top row: XP card + Streak card */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <PointsBadge levelInfo={summary.level_info as LevelInfo} variant="full" />
        <StreakIndicator streak={summary.streak as StreakData} variant="full" />
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="完成課文" value={summary.stories_completed} unit="篇" emoji="📚" />
        <StatCard label="已解鎖成就" value={unlockedBadges.length} unit="個" emoji="🏅" />
        <StatCard label="最長連續" value={summary.streak.longest} unit="天" emoji="🔥" />
      </div>

      {/* Unlocked badges */}
      {unlockedBadges.length > 0 && (
        <section>
          <h2 className="text-base font-semibold text-gray-700 mb-3">
            已解鎖成就 ({unlockedBadges.length})
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {unlockedBadges.map((badge) => (
              <AchievementCard key={badge.key} badge={badge} size="md" />
            ))}
          </div>
        </section>
      )}

      {/* Locked badges */}
      {lockedBadges.length > 0 && (
        <section>
          <h2 className="text-base font-semibold text-gray-700 mb-3">
            待解鎖成就 ({lockedBadges.length})
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {lockedBadges.map((badge) => (
              <AchievementCard key={badge.key} badge={{ ...badge, unlocked: false }} size="md" />
            ))}
          </div>
        </section>
      )}

      {unlockedBadges.length === 0 && lockedBadges.length === 0 && (
        <div className="text-center py-8 text-gray-400">
          <div className="text-4xl mb-2">🎯</div>
          <div>完成課文學習來解鎖成就！</div>
        </div>
      )}
    </div>
  );
};

// ── Sub-components ─────────────────────────────────────────────────────────

const StatCard: React.FC<{
  label: string;
  value: number;
  unit: string;
  emoji: string;
}> = ({ label, value, unit, emoji }) => (
  <div className="rounded-2xl bg-white border border-gray-100 shadow-sm p-3 text-center">
    <div className="text-2xl mb-1">{emoji}</div>
    <div className="text-2xl font-black text-gray-800">
      {value}
      <span className="text-sm font-medium text-gray-500 ml-0.5">{unit}</span>
    </div>
    <div className="text-xs text-gray-400 mt-0.5">{label}</div>
  </div>
);

export default AchievementsPage;
