import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { stepPath as buildStepPath } from '../../config/stepPath';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import {
  getMyAssignments,
  startAssignment,
  StudentAssignmentResponse,
  AssignmentApiError,
} from '../../services/assignmentApi';
import {
  fetchMyEnrolledClassrooms,
  type StudentEnrolledClassroom,
} from '../../services/learningApi';
import { filterRequiredAssignmentSteps, resolveActiveSteps, type StepConfig } from '../../config/stepConfig';
import { writeAssignmentSessionContext } from '../../utils/assignmentSessionContext';
import AssignmentCard from './AssignmentCard';
import AssignmentFilters, { type FilterTab } from './AssignmentFilters';
import { type SortKey, SORT_OPTIONS } from './assignmentSort';

const MyAssignments: React.FC = () => {
  const navigate = useNavigate();
  const { token, user } = useAuth();

  const [assignments, setAssignments] = useState<StudentAssignmentResponse[]>([]);
  const [classrooms, setClassrooms] = useState<StudentEnrolledClassroom[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeFilter, setActiveFilter] = useState<FilterTab>('pending');
  const [sortKey, setSortKey] = useState<SortKey>('newest');
  const [startingId, setStartingId] = useState<number | null>(null);
  const [classroomFilter, setClassroomFilter] = useState<string>('all');

  // Issue #3682 — this used to be a single global `ACTIVE_STEPS` list
  // (resolveActiveSteps() called with no step_sequence, i.e. always the
  // DEFAULT_STEP_SEQUENCE), applied to every assignment regardless of which
  // lesson it actually used. A lesson with its own `step_sequence` — in
  // particular a multi-part lesson whose round-keyed step ids look like
  // `key-passage-reading#4uee3` (#2916/#2930) — has NO overlap with that
  // global list, so `steps_completed` entries for it never matched and the
  // card showed "0/11" or "1/11" for a student who had finished most or all
  // of the real steps. Resolve per-assignment instead.
  const getAssignmentSteps = useCallback(
    (a: StudentAssignmentResponse): StepConfig[] => resolveActiveSteps(a.step_sequence),
    [],
  );

  // The denominator/numerator shown as "學習關卡進度 N/M" must be the SAME
  // required-step list that decides isAssignmentReadyForSubmit
  // (useStepProgressPersistence.ts) — excluding 'lesson-intro'/'report' — or
  // "8 done, ready to submit" could still render as "8/11" instead of "8/8".
  const getAssignmentProgressSteps = useCallback(
    (a: StudentAssignmentResponse): StepConfig[] => filterRequiredAssignmentSteps(getAssignmentSteps(a)),
    [getAssignmentSteps],
  );

  // Build classroom name -> teacher name lookup
  const classroomTeacherMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of classrooms) {
      map.set(c.name, c.teacher_name);
    }
    return map;
  }, [classrooms]);

  const getCompletedSteps = (a: StudentAssignmentResponse): Set<string> => {
    const progressSteps = getAssignmentProgressSteps(a);
    if (a.status === 'submitted' || a.status === 'graded') {
      return new Set(progressSteps.map((step) => step.id));
    }
    const stepIdSet = new Set(progressSteps.map((s) => s.id));
    return new Set(
      (a.steps_completed ?? []).filter((stepKey) => stepIdSet.has(stepKey)),
    );
  };

  const getResumeStepPath = (a: StudentAssignmentResponse): string => {
    // #2916/#3682 fix C — a.current_step can be a composite round key
    // (`comprehension#pjhxh`) for multi-part lessons.
    //
    // #3697 resolves `steps` from THIS assignment's own step_sequence instead
    // of the global default, so a lesson that DECLARES per-round entries
    // (e.g. `key-passage-reading#4uee3` as its own step_sequence item) now
    // has that exact composite id as a member of `stepIdSet` — try that
    // first, since (unlike a syntactic-only check) it correctly falls
    // through for a stale/renamed round slug left over from a content edit.
    //
    // But most lessons have NO custom step_sequence at all (falls back to
    // DEFAULT_STEP_SEQUENCE, bare ids only) — a.current_step can still be a
    // round-keyed id there (comprehension's rounds aren't declared in
    // step_sequence, only expressed at runtime via `?p=`). For that case
    // keep the progress-wipe fix's (#3693) base-id + syntactic-slug check:
    // strip the round, confirm the BASE id is a real step for this lesson,
    // and only accept a slug that could possibly be a real round reference
    // (not e.g. a path-traversal payload — test: "falls back to the default
    // step when the stored round slug has an unexpected shape").
    const steps = getAssignmentSteps(a);
    const stepIdSet = new Set(steps.map((s) => s.id));
    if (a.current_step) {
      if (stepIdSet.has(a.current_step)) {
        return a.current_step;
      }
      const hashIdx = a.current_step.indexOf('#');
      const baseId = hashIdx < 0 ? a.current_step : a.current_step.slice(0, hashIdx);
      const slug = hashIdx < 0 ? null : a.current_step.slice(hashIdx + 1);
      if (stepIdSet.has(baseId) && (slug === null || /^[A-Za-z0-9_-]{1,32}$/.test(slug))) {
        return a.current_step;
      }
    }
    return steps[0]?.id ?? 'full-text-annotate';
  };

  const loadData = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    setError('');
    try {
      const [assignmentData, classroomData] = await Promise.all([
        getMyAssignments(token),
        fetchMyEnrolledClassrooms(token).catch(() => ({ classrooms: [], total: 0 })),
      ]);
      setAssignments(assignmentData);
      setClassrooms(classroomData.classrooms);
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
    loadData();
  }, [loadData]);

  const filteredAssignments = useMemo(() => {
    const filtered = assignments.filter((a) => {
      if (classroomFilter !== 'all' && a.classroom_name !== classroomFilter) return false;
      if (activeFilter === 'pending') {
        return a.status === 'pending' || a.status === 'in_progress';
      }
      if (activeFilter === 'completed') {
        return a.status === 'submitted';
      }
      return a.status === 'graded';
    });
    const sortOption = SORT_OPTIONS.find((o) => o.key === sortKey);
    return sortOption ? [...filtered].sort(sortOption.compareFn) : filtered;
  }, [assignments, activeFilter, sortKey, classroomFilter]);

  // Summary bar: unique classroom names from enrolled classrooms
  const classroomNames = useMemo(() => classrooms.map((c) => c.name), [classrooms]);
  // Show pill filter when student is in 2+ classrooms (#1158)
  const showClassroomFilter = classrooms.length >= 2;

  // Reset classroom filter if the selected classroom is no longer in the list
  useEffect(() => {
    if (classroomFilter !== 'all' && !classroomNames.includes(classroomFilter)) {
      setClassroomFilter('all');
    }
  }, [classroomNames, classroomFilter]);

  // ------------------------------------------------------------------
  // Action handlers — delegate sessionStorage writes to the context util
  // ------------------------------------------------------------------

  const handleStart = async (assignmentId: number) => {
    if (!token) return;
    setStartingId(assignmentId);
    try {
      const result = await startAssignment(token, assignmentId);
      const textKey = result.story_id ?? String(result.text_id);
      writeAssignmentSessionContext({
        assignmentId,
        storyKey: textKey,
        userId: user ? String(user.id) : null,
        goals: {
          target_cpm: result.target_cpm,
          target_accuracy: result.target_accuracy,
          difficulty_label: result.difficulty_label,
          effective_cpm: result.effective_cpm,
          effective_accuracy: result.effective_accuracy,
        },
        sessionId: result.session_id,
      });
      // #3682 — first step of THIS lesson's own sequence, not the global default
      // (StartAssignmentResponse doesn't carry step_sequence; look up the
      // already-loaded list entry, which does).
      const original = assignments.find((x) => x.assignment_id === assignmentId);
      const firstStepPath = resolveActiveSteps(original?.step_sequence)[0]?.id ?? 'full-text-annotate';
      navigate(buildStepPath(textKey, firstStepPath));
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

  const handleResume = async (a: StudentAssignmentResponse) => {
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
    const textKey = a.story_id ?? a.text_id;
    writeAssignmentSessionContext({
      assignmentId: a.assignment_id,
      storyKey: textKey ?? '',
      userId: user ? String(user.id) : null,
      goals: {
        target_cpm: a.target_cpm,
        target_accuracy: a.target_accuracy,
        difficulty_label: a.difficulty_label,
        effective_cpm: a.effective_cpm,
        effective_accuracy: a.effective_accuracy,
      },
      sessionId,
    });
    const resumeStepPath = getResumeStepPath(a);
    navigate(buildStepPath(textKey, resumeStepPath));
  };

  const handleViewReport = (a: StudentAssignmentResponse) => {
    const textKey = a.story_id ?? a.text_id;
    if (textKey == null) return;
    writeAssignmentSessionContext({
      assignmentId: a.assignment_id,
      storyKey: textKey,
      userId: user ? String(user.id) : null,
      goals: {
        target_cpm: a.target_cpm,
        target_accuracy: a.target_accuracy,
        difficulty_label: a.difficulty_label,
        effective_cpm: a.effective_cpm,
        effective_accuracy: a.effective_accuracy,
      },
      sessionId: a.session_id,
    });
    navigate(`/learn/${textKey}/report`);
  };

  return (
    <div className="flex-1 overflow-y-auto bg-surface">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 pt-6 pb-10 space-y-4">
        {/* Page title */}
        <div>
          <h1 className="text-xl sm:text-2xl font-bold font-headline text-on-surface">班級作業</h1>
          <p className="text-xs sm:text-sm text-on-surface-variant mt-0.5">完成老師指派的學習任務</p>
        </div>

        {/* Classroom summary bar */}
        {!isLoading && classrooms.length > 0 && (
          <div className="flex items-center gap-2 px-3 py-2 bg-accent/5 border border-accent/20 rounded-xl text-xs text-accent">
            <span aria-hidden="true">🏫</span>
            <span>
              你在 <strong>{classrooms.length}</strong> 個班級：
              {classroomNames.join('・')}
            </span>
          </div>
        )}

        {/* Filters + sort — hidden while loading to avoid layout jump */}
        {!isLoading && (
          <AssignmentFilters
            activeFilter={activeFilter}
            onFilterChange={setActiveFilter}
            sortKey={sortKey}
            onSortChange={setSortKey}
            classroomNames={classroomNames}
            classroomFilter={classroomFilter}
            onClassroomFilterChange={setClassroomFilter}
            showClassroomFilter={showClassroomFilter}
          />
        )}

        {/* Error */}
        {error && (
          <div className="bg-error/5 border border-error/20 text-error text-sm rounded-lg px-4 py-3">
            {error}
            <button onClick={() => setError('')} className="ml-2 underline cursor-pointer">
              關閉
            </button>
          </div>
        )}

        {/* Loading skeleton */}
        {isLoading ? (
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="bg-surface-container-lowest border border-[#E5E0D5] rounded-2xl p-4">
                <div className="h-5 bg-surface-container animate-pulse rounded w-2/3 mb-3" />
                <div className="h-4 bg-surface-container animate-pulse rounded w-1/3 mb-2" />
                <div className="h-4 bg-surface-container animate-pulse rounded w-1/4" />
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
            <p className="text-sm font-medium text-on-surface mb-1">
              {activeFilter === 'pending'
                ? '目前沒有待完成的作業'
                : activeFilter === 'completed'
                  ? '還沒有已完成的作業'
                  : '還沒有已批改的作業'}
            </p>
            <p className="text-xs text-on-surface-variant">老師指派的作業會顯示在這裡</p>
            {/* Nothing assigned is not "nothing to do": point to self-study, as
                Khan Academy's empty states point to the next practice. */}
            {activeFilter === 'pending' && (
              <button
                type="button"
                onClick={() => navigate('/library')}
                className="mt-4 inline-flex items-center gap-1.5 h-10 px-5 rounded-full bg-accent hover:bg-accent-hover text-white text-sm font-medium cursor-pointer"
              >
                📚 去圖書館自己練習
              </button>
            )}
          </div>
        ) : (
          /* Assignment cards */
          <div className="space-y-3">
            {filteredAssignments.map((a) => (
              <AssignmentCard
                key={a.assignment_id}
                assignment={a}
                steps={getAssignmentProgressSteps(a)}
                completedSteps={getCompletedSteps(a)}
                currentStepPath={a.status === 'in_progress' ? getResumeStepPath(a) : null}
                teacherName={classroomTeacherMap.get(a.classroom_name)}
                startingId={startingId}
                onStart={handleStart}
                onResume={handleResume}
                onViewReport={handleViewReport}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default MyAssignments;
