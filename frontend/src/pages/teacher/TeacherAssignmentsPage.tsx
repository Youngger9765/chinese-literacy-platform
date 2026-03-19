/**
 * TeacherAssignmentsPage — standalone page for managing assignments across classrooms.
 * Route: /teacher/assignments
 * Lifted from ClassroomDetail tab to sidebar level (#550).
 * Teacher selects a classroom, then sees assignments for that classroom.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { listMyClassrooms, ClassroomResponse, ClassroomApiError } from '../../services/classroomApi';
import AssignmentTab from './AssignmentTab';

const TeacherAssignmentsPage: React.FC = () => {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const classroomIdParam = searchParams.get('classroom');

  const [classrooms, setClassrooms] = useState<ClassroomResponse[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(() => {
    const id = classroomIdParam ? parseInt(classroomIdParam, 10) : NaN;
    return Number.isNaN(id) ? null : id;
  });

  const loadClassrooms = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    setError('');
    try {
      const data = await listMyClassrooms(token);
      setClassrooms(data.items);
      if (data.items.length > 0) {
        const ids = new Set(data.items.map((c) => c.id));
        const valid = selectedId && ids.has(selectedId);
        if (!valid) {
          const first = data.items[0].id;
          setSelectedId(first);
          setSearchParams({ classroom: String(first) }, { replace: true });
        }
      }
    } catch (err) {
      if (err instanceof ClassroomApiError) {
        setError(err.message);
      } else {
        setError('無法載入班級列表');
      }
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void loadClassrooms();
  }, [loadClassrooms]);

  useEffect(() => {
    const id = classroomIdParam ? parseInt(classroomIdParam, 10) : NaN;
    if (!Number.isNaN(id)) setSelectedId(id);
  }, [classroomIdParam]);

  const handleSelectClassroom = (id: number) => {
    setSelectedId(id);
    setSearchParams({ classroom: String(id) }, { replace: true });
  };

  if (isLoading) {
    return (
      <div className="flex-1 overflow-y-auto p-6 sm:p-8">
        <div className="max-w-4xl mx-auto">
          <div className="h-6 bg-gray-200 animate-pulse rounded w-32 mb-6" />
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
            <div className="h-48 bg-gray-100 animate-pulse rounded" />
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 overflow-y-auto p-6 sm:p-8">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-xl font-bold text-gray-900 mb-6">作業管理</h1>
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-6">
            <p>{error}</p>
            <button
              onClick={() => void loadClassrooms()}
              className="mt-3 text-sm text-red-600 underline hover:text-red-800"
            >
              重試
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (classrooms.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto p-6 sm:p-8">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-xl font-bold text-gray-900 mb-6">作業管理</h1>
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8 text-center text-gray-500">
            <p>尚無班級，請先建立班級。</p>
            <button
              type="button"
              onClick={() => navigate('/teacher')}
              className="mt-2 text-accent hover:underline cursor-pointer"
            >
              前往班級管理
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 sm:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <h1 className="text-xl font-bold text-gray-900">作業管理</h1>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-gray-600">班級：</span>
            <select
              value={selectedId ?? ''}
              onChange={(e) => handleSelectClassroom(Number(e.target.value))}
              className="rounded-lg border border-gray-300 px-3 py-2 text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-accent/40"
            >
              {classrooms.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.grade != null ? ` (${c.grade} 年級)` : ''}
                </option>
              ))}
            </select>
          </label>
        </div>

        {selectedId && <AssignmentTab classroomId={selectedId} />}
      </div>
    </div>
  );
};

export default TeacherAssignmentsPage;
