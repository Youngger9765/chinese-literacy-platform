/**
 * TeacherLeaguePage — 跨班賽季 (teacher-facing; code identifier/route stay
 * `league` / `/teacher/league` — only the user-facing label changed,
 * 2026-10-16 #3554 follow-up, Young-approved).
 *
 * Lets a classroom owner: create a one-time invite code for a cross-class
 * invitational, preview + accept/decline a code someone shared with them,
 * and see the class-average board + anomaly list for each season their
 * classroom has joined.
 *
 * Route: /teacher/league
 * PRD: docs/prd/2026-10-14-chinese-star-league-prd.md §10 (UIUX states:
 * 無賽季 / 未報名 / 中途加入 / 多隊切換 / 已結束 / 0 分 / 離線 / 邀請失效) +
 * §12 (2026-10-16 visual redesign + feature-parity vs Junyi 星空探險隊).
 *
 * All data-fetching logic is unchanged from the MVP — this redesign only
 * reorganizes the JSX: the most recent season now renders as a prominent
 * BattleHero automatically (not hidden behind a "查看排行榜" click, per
 * Young's "大『清除進度』集體進度條" requirement), older seasons stay in a
 * collapsible history list, and the invite flow becomes a 3-step wizard
 * card instead of a stacked form.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { listMyClassrooms, type ClassroomResponse } from '../../services/classroomApi';
import {
  acceptInvitation,
  createInvitation,
  declineInvitation,
  getSeasonBoard,
  getTeamAnomalies,
  listClassroomSeasons,
  listInvitations,
  previewInvitation,
  revokeInvitation,
  LeagueApiError,
  type LeagueAnomalyEntry,
  type LeagueClassroomSeason,
  type LeagueInvitation,
  type LeagueInvitationPreview,
  type LeagueSeasonBoard,
} from '../../services/leagueApi';
import BattleHero from '../../components/league/BattleHero';
import LeagueBadgeCard from '../../components/league/LeagueBadgeCard';
import { displayPoints } from '../../components/league/leagueVisuals';

const INVITATION_STATUS_LABEL: Record<string, string> = {
  pending: '等待對方接受',
  accepted: '已接受',
  declined: '已婉拒',
  expired: '邀請失效',
  revoked: '已撤回',
};

export function invitationStatusLabel(status: string): string {
  return INVITATION_STATUS_LABEL[status] ?? status;
}

function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ---------------------------------------------------------------------------
// Small presentational helpers local to this page
// ---------------------------------------------------------------------------

const SectionCard: React.FC<{ title: string; children: React.ReactNode; icon?: string }> = ({
  title,
  children,
  icon,
}) => (
  <section className="bg-surface-container-lowest rounded-3xl shadow-card p-5">
    <h2 className="text-base font-bold text-on-surface mb-4 flex items-center gap-2">
      {icon && <span aria-hidden="true">{icon}</span>}
      {title}
    </h2>
    {children}
  </section>
);

const inputClass =
  'w-full border border-surface-dim bg-surface-container-lowest rounded-xl px-3 py-2.5 text-on-surface focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-shadow';

const primaryButtonClass =
  'bg-accent hover:bg-accent-hover text-white rounded-xl px-5 py-2.5 text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-sm';

const secondaryButtonClass =
  'bg-surface-container text-on-surface rounded-xl px-5 py-2.5 text-sm font-bold hover:bg-surface-container-high transition-colors';

const TeacherLeaguePage: React.FC = () => {
  const { token, user } = useAuth();
  const [classrooms, setClassrooms] = useState<ClassroomResponse[]>([]);
  const [selectedClassroomId, setSelectedClassroomId] = useState<number | null>(null);
  const [invitations, setInvitations] = useState<LeagueInvitation[]>([]);
  const [seasons, setSeasons] = useState<LeagueClassroomSeason[]>([]);
  const [boards, setBoards] = useState<Record<number, LeagueSeasonBoard>>({});
  const [anomalies, setAnomalies] = useState<Record<string, LeagueAnomalyEntry[]>>({});
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Invite flow state (wizard step)
  const [inviteStep, setInviteStep] = useState<1 | 2>(1);
  const [inviteGrade, setInviteGrade] = useState(4);
  const [inviteStart, setInviteStart] = useState('');
  const [inviteEnd, setInviteEnd] = useState('');
  const [createdCode, setCreatedCode] = useState<string | null>(null);

  // Accept-by-code flow state
  const [codeInput, setCodeInput] = useState('');
  const [preview, setPreview] = useState<LeagueInvitationPreview | null>(null);
  const [acceptGrade, setAcceptGrade] = useState(4);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [joinMode, setJoinMode] = useState<'create' | 'join'>('create');

  const ownedClassrooms = classrooms.filter((c) => c.teacher_id === user?.id);

  const loadClassroomData = useCallback(
    async (classroomId: number) => {
      if (!token) return;
      try {
        const [invs, seasonList] = await Promise.all([
          listInvitations(token, classroomId),
          listClassroomSeasons(token, classroomId),
        ]);
        setInvitations(invs);
        setSeasons(seasonList);
        setOffline(false);
      } catch (err) {
        if (err instanceof TypeError) {
          setOffline(true); // network failure, not an API error
        } else {
          setError(err instanceof Error ? err.message : '載入失敗');
        }
      }
    },
    [token],
  );

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    listMyClassrooms(token)
      .then((res) => {
        setClassrooms(res.items);
        const owned = res.items.filter((c) => c.teacher_id === user?.id);
        if (owned.length > 0) setSelectedClassroomId(owned[0].id);
      })
      .catch((err) => {
        if (err instanceof TypeError) setOffline(true);
        else setError(err instanceof Error ? err.message : '載入失敗');
      })
      .finally(() => setLoading(false));
  }, [token, user?.id]);

  useEffect(() => {
    if (selectedClassroomId != null) {
      void loadClassroomData(selectedClassroomId);
    }
  }, [selectedClassroomId, loadClassroomData]);

  // Auto-load the most recent season's board (PRD §12.2 decision #3: the
  // battle hero is a dashboard, not something hidden behind a click).
  const primarySeason = seasons[0];
  useEffect(() => {
    if (!token || !primarySeason) return;
    let cancelled = false;
    getSeasonBoard(token, primarySeason.season_id)
      .then((board) => {
        if (!cancelled) setBoards((prev) => ({ ...prev, [primarySeason.season_id]: board }));
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof LeagueApiError ? err.message : '載入排行榜失敗');
      });
    return () => {
      cancelled = true;
    };
  }, [token, primarySeason]);

  const handleCreateInvitation = async () => {
    if (!token || selectedClassroomId == null || !inviteStart || !inviteEnd) return;
    try {
      const inv = await createInvitation(token, {
        inviter_classroom_id: selectedClassroomId,
        inviter_team_grade: inviteGrade,
        game_start: new Date(inviteStart).toISOString(),
        game_end: new Date(inviteEnd).toISOString(),
      });
      setCreatedCode(inv.code);
      await loadClassroomData(selectedClassroomId);
    } catch (err) {
      setError(err instanceof LeagueApiError ? err.message : '建立邀請失敗');
    }
  };

  const handlePreview = async () => {
    if (!token || !codeInput.trim()) return;
    setPreviewError(null);
    setPreview(null);
    try {
      const p = await previewInvitation(token, codeInput.trim());
      setPreview(p);
    } catch (err) {
      setPreviewError(err instanceof LeagueApiError ? err.message : '查詢邀請碼失敗');
    }
  };

  const handleAccept = async () => {
    if (!token || selectedClassroomId == null || !preview) return;
    try {
      await acceptInvitation(token, preview.code, {
        invitee_classroom_id: selectedClassroomId,
        invitee_team_grade: acceptGrade,
      });
      setPreview(null);
      setCodeInput('');
      await loadClassroomData(selectedClassroomId);
    } catch (err) {
      setPreviewError(err instanceof LeagueApiError ? err.message : '接受邀請失敗');
    }
  };

  const handleDecline = async () => {
    if (!token || !preview || selectedClassroomId == null) return;
    try {
      await declineInvitation(token, preview.code, selectedClassroomId);
      setPreview(null);
      setCodeInput('');
    } catch (err) {
      setPreviewError(err instanceof LeagueApiError ? err.message : '婉拒邀請失敗');
    }
  };

  const handleRevoke = async (invitationId: number) => {
    if (!token || selectedClassroomId == null) return;
    try {
      await revokeInvitation(token, invitationId);
      await loadClassroomData(selectedClassroomId);
    } catch (err) {
      setError(err instanceof LeagueApiError ? err.message : '撤回邀請失敗');
    }
  };

  const toggleBoard = async (seasonId: number) => {
    if (!token) return;
    if (boards[seasonId]) {
      setBoards((prev) => {
        const next = { ...prev };
        delete next[seasonId];
        return next;
      });
      return;
    }
    try {
      const board = await getSeasonBoard(token, seasonId);
      setBoards((prev) => ({ ...prev, [seasonId]: board }));
    } catch (err) {
      setError(err instanceof LeagueApiError ? err.message : '載入排行榜失敗');
    }
  };

  const toggleAnomalies = async (seasonId: number, teamId: number) => {
    if (!token) return;
    const key = `${seasonId}-${teamId}`;
    if (anomalies[key]) {
      setAnomalies((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      return;
    }
    try {
      const list = await getTeamAnomalies(token, seasonId, teamId);
      setAnomalies((prev) => ({ ...prev, [key]: list }));
    } catch (err) {
      setError(err instanceof LeagueApiError ? err.message : '載入異常名單失敗');
    }
  };

  if (loading) {
    return <div className="p-6 text-on-surface-variant">載入中…</div>;
  }

  if (offline) {
    return (
      <div className="p-6">
        <p className="text-on-surface-variant">目前無法連線，請檢查網路後重新整理頁面。</p>
      </div>
    );
  }

  if (ownedClassrooms.length === 0) {
    return (
      <div className="p-6">
        <h1 className="text-xl font-bold text-on-surface mb-1">跨班賽季</h1>
        <p className="text-sm text-on-surface-variant mb-2">和別班比幾週，平常讀課文就累積</p>
        <p className="text-on-surface-variant">你目前沒有自己擔任班級擁有者的班級，無法建立跨班邀請賽。</p>
      </div>
    );
  }

  const primaryBoard = primarySeason ? boards[primarySeason.season_id] : undefined;
  const olderSeasons = primarySeason ? seasons.slice(1) : seasons;
  const myRow = primaryBoard?.board.find((r) => r.classroom_id === selectedClassroomId);

  return (
    <div className="min-h-full bg-surface">
      <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-6">
        <div>
          <h1 className="text-xl font-bold text-on-surface">讀家星圖 · 跨班賽季</h1>
          <p className="text-sm text-on-surface-variant mt-0.5">和別班比幾週，平常讀課文就累積</p>
        </div>

        {error && (
          <div className="bg-error/10 text-error text-sm rounded-xl p-3" role="alert">
            {error}
          </div>
        )}

        {ownedClassrooms.length > 1 && (
          <div>
            <label className="block text-sm text-on-surface-variant mb-1" htmlFor="league-classroom-select">
              選擇班級
            </label>
            <select
              id="league-classroom-select"
              className={inputClass}
              value={selectedClassroomId ?? ''}
              onChange={(e) => setSelectedClassroomId(Number(e.target.value))}
            >
              {ownedClassrooms.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* ── 對戰首頁：最新賽季的能量條（PRD §12 Young 指定需求）──────── */}
        {primarySeason && primaryBoard && primaryBoard.board.length === 2 && (
          <BattleHero
            seasonName={primaryBoard.season_name}
            rows={[primaryBoard.board[0], primaryBoard.board[1]]}
            viewerClassroomId={selectedClassroomId}
            isFinalized={primarySeason.is_finalized}
          />
        )}

        {/* ── 徽章（班級達標視覺）────────────────────────────────── */}
        {myRow && (
          <div className="grid grid-cols-2 gap-3 max-w-xs">
            <LeagueBadgeCard
              kind="class"
              earned={myRow.team_badge_earned}
              title="班級徽章"
              description={`平均 ${displayPoints(myRow.badge_threshold)} 分達標`}
            />
            <LeagueBadgeCard
              kind="class"
              earned={myRow.treasure_chest_eligible}
              title="神秘寶箱"
              description="全班過半參與即可解鎖"
            />
          </div>
        )}

        {seasons.length === 0 && (
          <SectionCard title="本班賽季" icon="🏳️">
            <p className="text-on-surface-variant text-sm">
              目前沒有賽季 — 建立或接受一組跨班邀請即可開始。
            </p>
          </SectionCard>
        )}

        {/* ── 邀請精靈（建立 / 加入，二擇一）──────────────────────── */}
        <SectionCard title="跨班邀請賽" icon="✉️">
          <div className="flex gap-2 mb-4">
            <button
              type="button"
              className={`flex-1 rounded-xl py-2 text-sm font-bold transition-colors ${
                joinMode === 'create' ? 'bg-accent text-white' : 'bg-surface-container text-on-surface-variant'
              }`}
              onClick={() => setJoinMode('create')}
            >
              發出邀請
            </button>
            <button
              type="button"
              className={`flex-1 rounded-xl py-2 text-sm font-bold transition-colors ${
                joinMode === 'join' ? 'bg-accent text-white' : 'bg-surface-container text-on-surface-variant'
              }`}
              onClick={() => setJoinMode('join')}
            >
              輸入邀請碼
            </button>
          </div>

          {joinMode === 'create' &&
            (createdCode ? (
              <div className="bg-accent-bg rounded-2xl p-4 text-center">
                <p className="text-sm text-on-surface-variant mb-2">邀請碼已建立，請把這組代碼分享給對方老師：</p>
                <p className="text-3xl font-mono font-black tracking-[0.3em] text-accent">{createdCode}</p>
                <button
                  type="button"
                  className="mt-3 text-sm text-accent underline font-medium"
                  onClick={() => {
                    setCreatedCode(null);
                    setInviteStep(1);
                  }}
                >
                  建立下一組邀請
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Step indicator */}
                <div className="flex items-center gap-2 text-xs text-on-surface-variant">
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center font-bold ${inviteStep === 1 ? 'bg-accent text-white' : 'bg-accent-bg text-accent'}`}>1</span>
                  設定年級
                  <span className="flex-1 border-t border-surface-dim mx-1" />
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center font-bold ${inviteStep === 2 ? 'bg-accent text-white' : 'bg-surface-container text-on-surface-variant'}`}>2</span>
                  設定比賽時間
                </div>

                {inviteStep === 1 ? (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm text-on-surface-variant mb-1" htmlFor="invite-grade">
                        本班參賽年級
                      </label>
                      <input
                        id="invite-grade"
                        type="number"
                        min={3}
                        max={9}
                        className={inputClass}
                        value={inviteGrade}
                        onChange={(e) => setInviteGrade(Number(e.target.value))}
                      />
                    </div>
                    <button type="button" className={primaryButtonClass} onClick={() => setInviteStep(2)}>
                      下一步
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm text-on-surface-variant mb-1" htmlFor="invite-start">
                          開始時間
                        </label>
                        <input
                          id="invite-start"
                          type="datetime-local"
                          className={inputClass}
                          value={inviteStart}
                          min={toLocalInputValue(new Date())}
                          onChange={(e) => setInviteStart(e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="block text-sm text-on-surface-variant mb-1" htmlFor="invite-end">
                          結束時間
                        </label>
                        <input
                          id="invite-end"
                          type="datetime-local"
                          className={inputClass}
                          value={inviteEnd}
                          onChange={(e) => setInviteEnd(e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button type="button" className={secondaryButtonClass} onClick={() => setInviteStep(1)}>
                        上一步
                      </button>
                      <button
                        type="button"
                        className={primaryButtonClass}
                        disabled={!inviteStart || !inviteEnd}
                        onClick={handleCreateInvitation}
                      >
                        產生邀請碼
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}

          {joinMode === 'join' && (
            <div className="space-y-3">
              <div className="flex gap-2">
                <input
                  type="text"
                  className={`${inputClass} font-mono tracking-widest`}
                  placeholder="例如 AB3CD9EF"
                  value={codeInput}
                  onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
                />
                <button type="button" className={secondaryButtonClass} onClick={handlePreview}>
                  查詢
                </button>
              </div>
              {previewError && <p className="text-sm text-error">{previewError}</p>}
              {preview && preview.status !== 'pending' && (
                <p className="text-sm text-on-surface-variant">
                  這組邀請碼目前狀態是「{invitationStatusLabel(preview.status)}」，無法使用。
                </p>
              )}
              {preview && preview.status === 'pending' && (
                <div className="bg-surface-container-low rounded-2xl p-4 space-y-3">
                  <p className="text-sm text-on-surface">
                    邀請來自「{preview.inviter_classroom_name}」（{preview.inviter_team_grade} 年級）
                  </p>
                  <div>
                    <label className="block text-sm text-on-surface-variant mb-1" htmlFor="accept-grade">
                      本班參賽年級
                    </label>
                    <input
                      id="accept-grade"
                      type="number"
                      min={3}
                      max={9}
                      className={inputClass}
                      value={acceptGrade}
                      onChange={(e) => setAcceptGrade(Number(e.target.value))}
                    />
                  </div>
                  <div className="flex gap-2">
                    <button type="button" className="bg-success text-white rounded-xl px-5 py-2.5 text-sm font-bold" onClick={handleAccept}>
                      接受邀請
                    </button>
                    <button type="button" className={secondaryButtonClass} onClick={handleDecline}>
                      婉拒
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </SectionCard>

        {/* ── 邀請紀錄 ─────────────────────────────────────────────── */}
        {invitations.length > 0 && (
          <SectionCard title="邀請紀錄" icon="📜">
            <ul className="space-y-2">
              {invitations.map((inv) => (
                <li key={inv.id} className="flex items-center justify-between text-sm border-b border-surface-container-high pb-2 last:border-0 last:pb-0">
                  <span className="font-mono text-on-surface">{inv.code}</span>
                  <span className="text-on-surface-variant">{invitationStatusLabel(inv.status)}</span>
                  {inv.status === 'pending' && inv.inviter_classroom_id === selectedClassroomId && (
                    <button type="button" className="text-tertiary underline font-medium" onClick={() => handleRevoke(inv.id)}>
                      撤回
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </SectionCard>
        )}

        {/* ── 歷史賽季（較舊的賽季，摺疊）──────────────────────────── */}
        {olderSeasons.length > 0 && (
          <SectionCard title="歷史賽季" icon="🗂️">
            <ul className="space-y-3">
              {olderSeasons.map((s) => (
                <li key={s.season_id} className="border border-surface-container-high rounded-2xl p-3">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-on-surface">{s.name}</span>
                    <span className="text-xs text-on-surface-variant">{s.is_finalized ? '已結束' : '進行中'}</span>
                  </div>
                  <button
                    type="button"
                    className="text-sm text-accent underline mt-1 font-medium"
                    onClick={() => toggleBoard(s.season_id)}
                  >
                    {boards[s.season_id] ? '收起排行榜' : '查看班級平均榜'}
                  </button>
                  {boards[s.season_id] && (
                    <table className="w-full mt-2 text-sm">
                      <thead>
                        <tr className="text-left text-on-surface-variant">
                          <th className="py-1">名次</th>
                          <th className="py-1">班級</th>
                          <th className="py-1">平均分</th>
                          <th className="py-1">參與人數</th>
                          <th className="py-1" />
                        </tr>
                      </thead>
                      <tbody>
                        {boards[s.season_id].board.map((row) => (
                          <tr key={row.team_id} className="border-t border-surface-container">
                            <td className="py-1">{row.rank}</td>
                            <td className="py-1">{row.classroom_name}</td>
                            <td className="py-1">{displayPoints(row.average_points)}</td>
                            <td className="py-1">
                              全班 {row.participant_count}/{row.roster_size} 人已參與
                            </td>
                            <td className="py-1">
                              {row.classroom_id === selectedClassroomId && (
                                <button
                                  type="button"
                                  className="text-xs text-tertiary underline font-medium"
                                  onClick={() => toggleAnomalies(s.season_id, row.team_id)}
                                >
                                  異常名單
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  {Object.entries(anomalies)
                    .filter(([key]) => key.startsWith(`${s.season_id}-`))
                    .map(([key, list]) => (
                      <div key={key} className="mt-2 bg-tertiary-container/15 rounded-xl p-2 text-sm">
                        {list.length === 0 ? (
                          <p className="text-on-surface-variant">沒有異常紀錄</p>
                        ) : (
                          <ul className="space-y-1">
                            {list.map((a) => (
                              <li key={a.student_id}>
                                {a.student_name}：
                                {a.anomalies.map((x) => (x.reason === 'too_fast' ? '完成太快' : '超過每日上限')).join('、')}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ))}
                </li>
              ))}
            </ul>
          </SectionCard>
        )}

        {/* ── 當前賽季的異常名單入口（放在首頁 hero 底下，teacher-only）── */}
        {primarySeason && myRow && (
          <div>
            <button
              type="button"
              className="text-xs text-tertiary underline font-medium"
              onClick={() => toggleAnomalies(primarySeason.season_id, myRow.team_id)}
            >
              {anomalies[`${primarySeason.season_id}-${myRow.team_id}`] ? '收起異常名單' : '查看本班異常名單'}
            </button>
            {anomalies[`${primarySeason.season_id}-${myRow.team_id}`] && (
              <div className="mt-2 bg-tertiary-container/15 rounded-xl p-3 text-sm">
                {anomalies[`${primarySeason.season_id}-${myRow.team_id}`].length === 0 ? (
                  <p className="text-on-surface-variant">沒有異常紀錄</p>
                ) : (
                  <ul className="space-y-1">
                    {anomalies[`${primarySeason.season_id}-${myRow.team_id}`].map((a) => (
                      <li key={a.student_id}>
                        {a.student_name}：
                        {a.anomalies.map((x) => (x.reason === 'too_fast' ? '完成太快' : '超過每日上限')).join('、')}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default TeacherLeaguePage;
