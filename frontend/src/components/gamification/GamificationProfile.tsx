/**
 * GamificationProfile — full page showing a student's XP, level,
 * badges, streak, and class leaderboard.
 *
 * Route: /gamification  (student only)
 */
import React, { useEffect, useState } from 'react';
import {
  fetchGamificationSummary,
  fetchLeaderboard,
  type GamificationSummary,
  type LeaderboardResponse,
} from '../../services/gamificationApi';
import XPBar from './XPBar';
import BadgeGrid from './BadgeGrid';
import StreakBadge from './StreakBadge';
import Leaderboard from './Leaderboard';

interface GamificationProfileProps {
  studentId: number;
  token: string;
  classroomId?: number;
}

type Tab = 'profile' | 'badges' | 'leaderboard';

const GamificationProfile: React.FC<GamificationProfileProps> = ({
  studentId,
  token,
  classroomId,
}) => {
  const [summary, setSummary] = useState<GamificationSummary | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardResponse | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('profile');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      fetchGamificationSummary(studentId, token),
      classroomId ? fetchLeaderboard(classroomId, token) : Promise.resolve(null),
    ])
      .then(([s, l]) => {
        setSummary(s);
        setLeaderboard(l);
      })
      .catch((err: Error) => {
        setError(err.message || '載入失敗');
      })
      .finally(() => setLoading(false));
  }, [studentId, token, classroomId]);

  if (loading) {
    return (
      <div className="flex justify-center items-center py-16">
        <div className="text-gray-400 text-sm animate-pulse">載入中...</div>
      </div>
    );
  }

  if (error || !summary) {
    return (
      <div className="flex flex-col items-center py-16 gap-4">
        <div className="text-4xl">😵</div>
        <p className="text-gray-500 text-sm">{error ?? '無法載入資料'}</p>
      </div>
    );
  }

  const TAB_LABELS: { id: Tab; label: string; icon: string }[] = [
    { id: 'profile', label: '我的成長', icon: '⭐' },
    { id: 'badges', label: '徽章牆', icon: '🏅' },
    { id: 'leaderboard', label: '排行榜', icon: '📊' },
  ];

  return (
    <div className="max-w-lg mx-auto px-4 py-6 space-y-4">
      {/* Header */}
      <div className="text-center">
        <h1 className="text-2xl font-black text-gray-800">我的學習成就</h1>
        <p className="text-sm text-gray-500 mt-1">繼續閱讀，提升等級！</p>
      </div>

      {/* Level + XP bar always visible */}
      <XPBar levelInfo={summary.level_info} />

      {/* Quick stats row */}
      <div className="grid grid-cols-3 gap-3 text-center">
        <div className="rounded-xl bg-blue-50 border border-blue-100 p-3">
          <div className="text-2xl font-black text-blue-600">{summary.stories_completed}</div>
          <div className="text-xs text-gray-500 mt-0.5">完成課文</div>
        </div>
        <div className="rounded-xl bg-orange-50 border border-orange-100 p-3">
          <div className="text-2xl font-black text-orange-500">{summary.streak.current}</div>
          <div className="text-xs text-gray-500 mt-0.5">連續天數</div>
        </div>
        <div className="rounded-xl bg-purple-50 border border-purple-100 p-3">
          <div className="text-2xl font-black text-purple-600">{summary.badges.length}</div>
          <div className="text-xs text-gray-500 mt-0.5">獲得徽章</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex rounded-xl bg-gray-100 p-1 gap-1">
        {TAB_LABELS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-bold transition-all ${
              activeTab === tab.id
                ? 'bg-white shadow text-gray-800'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <span>{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'profile' && (
        <div className="space-y-4">
          <StreakBadge streak={summary.streak} />

          {/* Recent badges preview */}
          {summary.badges.length > 0 && (
            <div>
              <h3 className="text-sm font-bold text-gray-600 mb-2">最新徽章</h3>
              <BadgeGrid badges={summary.badges.slice(-3)} />
            </div>
          )}

          {/* All-badge locked preview */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-bold text-gray-600">成就進度</h3>
              <button
                onClick={() => setActiveTab('badges')}
                className="text-xs text-blue-500 hover:text-blue-600"
              >
                查看全部
              </button>
            </div>
            <BadgeGrid badges={summary.all_badges} previewCount={6} />
          </div>
        </div>
      )}

      {activeTab === 'badges' && (
        <div>
          <div className="text-sm text-gray-500 mb-3">
            已解鎖 <strong>{summary.badges.length}</strong> / {summary.all_badges.length} 個徽章
          </div>
          <BadgeGrid badges={summary.all_badges} />
        </div>
      )}

      {activeTab === 'leaderboard' && (
        <div>
          {leaderboard ? (
            <Leaderboard
              entries={leaderboard.entries}
              currentStudentId={studentId}
              classroomName={undefined}
            />
          ) : (
            <div className="text-center py-12 text-gray-400 text-sm">
              需要加入班級才能看到排行榜
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default GamificationProfile;
