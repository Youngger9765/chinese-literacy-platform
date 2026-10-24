/**
 * #3747: this screen had no way back to 遊戲區 except the browser's own
 * back button (no AppShell on this route) — added GameBackButton. The
 * banner/explanation and RWD card below were already in place.
 * #3756: added `EscapeRoomHistoryPanel` ("我的挑戰紀錄") — same
 * "後端已有資料就做，不需要 migration" reasoning PkHistoryPanel used.
 */
import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { fetchMyEnrolledClassrooms, type StudentEnrolledClassroom } from '../../services/learning/session';
import {
  EscapeRoomApiError,
  startEscapeRoomRun,
  type EscapeRoomScopeType,
} from '../../services/escapeRoomApi';
import { resolveGradeForAiPk } from '../pk/resolvePkGrade';
import GameBackButton from '../../components/game/GameBackButton';
import EscapeRoomHistoryPanel from '../../components/escape-room/EscapeRoomHistoryPanel';

interface Scope {
  type: EscapeRoomScopeType;
  ref: string;
  label: string;
}

const StudentEscapeRoomEntry: React.FC = () => {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const lessonUid = searchParams.get('lessonUid');
  const lessonTitle = searchParams.get('lessonTitle');
  const [classrooms, setClassrooms] = useState<StudentEnrolledClassroom[]>([]);
  const [studentGrade, setStudentGrade] = useState<number | null>(null);
  const [activeClassroom, setActiveClassroom] = useState<StudentEnrolledClassroom | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [scopeChoice, setScopeChoice] = useState<'lesson' | 'grade_pool'>(lessonUid ? 'lesson' : 'grade_pool');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) {
      setLoaded(true);
      return;
    }
    fetchMyEnrolledClassrooms(token)
      .then((res) => {
        setClassrooms(res.classrooms);
        setStudentGrade(res.student_grade);
        setActiveClassroom(res.classrooms.find((classroom) => classroom.is_active) ?? res.classrooms[0] ?? null);
      })
      .finally(() => setLoaded(true));
  }, [token]);

  const grade = resolveGradeForAiPk(classrooms, activeClassroom?.grade ?? null, studentGrade);
  const scope: Scope =
    scopeChoice === 'lesson' && lessonUid
      ? { type: 'lesson', ref: lessonUid, label: lessonTitle ?? '這一課' }
      : { type: 'grade_pool', ref: String(grade), label: `${grade} 年級題庫` };

  const handleStart = async () => {
    if (!token) return;
    setBusy(true);
    setError('');
    try {
      const run = await startEscapeRoomRun(token, { scope_type: scope.type, scope_ref: scope.ref });
      navigate(`/escape-room/run/${run.run_id}`);
    } catch (err) {
      setError(err instanceof EscapeRoomApiError ? err.message : '發生錯誤，請稍後再試一次');
      setBusy(false);
    }
  };

  if (!loaded) {
    return <div className="flex min-h-screen items-center justify-center" role="status" aria-label="載入中" />;
  }

  return (
    <main className="flex min-h-screen flex-col items-center bg-surface px-5 py-10 text-on-surface">
      <div className="w-full max-w-lg">
        <GameBackButton to="/game-hub" />
      </div>
      <div className="mt-4 w-full max-w-lg rounded-3xl bg-gradient-to-br from-[#6D5BD0] to-[#4B3F99] p-6 text-center text-white shadow-sm sm:p-10">
        {/* #3761: the new codex image_gen lantern icon (also used on the
            game-hub card) replaces the plain gradient card — same "already
            had a decent banner, just no illustration" gap as team-arena. */}
        <img
          src="/story-assets/escape-room-hub/icon.png"
          alt=""
          aria-hidden="true"
          className="mx-auto h-20 w-20 object-contain drop-shadow-md"
        />
        <p className="mt-2 text-sm font-semibold text-white/90">書中世界探索</p>
        <h1 className="mt-1 text-3xl font-bold">迷城密室</h1>
        <p className="mt-3 text-sm leading-6 text-white/90">和三位書中夥伴一起解開機關，把被迷霧遮住的字跡找回來</p>

        {lessonUid && (
          <div className="mt-7 flex rounded-full bg-white/80 p-1 text-sm" role="group" aria-label="題目範圍">
            <button
              type="button"
              onClick={() => setScopeChoice('lesson')}
              className={`flex-1 rounded-full px-3 py-2 font-medium ${scopeChoice === 'lesson' ? 'bg-accent text-white' : 'text-on-surface-variant'}`}
            >
              剛讀完的這課
            </button>
            <button
              type="button"
              onClick={() => setScopeChoice('grade_pool')}
              className={`flex-1 rounded-full px-3 py-2 font-medium ${scopeChoice === 'grade_pool' ? 'bg-accent text-white' : 'text-on-surface-variant'}`}
            >
              我的年級題庫
            </button>
          </div>
        )}

        <p className="mt-6 rounded-xl bg-white/80 px-4 py-3 text-sm text-on-surface" aria-live="polite">
          本局範圍：{scope.label}
        </p>
        <button type="button" disabled={busy} onClick={() => void handleStart()} className="btn-immersive mt-7 w-full disabled:opacity-50">
          {busy ? '正在走進迷城' : '開始探索'}
        </button>
        {error && <p className="mt-4 text-sm text-error" role="alert">{error}</p>}
      </div>
      {token && <EscapeRoomHistoryPanel token={token} />}
    </main>
  );
};

export default StudentEscapeRoomEntry;
