/**
 * LeagueProgressTab — ClassroomTabs 「跨班賽季」progress tab (teacher-only;
 * label renamed from 班級賽 2026-10-16, code identifiers unchanged).
 *
 * Lists this classroom's current/latest league season and its roster,
 * 尚未參與 (not yet participated) FIRST, in neutral grey (not red) — PRD
 * §10 UIUX: "誰還沒參與只有老師看得到（標「尚未參與」，不用紅色）".
 *
 * 2026-10-16 UI redesign (#3554 follow-up, PRD §12.4): replaces the plain
 * `divide-y` list with a class-summary card (energy bar toward the season's
 * badge threshold) on top of the same roster list, restyled.
 */
import React, { useEffect, useState } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import {
  getSeasonBoard,
  getTeamRosterProgress,
  listClassroomSeasons,
  LeagueApiError,
  type LeagueBoardRow,
  type LeagueClassroomSeason,
  type LeagueRosterProgressEntry,
} from '../../../services/leagueApi';
import EnergyBar from '../../../components/league/EnergyBar';
import { chestHintText, displayPoints } from '../../../components/league/leagueVisuals';
import { DEFAULT_THEME_FALLBACK } from '../../../components/league/leagueTheme';

interface LeagueProgressTabProps {
  classroomId: number;
}

const LeagueProgressTab: React.FC<LeagueProgressTabProps> = ({ classroomId }) => {
  const { token } = useAuth();
  const [seasons, setSeasons] = useState<LeagueClassroomSeason[]>([]);
  const [activeSeasonId, setActiveSeasonId] = useState<number | null>(null);
  const [boardRow, setBoardRow] = useState<LeagueBoardRow | null>(null);
  // #3615: the chest wording follows this season's story pack.
  const [chestName, setChestName] = useState<string>(DEFAULT_THEME_FALLBACK.chest.name);
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
      setBoardRow(null);
      return;
    }
    setRoster(null);
    setBoardRow(null);
    getSeasonBoard(token, activeSeasonId)
      .then((board) => {
        const row = board.board.find((r) => r.classroom_id === classroomId);
        if (!row) {
          setRoster([]);
          return;
        }
        setBoardRow(row);
        setChestName((board.theme ?? DEFAULT_THEME_FALLBACK).chest.name);
        return getTeamRosterProgress(token, activeSeasonId, row.team_id).then(setRoster);
      })
      .catch((err) => setError(err instanceof LeagueApiError ? err.message : '載入排行榜失敗'));
  }, [token, activeSeasonId, classroomId]);

  if (loading) {
    return <div className="p-5 text-on-surface-variant">載入中…</div>;
  }
  if (error) {
    return <div className="p-5 text-error text-sm">{error}</div>;
  }
  // 無賽季 state
  if (seasons.length === 0) {
    return (
      <div className="p-5 text-center text-on-surface-variant text-sm">
        這個班級還沒有參加任何跨班賽季。到「跨班賽季」頁面建立或接受跨班邀請即可開始。
      </div>
    );
  }

  return (
    <div className="p-5 space-y-4">
      {seasons.length > 1 && (
        <select
          className="border border-surface-dim bg-surface-container-lowest rounded-xl px-3 py-2 text-sm text-on-surface"
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

      {boardRow && (
        <div className="rounded-2xl bg-gradient-to-br from-accent to-accent/80 p-4 shadow-sm">
          <EnergyBar
            label="班級平均"
            points={boardRow.average_points}
            threshold={boardRow.badge_threshold}
            badgeEarned={boardRow.team_badge_earned}
            tone="accent"
          />
          <p className="mt-2 text-[11px] text-white/80">
            {chestHintText(chestName, boardRow.treasure_chest_eligible, boardRow.treasure_chest_participants_needed)}
          </p>
        </div>
      )}

      {roster === null ? (
        <div className="text-on-surface-variant/70 text-sm">載入名單中…</div>
      ) : roster.length === 0 ? (
        <div className="text-on-surface-variant/70 text-sm">這個賽季目前沒有班級名單。</div>
      ) : (
        <ul className="divide-y divide-surface-container-high rounded-2xl bg-surface-container-lowest shadow-card overflow-hidden">
          {roster.map((entry) => (
            <li key={entry.student_id} className="flex items-center justify-between px-4 py-2.5 text-sm">
              <span className="text-on-surface">{entry.student_name}</span>
              {entry.participated ? (
                <span className="text-success font-bold">{displayPoints(entry.points)} 分</span>
              ) : (
                <span className="text-on-surface-variant/70">尚未參與</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default LeagueProgressTab;
