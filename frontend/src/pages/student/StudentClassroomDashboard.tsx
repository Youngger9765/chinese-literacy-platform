/**
 * StudentClassroomDashboard — 學生班級儀表板
 *
 * Route: /classroom-dashboard
 * Issue #464
 *
 * Shows:
 *   - All classrooms the student is enrolled in
 *   - Each classroom's teacher and grade
 *   - Pending / completed assignments per classroom
 *   - Link to start each assignment or view classroom's story library
 */

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import {
  fetchMyEnrolledClassrooms,
  type StudentEnrolledClassroom,
} from '../../services/learningApi';
import {
  getMyAssignments,
  type StudentAssignmentResponse,
  startAssignment,
} from '../../services/assignmentApi';
import { Skeleton, SkeletonText } from '../../components/ui/Skeleton';
import LoadingIndicator from '../../components/ui/LoadingIndicator';

// ---------------------------------------------------------------------------
// Assignment status badge
// ---------------------------------------------------------------------------

const STATUS_MAP: Record<string, { label: string; className: string }> = {
  pending:     { label: '待完成', className: 'bg-amber-100 text-amber-700' },
  in_progress: { label: '進行中', className: 'bg-blue-100 text-blue-700' },
  submitted:   { label: '已繳交', className: 'bg-green-100 text-green-700' },
  graded:      { label: '已評分', className: 'bg-purple-100 text-purple-700' },
};

const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const { label, className } = STATUS_MAP[status] ?? { label: status, className: 'bg-gray-100 text-gray-600' };
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${className}`}>
      {label}
    </span>
  );
};

const ClassroomCardSkeleton: React.FC = () => (
  <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
    <div className="bg-indigo-50 border-b border-indigo-100 px-5 py-4 flex items-center justify-between gap-4">
      <div className="flex items-center gap-3 min-w-0 w-full">
        <Skeleton className="h-9 w-9 rounded-full" />
        <div className="min-w-0 flex-1">
          <Skeleton className="h-5 w-2/5 rounded mb-2" />
          <Skeleton className="h-3 w-1/3 rounded" />
        </div>
      </div>
      <Skeleton className="h-8 w-16 rounded-lg" />
    </div>
    <div className="px-5 pt-4 pb-2 flex gap-4">
      <Skeleton className="h-4 w-20 rounded" />
      <Skeleton className="h-4 w-20 rounded" />
    </div>
    <div className="px-5 pb-4 space-y-4">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="flex items-center justify-between gap-3 pb-3 border-b border-gray-100 last:border-0 last:pb-0">
          <SkeletonText lines={2} className="flex-1" lineClassName="h-3 rounded" />
          <Skeleton className="h-6 w-14 rounded-full" />
          <Skeleton className="h-8 w-16 rounded-lg" />
        </div>
      ))}
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// Assignment row inside a classroom card
// ---------------------------------------------------------------------------

interface AssignmentRowProps {
  assignment: StudentAssignmentResponse;
  onStart: (id: number) => void;
  starting: boolean;
}

const AssignmentRow: React.FC<AssignmentRowProps> = ({ assignment, onStart, starting }) => {
  const navigate = useNavigate();
  const isDone = assignment.status === 'submitted' || assignment.status === 'graded';

  return (
    <li className="flex items-center justify-between gap-3 py-2 border-b border-gray-100 last:border-0">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-800 truncate">
          {assignment.title || assignment.story_title}
        </p>
        {assignment.due_date && (
          <p className="text-xs text-gray-400 mt-0.5">
            截止：{new Date(assignment.due_date).toLocaleDateString('zh-TW')}
          </p>
        )}
      </div>
      <StatusBadge status={assignment.status} />
      {!isDone ? (
        <button
          type="button"
          disabled={starting}
          onClick={() => onStart(assignment.assignment_id)}
          className="shrink-0 text-xs font-medium text-white bg-accent hover:bg-accent/90 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {starting ? '啟動中...' : '開始'}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => navigate('/assignments')}
          className="shrink-0 text-xs font-medium text-gray-500 hover:text-gray-700 px-3 py-1.5 rounded-lg border border-gray-200 hover:border-gray-300 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          查看
        </button>
      )}
    </li>
  );
};

// ---------------------------------------------------------------------------
// Classroom card
// ---------------------------------------------------------------------------

interface ClassroomCardProps {
  classroom: StudentEnrolledClassroom;
  assignments: StudentAssignmentResponse[];
  onStart: (assignmentId: number) => void;
  startingId: number | null;
}

const ClassroomCard: React.FC<ClassroomCardProps> = ({
  classroom,
  assignments,
  onStart,
  startingId,
}) => {
  const navigate = useNavigate();
  const pending = assignments.filter(
    (a) => a.status === 'pending' || a.status === 'in_progress',
  );
  const completed = assignments.filter(
    (a) => a.status === 'submitted' || a.status === 'graded',
  );

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="bg-indigo-50 border-b border-indigo-100 px-5 py-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-2xl shrink-0" aria-hidden="true">🏫</span>
          <div className="min-w-0">
            <h3 className="text-base font-bold text-indigo-900 truncate">{classroom.name}</h3>
            <p className="text-xs text-indigo-600 mt-0.5">
              老師：{classroom.teacher_name}
              {classroom.grade != null && (
                <span className="ml-2 text-indigo-400">({classroom.grade} 年級)</span>
              )}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => navigate(`/library?classroom=${classroom.id}`)}
          className="shrink-0 text-xs font-medium text-indigo-600 hover:text-indigo-800 border border-indigo-200 hover:border-indigo-400 px-3 py-1.5 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
        >
          課文庫
        </button>
      </div>

      {/* Assignment summary stats */}
      <div className="px-5 pt-3 pb-2 flex gap-4 text-xs">
        <span className="text-amber-700 font-semibold">
          {pending.length} 待完成
        </span>
        <span className="text-green-700 font-semibold">
          {completed.length} 已完成
        </span>
      </div>

      {/* Assignment list */}
      {assignments.length === 0 ? (
        <p className="px-5 pb-5 text-sm text-gray-400">目前沒有作業</p>
      ) : (
        <ul className="px-5 pb-4">
          {assignments.map((a) => (
            <AssignmentRow
              key={a.assignment_id}
              assignment={a}
              onStart={onStart}
              starting={startingId === a.assignment_id}
            />
          ))}
        </ul>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

const StudentClassroomDashboard: React.FC = () => {
  const { token } = useAuth();
  const navigate = useNavigate();

  const [classrooms, setClassrooms] = useState<StudentEnrolledClassroom[]>([]);
  const [assignments, setAssignments] = useState<StudentAssignmentResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [startingId, setStartingId] = useState<number | null>(null);

  useEffect(() => {
    if (!token) return;

    Promise.allSettled([
      fetchMyEnrolledClassrooms(token),
      getMyAssignments(token),
    ])
      .then(([classroomsResult, assignmentsResult]) => {
        if (classroomsResult.status === 'fulfilled') {
          setClassrooms(classroomsResult.value.classrooms);
        }
        if (assignmentsResult.status === 'fulfilled') {
          setAssignments(assignmentsResult.value);
        }
        if (classroomsResult.status === 'rejected' && assignmentsResult.status === 'rejected') {
          setError('載入資料時發生錯誤，請稍後再試');
        }
      })
      .finally(() => setLoading(false));
  }, [token]);

  const handleStart = async (assignmentId: number) => {
    if (!token) return;
    setStartingId(assignmentId);
    try {
      const result = await startAssignment(token, assignmentId);
      sessionStorage.setItem('activeAssignmentId', String(assignmentId));
      if (result.story_id) {
        navigate(`/learn/${result.story_id}/intro`);
      } else if (result.text_id) {
        navigate(`/learn/${result.text_id}/intro`);
      } else {
        navigate('/assignments');
      }
    } catch {
      setError('啟動作業時發生錯誤');
    } finally {
      setStartingId(null);
    }
  };

  // Group assignments by classroom_name
  const assignmentsByClassroom = (classroomName: string) =>
    assignments.filter((a) => a.classroom_name === classroomName);

  const ClassroomCardSkeleton = () => (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="bg-indigo-50 border-b border-indigo-100 px-5 py-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0 w-full">
          <Skeleton className="h-9 w-9 rounded-full" />
          <div className="min-w-0 flex-1">
            <Skeleton className="h-5 w-2/5 rounded mb-2" />
            <Skeleton className="h-3 w-1/3 rounded" />
          </div>
        </div>
        <Skeleton className="h-8 w-16 rounded-lg" />
      </div>
      <div className="px-5 pt-4 pb-2 flex gap-4">
        <Skeleton className="h-4 w-20 rounded" />
        <Skeleton className="h-4 w-20 rounded" />
      </div>
      <div className="px-5 pb-4 space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-center justify-between gap-3 pb-3 border-b border-gray-100 last:border-0 last:pb-0">
            <SkeletonText lines={2} className="flex-1" lineClassName="h-3 rounded" />
            <Skeleton className="h-6 w-14 rounded-full" />
            <Skeleton className="h-8 w-16 rounded-lg" />
          </div>
        ))}
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-4">
          <LoadingIndicator />
          <div>
            <Skeleton className="h-5 w-36 rounded" />
            <Skeleton className="h-3 w-52 rounded mt-1.5" />
          </div>
          <div className="space-y-5">
            {Array.from({ length: 2 }).map((_, index) => (
              <ClassroomCardSkeleton key={index} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-4">
        {/* Page header */}
        <div>
          <h1 className="text-base font-bold text-gray-900">我的班級</h1>
          <p className="text-xs text-gray-500 mt-0.5">查看你加入的班級、老師和作業</p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">
            {error}
          </div>
        )}

        {classrooms.length === 0 ? (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-8 text-center">
            <span className="text-4xl" aria-hidden="true">🏫</span>
            <p className="text-base font-semibold text-amber-800 mt-3">尚未加入任何班級</p>
            <p className="text-sm text-amber-600 mt-1">
              請向老師索取班級加入碼，或等待老師將你加入班級。
            </p>
            <button
              type="button"
              onClick={() => navigate('/join')}
              className="mt-4 text-sm font-medium text-white bg-accent hover:bg-accent/90 px-5 py-2 rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              加入班級
            </button>
          </div>
        ) : (
          <div className="space-y-5">
            {classrooms.map((c) => (
              <ClassroomCard
                key={c.id}
                classroom={c}
                assignments={assignmentsByClassroom(c.name)}
                onStart={handleStart}
                startingId={startingId}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default StudentClassroomDashboard;
