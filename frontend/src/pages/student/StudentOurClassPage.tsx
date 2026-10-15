/**
 * StudentOurClassPage — 我們班 (student-facing).
 *
 * Shows the student's own team's season(s): class average, "全班 X/Y 人已
 * 參與" participation, and the student's OWN contribution — never a
 * classmate's individual score (PRD §6/§10).
 *
 * Route: /student/our-class
 */
import React, { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import {
  getMyLeagueHistory,
  LeagueApiError,
  type LeagueMySummary,
} from '../../services/leagueApi';

const StudentOurClassPage: React.FC = () => {
  const { token } = useAuth();
  const [seasons, setSeasons] = useState<LeagueMySummary[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    getMyLeagueHistory(token)
      .then(setSeasons)
      .catch((err) => {
        if (err instanceof TypeError) setOffline(true);
        else setError(err instanceof LeagueApiError ? err.message : '載入失敗');
      })
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) return <div className="p-6 text-gray-500">載入中…</div>;
  if (offline) return <div className="p-6 text-gray-600">目前無法連線，請檢查網路後重新整理。</div>;
  if (error) return <div className="p-6 text-red-600">{error}</div>;

  // 無賽季 state
  if (seasons.length === 0) {
    return (
      <div className="p-6 max-w-xl mx-auto">
        <h1 className="text-xl font-semibold text-gray-900 mb-2">我們班</h1>
        <p className="text-gray-500">老師還沒有開啟班級賽季，等老師邀請跨班比賽後就會出現在這裡。</p>
      </div>
    );
  }

  const season = seasons[activeIndex];

  return (
    <div className="p-4 md:p-6 max-w-xl mx-auto space-y-4">
      <h1 className="text-xl font-semibold text-gray-900">我們班</h1>

      {/* 多隊切換 state */}
      {seasons.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {seasons.map((s, i) => (
            <button
              key={s.season_id}
              type="button"
              className={`px-3 py-1.5 rounded-full text-sm whitespace-nowrap ${
                i === activeIndex ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'
              }`}
              onClick={() => setActiveIndex(i)}
            >
              {s.season_name}
            </button>
          ))}
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-card p-5 space-y-4">
        <h2 className="text-base font-medium text-gray-900">{season.season_name}</h2>

        <div className="grid grid-cols-2 gap-4">
          <div className="bg-blue-50 rounded-xl p-4 text-center">
            <p className="text-xs text-gray-500 mb-1">我的貢獻</p>
            <p className="text-2xl font-bold text-blue-700">{season.my_points}</p>
            <p className="text-xs text-gray-500 mt-1">完成 {season.my_lessons_counted} 課</p>
          </div>
          <div className="bg-emerald-50 rounded-xl p-4 text-center">
            <p className="text-xs text-gray-500 mb-1">班級平均</p>
            <p className="text-2xl font-bold text-emerald-700">
              {season.class_average_points.toFixed(1)}
            </p>
          </div>
        </div>

        <p className="text-sm text-gray-600">
          全班 {season.participant_count}/{season.roster_size} 人已參與
        </p>

        <div className="flex gap-2 flex-wrap">
          {season.individual_badge_earned && (
            <span className="bg-amber-100 text-amber-800 text-xs rounded-full px-3 py-1">
              🏅 個人達標徽章
            </span>
          )}
          {season.class_badge_earned && (
            <span className="bg-purple-100 text-purple-800 text-xs rounded-full px-3 py-1">
              🏆 班級達標徽章
            </span>
          )}
          {!season.individual_badge_earned && !season.class_badge_earned && (
            <span className="text-xs text-gray-400">繼續加油，還沒有徽章喔</span>
          )}
        </div>
      </div>
    </div>
  );
};

export default StudentOurClassPage;
