/**
 * PendingInvitationsBanner — #3820.
 *
 * A co-teaching invitation starts 'pending' and grants NO classroom access
 * until the invitee accepts it (backend: require_classroom_member denies a
 * pending row everywhere). So the invitee can't discover it by opening the
 * classroom -- this banner (fed by GET /co-teaching/invitations) is the only
 * place they see it, with Accept/Reject actions right there.
 *
 * Kept as its own small component (not inlined into TeacherDashboard, which
 * is already 500+ lines) so it's independently testable and the dashboard's
 * diff for this change stays a one-line import + one-line render.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import {
  acceptCoTeacherInvitation,
  listMyPendingInvitations,
  removeCoTeacher,
  ClassroomApiError,
  PendingInvitationResponse,
} from '../../services/classroomApi';

const roleText = (role: string) => (role === 'viewer' ? '只能看' : '可編輯');

const PendingInvitationsBanner: React.FC = () => {
  const { token } = useAuth();
  const [invitations, setInvitations] = useState<PendingInvitationResponse[]>([]);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const data = await listMyPendingInvitations(token);
      setInvitations(data);
    } catch {
      // Silent: this is a nice-to-have banner, not the page's core content --
      // a transient failure here shouldn't block the rest of the dashboard.
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const handleAccept = async (inv: PendingInvitationResponse) => {
    if (!token) return;
    setBusyId(inv.classroom_teacher_id);
    setError('');
    try {
      await acceptCoTeacherInvitation(token, inv.classroom_id, inv.teacher_id);
      await load();
    } catch (err) {
      setError(err instanceof ClassroomApiError ? err.message : '接受邀請失敗');
    } finally {
      setBusyId(null);
    }
  };

  const handleReject = async (inv: PendingInvitationResponse) => {
    if (!token) return;
    setBusyId(inv.classroom_teacher_id);
    setError('');
    try {
      await removeCoTeacher(token, inv.classroom_id, inv.teacher_id);
      await load();
    } catch (err) {
      setError(err instanceof ClassroomApiError ? err.message : '拒絕邀請失敗');
    } finally {
      setBusyId(null);
    }
  };

  if (invitations.length === 0) return null;

  return (
    <div
      data-testid="pending-invitations-banner"
      className="space-y-2 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3"
    >
      <h2 className="text-sm font-semibold text-blue-800">待我確認的協同教學邀請</h2>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {invitations.map((inv) => (
        <div
          key={inv.classroom_teacher_id}
          className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-white rounded-lg px-3 py-2"
        >
          <p className="text-sm text-gray-700">
            <span className="font-medium">{inv.invited_by_name}</span> 邀請你以「
            <span className="font-medium">{roleText(inv.role)}</span>
            」身份加入「<span className="font-medium">{inv.classroom_name}</span>」
          </p>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={() => handleAccept(inv)}
              disabled={busyId === inv.classroom_teacher_id}
              className="text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg disabled:opacity-50 cursor-pointer"
            >
              接受
            </button>
            <button
              onClick={() => handleReject(inv)}
              disabled={busyId === inv.classroom_teacher_id}
              className="text-xs font-medium text-gray-500 hover:text-red-600 px-3 py-1.5 rounded-lg disabled:opacity-50 cursor-pointer"
            >
              拒絕
            </button>
          </div>
        </div>
      ))}
    </div>
  );
};

export default PendingInvitationsBanner;
