/**
 * TeacherTeamArenaHost — `/teacher/team-arena` (setup) and
 * `/teacher/team-arena/:code` (lobby → playing → ended), the fullscreen
 * projector page for 五人對抗賽 (issue #3632, PRD §6 "老師投影頁").
 *
 * Deliberately NOT wrapped in AppShell — same "投影頁全螢幕" precedent as
 * TeacherLiveQuizHost.tsx (PRD §6: "全螢幕，不套頁面外框").
 *
 * Unlike live_quiz's 5-file setup/lobby/question/reveal/podium split, this
 * is one file with four render branches gated on `state.status` — the
 * scope here (one classroom picker + one roster list + one match-tile
 * grid + one result list) didn't justify the extra file boundaries.
 *
 * MVP simplification (documented, not hidden): the setup form only offers
 * `scope_type: "grade_pool"` pinned to the chosen classroom's own grade —
 * picking a specific lesson (PRD's `scope_type: "lesson"` option) is left
 * for a later iteration, same "smallest thing that works" scope-cut this
 * PRD's own §12 (Phase 2 list) already applies elsewhere.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../../contexts/AuthContext';
import { listMyClassrooms, updateClassroomFeatureSettings, type ClassroomResponse } from '../../../services/classroomApi';
import {
  createTeamArenaSession,
  assignTeamArenaTeams,
  controlTeamArena,
  getTeamArenaResult,
  TeamArenaApiError,
  TEAM_ARENA_LANE_LABELS,
  TEAM_ARENA_PRIMARY_LANES,
  type TeamArenaReadingSpeed,
  type TeamArenaResult,
} from '../../../services/teamArenaApi';
import { useTeamArenaPoll } from '../../../components/team-arena/useTeamArenaPoll';
import { isTeacherState } from '../../../services/teamArenaApi';

const TURNS_OPTIONS: (1 | 2 | 3)[] = [1, 2, 3];
const SECONDS_OPTIONS: (20 | 30 | 45)[] = [20, 30, 45];
const PACE_OPTIONS: { key: TeamArenaReadingSpeed; label: string }[] = [
  { key: 'slow', label: '慢' },
  { key: 'standard', label: '標準' },
  { key: 'fast', label: '快' },
];

const TeacherTeamArenaSetup: React.FC<{ onCreated: (code: string) => void }> = ({ onCreated }) => {
  const { token } = useAuth();
  const [classrooms, setClassrooms] = useState<ClassroomResponse[]>([]);
  const [classroomId, setClassroomId] = useState<number | ''>('');
  const [turnsPerPlayer, setTurnsPerPlayer] = useState<1 | 2 | 3>(2);
  const [answerSeconds, setAnswerSeconds] = useState<20 | 30 | 45>(30);
  const [readingSpeed, setReadingSpeed] = useState<TeamArenaReadingSpeed>('standard');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [needsEnable, setNeedsEnable] = useState(false);

  useEffect(() => {
    if (!token) return;
    listMyClassrooms(token)
      .then((res) => setClassrooms(res.items))
      .catch(() => setError('班級清單載入失敗，請重新整理'));
  }, [token]);

  const selectedClassroom = classroomId === '' ? null : classrooms.find((c) => c.id === classroomId) ?? null;

  const handleCreate = async () => {
    if (!token || classroomId === '' || !selectedClassroom?.grade) return;
    setSubmitting(true);
    setError('');
    setNeedsEnable(false);
    try {
      const res = await createTeamArenaSession(token, {
        classroom_id: classroomId,
        scope_type: 'grade_pool',
        scope_ref: String(selectedClassroom.grade),
        turns_per_player: turnsPerPlayer,
        answer_seconds: answerSeconds,
        reading_speed: readingSpeed,
      });
      onCreated(res.code);
    } catch (err) {
      if (err instanceof TeamArenaApiError && err.status === 403) {
        setNeedsEnable(true);
        setError('這個班級還沒開放五人對抗賽');
      } else {
        setError(err instanceof TeamArenaApiError ? err.message : '建立失敗，請稍後再試');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleEnable = async () => {
    if (!token || classroomId === '') return;
    setSubmitting(true);
    try {
      await updateClassroomFeatureSettings(token, classroomId, { team_arena: true });
      setNeedsEnable(false);
      setError('');
      await handleCreate();
    } catch {
      setError('開放失敗，請稍後再試');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-10">
      <h1 className="mb-1 text-xl font-bold text-on-surface">五人對抗賽</h1>
      <p className="mb-6 text-sm text-on-surface-variant">五人一組，組隊競賽</p>

      <label className="mb-1 text-sm font-semibold text-on-surface">班級</label>
      <select
        value={classroomId}
        onChange={(e) => setClassroomId(e.target.value ? Number(e.target.value) : '')}
        className="mb-4 rounded-lg border border-surface-dim px-3 py-2"
      >
        <option value="">請選擇班級</option>
        {classrooms.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>

      <label className="mb-1 text-sm font-semibold text-on-surface">每人上場次數</label>
      <div className="mb-4 flex gap-2">
        {TURNS_OPTIONS.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setTurnsPerPlayer(n)}
            className={`flex-1 rounded-lg border px-3 py-2 text-sm ${turnsPerPlayer === n ? 'border-accent bg-accent-bg text-accent' : 'border-surface-dim text-on-surface-variant'}`}
          >
            {n} 次
          </button>
        ))}
      </div>

      <label className="mb-1 text-sm font-semibold text-on-surface">作答秒數</label>
      <div className="mb-4 flex gap-2">
        {SECONDS_OPTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setAnswerSeconds(s)}
            className={`flex-1 rounded-lg border px-3 py-2 text-sm ${answerSeconds === s ? 'border-accent bg-accent-bg text-accent' : 'border-surface-dim text-on-surface-variant'}`}
          >
            {s} 秒
          </button>
        ))}
      </div>

      <label className="mb-1 text-sm font-semibold text-on-surface">閱讀速度</label>
      <div className="mb-6 flex gap-2">
        {PACE_OPTIONS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => setReadingSpeed(p.key)}
            className={`flex-1 rounded-lg border px-3 py-2 text-sm ${readingSpeed === p.key ? 'border-accent bg-accent-bg text-accent' : 'border-surface-dim text-on-surface-variant'}`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      {needsEnable ? (
        <button
          type="button"
          disabled={submitting}
          onClick={handleEnable}
          className="rounded-xl bg-accent px-4 py-3 text-base font-semibold text-white disabled:opacity-40"
        >
          開放這個班級並建立
        </button>
      ) : (
        <button
          type="button"
          disabled={submitting || classroomId === '' || !selectedClassroom?.grade}
          onClick={handleCreate}
          className="rounded-xl bg-accent px-4 py-3 text-base font-semibold text-white disabled:opacity-40"
        >
          建立場次
        </button>
      )}
    </div>
  );
};


const TeacherTeamArenaHost: React.FC = () => {
  const { code: routeCode } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const { token } = useAuth();

  const { state, error: pollError } = useTeamArenaPoll(token ?? null, routeCode ?? null);
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TeamArenaResult | null>(null);

  const teacherState = state && isTeacherState(state) ? state : null;

  useEffect(() => {
    if (teacherState?.status === 'ended' && token && routeCode && !result) {
      getTeamArenaResult(token, routeCode)
        .then(setResult)
        .catch(() => {
          /* result stays null — the per-match summary in `teacherState.matches` is still shown */
        });
    }
  }, [teacherState?.status, token, routeCode, result]);

  const runControl = useCallback(
    async (action: 'start' | 'pause' | 'resume' | 'next' | 'end') => {
      if (!token || !routeCode) return;
      setBusy(true);
      setActionError('');
      try {
        await controlTeamArena(token, routeCode, action);
      } catch (err) {
        setActionError(err instanceof TeamArenaApiError ? err.message : '操作失敗，請稍後再試');
      } finally {
        setBusy(false);
      }
    },
    [token, routeCode],
  );

  const runAutoAssign = useCallback(async () => {
    if (!token || !routeCode) return;
    setBusy(true);
    setActionError('');
    try {
      await assignTeamArenaTeams(token, routeCode, { action: 'auto' });
    } catch (err) {
      setActionError(err instanceof TeamArenaApiError ? err.message : '分隊失敗，請稍後再試');
    } finally {
      setBusy(false);
    }
  }, [token, routeCode]);

  if (!routeCode) {
    return <TeacherTeamArenaSetup onCreated={(code) => navigate(`/teacher/team-arena/${code}`)} />;
  }

  if (pollError && !state) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6 text-center">
        <p className="text-on-surface-variant">{pollError}</p>
      </div>
    );
  }

  if (!teacherState) {
    return (
      <div className="flex min-h-screen items-center justify-center" role="status" aria-label="載入中">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-accent border-t-transparent" />
      </div>
    );
  }

  const matchEntries = Object.entries(teacherState.matches);

  return (
    <div className="flex min-h-screen flex-col bg-surface px-6 py-6">
      <header className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-on-surface">五人對抗賽</h1>
          <p className="text-sm text-on-surface-variant">
            代碼 <span className="font-mono font-bold text-accent">{routeCode}</span>
          </p>
        </div>
        <div className="flex gap-2">
          {teacherState.status === 'lobby' && (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={runAutoAssign}
                className="rounded-lg bg-surface-container px-3 py-2 text-sm font-semibold text-on-surface"
              >
                自動分隊
              </button>
              <button
                type="button"
                disabled={busy || matchEntries.length === 0}
                onClick={() => runControl('start')}
                className="rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"
              >
                開始比賽
              </button>
            </>
          )}
          {teacherState.status === 'playing' && (
            <>
              <button type="button" disabled={busy} onClick={() => runControl('pause')} className="rounded-lg bg-surface-container px-3 py-2 text-sm text-on-surface">
                暫停
              </button>
              <button type="button" disabled={busy} onClick={() => runControl('next')} className="rounded-lg bg-surface-container px-3 py-2 text-sm text-on-surface">
                下一回合
              </button>
              <button type="button" disabled={busy} onClick={() => runControl('end')} className="rounded-lg bg-surface-container px-3 py-2 text-sm text-on-surface">
                結束比賽
              </button>
            </>
          )}
          {teacherState.status === 'paused' && (
            <button type="button" disabled={busy} onClick={() => runControl('resume')} className="rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-white">
              繼續
            </button>
          )}
        </div>
      </header>

      {actionError && <p className="mb-3 text-sm text-red-600">{actionError}</p>}

      {teacherState.status === 'lobby' && (
        <p className="text-sm text-on-surface-variant">
          {matchEntries.length === 0 ? '等待學生加入後，按「自動分隊」' : `已分成 ${matchEntries.length * 2} 隊，可以開始了`}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {matchEntries.map(([key, team]) => (
          <div key={key} className="rounded-xl border border-surface-dim bg-white p-4">
            <p className="mb-2 text-sm font-semibold text-on-surface">
              {teacherState.story.team_labels[Number(key.split(':')[1]) === 1 ? 1 : 0]} — 第 {Number(key.split(':')[0]) + 1} 場
            </p>
            <div className="mb-2 flex gap-1">
              {TEAM_ARENA_PRIMARY_LANES.map((lane) => (
                <div
                  key={lane}
                  className="flex-1 rounded bg-surface-container-high p-1 text-center text-[11px]"
                  title={TEAM_ARENA_LANE_LABELS[lane]}
                >
                  {TEAM_ARENA_LANE_LABELS[lane]}
                  <div className="font-bold">{team.towers_down?.[lane] ?? 0}/2</div>
                </div>
              ))}
            </div>
            <p className="text-sm text-on-surface-variant">
              主堡 {team.base_hits ?? 0}/2 · 分數 {team.score ?? 0}
              {team.match_status === 'ended' && team.winner && (
                <span className="ml-2 font-semibold text-accent">
                  {team.winner === 'draw' ? '平手' : `${team.winner === 'a' ? '左' : '右'}隊獲勝`}
                </span>
              )}
            </p>
          </div>
        ))}
      </div>

      {teacherState.status === 'ended' && (
        <div className="mt-6 rounded-xl border border-surface-dim bg-white p-4">
          <h2 className="mb-2 text-base font-bold text-on-surface">比賽結束</h2>
          <p className="text-sm text-on-surface-variant">
            全班合計：推倒{' '}
            {Object.values(result?.matches ?? teacherState.matches).reduce(
              (sum, t) => sum + Object.values(t.towers_down).reduce((a, b) => a + b, 0),
              0,
            )}{' '}
            座塔
          </p>
        </div>
      )}
    </div>
  );
};

export default TeacherTeamArenaHost;
