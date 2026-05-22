import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import {
  addStudentTag,
  exportClassroomReport,
  getClassroomInstructionCounts,
  getClassroomProgress,
  getStudentLearningCurve,
  getStudentSessions,
  getTeacherStudentDialogue,
  removeStudentTag,
  LearningCurvePoint,
  StudentProgress,
  StudentSession,
  StudentTag,
  TeacherApiError,
  TeacherDialogueHistoryResponse,
} from '../../../services/teacherApi';

export interface DialogueModalState {
  data: TeacherDialogueHistoryResponse;
  storyTitle: string | null;
  studentName: string;
}

export interface InstructionTarget {
  id: number;
  name: string;
}

export function useStudentProgress(classroomId: number) {
  const { token } = useAuth();
  const [progress, setProgress] = useState<StudentProgress[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);

  const [expandedStudentId, setExpandedStudentId] = useState<number | null>(null);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  const [sessions, setSessions] = useState<StudentSession[]>([]);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const sessionCache = useRef<Record<number, StudentSession[]>>({});

  const [dialogueModal, setDialogueModal] = useState<DialogueModalState | null>(null);
  const [loadingDialogueSessionId, setLoadingDialogueSessionId] = useState<number | null>(null);
  const [dialogueError, setDialogueError] = useState<string | null>(null);

  const [instructionTarget, setInstructionTarget] = useState<InstructionTarget | null>(null);
  const [instructionCounts, setInstructionCounts] = useState<Record<number, number>>({});

  const [tagManagerStudent, setTagManagerStudent] = useState<StudentProgress | null>(null);

  const [learningCurve, setLearningCurve] = useState<LearningCurvePoint[]>([]);
  const [isLoadingCurve, setIsLoadingCurve] = useState(false);
  const [curveError, setCurveError] = useState<string | null>(null);
  const curveCache = useRef<Record<string, LearningCurvePoint[]>>({});
  const [curveStoryFilter, setCurveStoryFilter] = useState<string>('');

  const loadProgress = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    setError('');
    try {
      const data = await getClassroomProgress(token, classroomId);
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

  const exportReport = useCallback(async () => {
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
    } catch {
      setError('匯出失敗，請稍後再試');
    } finally {
      setExporting(false);
    }
  }, [token, classroomId]);

  const loadStudentSessions = useCallback(async (studentId: number) => {
    if (!token) return;
    if (sessionCache.current[studentId]) {
      setSessions(sessionCache.current[studentId]);
      setSessionsError(null);
      return;
    }

    setIsLoadingSessions(true);
    setSessions([]);
    setSessionsError(null);
    try {
      const data = await getStudentSessions(token, studentId);
      sessionCache.current[studentId] = data;
      setSessions(data);
    } catch (err) {
      setSessionsError(err instanceof Error ? err.message : '載入失敗');
      setSessions([]);
    } finally {
      setIsLoadingSessions(false);
    }
  }, [token]);

  const loadLearningCurve = useCallback(async (studentId: number, storyFilter: string) => {
    if (!token) return;
    const cacheKey = `${studentId}:${storyFilter}`;
    if (curveCache.current[cacheKey]) {
      setLearningCurve(curveCache.current[cacheKey]);
      setCurveError(null);
      return;
    }

    setIsLoadingCurve(true);
    setLearningCurve([]);
    setCurveError(null);
    try {
      const curveData = await getStudentLearningCurve(token, studentId, storyFilter || undefined);
      curveCache.current[cacheKey] = curveData.data;
      setLearningCurve(curveData.data);
    } catch (err) {
      setCurveError(err instanceof Error ? err.message : '載入失敗');
      setLearningCurve([]);
    } finally {
      setIsLoadingCurve(false);
    }
  }, [token]);

  const handleRowClick = useCallback(async (studentId: number) => {
    if (expandedStudentId === studentId) {
      setExpandedStudentId(null);
      return;
    }

    setExpandedStudentId(studentId);
    const nextFilter = '';
    setCurveStoryFilter(nextFilter);
    if (!token) return;

    await loadStudentSessions(studentId);
    await loadLearningCurve(studentId, nextFilter);
  }, [expandedStudentId, loadLearningCurve, loadStudentSessions, token]);

  const loadDialogue = useCallback(async (
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
      setDialogueError(err instanceof Error ? err.message : '無法載入對話紀錄');
    } finally {
      setLoadingDialogueSessionId(null);
    }
  }, [token]);

  const handleTagsChanged = useCallback((studentId: number, tags: StudentTag[]) => {
    setProgress((prev) =>
      prev.map((s) => (s.student_id === studentId ? { ...s, tags } : s)),
    );
    setTagManagerStudent((prev) =>
      prev && prev.student_id === studentId ? { ...prev, tags } : prev,
    );
  }, []);

  const addTag = useCallback(async (studentId: number, tagName: string, color: string): Promise<StudentTag | null> => {
    if (!token) return null;
    try {
      return await addStudentTag(token, studentId, tagName, color);
    } catch (err) {
      if (err instanceof TeacherApiError && err.status === 409) {
        return null;
      }
      throw err;
    }
  }, [token]);

  const removeTag = useCallback(async (studentId: number, tagName: string) => {
    if (!token) return;
    await removeStudentTag(token, studentId, tagName);
  }, [token]);

  const availableStories = useMemo(() => {
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

  return {
    progress,
    isLoading,
    error,
    setError,
    exporting,
    expandedStudentId,
    isLoadingSessions,
    sessions,
    sessionsError,
    dialogueModal,
    setDialogueModal,
    loadingDialogueSessionId,
    dialogueError,
    setDialogueError,
    instructionTarget,
    setInstructionTarget,
    instructionCounts,
    tagManagerStudent,
    setTagManagerStudent,
    learningCurve,
    isLoadingCurve,
    curveError,
    curveStoryFilter,
    setCurveStoryFilter,
    availableStories,
    loadProgress,
    loadInstructionCounts,
    loadStudentSessions,
    loadDialogue,
    loadLearningCurve,
    exportReport,
    handleRowClick,
    handleTagsChanged,
    addTag,
    removeTag,
  };
}
