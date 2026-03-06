import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import {
  getClassroomDetail,
  ClassroomDetailResponse,
  ClassroomApiError,
} from '../../services/classroomApi';

interface ClassroomDetailPanelProps {
  classroomId: number;
}

const ClassroomDetailPanel: React.FC<ClassroomDetailPanelProps> = ({ classroomId }) => {
  const { token } = useAuth();
  const [classroom, setClassroom] = useState<ClassroomDetailResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const loadClassroom = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    setError('');
    try {
      const data = await getClassroomDetail(token, classroomId);
      setClassroom(data);
    } catch (err) {
      if (err instanceof ClassroomApiError) {
        setError(err.message);
      } else {
        setError('無法載入班級資料');
      }
    } finally {
      setIsLoading(false);
    }
  }, [token, classroomId]);

  useEffect(() => {
    loadClassroom();
  }, [loadClassroom]);

  if (isLoading) {
    return (
      <div className="p-6 sm:p-8">
        <div className="max-w-4xl mx-auto">
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-4">
            <div className="h-6 bg-gray-200 animate-pulse rounded w-1/3" />
            <div className="h-4 bg-gray-200 animate-pulse rounded w-1/4" />
            <div className="h-4 bg-gray-200 animate-pulse rounded w-1/2" />
          </div>
        </div>
      </div>
    );
  }

  if (error && !classroom) {
    return (
      <div className="p-6 sm:p-8">
        <div className="max-w-4xl mx-auto">
          <div className="text-center py-12 bg-red-50 rounded-xl border border-red-200">
            <p className="text-red-700 text-sm">{error}</p>
            <button onClick={loadClassroom} className="mt-2 text-sm text-red-600 underline hover:text-red-800 cursor-pointer">
              重試
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!classroom) return null;

  return (
    <div className="p-6 sm:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Classroom info card */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-xl font-bold text-gray-900">{classroom.name}</h2>
              <div className="flex flex-wrap items-center gap-3 mt-3 text-sm text-gray-500">
                {classroom.grade != null && <span>{classroom.grade} 年級</span>}
                <span className={classroom.is_active ? 'text-emerald-600' : 'text-gray-400'}>
                  {classroom.is_active ? '使用中' : '已停用'}
                </span>
                <span>{classroom.student_count} 位學生</span>
              </div>
            </div>
          </div>
        </div>

        {/* Student list */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
          <div className="p-5 border-b border-gray-100 flex items-center justify-between">
            <h3 className="font-bold text-gray-900">學生名單</h3>
            <span className="text-sm text-gray-500">{classroom.students.length} 位</span>
          </div>

          {classroom.students.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-sm text-gray-400">尚無學生</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {classroom.students.map((student) => (
                <div key={student.id} className="px-5 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{student.name}</p>
                    <p className="text-xs text-gray-500">{student.email}</p>
                  </div>
                  <span className="text-xs text-gray-400">
                    {new Date(student.enrolled_at).toLocaleDateString('zh-TW')}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ClassroomDetailPanel;
