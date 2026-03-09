import React, { useEffect, useState, useCallback } from 'react';
import { getClassroomStuckOverview, type StudentStuckSummary } from '../../services/teacherApi';
import { useAuth } from '../../contexts/AuthContext';

interface ClassroomStuckAlertProps {
  classroomId: number;
}

/**
 * ClassroomStuckAlert — teacher dashboard panel for stuck-point alerts (Issue #91).
 *
 * Shows students who have learning stuck-points detected in the last 30 days.
 * Gives the teacher actionable insight at a glance.
 */
const ClassroomStuckAlert: React.FC<ClassroomStuckAlertProps> = ({ classroomId }) => {
  const { token } = useAuth();
  const [students, setStudents] = useState<StudentStuckSummary[]>([]);
  const [totalStuck, setTotalStuck] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchOverview = useCallback(async () => {
    if (!token) return;
    try {
      setLoading(true);
      setError(null);
      const data = await getClassroomStuckOverview(token, classroomId);
      setStudents(data.students);
      setTotalStuck(data.total_stuck);
    } catch (err) {
      setError('無法載入卡點概覽');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [token, classroomId]);

  useEffect(() => {
    fetchOverview();
  }, [fetchOverview]);

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="text-lg font-bold text-gray-900 mb-4">學習卡點警示</h3>
        <div className="flex items-center justify-center py-8">
          <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="text-lg font-bold text-gray-900 mb-4">學習卡點警示</h3>
        <p className="text-sm text-red-500">{error}</p>
      </div>
    );
  }

  if (totalStuck === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="text-lg font-bold text-gray-900 mb-4">學習卡點警示</h3>
        <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-lg p-4">
          <span className="text-xl">✓</span>
          <p className="text-sm text-green-700">目前班上無學生有學習卡點，繼續保持！</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-bold text-gray-900">學習卡點警示</h3>
        <span className="text-xs font-medium px-2 py-1 bg-red-100 text-red-700 rounded-full">
          {totalStuck} 位學生需要關注
        </span>
      </div>

      <div className="space-y-3">
        {students.map((stu) => (
          <StudentStuckRow key={stu.student_id} student={stu} />
        ))}
      </div>
    </div>
  );
};

interface StudentStuckRowProps {
  student: StudentStuckSummary;
}

const StudentStuckRow: React.FC<StudentStuckRowProps> = ({ student }) => {
  const hasCharacters = student.top_stuck_characters.length > 0;
  const hasRecs = student.top_recommendations.length > 0;

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-gray-900">{student.student_name}</span>
            {student.is_declining && (
              <span className="text-xs px-1.5 py-0.5 bg-orange-100 text-orange-700 rounded">
                正確率下滑
              </span>
            )}
            {student.story_stuck_count > 0 && (
              <span className="text-xs px-1.5 py-0.5 bg-yellow-100 text-yellow-700 rounded">
                課文卡關 {student.story_stuck_count} 篇
              </span>
            )}
            {student.character_stuck_count > 0 && (
              <span className="text-xs px-1.5 py-0.5 bg-red-100 text-red-700 rounded">
                卡點生字 {student.character_stuck_count} 個
              </span>
            )}
          </div>

          {hasCharacters && (
            <div className="flex items-center gap-1 mt-2">
              <span className="text-xs text-gray-500">卡點字：</span>
              {student.top_stuck_characters.map((ch) => (
                <span
                  key={ch}
                  className="text-base font-bold text-red-700 bg-red-50 border border-red-200 rounded px-1"
                >
                  {ch}
                </span>
              ))}
            </div>
          )}

          {hasRecs && (
            <div className="mt-2">
              {student.top_recommendations.map((rec, i) => (
                <p key={i} className="text-xs text-amber-800">
                  • {rec}
                </p>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ClassroomStuckAlert;
