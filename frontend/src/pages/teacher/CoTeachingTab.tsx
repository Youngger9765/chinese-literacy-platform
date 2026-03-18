/**
 * CoTeachingTab — manage co-teachers for a classroom.
 *
 * Permissions enforced by backend:
 *   - Only owner (primary teacher) can invite / remove other teachers.
 *   - Co-teachers (assistants) see the list but cannot manage it.
 *   - A co-teacher can remove themselves (leave).
 */
import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import {
  listClassroomTeachers,
  inviteCoTeacher,
  removeCoTeacher,
  ClassroomTeacherResponse,
  ClassroomApiError,
} from '../../services/classroomApi';

interface CoTeachingTabProps {
  classroomId: number;
  ownerId: number;
}

const CoTeachingTab: React.FC<CoTeachingTabProps> = ({ classroomId, ownerId }) => {
  const { token, user } = useAuth();
  const currentUserId = user?.id;
  const isOwner = currentUserId === ownerId;

  const [teachers, setTeachers] = useState<ClassroomTeacherResponse[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  // Invite form
  const [inviteEmail, setInviteEmail] = useState('');
  const [isInviting, setIsInviting] = useState(false);
  const [inviteError, setInviteError] = useState('');
  const [inviteSuccess, setInviteSuccess] = useState('');

  // Remove confirmation
  const [removingId, setRemovingId] = useState<number | null>(null);

  const loadTeachers = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    setError('');
    try {
      const data = await listClassroomTeachers(token, classroomId);
      setTeachers(data);
    } catch (err) {
      setError(err instanceof ClassroomApiError ? err.message : '無法載入教師列表');
    } finally {
      setIsLoading(false);
    }
  }, [token, classroomId]);

  useEffect(() => {
    loadTeachers();
  }, [loadTeachers]);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !inviteEmail.trim()) return;

    setIsInviting(true);
    setInviteError('');
    setInviteSuccess('');
    try {
      await inviteCoTeacher(token, classroomId, inviteEmail.trim());
      setInviteEmail('');
      setInviteSuccess('已成功邀請協同教師');
      await loadTeachers();
    } catch (err) {
      setInviteError(err instanceof ClassroomApiError ? err.message : '邀請失敗');
    } finally {
      setIsInviting(false);
    }
  };

  const handleRemove = async (teacherId: number) => {
    if (!token) return;
    try {
      await removeCoTeacher(token, classroomId, teacherId);
      setRemovingId(null);
      await loadTeachers();
    } catch (err) {
      setError(err instanceof ClassroomApiError ? err.message : '移除失敗');
      setRemovingId(null);
    }
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric' });
  };

  const roleLabel = (role: string, isMe: boolean) => {
    if (role === 'primary') return <span className="text-xs font-medium text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">主教師</span>;
    return <span className="text-xs font-medium text-green-600 bg-green-50 px-2 py-0.5 rounded-full">協同教師{isMe ? '（我）' : ''}</span>;
  };

  if (isLoading) {
    return (
      <div className="p-6 space-y-3">
        {[1, 2].map((i) => (
          <div key={i} className="h-14 bg-gray-100 animate-pulse rounded-lg" />
        ))}
      </div>
    );
  }

  return (
    <div className="p-5 space-y-6">
      {/* Invite form — owner only */}
      {isOwner && (
        <div className="bg-gray-50 rounded-xl border border-gray-200 p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">邀請協同教師</h3>
          <form onSubmit={handleInvite} className="flex gap-2">
            <input
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="輸入教師 Email"
              disabled={isInviting}
              className="flex-1 text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:bg-gray-100"
            />
            <button
              type="submit"
              disabled={isInviting || !inviteEmail.trim()}
              className="text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              {isInviting ? '邀請中...' : '邀請'}
            </button>
          </form>
          {inviteError && <p className="mt-2 text-xs text-red-600">{inviteError}</p>}
          {inviteSuccess && <p className="mt-2 text-xs text-green-600">{inviteSuccess}</p>}
        </div>
      )}

      {/* Teacher list */}
      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="space-y-2">
        {teachers.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-6">目前沒有教師資料</p>
        ) : (
          teachers.map((ct) => {
            const isMe = ct.teacher_id === currentUserId;
            const canRemove = isOwner && ct.role !== 'primary';
            const canLeave = !isOwner && isMe && ct.role === 'assistant';

            return (
              <div
                key={ct.id}
                className="flex items-center justify-between bg-white border border-gray-200 rounded-xl px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center text-gray-600 font-semibold text-sm">
                    {ct.teacher_name.charAt(0)}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-800">{ct.teacher_name}</span>
                      {roleLabel(ct.role, isMe)}
                    </div>
                    <span className="text-xs text-gray-400">加入日期：{formatDate(ct.invited_at)}</span>
                  </div>
                </div>

                {/* Action buttons */}
                {(canRemove || canLeave) && (
                  removingId === ct.id ? (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500">{canLeave ? '確認離開？' : '確認移除？'}</span>
                      <button
                        onClick={() => handleRemove(ct.teacher_id)}
                        className="text-xs font-medium text-red-600 hover:text-red-700 cursor-pointer"
                      >
                        確認
                      </button>
                      <button
                        onClick={() => setRemovingId(null)}
                        className="text-xs text-gray-500 hover:text-gray-700 cursor-pointer"
                      >
                        取消
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setRemovingId(ct.id)}
                      className="text-xs text-gray-400 hover:text-red-500 transition-colors cursor-pointer"
                    >
                      {canLeave ? '離開班級' : '移除'}
                    </button>
                  )
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Info note for co-teachers */}
      {!isOwner && (
        <p className="text-xs text-gray-400 text-center">
          協同教師可查看學生進度與報告。班級設定由主教師管理。
        </p>
      )}
    </div>
  );
};

export default CoTeachingTab;
