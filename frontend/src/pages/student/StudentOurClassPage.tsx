/**
 * StudentOurClassPage — 我們班 (student-facing "battle home" equivalent of
 * TeacherLeaguePage).
 *
 * Shows the student's own team's season(s): the same two-classroom
 * BattleHero the teacher sees (both classes' energy bars face to face),
 * the student's OWN contribution, and badge/chest status — never a
 * classmate's individual score (PRD §6/§10).
 *
 * 2026-10-16 UI redesign (#3554 follow-up, PRD §12): previously this page
 * was a plain white card with a two-stat grid — it never showed the
 * opposing classroom at all, so students never actually SAW the "跟其他班
 * 比賽" framing the feature is named after. Fetches the same season board
 * the teacher page uses (students are allowed — `_require_season_member`
 * includes any student on either team's locked roster) and renders it
 * with the same BattleHero/EnergyBar/LeagueBadgeCard components so the
 * teacher and student experiences of "跨班賽季" feel like the same
 * feature, not two different UIs built at different times.
 *
 * Route: /student/our-class
 */
import React, { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import {
  getMyLeagueHistory,
  getSeasonBoard,
  LeagueApiError,
  type LeagueMySummary,
  type LeagueSeasonBoard,
} from '../../services/leagueApi';
import BattleHero from '../../components/league/BattleHero';
import LeagueBadgeCard from '../../components/league/LeagueBadgeCard';
import { chestHintText, displayPoints } from '../../components/league/leagueVisuals';
import { DEFAULT_THEME_FALLBACK } from '../../components/league/leagueTheme';
import { findBadge } from '../../types/leagueTheme';

const StudentOurClassPage: React.FC = () => {
  const { token } = useAuth();
  const [seasons, setSeasons] = useState<LeagueMySummary[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [board, setBoard] = useState<LeagueSeasonBoard | null>(null);
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

  const activeSeasonId = seasons[activeIndex]?.season_id;
  useEffect(() => {
    if (!token || activeSeasonId == null) {
      setBoard(null);
      return;
    }
    let cancelled = false;
    setBoard(null);
    getSeasonBoard(token, activeSeasonId)
      .then((b) => {
        if (!cancelled) setBoard(b);
      })
      .catch(() => {
        // Non-fatal: the stat cards below already carry the student's own
        // numbers from getMyLeagueHistory. A board fetch failure just means
        // no BattleHero this render, not a broken page.
      });
    return () => {
      cancelled = true;
    };
  }, [token, activeSeasonId]);

  if (loading) return <div className="p-6 text-on-surface-variant">載入中…</div>;
  if (offline) return <div className="p-6 text-on-surface-variant">目前無法連線，請檢查網路後重新整理。</div>;
  if (error) return <div className="p-6 text-error">{error}</div>;

  // 無賽季 state
  if (seasons.length === 0) {
    return (
      <div className="p-6 max-w-xl mx-auto">
        <h1 className="text-xl font-bold text-on-surface mb-1">我們班</h1>
        <p className="text-sm text-on-surface-variant mb-2">和別班比幾週，平常讀課文就累積</p>
        <p className="text-on-surface-variant">老師還沒有開啟跨班賽季，等老師邀請跨班比賽後就會出現在這裡。</p>
      </div>
    );
  }

  const season = seasons[activeIndex];
  const activeTheme = season.theme ?? DEFAULT_THEME_FALLBACK;
  const individualBadge = findBadge(activeTheme, 'individual_badge');
  const classBadge = findBadge(activeTheme, 'class_badge');

  return (
    <div className="p-4 md:p-6 max-w-xl mx-auto space-y-4">
      <div>
        <h1 className="text-xl font-bold text-on-surface">我們班</h1>
        <p className="text-sm text-on-surface-variant mt-0.5">和別班比幾週，平常讀課文就累積</p>
      </div>

      {/* 多隊切換 state */}
      {seasons.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {seasons.map((s, i) => (
            <button
              key={s.season_id}
              type="button"
              className={`px-3 py-1.5 rounded-full text-sm whitespace-nowrap font-medium transition-colors ${
                i === activeIndex ? 'bg-accent text-white' : 'bg-surface-container text-on-surface-variant'
              }`}
              onClick={() => setActiveIndex(i)}
            >
              {s.season_name}
            </button>
          ))}
        </div>
      )}

      {/* ── 本季劇情：老師端看得到劇情包的標題與開場，學生也要看得到。
          用 my-history 自帶的 theme（不靠 board），所以 board 載入失敗時
          劇情一樣在，issue 3615。 ──── */}
      <section
        data-testid="student-story-intro"
        aria-label="本季劇情"
        className="bg-surface-container-lowest rounded-2xl shadow-card p-5 space-y-2"
      >
        <p className="text-xs font-medium text-accent">{activeTheme.era} · 本季劇情</p>
        <h2 className="text-lg font-bold text-on-surface">{activeTheme.title}</h2>
        {activeTheme.intro.map((paragraph, i) => (
          <p key={i} className="text-sm text-on-surface-variant leading-relaxed">
            {paragraph}
          </p>
        ))}
      </section>

      {/* ── 對戰首頁：跟老師看到的同一個能量條，學生也看得到對方班 ──── */}
      {board && board.board.length === 2 && (
        <BattleHero
          theme={board.theme ?? activeTheme}
          seasonName={board.season_name}
          rows={[board.board[0], board.board[1]]}
          viewerClassroomId={null}
          isFinalized={false}
        />
      )}

      <div className="bg-surface-container-lowest rounded-2xl shadow-card p-5 space-y-4">
        <h2 className="text-base font-bold text-on-surface">{season.season_name}</h2>

        <div className="grid grid-cols-2 gap-4">
          <div className="bg-accent-bg rounded-xl p-4 text-center">
            <p className="text-xs text-on-surface-variant mb-1">我的貢獻</p>
            <p className="text-2xl font-black text-accent">{displayPoints(season.my_points)}</p>
            <p className="text-xs text-on-surface-variant mt-1">完成 {season.my_lessons_counted} 課</p>
          </div>
          <div className="bg-success/10 rounded-xl p-4 text-center">
            <p className="text-xs text-on-surface-variant mb-1">班級平均</p>
            <p className="text-2xl font-black text-success">
              {displayPoints(season.class_average_points)}
            </p>
          </div>
        </div>

        <p className="text-sm text-on-surface-variant">
          全班 {season.participant_count}/{season.roster_size} 人已參與
          {' · '}
          {chestHintText(activeTheme.chest.name, season.treasure_chest_eligible, season.treasure_chest_participants_needed)}
        </p>

        <div className="grid grid-cols-2 gap-2">
          <LeagueBadgeCard
            kind="individual"
            earned={season.individual_badge_earned}
            title={individualBadge?.name ?? '個人徽章'}
            description={individualBadge?.description ?? `累積 ${displayPoints(season.badge_threshold)} 分達標`}
            icon={individualBadge?.art}
          />
          <LeagueBadgeCard
            kind="class"
            earned={season.class_badge_earned}
            title={classBadge?.name ?? '班級徽章'}
            description={classBadge?.description ?? '班級平均達標'}
            icon={classBadge?.art}
          />
        </div>
      </div>
    </div>
  );
};

export default StudentOurClassPage;
