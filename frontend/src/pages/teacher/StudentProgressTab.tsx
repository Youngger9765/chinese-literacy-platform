import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { useAuth } from '../../contexts/AuthContext';
import {
  getClassroomProgress,
  getClassroomInstructionCounts,
  getStudentSessions,
  getTeacherStudentDialogue,
  exportClassroomReport,
  addStudentTag,
  removeStudentTag,
  getStudentLearningCurve,
  StudentProgress,
  StudentTag,
  StudentSession,
  TeacherDialogueTurn,
  TeacherDialogueHistoryResponse,
  LearningCurvePoint,
  TeacherApiError,
} from '../../services/teacherApi';
import TeacherInstructionPanel from './TeacherInstructionPanel';

interface StudentProgressTabProps {
  classroomId: number;
}

// Predefined tags with their default colors
const PREDEFINED_TAGS: { name: string; color: string }[] = [
  { name: '需要關注', color: 'red' },
  { name: '閱讀困難', color: 'orange' },
  { name: '進步中', color: 'green' },
  { name: '資優', color: 'blue' },
];

const TAG_COLOR_CLASSES: Record<string, string> = {
  red: 'bg-red-100 text-red-700 border-red-200',
  orange: 'bg-orange-100 text-orange-700 border-orange-200',
  green: 'bg-green-100 text-green-700 border-green-200',
  blue: 'bg-blue-100 text-blue-700 border-blue-200',
  purple: 'bg-purple-100 text-purple-700 border-purple-200',
  gray: 'bg-gray-100 text-gray-600 border-gray-200',
};

function tagColorClass(color: string): string {
  return TAG_COLOR_CLASSES[color] ?? TAG_COLOR_CLASSES['gray'];
}

interface TagManagerProps {
  studentId: number;
  studentName: string;
  currentTags: StudentTag[];
  onClose: () => void;
  onTagsChanged: (studentId: number, tags: StudentTag[]) => void;
}

const TagManager: React.FC<TagManagerProps> = ({
  studentId,
  studentName,
  currentTags,
  onClose,
  onTagsChanged,
}) => {
  const { token } = useAuth();
  const [tags, setTags] = useState<StudentTag[]>(currentTags);
  const [customInput, setCustomInput] = useState('');
  const [customColor, setCustomColor] = useState('gray');
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState('');

  const handleAdd = async (tagName: string, color: string) => {
    if (!token) return;
    if (tags.some((t) => t.tag_name === tagName)) return; // already present
    setSaving(tagName);
    setError('');
    try {
      const newTag = await addStudentTag(token, studentId, tagName, color);
      const updated = [...tags, newTag];
      setTags(updated);
      onTagsChanged(studentId, updated);
    } catch (err) {
      if (err instanceof TeacherApiError && err.status === 409) {
        // tag already exists (race condition), silently ignore
      } else {
        setError('新增標籤失敗，請稍後再試');
      }
    } finally {
      setSaving(null);
    }
  };

  const handleRemove = async (tagName: string) => {
    if (!token) return;
    setSaving(tagName);
    setError('');
    try {
      await removeStudentTag(token, studentId, tagName);
      const updated = tags.filter((t) => t.tag_name !== tagName);
      setTags(updated);
      onTagsChanged(studentId, updated);
    } catch {
      setError('移除標籤失敗，請稍後再試');
    } finally {
      setSaving(null);
    }
  };

  const handleAddCustom = async () => {
    const name = customInput.trim();
    if (!name) return;
    if (name.length > 50) {
      setError('標籤名稱不能超過 50 字元');
      return;
    }
    await handleAdd(name, customColor);
    setCustomInput('');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-sm mx-4 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-gray-800">
            管理標籤 — {studentName}
          </h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors cursor-pointer"
            aria-label="關閉"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Current tags */}
        {tags.length > 0 && (
          <div className="mb-4">
            <p className="text-xs text-gray-500 mb-2">目前標籤</p>
            <div className="flex flex-wrap gap-1.5">
              {tags.map((t) => (
                <span
                  key={t.tag_name}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${tagColorClass(t.color)}`}
                >
                  {t.tag_name}
                  <button
                    onClick={() => handleRemove(t.tag_name)}
                    disabled={saving === t.tag_name}
                    className="ml-0.5 hover:opacity-70 disabled:opacity-40 cursor-pointer"
                    aria-label={`移除 ${t.tag_name}`}
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Predefined tags */}
        <div className="mb-4">
          <p className="text-xs text-gray-500 mb-2">快速新增</p>
          <div className="flex flex-wrap gap-1.5">
            {PREDEFINED_TAGS.map((pt) => {
              const isActive = tags.some((t) => t.tag_name === pt.name);
              return (
                <button
                  key={pt.name}
                  onClick={() => isActive ? handleRemove(pt.name) : handleAdd(pt.name, pt.color)}
                  disabled={saving === pt.name}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-opacity disabled:opacity-50 cursor-pointer ${
                    isActive
                      ? tagColorClass(pt.color)
                      : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  {isActive && (
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414L8.414 15l-4.121-4.121a1 1 0 011.414-1.414L8.414 12.172l7.879-7.879a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  )}
                  {pt.name}
                </button>
              );
            })}
          </div>
        </div>

        {/* Custom tag input */}
        <div className="mb-3">
          <p className="text-xs text-gray-500 mb-2">自訂標籤</p>
          <div className="flex gap-2">
            <input
              type="text"
              value={customInput}
              onChange={(e) => setCustomInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddCustom()}
              placeholder="輸入標籤名稱..."
              maxLength={50}
              className="flex-1 px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
            <select
              value={customColor}
              onChange={(e) => setCustomColor(e.target.value)}
              className="px-2 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white"
            >
              <option value="gray">灰</option>
              <option value="red">紅</option>
              <option value="orange">橙</option>
              <option value="green">綠</option>
              <option value="blue">藍</option>
              <option value="purple">紫</option>
            </select>
            <button
              onClick={handleAddCustom}
              disabled={!customInput.trim() || saving !== null}
              className="px-3 py-1.5 text-sm font-medium bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              新增
            </button>
          </div>
        </div>

        {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
      </div>
    </div>
  );
};

// ── Dialogue Modal (Issue #418) ────────────────────────────────────────────

const PHASE_LABEL: Record<string, string> = {
  factual: '事實理解',
  inferential: '推論思考',
  evaluative: '評估反思',
};

const DialogueModal: React.FC<{
  data: TeacherDialogueHistoryResponse;
  storyTitle: string | null;
  studentName: string;
  onClose: () => void;
}> = ({ data, storyTitle, studentName, onClose }) => {
  const headerTitle = storyTitle
    ? `${studentName} — 《${storyTitle}》對話紀錄`
    : `${studentName} — 對話紀錄`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="學生對話紀錄"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100 shrink-0">
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-gray-800 truncate">{headerTitle}</h2>
            <p className="text-xs text-gray-400 mt-0.5">共 {data.total} 則訊息</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="關閉對話紀錄"
            className="flex-shrink-0 p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Turns */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {data.turns.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-sm text-gray-500">這次學習沒有對話記錄</p>
            </div>
          ) : (
            data.turns.map((turn) => <DialogueTurnRow key={turn.id} turn={turn} />)
          )}
        </div>
      </div>
    </div>
  );
};

const DialogueTurnRow: React.FC<{ turn: TeacherDialogueTurn }> = ({ turn }) => {
  if (turn.role === 'ai') {
    return (
      <div className="flex gap-2.5">
        <div className="flex-shrink-0 w-6 h-6 rounded-full bg-accent flex items-center justify-center mt-0.5">
          <span className="text-white text-[9px] font-bold">AI</span>
        </div>
        <div className="flex-1 max-w-[85%]">
          {turn.phase && (
            <span className="inline-block mb-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-accent-bg text-accent">
              {PHASE_LABEL[turn.phase] ?? turn.phase}
            </span>
          )}
          <div className="bg-accent-bg border border-accent-bg-subtle rounded-2xl rounded-tl-sm px-3.5 py-2.5">
            <p className="text-sm text-accent-hover leading-relaxed">{turn.text}</p>
          </div>
        </div>
      </div>
    );
  }

  if (turn.role === 'student') {
    return (
      <div className="flex gap-2.5 flex-row-reverse">
        <div className="flex-shrink-0 w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center mt-0.5">
          <svg className="w-3 h-3 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
              d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
        </div>
        <div className="max-w-[85%]">
          <div className="bg-accent rounded-2xl rounded-tr-sm px-3.5 py-2.5">
            <p className="text-sm text-white leading-relaxed">{turn.text}</p>
          </div>
        </div>
      </div>
    );
  }

  if (turn.role === 'feedback') {
    return (
      <div className="mx-8">
        <div className={`rounded-xl px-3 py-2 text-xs border ${
          turn.is_correct
            ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
            : 'bg-amber-50 border-amber-200 text-amber-800'
        }`}>
          <span className="mr-1">{turn.is_correct ? '✓' : '💡'}</span>
          {turn.text}
        </div>
      </div>
    );
  }

  return null;
};

// ── Main Component ─────────────────────────────────────────────────────────

const StudentProgressTab: React.FC<StudentProgressTabProps> = ({ classroomId }) => {
  const { token } = useAuth();
  const [progress, setProgress] = useState<StudentProgress[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);

  // Expand / session history state
  const [expandedStudentId, setExpandedStudentId] = useState<number | null>(null);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  const [sessions, setSessions] = useState<StudentSession[]>([]);
  const sessionCache = useRef<Record<number, StudentSession[]>>({});
  /* #1784: separate fetch-failed from no-data so teacher doesn't mistake
   * an API error for "student hasn't done any sessions". */
  const [sessionsError, setSessionsError] = useState<string | null>(null);

  // Dialogue modal state (Issue #418)
  const [dialogueModal, setDialogueModal] = useState<{
    data: TeacherDialogueHistoryResponse;
    storyTitle: string | null;
    studentName: string;
  } | null>(null);
  const [loadingDialogueSessionId, setLoadingDialogueSessionId] = useState<number | null>(null);
  // #1784: surface dialogue-fetch failures (was silent → opened blank modal)
  const [dialogueError, setDialogueError] = useState<string | null>(null);

  // Instruction panel state
  const [instructionTarget, setInstructionTarget] = useState<{ id: number; name: string } | null>(null);
  const [instructionCounts, setInstructionCounts] = useState<Record<number, number>>({});

  // Tag management state
  const [tagManagerStudent, setTagManagerStudent] = useState<StudentProgress | null>(null);

  // Learning curve state
  const [learningCurve, setLearningCurve] = useState<LearningCurvePoint[]>([]);
  const [isLoadingCurve, setIsLoadingCurve] = useState(false);
  const curveCache = useRef<Record<string, LearningCurvePoint[]>>({});
  // #1784: surface learning-curve fetch failures
  const [curveError, setCurveError] = useState<string | null>(null);
  const [curveStoryFilter, setCurveStoryFilter] = useState<string>(''); // empty = all stories

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


  // Load instruction counts for all students in one bulk request (avoids N+1)
  const loadInstructionCounts = useCallback(async (_students: StudentProgress[]) => {
    if (!token) return;
    try {
      const counts = await getClassroomInstructionCounts(token, classroomId);
      setInstructionCounts(counts);
    } catch {
      // Non-fatal: leave counts at zero
    }
  }, [token, classroomId]);

  useEffect(() => {
    if (progress.length > 0) {
      loadInstructionCounts(progress);
    }
  }, [progress, loadInstructionCounts]);

  const handleExport = useCallback(async () => {
    if (!token) return;
    try {
      setExporting(true);
      const blob = await exportClassroomReport(token, classroomId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `classroom-report-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setError('匯出失敗，請稍後再試');
    } finally {
      setExporting(false);
    }
  }, [token, classroomId]);

  const handleRowClick = useCallback(async (studentId: number) => {
    // Toggle collapse if already expanded
    if (expandedStudentId === studentId) {
      setExpandedStudentId(null);
      return;
    }

    setExpandedStudentId(studentId);
    // #1778: explicit nextFilter — was using stale curveStoryFilter from closure
    // (UI showed 'all stories' but cache key + API call used previous filter)
    const nextFilter = '';
    setCurveStoryFilter(nextFilter);
    if (!token) return;

    // Load session history (with cache)
    if (sessionCache.current[studentId]) {
      setSessions(sessionCache.current[studentId]);
      setSessionsError(null);
    } else {
      setIsLoadingSessions(true);
      setSessions([]);
      setSessionsError(null);
      try {
        const data = await getStudentSessions(token, studentId);
        sessionCache.current[studentId] = data;
        setSessions(data);
      } catch (err) {
        // #1784: keep sessions empty but surface the failure so teacher
        // doesn't conclude the student hasn't done any practice.
        setSessionsError(err instanceof Error ? err.message : '無法載入學習紀錄');
      } finally {
        setIsLoadingSessions(false);
      }
    }

    // Load learning curve (with cache) — use nextFilter not stale closure value
    const cacheKey = `${studentId}:${nextFilter}`;
    if (curveCache.current[cacheKey]) {
      setLearningCurve(curveCache.current[cacheKey]);
      setCurveError(null);
    } else {
      setIsLoadingCurve(true);
      setLearningCurve([]);
      setCurveError(null);
      try {
        const curveData = await getStudentLearningCurve(token, studentId, nextFilter || undefined);
        curveCache.current[cacheKey] = curveData.data;
        setLearningCurve(curveData.data);
      } catch (err) {
        // #1784: surface curve fetch failure instead of pretending data is empty
        setCurveError(err instanceof Error ? err.message : '無法載入學習曲線');
      } finally {
        setIsLoadingCurve(false);
      }
    }
  }, [expandedStudentId, token]);

  // Load and show dialogue history for a session (Issue #418)
  const handleViewDialogue = useCallback(async (
    studentId: number,
    sessionId: number,
    storyTitle: string | null,
    studentName: string,
  ) => {
    if (!token) return;
    setLoadingDialogueSessionId(sessionId);
    setDialogueError(null);
    try {
      const data = await getTeacherStudentDialogue(token, studentId, sessionId);
      setDialogueModal({ data, storyTitle, studentName });
    } catch (err) {
      // #1784: was silently failing → teacher clicked the dialogue button and
      // nothing happened. Now surface the error inline.
      setDialogueError(err instanceof Error ? err.message : '無法載入對話紀錄');
    } finally {
      setLoadingDialogueSessionId(null);
    }
  }, [token]);

  // Update local tags after tag manager changes
  const handleTagsChanged = useCallback((studentId: number, tags: StudentTag[]) => {
    setProgress((prev) =>
      prev.map((s) => (s.student_id === studentId ? { ...s, tags } : s))
    );
    // Update tag manager state so the modal reflects changes immediately
    setTagManagerStudent((prev) =>
      prev && prev.student_id === studentId ? { ...prev, tags } : prev
    );
  }, []);

  /** Build chart-ready data with rolling average (window=5). */
  const buildCurveChartData = (points: LearningCurvePoint[]) => {
    return points.map((pt, idx) => {
      const windowStart = Math.max(0, idx - 4);
      const windowSlice = points.slice(windowStart, idx + 1);
      const rollingAvg = windowSlice.reduce((sum, p) => sum + p.score, 0) / windowSlice.length;
      return {
        date: new Date(pt.date).toLocaleDateString('zh-TW', { month: 'short', day: 'numeric' }),
        score: pt.score,
        rollingAvg: Math.round(rollingAvg * 10) / 10,
        story_title: pt.story_title,
        cpm: pt.cpm,
        accuracy: pt.accuracy,
      };
    });
  };

  /** Get unique story slugs from learning curve for the filter dropdown. */
  const availableStories = useMemo(() => {
    // Use the "all stories" cache for the current student
    const allKey = `${expandedStudentId}:`;
    const allPoints = curveCache.current[allKey] || learningCurve;
    const seen = new Map<string, string>();
    for (const pt of allPoints) {
      if (pt.story_slug && !seen.has(pt.story_slug)) {
        seen.set(pt.story_slug, pt.story_title || pt.story_slug);
      }
    }
    return Array.from(seen.entries()).map(([slug, title]) => ({ slug, title }));
  }, [expandedStudentId, learningCurve]);

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
      {/* Tag Manager Modal */}
      {tagManagerStudent && (
        <TagManager
          studentId={tagManagerStudent.student_id}
          studentName={tagManagerStudent.student_name}
          currentTags={tagManagerStudent.tags}
          onClose={() => setTagManagerStudent(null)}
          onTagsChanged={handleTagsChanged}
        />
      )}

      {/* Dialogue History Modal (Issue #418) */}
      {dialogueModal && (
        <DialogueModal
          data={dialogueModal.data}
          storyTitle={dialogueModal.storyTitle}
          studentName={dialogueModal.studentName}
          onClose={() => setDialogueModal(null)}
        />
      )}
      {/* #1784: dialogue fetch errors used to be silent; surface them as a
          dismissible banner so the teacher doesn't think "button doesn't work". */}
      {dialogueError && (
        <div className="mb-3 flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-red-200 bg-red-50 text-sm text-red-700">
          <span>對話紀錄載入失敗：{dialogueError}</span>
          <button type="button" onClick={() => setDialogueError(null)} className="underline text-xs">關閉</button>
        </div>
      )}

      <div className="flex justify-end mb-3">
        <button
          onClick={handleExport}
          disabled={exporting}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          {exporting ? '匯出中...' : '匯出 CSV'}
        </button>
      </div>
      {/* Mobile card view */}
      <div className="md:hidden space-y-3">
        {progress.map((s) => {
          const isExpanded = expandedStudentId === s.student_id;
          return (
            <div key={s.student_id}>
              <div
                className="bg-white rounded-lg border border-gray-200 p-4 cursor-pointer hover:border-gray-300 transition-colors"
                onClick={() => handleRowClick(s.student_id)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <svg
                        className={`w-4 h-4 text-gray-400 transition-transform duration-200 shrink-0 ${isExpanded ? 'rotate-90' : ''}`}
                        fill="none" stroke="currentColor" viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                      <span className="font-medium text-gray-900">{s.student_name}</span>
                      {s.tags.map((t) => (
                        <span
                          key={t.tag_name}
                          className={`inline-block px-1.5 py-0.5 rounded-full text-xs font-medium border ${tagColorClass(t.color)}`}
                        >
                          {t.tag_name}
                        </span>
                      ))}
                      <button
                        onClick={(e) => { e.stopPropagation(); setTagManagerStudent(s); }}
                        className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs text-gray-400 border border-dashed border-gray-300 hover:border-gray-400 hover:text-gray-600 transition-colors cursor-pointer"
                        title="管理標籤"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                        標籤
                      </button>
                    </div>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); setInstructionTarget({ id: s.student_id, name: s.student_name }); }}
                    className="relative inline-flex items-center justify-center px-2.5 py-1 rounded-md text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 hover:bg-amber-100 transition-colors shrink-0"
                    title="AI 教學指示"
                  >
                    留言
                    {(instructionCounts[s.student_id] ?? 0) > 0 && (
                      <span className="absolute -top-0.5 -right-0.5 inline-flex items-center justify-center w-3.5 h-3.5 text-[9px] font-bold text-white bg-amber-500 rounded-full">
                        {instructionCounts[s.student_id]}
                      </span>
                    )}
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm mt-3">
                  <div>
                    <span className="text-xs text-gray-400">最近練習日期</span>
                    <p className="text-gray-700">{formatDate(s.last_session_date)}</p>
                  </div>
                  <div>
                    <span className="text-xs text-gray-400">最近課文</span>
                    <p className="text-gray-700 truncate">{s.last_text_title ?? '-'}</p>
                  </div>
                  <div>
                    <span className="text-xs text-gray-400">練習次數</span>
                    <p>
                      <span className={`inline-block min-w-[2rem] px-2 py-0.5 rounded-full text-xs font-medium ${
                        s.total_sessions > 0 ? 'bg-accent-bg text-accent' : 'bg-gray-100 text-gray-500'
                      }`}>{s.total_sessions}</span>
                    </p>
                  </div>
                </div>
              </div>
              {isExpanded && (
                <div className="mt-2 bg-gray-50 rounded-lg p-3 space-y-4">
                  {isLoadingCurve ? (
                    <div className="h-40 bg-gray-200 animate-pulse rounded" />
                  ) : curveError ? (
                    <div className="px-3 py-2 rounded-lg border border-red-200 bg-red-50 text-xs text-red-700">
                      學習曲線載入失敗：{curveError}（請收合此學生後再展開重試）
                    </div>
                  ) : learningCurve.length >= 2 ? (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-xs font-medium text-gray-500">學習曲線</p>
                        {availableStories.length > 1 && (
                          <select
                            value={curveStoryFilter}
                            onChange={(e) => setCurveStoryFilter(e.target.value)}
                            className="text-xs border border-gray-200 rounded px-2 py-1 bg-white text-gray-600"
                          >
                            <option value="">全部課文</option>
                            {availableStories.map((s) => (
                              <option key={s.slug} value={s.slug}>{s.title}</option>
                            ))}
                          </select>
                        )}
                      </div>
                      <ResponsiveContainer width="100%" height={180}>
                        <LineChart data={buildCurveChartData(learningCurve)}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                          <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                          <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} width={28} />
                          <Tooltip
                            formatter={(value: number, name: string) => {
                              if (name === 'score') return [value, '實際分數'];
                              if (name === 'rollingAvg') return [value, '5次均線'];
                              if (name === 'cpm') return [`${value} 字/分`, '語速'];
                              if (name === 'accuracy') return [`${value}%`, '準確度'];
                              return [value, name];
                            }}
                            labelFormatter={(label) => `日期：${label}`}
                          />
                          <Legend formatter={(value) => {
                            if (value === 'score') return '實際分數';
                            if (value === 'rollingAvg') return '5次均線';
                            if (value === 'cpm') return '語速';
                            if (value === 'accuracy') return '準確度';
                            return value;
                          }} />
                          <Line type="monotone" dataKey="score" stroke="#5B4FC4" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                          <Line type="monotone" dataKey="rollingAvg" stroke="#10b981" strokeWidth={2} dot={false} strokeDasharray="5 3" connectNulls />
                          {curveStoryFilter && (
                            <>
                              <Line type="monotone" dataKey="cpm" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                              <Line type="monotone" dataKey="accuracy" stroke="#ef4444" strokeWidth={1} dot={{ r: 2 }} strokeDasharray="4 2" connectNulls />
                            </>
                          )}
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  ) : null}

                  {isLoadingSessions ? (
                    <div className="space-y-2">
                      {Array.from({ length: 3 }).map((_, i) => (
                        <div key={i} className="h-16 bg-gray-200 animate-pulse rounded-lg" />
                      ))}
                    </div>
                  ) : sessionsError ? (
                    <div className="px-3 py-2 rounded-lg border border-red-200 bg-red-50 text-xs text-red-700">
                      學習紀錄載入失敗：{sessionsError}（請收合此學生後再展開重試）
                    </div>
                  ) : sessions.length === 0 ? (
                    <p className="text-xs text-gray-500 text-center py-2">尚無練習記錄</p>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-gray-500">練習記錄</p>
                      {sessions.map((sess) => (
                        <div key={sess.id} className="bg-white rounded-lg border border-gray-100 p-3">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium text-gray-700 text-sm truncate">{sess.story_title ?? '-'}</span>
                            <div className="flex items-center gap-2 shrink-0">
                              {statusLabel(sess.status)}
                              {sess.teacher_reviewed_at && (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium text-emerald-600 bg-emerald-50 border border-emerald-200" title="已查看">
                                  ✓ 已查看
                                </span>
                              )}
                              <Link
                                to={`/teacher/students/${s.student_id}/sessions/${sess.id}/report`}
                                onClick={(e) => e.stopPropagation()}
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium text-accent border border-accent/30 hover:bg-accent-bg transition-colors"
                                title="查看學習報告"
                              >
                                <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                </svg>
                                報告
                              </Link>
                              <button
                                type="button"
                                disabled={loadingDialogueSessionId === sess.id}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleViewDialogue(s.student_id, sess.id, sess.story_title, s.student_name);
                                }}
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium text-accent border border-accent/30 hover:bg-accent-bg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                title="查看蘇格拉底對話記錄"
                              >
                                {loadingDialogueSessionId === sess.id ? (
                                  <span className="w-2.5 h-2.5 border border-accent border-t-transparent rounded-full animate-spin" />
                                ) : (
                                  <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                      d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                                  </svg>
                                )}
                                對話
                              </button>
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-xs mt-2">
                            <div>
                              <span className="text-gray-400">日期</span>
                              <p className="text-gray-600">{formatDate(sess.started_at)}</p>
                            </div>
                            <div>
                              <span className="text-gray-400">分數</span>
                              <p className="text-gray-700 font-medium">{formatScore(sess.overall_score)}</p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Desktop table view */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-left text-gray-500">
              <th className="pb-2 font-medium w-6"></th>
              <th className="pb-2 font-medium">學生姓名</th>
              <th className="pb-2 font-medium">最近練習日期</th>
              <th className="pb-2 font-medium">最近練習課文</th>
              <th className="pb-2 font-medium text-center">練習次數</th>
              <th className="pb-2 font-medium text-center w-10">指示</th>
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
                    <td className="py-2.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-gray-900 font-medium">{s.student_name}</span>
                        {/* Tag badges */}
                        {s.tags.map((t) => (
                          <span
                            key={t.tag_name}
                            className={`inline-block px-1.5 py-0.5 rounded-full text-xs font-medium border ${tagColorClass(t.color)}`}
                          >
                            {t.tag_name}
                          </span>
                        ))}
                        {/* Tag management button */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setTagManagerStudent(s);
                          }}
                          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs text-gray-400 border border-dashed border-gray-300 hover:border-gray-400 hover:text-gray-600 transition-colors cursor-pointer"
                          title="管理標籤"
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                          </svg>
                          標籤
                        </button>
                      </div>
                    </td>
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
                    <td className="py-2.5 text-center">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setInstructionTarget({ id: s.student_id, name: s.student_name });
                        }}
                        className="relative inline-flex items-center justify-center px-2.5 py-1 rounded-md text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 hover:bg-amber-100 transition-colors"
                        title="AI 教學指示"
                      >
                        留言
                        {(instructionCounts[s.student_id] ?? 0) > 0 && (
                          <span className="absolute -top-0.5 -right-0.5 inline-flex items-center justify-center w-3.5 h-3.5 text-[9px] font-bold text-white bg-amber-500 rounded-full">
                            {instructionCounts[s.student_id]}
                          </span>
                        )}
                      </button>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr>
                      <td colSpan={6} className="bg-gray-50 px-4 py-3 space-y-4">
                        {/* Learning curve chart */}
                        {isLoadingCurve ? (
                          <div className="h-40 bg-gray-200 animate-pulse rounded" />
                        ) : curveError ? (
                          <div className="px-3 py-2 rounded-lg border border-red-200 bg-red-50 text-xs text-red-700">
                            學習曲線載入失敗：{curveError}（請收合此學生後再展開重試）
                          </div>
                        ) : learningCurve.length >= 2 ? (
                          <div>
                            <div className="flex items-center justify-between mb-2">
                              <p className="text-xs font-medium text-gray-500">學習曲線</p>
                              {availableStories.length > 1 && (
                                <select
                                  value={curveStoryFilter}
                                  onChange={(e) => setCurveStoryFilter(e.target.value)}
                                  className="text-xs border border-gray-200 rounded px-2 py-1 bg-white text-gray-600"
                                >
                                  <option value="">全部課文</option>
                                  {availableStories.map((st) => (
                                    <option key={st.slug} value={st.slug}>{st.title}</option>
                                  ))}
                                </select>
                              )}
                            </div>
                            <ResponsiveContainer width="100%" height={180}>
                              <LineChart data={buildCurveChartData(learningCurve)}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                                <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                                <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} width={28} />
                                <Tooltip
                                  formatter={(value: number, name: string) => {
                                    if (name === 'score') return [value, '實際分數'];
                                    if (name === 'rollingAvg') return [value, '5次均線'];
                                    if (name === 'cpm') return [`${value} 字/分`, '語速'];
                                    if (name === 'accuracy') return [`${value}%`, '準確度'];
                                    return [value, name];
                                  }}
                                  labelFormatter={(label) => `日期：${label}`}
                                />
                                <Legend
                                  formatter={(value) => {
                                    if (value === 'score') return '實際分數';
                                    if (value === 'rollingAvg') return '5次均線';
                                    if (value === 'cpm') return '語速';
                                    if (value === 'accuracy') return '準確度';
                                    return value;
                                  }}
                                />
                                <Line type="monotone" dataKey="score" stroke="#5B4FC4" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                                <Line type="monotone" dataKey="rollingAvg" stroke="#10b981" strokeWidth={2} dot={false} strokeDasharray="5 3" connectNulls />
                                {curveStoryFilter && (
                                  <>
                                    <Line type="monotone" dataKey="cpm" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                                    <Line type="monotone" dataKey="accuracy" stroke="#ef4444" strokeWidth={1} dot={{ r: 2 }} strokeDasharray="4 2" connectNulls />
                                  </>
                                )}
                              </LineChart>
                            </ResponsiveContainer>
                          </div>
                        ) : null}

                        {/* Session history table */}
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
                        ) : sessionsError ? (
                          <div className="px-3 py-2 rounded-lg border border-red-200 bg-red-50 text-xs text-red-700">
                            學習紀錄載入失敗：{sessionsError}（請收合此學生後再展開重試）
                          </div>
                        ) : sessions.length === 0 ? (
                          <p className="text-xs text-gray-500 text-center py-2">尚無練習記錄</p>
                        ) : (
                          <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-left text-gray-400">
                                <th className="pb-1.5 font-medium">課文</th>
                                <th className="pb-1.5 font-medium">日期</th>
                                <th className="pb-1.5 font-medium text-center">分數</th>
                                <th className="pb-1.5 font-medium text-center">狀態</th>
                                <th className="pb-1.5 font-medium text-center">報告</th>
                                <th className="pb-1.5 font-medium text-center">對話</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                              {sessions.map((sess) => (
                                <tr key={sess.id}>
                                  <td className="py-1.5 text-gray-700">{sess.story_title ?? '-'}</td>
                                  <td className="py-1.5 text-gray-500">{formatDate(sess.started_at)}</td>
                                  <td className="py-1.5 text-gray-700 text-center font-medium">{formatScore(sess.overall_score)}</td>
                                  <td className="py-1.5 text-center">{statusLabel(sess.status)}</td>
                                  <td className="py-1.5 text-center">
                                    <Link
                                      to={`/teacher/students/${s.student_id}/sessions/${sess.id}/report`}
                                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium text-accent border border-accent/30 hover:bg-accent-bg transition-colors"
                                      title="查看學習報告"
                                    >
                                      {sess.teacher_reviewed_at ? '✓ 報告' : '報告'}
                                    </Link>
                                  </td>
                                  <td className="py-1.5 text-center">
                                    <button
                                      type="button"
                                      disabled={loadingDialogueSessionId === sess.id}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleViewDialogue(s.student_id, sess.id, sess.story_title, s.student_name);
                                      }}
                                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium text-accent border border-accent/30 hover:bg-accent-bg transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                                      title="查看蘇格拉底對話記錄"
                                    >
                                      {loadingDialogueSessionId === sess.id ? (
                                        <span className="w-2.5 h-2.5 border border-accent border-t-transparent rounded-full animate-spin" />
                                      ) : (
                                        <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                            d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                                        </svg>
                                      )}
                                      對話
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          </div>
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

      {/* Teacher Instruction Panel Modal */}
      {instructionTarget && (
        <TeacherInstructionPanel
          studentId={instructionTarget.id}
          studentName={instructionTarget.name}
          classroomId={classroomId}
          onClose={() => {
            setInstructionTarget(null);
            // Refresh instruction counts when panel closes
            loadInstructionCounts(progress);
          }}
        />
      )}
    </div>
  );
};

export default StudentProgressTab;
