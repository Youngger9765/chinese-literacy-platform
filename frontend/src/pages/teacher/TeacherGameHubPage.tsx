/**
 * TeacherGameHubPage — `/teacher/game-hub` (issue #3633).
 *
 * Gathers 跨班賽季／課堂搶答／班級內 PK into one 「遊戲區」 page, replacing the
 * two separate sidebar entries (跨班賽季, 課堂搶答) this issue consolidates:
 *  - links out to the existing management pages (/teacher/league hosts
 *    season boards + invitations, /teacher/live hosts the live-quiz
 *    screen) rather than re-implementing their content here
 *  - reuses <ClassroomPkSettingsPanel> — already the single source of
 *    truth for the three per-class switches on ClassroomDetail.tsx — once
 *    per classroom, so the switch logic is never duplicated
 *
 * Old routes (/teacher/league, /teacher/live) are untouched.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { listMyClassrooms, ClassroomApiError, type ClassroomResponse } from '../../services/classroomApi';
import ClassroomPkSettingsPanel from './ClassroomPkSettingsPanel';

const TeacherGameHubPage: React.FC = () => {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [classrooms, setClassrooms] = useState<ClassroomResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    listMyClassrooms(token, { limit: 100 })
      .then((res) => setClassrooms(res.items))
      .catch((err) => {
        setError(err instanceof ClassroomApiError ? err.message : '載入班級失敗，請稍後再試一次');
      })
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <h1 className="text-xl font-bold text-gray-900 mb-1">遊戲區</h1>
      <p className="text-sm text-gray-500 mb-6">管理每個班級的遊戲開關，或前往主持／排行頁面</p>

      <section className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-8" aria-label="遊戲管理頁面">
        <button
          type="button"
          onClick={() => navigate('/teacher/league')}
          className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white p-4 text-left transition-colors hover:border-accent hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1"
        >
          <span className="text-2xl shrink-0" aria-hidden="true">🏆</span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-gray-900">跨班賽季</span>
            <span className="block text-xs text-gray-500">查看排行榜、建立邀請</span>
          </span>
        </button>
        <button
          type="button"
          onClick={() => navigate('/teacher/live')}
          className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white p-4 text-left transition-colors hover:border-accent hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1"
        >
          <span className="text-2xl shrink-0" aria-hidden="true">🎮</span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-gray-900">課堂搶答</span>
            <span className="block text-xs text-gray-500">主持即時搶答</span>
          </span>
        </button>
        <button
          type="button"
          onClick={() => navigate('/teacher/team-arena')}
          className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white p-4 text-left transition-colors hover:border-accent hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1"
        >
          <span className="text-2xl shrink-0" aria-hidden="true">🛡️</span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-gray-900">五人對抗賽</span>
            <span className="block text-xs text-gray-500">開一場組隊競賽</span>
          </span>
        </button>
      </section>

      <h2 className="text-base font-semibold text-gray-700 mb-3">班級開關</h2>

      {loading && <p className="text-sm text-gray-400">載入中…</p>}
      {!loading && error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      {!loading && !error && classrooms.length === 0 && (
        <p className="text-sm text-gray-400">還沒有建立班級</p>
      )}

      {!loading && !error && classrooms.length > 0 && (
        <div className="flex flex-col gap-4">
          {classrooms.map((classroom) => (
            <div key={classroom.id} className="rounded-xl border border-gray-200 p-4">
              <h3 className="text-sm font-semibold text-gray-800 mb-2">{classroom.name}</h3>
              {token && (
                <ClassroomPkSettingsPanel
                  token={token}
                  classroomId={classroom.id}
                  pkHuman={classroom.pk_human}
                  league={classroom.league}
                  liveQuiz={classroom.live_quiz}
                  teamArena={classroom.team_arena}
                  onChanged={(next) =>
                    setClassrooms((prev) =>
                      prev.map((c) => (c.id === classroom.id ? { ...c, ...next } : c)),
                    )
                  }
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default TeacherGameHubPage;
