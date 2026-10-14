/**
 * LeagueProgressTab — ClassroomTabs 「班級賽」progress tab (teacher-only).
 *
 * Lists this classroom's current/latest league season and its roster,
 * 尚未參與 (not yet participated) FIRST, in neutral grey (not red) — PRD
 * §10 UIUX: "誰還沒參與只有老師看得到（標「尚未參與」，不用紅色）".
 */
import React, { useEffect, useState } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import {
  getSeasonBoard,
  getTeamRosterProgress,
  listClassroomSeasons,
  LeagueApiError,
  type LeagueClassroomSeason,
  type LeagueRosterProgressEntry,
} from '../../../services/leagueApi';

interface LeagueProgressTabProps {
  classroomId: number;
}

const LeagueProgressTab: React.FC<LeagueProgressTabProps> = ({ classroomId }) => {
  const { token } = useAuth();
  const [seasons, setSeasons] = useState<LeagueClassroomSeason[]>([]);
  const [activeSeasonId, setActiveSeasonId] = useState<number | null>(null);
  const [roster, setRoster] = useState<LeagueRosterProgressEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    listClassroomSeasons(token, classroomId)
      .then((list) => {
        setSeasons(list);
        if (list.length > 0) setActiveSeasonId(list[0].season_id);
      })
      .catch((err) => setError(err instanceof LeagueApiError ? err.message : '載入失敗'))
      .finally(() => setLoading(false));
  }, [token, classroomId]);

  useEffect(() => {
    if (!token || activeSeasonId == null) {
      setRoster(null);
      return;
    }
    setRoster(null);
    getSeasonBoard(token, activeSeasonId)
      .then((board) => {
        const row = board.board.find((r) => r.classroom_id === classroomId);
        if (!row) {
          setRoster([]);
          return;
        }
        return getTeamRosterProgress(token, activeSeasonId, row.team_id).then(setRoster);
      })
      .catch((err) => setError(err instanceof LeagueApiError ? err.message : '載入排行榜失敗'));
  }, [token, activeSeasonId, classroomId]);

  if (loading) {
    return <div className="p-5 text-gray-500">載入中…</div>;
  }
  if (error) {
    return <div className="p-5 text-red-600 text-sm">{error}</div>;
  }
  // 無賽季 state
  if (seasons.length === 0) {
    return (
      <div className="p-5 text-center text-gray-500 text-sm">
        這個班級還沒有參加任何班級賽季。到「班級賽」頁面建立或接受跨班邀請即可開始。
      </div>
    );
  }

  return (
    <div className="p-5 space-y-4">
      {seasons.length > 1 && (
        <select
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
          value={activeSeasonId ?? ''}
          onChange={(e) => setActiveSeasonId(Number(e.target.value))}
        >
          {seasons.map((s) => (
            <option key={s.season_id} value={s.season_id}>
              {s.name}
            </option>
          ))}
        </select>
      )}

      {roster === null ? (
        <div className="text-gray-400 text-sm">載入名單中…</div>
      ) : roster.length === 0 ? (
        <div className="text-gray-400 text-sm">這個賽季目前沒有班級名單。</div>
      ) : (
        <ul className="divide-y divide-gray-100">
          {roster.map((entry) => (
            <li key={entry.student_id} className="flex items-center justify-between py-2 text-sm">
              <span className="text-gray-900">{entry.student_name}</span>
              {entry.participated ? (
                <span className="text-emerald-700">{entry.points} 分</span>
              ) : (
                <span className="text-gray-400">尚未參與</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default LeagueProgressTab;
