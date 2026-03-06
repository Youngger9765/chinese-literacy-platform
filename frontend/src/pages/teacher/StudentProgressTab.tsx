import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import {
  getClassroomProgress,
  getStudentSessions,
  StudentProgress,
  StudentSession,
  TeacherApiError,
} from '../../services/teacherApi';

interface StudentProgressTabProps {
  classroomId: number;
}

const StudentProgressTab: React.FC<StudentProgressTabProps> = ({ classroomId }) => {
  const { token } = useAuth();
  const [progress, setProgress] = useState<StudentProgress[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  // Expand / session history state
  const [expandedStudentId, setExpandedStudentId] = useState<number | null>(null);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  const [sessions, setSessions] = useState<StudentSession[]>([]);
  const sessionCache = useRef<Record<number, StudentSession[]>>({});

  const loadProgress = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    setError('');
    try {
      const data = await getClassroomProgress(token, classroomId);
      // Sort by last_session_date descending (most recent first), nulls last
      const sorted = [...data].sort((a, b) => {
        if (!a.last_session_date && !b.last_session_date) return 0;
        if (!a.last_session_date) return 1;
        if (!b.last_session_date) return -1;
        return new Date(b.last_session_date).getTime() - new Date(a.last_session_date).getTime();
      });
      setProgress(sorted);
    } catch (err) {
      if (err instanceof TeacherApiError) {
        setError(err.message);
      } else {
        setError('無法載入學生進度');
      }
    } finally {
      setIsLoading(false);
    }
  }, [token, classroomId]);

  useEffect(() => {
    loadProgress();
  }, [loadProgress]);

  const handleRowClick = useCallback(async (studentId: number) => {
    // Toggle collapse if already expanded
    if (expandedStudentId === studentId) {
      setExpandedStudentId(null);
      return;
    }

    setExpandedStudentId(studentId);

    // Use cache if available
    if (sessionCache.current[studentId]) {
      setSessions(sessionCache.current[studentId]);
      return;
    }

    if (!token) return;
    setIsLoadingSessions(true);
    setSessions([]);
    try {
      const data = await getStudentSessions(token, studentId);
      sessionCache.current[studentId] = data;
      setSessions(data);
    } catch {
      setSessions([]);
    } finally {
      setIsLoadingSessions(false);
    }
  }, [expandedStudentId, token]);

  const formatDate = (dateStr: string | null): string => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('zh-TW', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const formatScore = (score: number | null): string => {
    if (score === null || score === undefined) return '-';
    return `${Math.round(score)}%`;
  };

  const statusLabel = (status: string) => {
    if (status === 'completed') {
      return (
        <span className="inline-block px-1.5 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">
          已完成
        </span>
      );
    }
    return (
      <span className="inline-block px-1.5 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-700">
        進行中
      </span>
    );
  };

  if (isLoading) {
    return (
      <div className="p-5 space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex gap-4">
            <div className="h-4 bg-gray-200 animate-pulse rounded w-1/4" />
            <div className="h-4 bg-gray-200 animate-pulse rounded w-1/4" />
            <div className="h-4 bg-gray-200 animate-pulse rounded w-1/4" />
            <div className="h-4 bg-gray-200 animate-pulse rounded w-1/6" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-5">
        <div className="text-center py-6 bg-red-50 rounded-lg border border-red-200">
          <p className="text-red-700 text-sm">{error}</p>
          <button
            onClick={loadProgress}
            className="mt-2 text-sm text-red-600 underline hover:text-red-800 cursor-pointer"
          >
            重試
          </button>
        </div>
      </div>
    );
  }

  if (progress.length === 0) {
    return (
      <div className="p-8 text-center">
        <div className="inline-flex items-center justify-center w-12 h-12 bg-accent-bg rounded-xl mb-3">
          <svg className="w-6 h-6 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z" />
          </svg>
        </div>
        <p className="text-sm font-medium text-gray-700 mb-1">尚無學生學習記錄</p>
        <p className="text-xs text-gray-500">學生開始練習後，進度將會顯示在這裡</p>
      </div>
    );
  }

  return (
    <div className="p-5">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-left text-gray-500">
              <th className="pb-2 font-medium w-6"></th>
              <th className="pb-2 font-medium">學生姓名</th>
              <th className="pb-2 font-medium">最近練習日期</th>
              <th className="pb-2 font-medium">最近練習課文</th>
              <th className="pb-2 font-medium text-center">練習次數</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {progress.map((s) => {
              const isExpanded = expandedStudentId === s.student_id;
              return (
                <React.Fragment key={s.student_id}>
                  <tr
                    className="cursor-pointer hover:bg-gray-50 transition-colors"
                    onClick={() => handleRowClick(s.student_id)}
                  >
                    <td className="py-2.5 text-gray-400">
                      <svg
                        className={`w-4 h-4 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </td>
                    <td className="py-2.5 text-gray-900 font-medium">{s.student_name}</td>
                    <td className="py-2.5 text-gray-600">{formatDate(s.last_session_date)}</td>
                    <td className="py-2.5 text-gray-600">{s.last_text_title ?? '-'}</td>
                    <td className="py-2.5 text-gray-600 text-center">
                      <span className={`inline-block min-w-[2rem] px-2 py-0.5 rounded-full text-xs font-medium ${
                        s.total_sessions > 0
                          ? 'bg-accent-bg text-accent'
                          : 'bg-gray-100 text-gray-500'
                      }`}>
                        {s.total_sessions}
                      </span>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr>
                      <td colSpan={5} className="bg-gray-50 px-4 py-3">
                        {isLoadingSessions ? (
                          <div className="space-y-2">
                            {Array.from({ length: 3 }).map((_, i) => (
                              <div key={i} className="flex gap-4">
                                <div className="h-3 bg-gray-200 animate-pulse rounded w-1/3" />
                                <div className="h-3 bg-gray-200 animate-pulse rounded w-1/5" />
                                <div className="h-3 bg-gray-200 animate-pulse rounded w-1/6" />
                                <div className="h-3 bg-gray-200 animate-pulse rounded w-1/6" />
                              </div>
                            ))}
                          </div>
                        ) : sessions.length === 0 ? (
                          <p className="text-xs text-gray-500 text-center py-2">尚無練習記錄</p>
                        ) : (
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-left text-gray-400">
                                <th className="pb-1.5 font-medium">課文</th>
                                <th className="pb-1.5 font-medium">日期</th>
                                <th className="pb-1.5 font-medium text-center">分數</th>
                                <th className="pb-1.5 font-medium text-center">狀態</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                              {sessions.map((sess) => (
                                <tr key={sess.id}>
                                  <td className="py-1.5 text-gray-700">{sess.story_title ?? '-'}</td>
                                  <td className="py-1.5 text-gray-500">{formatDate(sess.started_at)}</td>
                                  <td className="py-1.5 text-gray-700 text-center font-medium">{formatScore(sess.overall_score)}</td>
                                  <td className="py-1.5 text-center">{statusLabel(sess.status)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default StudentProgressTab;
