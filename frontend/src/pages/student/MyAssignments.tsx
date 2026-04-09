import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import {
  getMyAssignments,
  startAssignment,
  StudentAssignmentResponse,
  AssignmentApiError,
} from '../../services/assignmentApi';
import { ACTIVE_STEPS } from '../../config/stepConfig';

type FilterTab = 'pending' | 'completed' | 'graded';

const FILTER_TABS: { key: FilterTab; label: string }[] = [
  { key: 'pending', label: '待完成' },
  { key: 'completed', label: '已完成' },
  { key: 'graded', label: '已批改' },
];

const ACTIVE_ASSIGNMENT_CONTEXT_KEY = 'activeAssignmentContext';
const ASSIGNMENT_DB_SESSION_KEY_PREFIX = 'assignment-db-session-';

interface ProgressStep {
  id: string;
  label: string;
}

const AssignmentProgressStrip: React.FC<{
  steps: ProgressStep[];
  completedSteps: Set<string>;
  currentStepPath: string | null;
}> = ({ steps, completedSteps, currentStepPath }) => (
  <div className="flex flex-wrap gap-1.5">
    {steps.map((step) => {
      const isDone = completedSteps.has(step.id);
      const isCurrent = !isDone && currentStepPath === step.id;
      return (
        <div
          key={step.id}
          title={step.label}
          className={`w-[calc((100%-1.5rem)/5)] min-h-[40px] rounded-md border px-2 py-1 flex items-center justify-center transition-colors ${
            isDone
              ? 'bg-green-100 border-green-200 text-green-800'
              : isCurrent
                ? 'bg-yellow-100 border-yellow-200 text-yellow-800'
                : 'bg-gray-50 border-gray-200 text-gray-500'
          }`}
        >
          <span className="text-[11px] leading-tight font-medium text-center whitespace-normal break-words">
            {step.label}
          </span>
        </div>
      );
    })}
  </div>
);

const MyAssignments: React.FC = () => {
  const navigate = useNavigate();
  const { token, user } = useAuth();

  const [assignments, setAssignments] = useState<StudentAssignmentResponse[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeFilter, setActiveFilter] = useState<FilterTab>('pending');
  const [startingId, setStartingId] = useState<number | null>(null);

  const assignmentSteps = useMemo(
    () => ACTIVE_STEPS,
    [],
  );
  const defaultStepPath = assignmentSteps[0]?.id ?? 'reading-annotation';
  const stepIdSet = useMemo(() => new Set(assignmentSteps.map((s) => s.id)), [assignmentSteps]);

  const getCompletedSteps = (a: StudentAssignmentResponse): Set<string> => {
    if (a.status === 'submitted' || a.status === 'graded') {
      return new Set(assignmentSteps.map((step) => step.id));
    }
    return new Set(
      (a.steps_completed ?? []).filter((stepKey) => stepIdSet.has(stepKey)),
    );
  };

  const getResumeStepPath = (a: StudentAssignmentResponse): string => {
    if (a.current_step && stepIdSet.has(a.current_step)) {
      return a.current_step;
    }

    return defaultStepPath;
  };

  const loadAssignments = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    setError('');
    try {
      const assignmentData = await getMyAssignments(token);
      setAssignments(assignmentData);
    } catch (err) {
      if (err instanceof AssignmentApiError) {
        setError(err.message);
      } else {
        setError('無法載入作業列表');
      }
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadAssignments();
  }, [loadAssignments]);

  const filteredAssignments = assignments.filter((a) => {
    if (activeFilter === 'pending') {
      return a.status === 'pending' || a.status === 'in_progress';
    }
    if (activeFilter === 'completed') {
      return a.status === 'submitted';
    }
    return a.status === 'graded';
  });

  const handleStart = async (assignmentId: number) => {
    if (!token) return;
    setStartingId(assignmentId);
    try {
      const result = await startAssignment(token, assignmentId);
      // Store assignment ID in sessionStorage so LearningLayout can auto-submit on completion.
      sessionStorage.setItem('activeAssignmentId', String(assignmentId));
      // Store reading goals so LearningLayout can pass them to AssessmentReport (Issue #414).
      sessionStorage.setItem(
        'activeAssignmentGoals',
        JSON.stringify({
          target_cpm: result.target_cpm,
          target_accuracy: result.target_accuracy,
          difficulty_label: result.difficulty_label,
          effective_cpm: result.effective_cpm,
          effective_accuracy: result.effective_accuracy,
        }),
      );
      // story_id is set for YAML texts; text_id for DB texts
      const textKey = result.story_id ?? String(result.text_id);
      try {
        sessionStorage.setItem(
          ACTIVE_ASSIGNMENT_CONTEXT_KEY,
          JSON.stringify({
            assignmentId,
            userId: user ? String(user.id) : null,
            storyKey: String(textKey),
            startedAt: Date.now(),
          }),
        );
      } catch {
        // non-fatal
      }
      try {
        sessionStorage.setItem(
          `${ASSIGNMENT_DB_SESSION_KEY_PREFIX}${assignmentId}-${textKey}`,
          String(result.session_id),
        );
        sessionStorage.removeItem(`${ASSIGNMENT_DB_SESSION_KEY_PREFIX}${textKey}`);
        sessionStorage.removeItem(`db-session-${textKey}`);
      } catch {
        // non-fatal
      }
      navigate(`/learn/${textKey}/${defaultStepPath}`);
    } catch (err) {
      if (err instanceof AssignmentApiError) {
        setError(err.message);
      } else {
        setError('啟動作業失敗');
      }
    } finally {
      setStartingId(null);
    }
  };

  const formatDate = (dateStr: string | null): string => {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleDateString('zh-TW', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const isOverdue = (dueDateStr: string | null): boolean => {
    if (!dueDateStr) return false;
    return new Date(dueDateStr) < new Date();
  };

  const statusBadge = (status: string) => {
    switch (status) {
      case 'in_progress':
        return (
          <span className="inline-block px-1.5 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700">
            進行中
          </span>
        );
      case 'submitted':
        return (
          <span className="inline-block px-1.5 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">
            已完成
          </span>
        );
      case 'graded':
        return (
          <span className="inline-block px-1.5 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-700">
            已批改
          </span>
        );
      default:
        return (
          <span className="inline-block px-1.5 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-500">
            待完成
          </span>
        );
    }
  };

  const actionButton = (a: StudentAssignmentResponse) => {
    if (a.status === 'pending') {
      return (
        <button
          onClick={() => handleStart(a.assignment_id)}
          disabled={startingId === a.assignment_id}
          className="px-3 py-1.5 rounded-lg bg-accent hover:bg-accent-hover text-white text-xs font-medium transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
        >
          {startingId === a.assignment_id ? '啟動中...' : '開始'}
        </button>
      );
    }
    if (a.status === 'in_progress') {
      return (
        <button
          onClick={async () => {
            // Restore assignment ID so LearningLayout can auto-submit on completion.
            sessionStorage.setItem('activeAssignmentId', String(a.assignment_id));
            // Restore reading goals so AssessmentReport can show goal comparison (Issue #414).
            sessionStorage.setItem(
              'activeAssignmentGoals',
              JSON.stringify({
                target_cpm: a.target_cpm,
                target_accuracy: a.target_accuracy,
                difficulty_label: a.difficulty_label,
                effective_cpm: a.effective_cpm,
                effective_accuracy: a.effective_accuracy,
              }),
            );
            let sessionId = a.session_id;
            // Backfill missing linkage for legacy in_progress rows without session_id.
            if (sessionId == null && token) {
              try {
                const started = await startAssignment(token, a.assignment_id);
                sessionId = started.session_id;
              } catch {
                // non-fatal: proceed with existing data paths
              }
            }
            // story_id is set for YAML texts; text_id for DB texts
            const textKey = a.story_id ?? a.text_id;
            try {
              sessionStorage.setItem(
                ACTIVE_ASSIGNMENT_CONTEXT_KEY,
                JSON.stringify({
                  assignmentId: a.assignment_id,
                  userId: user ? String(user.id) : null,
                  storyKey: String(textKey),
                  startedAt: Date.now(),
                }),
              );
            } catch {
              // non-fatal
            }
            if (sessionId != null) {
              try {
                sessionStorage.setItem(
                  `${ASSIGNMENT_DB_SESSION_KEY_PREFIX}${a.assignment_id}-${textKey}`,
                  String(sessionId),
                );
                sessionStorage.removeItem(`${ASSIGNMENT_DB_SESSION_KEY_PREFIX}${textKey}`);
                sessionStorage.removeItem(`db-session-${textKey}`);
              } catch {
                // non-fatal
              }
            }
            const resumeStepPath = getResumeStepPath(a);
            navigate(`/learn/${textKey}/${resumeStepPath}`);
          }}
          className="px-3 py-1.5 rounded-lg bg-blue-500 hover:bg-blue-600 text-white text-xs font-medium transition-colors cursor-pointer shrink-0"
        >
          繼續
        </button>
      );
    }
    // submitted or graded
    return (
      <button
        onClick={() => {
          const textKey = a.story_id ?? a.text_id;
          if (textKey == null) {
            return;
          }

          sessionStorage.setItem('activeAssignmentId', String(a.assignment_id));
          sessionStorage.setItem(
            'activeAssignmentGoals',
            JSON.stringify({
              target_cpm: a.target_cpm,
              target_accuracy: a.target_accuracy,
              difficulty_label: a.difficulty_label,
              effective_cpm: a.effective_cpm,
              effective_accuracy: a.effective_accuracy,
            }),
          );

          try {
            sessionStorage.setItem(
              ACTIVE_ASSIGNMENT_CONTEXT_KEY,
              JSON.stringify({
                assignmentId: a.assignment_id,
                userId: user ? String(user.id) : null,
                storyKey: String(textKey),
                startedAt: Date.now(),
              }),
            );
          } catch {
            // non-fatal
          }

          if (a.session_id != null) {
            try {
              sessionStorage.setItem(
                `${ASSIGNMENT_DB_SESSION_KEY_PREFIX}${a.assignment_id}-${textKey}`,
                String(a.session_id),
              );
              sessionStorage.removeItem(`${ASSIGNMENT_DB_SESSION_KEY_PREFIX}${textKey}`);
              sessionStorage.removeItem(`db-session-${textKey}`);
            } catch {
              // non-fatal
            }
          }

          navigate(`/learn/${textKey}/report`);
        }}
        className="px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 text-xs font-medium hover:bg-gray-50 transition-colors cursor-pointer shrink-0"
      >
        查看
      </button>
    );
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-6">
      <div className="max-w-4xl mx-auto space-y-4">
        {/* Page title */}
        <div>
          <h1 className="text-base font-bold text-gray-900">我的作業</h1>
          <p className="text-xs text-gray-500 mt-0.5">完成老師指派的學習任務</p>
        </div>

        {/* Filter tabs */}
        <div className="border-b border-gray-200">
          <nav className="flex -mb-px" aria-label="Filter tabs">
            {FILTER_TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveFilter(tab.key)}
                className={`px-3 py-1.5 text-xs font-medium border-b-2 transition-colors cursor-pointer ${
                  activeFilter === tab.key
                    ? 'border-accent text-accent'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
            {error}
            <button onClick={() => setError('')} className="ml-2 underline cursor-pointer">
              關閉
            </button>
          </div>
        )}

        {/* Loading */}
        {isLoading ? (
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="bg-white rounded-2xl shadow-card p-4">
                <div className="h-5 bg-gray-200 animate-pulse rounded w-2/3 mb-3" />
                <div className="h-4 bg-gray-200 animate-pulse rounded w-1/3 mb-2" />
                <div className="h-4 bg-gray-200 animate-pulse rounded w-1/4" />
              </div>
            ))}
          </div>
        ) : filteredAssignments.length === 0 ? (
          /* Empty state */
          <div className="text-center py-12">
            <div className="inline-flex items-center justify-center w-14 h-14 bg-accent-bg rounded-xl mb-4">
              <svg className="w-7 h-7 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z"
                />
              </svg>
            </div>
            <p className="text-sm font-medium text-gray-700 mb-1">
              {activeFilter === 'pending'
                ? '目前沒有待完成的作業'
                : activeFilter === 'completed'
                  ? '還沒有已完成的作業'
                  : '還沒有已批改的作業'}
            </p>
            <p className="text-xs text-gray-500">老師指派的作業會顯示在這裡</p>
          </div>
        ) : (
          /* Assignment cards */
          <div className="space-y-3">
            {filteredAssignments.map((a) => {
              const completedSteps = getCompletedSteps(a);
              const currentStepPath = a.status === 'in_progress' ? getResumeStepPath(a) : null;
              return (
                <div
                  key={a.assignment_id}
                  className="bg-white rounded-2xl shadow-card p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-sm font-medium text-gray-900 truncate">
                          {a.title || a.story_title}
                        </h3>
                        {statusBadge(a.status)}
                      </div>

                      {a.title && a.title !== a.story_title && (
                        <p className="text-xs text-gray-500 mt-0.5">
                          課文：{a.story_title}
                        </p>
                      )}

                      <div className="flex items-center gap-3 mt-2 flex-wrap">
                        <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-accent-bg text-accent">
                          {a.classroom_name}
                        </span>

                        {a.due_date && (
                          <span
                            className={`text-xs ${
                              isOverdue(a.due_date) ? 'text-red-600 font-medium' : 'text-gray-500'
                            }`}
                          >
                            截止：{formatDate(a.due_date)}
                            {isOverdue(a.due_date) && (
                              <span className="ml-1 inline-block px-1 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">
                                已逾期
                              </span>
                            )}
                          </span>
                        )}

                        {a.score != null && (
                          <span className="text-xs text-gray-700 font-medium">
                            分數：{Math.round(a.score)}%
                          </span>
                        )}

                        {a.submitted_at && (
                          <span className="text-xs text-gray-400">
                            提交於 {formatDate(a.submitted_at)}
                          </span>
                        )}
                      </div>

                      {/* Issue #424: per-student teacher feedback */}
                      {a.teacher_feedback && (
                        <div className="mt-2 px-2.5 py-2 bg-purple-50 border border-purple-100 rounded-lg">
                          <p className="text-xs font-medium text-purple-700 mb-0.5">老師評語</p>
                          <p className="text-xs text-gray-700">{a.teacher_feedback}</p>
                        </div>
                      )}

                      {assignmentSteps.length > 0 && (
                        <div className="mt-2.5">
                          <div className="flex items-center justify-between mb-1">
                            <p className="text-[11px] text-gray-500">學習關卡進度</p>
                            <p className="text-[11px] text-gray-400">
                              {completedSteps.size}/{assignmentSteps.length}
                            </p>
                          </div>
                          <AssignmentProgressStrip
                            steps={assignmentSteps}
                            completedSteps={completedSteps}
                            currentStepPath={currentStepPath}
                          />
                        </div>
                      )}

                      {a.description && (
                        <p className="text-xs text-gray-500 mt-1.5 line-clamp-2">
                          {a.description}
                        </p>
                      )}
                    </div>

                    <div className="shrink-0">{actionButton(a)}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default MyAssignments;
