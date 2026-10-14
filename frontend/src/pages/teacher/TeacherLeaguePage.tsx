/**
 * TeacherLeaguePage — 班級賽 (teacher-facing).
 *
 * Lets a classroom owner: create a one-time invite code for a cross-class
 * invitational, preview + accept/decline a code someone shared with them,
 * and see the class-average board + anomaly list for each season their
 * classroom has joined.
 *
 * Route: /teacher/league
 * PRD: docs/prd/2026-10-14-chinese-star-league-prd.md §10 (UIUX states:
 * 無賽季 / 未報名 / 中途加入 / 多隊切換 / 已結束 / 0 分 / 離線 / 邀請失效).
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

function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

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

  // Invite flow state
  const [inviteGrade, setInviteGrade] = useState(4);
  const [inviteStart, setInviteStart] = useState('');
  const [inviteEnd, setInviteEnd] = useState('');
  const [createdCode, setCreatedCode] = useState<string | null>(null);

  // Accept-by-code flow state
  const [codeInput, setCodeInput] = useState('');
  const [preview, setPreview] = useState<LeagueInvitationPreview | null>(null);
  const [acceptGrade, setAcceptGrade] = useState(4);
  const [previewError, setPreviewError] = useState<string | null>(null);

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
    if (!token || !preview) return;
    try {
      await declineInvitation(token, preview.code);
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
    return <div className="p-6 text-gray-500">載入中…</div>;
  }

  if (offline) {
    return (
      <div className="p-6">
        <p className="text-gray-600">目前無法連線，請檢查網路後重新整理頁面。</p>
      </div>
    );
  }

  if (ownedClassrooms.length === 0) {
    return (
      <div className="p-6">
        <h1 className="text-xl font-semibold text-gray-900 mb-2">班級賽</h1>
        <p className="text-gray-600">你目前沒有自己擔任班級擁有者的班級，無法建立跨班邀請賽。</p>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-6">
      <h1 className="text-xl font-semibold text-gray-900">班級賽</h1>

      {error && (
        <div className="bg-red-50 text-red-700 text-sm rounded-lg p-3" role="alert">
          {error}
        </div>
      )}

      {ownedClassrooms.length > 1 && (
        <div>
          <label className="block text-sm text-gray-600 mb-1">選擇班級</label>
          <select
            className="w-full border border-gray-300 rounded-lg px-3 py-2"
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

      {/* ── 建立跨班邀請賽（3 步驟）────────────────────────────────── */}
      <section className="bg-white rounded-2xl shadow-card p-4">
        <h2 className="text-base font-medium text-gray-900 mb-3">建立跨班邀請賽</h2>
        {createdCode ? (
          <div className="bg-blue-50 rounded-lg p-4">
            <p className="text-sm text-gray-700 mb-2">邀請碼已建立，請把這組代碼分享給對方老師：</p>
            <p className="text-2xl font-mono font-bold tracking-widest text-blue-700">{createdCode}</p>
            <button
              type="button"
              className="mt-3 text-sm text-blue-600 underline"
              onClick={() => setCreatedCode(null)}
            >
              建立下一組邀請
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="block text-sm text-gray-600 mb-1">本班參賽年級</label>
              <input
                type="number"
                min={3}
                max={9}
                className="w-full border border-gray-300 rounded-lg px-3 py-2"
                value={inviteGrade}
                onChange={(e) => setInviteGrade(Number(e.target.value))}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm text-gray-600 mb-1">開始時間</label>
                <input
                  type="datetime-local"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  value={inviteStart}
                  min={toLocalInputValue(new Date())}
                  onChange={(e) => setInviteStart(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">結束時間</label>
                <input
                  type="datetime-local"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  value={inviteEnd}
                  onChange={(e) => setInviteEnd(e.target.value)}
                />
              </div>
            </div>
            <button
              type="button"
              className="bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
              disabled={!inviteStart || !inviteEnd}
              onClick={handleCreateInvitation}
            >
              產生邀請碼
            </button>
          </div>
        )}
      </section>

      {/* ── 輸入對方的邀請碼 ─────────────────────────────────────── */}
      <section className="bg-white rounded-2xl shadow-card p-4">
        <h2 className="text-base font-medium text-gray-900 mb-3">輸入邀請碼加入</h2>
        <div className="flex gap-2">
          <input
            type="text"
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 font-mono tracking-widest"
            placeholder="例如 AB3CD9EF"
            value={codeInput}
            onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
          />
          <button
            type="button"
            className="bg-gray-100 text-gray-700 rounded-lg px-4 py-2 text-sm font-medium"
            onClick={handlePreview}
          >
            查詢
          </button>
        </div>
        {previewError && <p className="text-sm text-red-600 mt-2">{previewError}</p>}
        {preview && preview.status !== 'pending' && (
          <p className="text-sm text-gray-500 mt-2">
            這組邀請碼目前狀態是「{preview.status === 'expired' ? '邀請失效' : preview.status}」，無法使用。
          </p>
        )}
        {preview && preview.status === 'pending' && (
          <div className="mt-3 bg-gray-50 rounded-lg p-3 space-y-2">
            <p className="text-sm text-gray-700">
              邀請來自「{preview.inviter_classroom_name}」（{preview.inviter_team_grade} 年級）
            </p>
            <div>
              <label className="block text-sm text-gray-600 mb-1">本班參賽年級</label>
              <input
                type="number"
                min={3}
                max={9}
                className="w-full border border-gray-300 rounded-lg px-3 py-2"
                value={acceptGrade}
                onChange={(e) => setAcceptGrade(Number(e.target.value))}
              />
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                className="bg-green-600 text-white rounded-lg px-4 py-2 text-sm font-medium"
                onClick={handleAccept}
              >
                接受邀請
              </button>
              <button
                type="button"
                className="bg-gray-200 text-gray-700 rounded-lg px-4 py-2 text-sm font-medium"
                onClick={handleDecline}
              >
                婉拒
              </button>
            </div>
          </div>
        )}
      </section>

      {/* ── 已送出 / 已接受的邀請 ───────────────────────────────── */}
      {invitations.length > 0 && (
        <section className="bg-white rounded-2xl shadow-card p-4">
          <h2 className="text-base font-medium text-gray-900 mb-3">邀請紀錄</h2>
          <ul className="space-y-2">
            {invitations.map((inv) => (
              <li key={inv.id} className="flex items-center justify-between text-sm border-b border-gray-100 pb-2">
                <span className="font-mono">{inv.code}</span>
                <span className="text-gray-500">{inv.status === 'expired' ? '邀請失效' : inv.status}</span>
                {inv.status === 'pending' && inv.inviter_classroom_id === selectedClassroomId && (
                  <button
                    type="button"
                    className="text-red-600 underline"
                    onClick={() => handleRevoke(inv.id)}
                  >
                    撤回
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── 賽季（班級平均榜 + 異常名單）───────────────────────── */}
      <section className="bg-white rounded-2xl shadow-card p-4">
        <h2 className="text-base font-medium text-gray-900 mb-3">本班賽季</h2>
        {seasons.length === 0 ? (
          <p className="text-gray-500 text-sm">目前沒有賽季 — 建立或接受一組邀請即可開始。</p>
        ) : (
          <ul className="space-y-3">
            {seasons.map((s) => (
              <li key={s.season_id} className="border border-gray-100 rounded-lg p-3">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-gray-900">{s.name}</span>
                  <span className="text-xs text-gray-500">{s.is_finalized ? '已結束' : '進行中'}</span>
                </div>
                <button
                  type="button"
                  className="text-sm text-blue-600 underline mt-1"
                  onClick={() => toggleBoard(s.season_id)}
                >
                  {boards[s.season_id] ? '收起排行榜' : '查看班級平均榜'}
                </button>
                {boards[s.season_id] && (
                  <table className="w-full mt-2 text-sm">
                    <thead>
                      <tr className="text-left text-gray-500">
                        <th className="py-1">名次</th>
                        <th className="py-1">班級</th>
                        <th className="py-1">平均分</th>
                        <th className="py-1">參與人數</th>
                        <th className="py-1" />
                      </tr>
                    </thead>
                    <tbody>
                      {boards[s.season_id].board.map((row) => (
                        <tr key={row.team_id} className="border-t border-gray-50">
                          <td className="py-1">{row.rank}</td>
                          <td className="py-1">{row.classroom_name}</td>
                          <td className="py-1">{row.average_points.toFixed(1)}</td>
                          <td className="py-1">
                            全班 {row.participant_count}/{row.roster_size} 人已參與
                          </td>
                          <td className="py-1">
                            {row.classroom_id === selectedClassroomId && (
                              <button
                                type="button"
                                className="text-xs text-amber-700 underline"
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
                    <div key={key} className="mt-2 bg-amber-50 rounded-lg p-2 text-sm">
                      {list.length === 0 ? (
                        <p className="text-gray-500">沒有異常紀錄</p>
                      ) : (
                        <ul className="space-y-1">
                          {list.map((a) => (
                            <li key={a.student_id}>
                              {a.student_name}：
                              {a.anomalies
                                .map((x) => (x.reason === 'too_fast' ? '完成太快' : '超過每日上限'))
                                .join('、')}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
};

export default TeacherLeaguePage;
