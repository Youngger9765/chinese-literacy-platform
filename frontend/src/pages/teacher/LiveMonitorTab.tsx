/**
 * LiveMonitorTab — Issue #3025: 教師即時監控儀表板.
 *
 * Shows, per student in the classroom, which 大題 they are currently on and
 * a 「卡在這題」flag (same question answered wrong >= 3 times). Built for
 * 課後學習扶助: teacher present, students working simultaneously.
 *
 * Liveness (Young 2026-09-03, second decision — 60s poll + manual button):
 *   First version polled every 7s; Young pulled that as wasteful, then
 *   settled on this: auto-refresh once a MINUTE (an open forgotten tab
 *   costs ~1 cheap request/min, acceptable), plus a 重新整理 button for
 *   the teacher who wants the latest right now. 上次更新 timestamp shows
 *   staleness. Polling stops the moment the component unmounts.
 *
 * Data honesty (issue #3025 decided design):
 *   `mcq_attempt` has no session_id and only a handful of exercise
 *   components write to it, so most students doing most exercises will
 *   have NO row at all. Those students render as an explicit "尚無資料"
 *   state — never silently the same as a student who is doing fine. The
 *   `tracked_exercise_types` the backend discloses are shown so the
 *   teacher knows the scope of what this view can see.
 *
 * Wording: never label the stuck signal "亂猜" on screen (issue #3025
 * comment) — a teacher may project this, or a student may see it, and
 * that word assigns a motive the data does not support. Always
 * 「卡在這題」.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import {
  getClassroomLiveMonitor,
  requestPreviewToken,
  LiveMonitorStudentEntry,
} from '../../services/teacherApi';

interface LiveMonitorTabProps {
  classroomId: number;
}


function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diffSeconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (diffSeconds < 60) return `${diffSeconds} 秒前`;
  const diffMinutes = Math.round(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes} 分鐘前`;
  const diffHours = Math.round(diffMinutes / 60);
  return `${diffHours} 小時前`;
}

/** Stuck students first, then active students, then no-data — a teacher
 * scanning this list should see who needs help without hunting. */
function sortForTeacherScan(students: LiveMonitorStudentEntry[]): LiveMonitorStudentEntry[] {
  const rank = (s: LiveMonitorStudentEntry) => (s.is_stuck ? 0 : s.has_data ? 1 : 2);
  return [...students].sort((a, b) => rank(a) - rank(b));
}

const POLL_INTERVAL_MS = 60_000;

const LiveMonitorTab: React.FC<LiveMonitorTabProps> = ({ classroomId }) => {
  const { token } = useAuth();
  const navigate = useNavigate();

  const [students, setStudents] = useState<LiveMonitorStudentEntry[] | null>(null);
  const [trackedTypes, setTrackedTypes] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [previewingStudentId, setPreviewingStudentId] = useState<number | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Track mount state so an in-flight fetch from a poll tick that outlives
  // unmount never calls setState on an unmounted component.
  const isMountedRef = useRef(true);

  const fetchOnce = useCallback(async () => {
    if (!token) return;
    setRefreshing(true);
    try {
      const data = await getClassroomLiveMonitor(token, classroomId);
      if (!isMountedRef.current) return;
      setStudents(data.students);
      setTrackedTypes(data.tracked_exercise_types);
      setLastUpdated(new Date());
      setError('');
    } catch (err) {
      if (!isMountedRef.current) return;
      setError(err instanceof Error ? err.message : '無法載入即時監控資料');
    } finally {
      if (isMountedRef.current) setRefreshing(false);
    }
  }, [token, classroomId]);

  useEffect(() => {
    isMountedRef.current = true;
    fetchOnce();
    const interval = setInterval(fetchOnce, POLL_INTERVAL_MS);
    return () => {
      isMountedRef.current = false;
      clearInterval(interval);
    };
  }, [fetchOnce]);

  const startPreview = async (student: LiveMonitorStudentEntry) => {
    setPreviewError('');
    setPreviewingStudentId(student.student_id);
    try {
      const { preview_token, student_id, student_name, expires_in_minutes } =
        await requestPreviewToken(student.student_id);
      navigate(`/teacher/preview/${student_id}`, {
        state: {
          previewToken: preview_token,
          studentId: student_id,
          studentName: student_name,
          expiresInMinutes: expires_in_minutes,
        },
      });
    } catch {
      setPreviewError('無法開啟預覽，請稍後再試');
    } finally {
      setPreviewingStudentId(null);
    }
  };

  if (students === null && !error) {
    return (
      <div className="p-6 space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-14 bg-gray-100 animate-pulse rounded-lg" />
        ))}
      </div>
    );
  }

  if (error && students === null) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
          {error}
        </div>
      </div>
    );
  }

  const list = sortForTeacherScan(students ?? []);
  const stuckCount = list.filter((s) => s.is_stuck).length;

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-gray-900">課堂即時監控</h3>
          <p className="text-sm text-gray-500 mt-0.5">
            顯示每位學生目前所在的大題與是否卡關。每分鐘自動更新，也可隨時按「重新整理」。
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {lastUpdated && (
            <span className="text-xs text-gray-400">
              上次更新 {lastUpdated.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          )}
          <button
            type="button"
            onClick={fetchOnce}
            disabled={refreshing}
            className="px-3 py-1.5 rounded-lg text-sm font-medium text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-50"
          >
            {refreshing ? '更新中…' : '重新整理'}
          </button>
        </div>
      </div>

      {/* Honesty disclosure — most exercise types produce no signal at all. */}
      <div className="bg-blue-50 border border-blue-100 text-blue-800 text-xs rounded-lg px-3 py-2">
        此檢視僅涵蓋會記錄答題資料的練習類型
        {trackedTypes.length > 0 && `（${trackedTypes.join('、')}）`}
        ，學生若正在做其他類型的練習，這裡會顯示「尚無資料」而非「正常」。
      </div>

      {previewError && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">
          {previewError}
        </div>
      )}

      {stuckCount > 0 && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <span className="w-2.5 h-2.5 bg-red-500 rounded-full" />
          <span className="text-sm font-medium text-red-800">卡在這題 {stuckCount} 人</span>
        </div>
      )}

      {list.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <p className="text-sm">班級尚無學生</p>
        </div>
      ) : (
        <div className="divide-y divide-gray-100 rounded-lg border border-gray-100">
          {list.map((s) => (
            <div
              key={s.student_id}
              className={`px-4 py-3 flex items-center justify-between gap-3 ${
                s.is_stuck ? 'bg-red-50' : ''
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-gray-900 text-sm">{s.student_name}</span>
                  {s.is_stuck && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border bg-red-100 text-red-800 border-red-200">
                      卡在這題
                    </span>
                  )}
                  {!s.has_data && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border bg-gray-100 text-gray-500 border-gray-200">
                      尚無資料
                    </span>
                  )}
                </div>
                {s.has_data ? (
                  <p className="mt-1 text-xs text-gray-600">
                    目前作答：{s.question_label}
                    {s.lesson_id && <span className="text-gray-400">（課文 {s.lesson_id}）</span>}
                    {s.wrong_count > 0 && (
                      <span className="text-gray-400"> · 已答錯 {s.wrong_count} 次</span>
                    )}
                    {s.last_activity_at && (
                      <span className="text-gray-400"> · {formatRelativeTime(s.last_activity_at)}</span>
                    )}
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-gray-400">此練習類型不記錄答題資料，或尚未開始作答</p>
                )}
              </div>

              <button
                onClick={() => startPreview(s)}
                disabled={previewingStudentId === s.student_id}
                className="shrink-0 inline-flex items-center justify-center px-2.5 py-1 rounded-md text-xs font-medium text-accent bg-accent-bg border border-accent/30 hover:bg-accent-bg/70 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title="以學生身分預覽（唯讀）"
              >
                {previewingStudentId === s.student_id ? '載入中…' : '預覽'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default LiveMonitorTab;
