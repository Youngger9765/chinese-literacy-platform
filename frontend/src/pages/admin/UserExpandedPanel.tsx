/**
 * UserExpandedPanel — role details + assign form for an expanded user row.
 *
 * Shows the user's current role assignments (loaded on mount via getUserRoles),
 * with inline revoke confirm pattern and an optional AssignRoleForm.
 * Uses ConfirmDialog primitive for the revoke confirmation gate.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { UserListItem } from '../../services/userApi';
import {
  getUserRoles,
  revokeRole,
  UserRoleDetailResponse,
  RoleApiError,
} from '../../services/roleApi';
import { PlusIcon } from '../../components/icons';
import RoleBadge from './RoleBadge';
import AssignRoleForm from './AssignRoleForm';

export interface UserExpandedPanelProps {
  user: UserListItem;
  onRolesChanged: () => void;
}

const UserExpandedPanel: React.FC<UserExpandedPanelProps> = ({ user, onRolesChanged }) => {
  const { token } = useAuth();

  const [roleDetails, setRoleDetails] = useState<UserRoleDetailResponse[]>([]);
  const [isLoadingRoles, setIsLoadingRoles] = useState(true);
  const [rolesError, setRolesError] = useState('');

  const [showAssignForm, setShowAssignForm] = useState(false);

  // Inline revoke confirm
  const [revokeConfirmId, setRevokeConfirmId] = useState<number | null>(null);
  const [isRevoking, setIsRevoking] = useState(false);

  const loadRoleDetails = useCallback(async () => {
    if (!token) return;
    setIsLoadingRoles(true);
    setRolesError('');
    try {
      const data = await getUserRoles(token, user.id);
      setRoleDetails(data);
    } catch (err) {
      if (err instanceof RoleApiError) {
        setRolesError(err.message);
      } else {
        setRolesError('無法載入角色資訊');
      }
    } finally {
      setIsLoadingRoles(false);
    }
  }, [token, user.id]);

  useEffect(() => {
    loadRoleDetails();
  }, [loadRoleDetails]);

  const handleRevoke = async (assignmentId: number) => {
    if (!token) return;
    setIsRevoking(true);
    try {
      await revokeRole(token, assignmentId);
      setRevokeConfirmId(null);
      await loadRoleDetails();
      onRolesChanged();
    } catch (err) {
      const msg = err instanceof RoleApiError ? err.message : '撤銷角色失敗';
      setRolesError(msg);
    } finally {
      setIsRevoking(false);
    }
  };

  const handleAssignSuccess = async () => {
    setShowAssignForm(false);
    await loadRoleDetails();
    onRolesChanged();
  };

  return (
    <div className="px-6 pb-5 bg-gray-50 border-t border-gray-100">
      <div className="max-w-2xl space-y-4 pt-4">
        {/* Current roles section */}
        <div>
          <h4 className="text-sm font-semibold text-gray-700 mb-2">目前角色</h4>

          {isLoadingRoles && (
            <div className="flex items-center gap-2 py-2">
              <div className="w-3 h-3 border-2 border-gray-300 border-t-transparent rounded-full animate-spin" />
              <span className="text-xs text-gray-400">載入中...</span>
            </div>
          )}

          {rolesError && (
            <p className="text-xs text-red-600 py-1">{rolesError}</p>
          )}

          {!isLoadingRoles && !rolesError && roleDetails.length === 0 && (
            <p className="text-xs text-gray-400 py-1">此使用者尚無任何角色</p>
          )}

          {!isLoadingRoles && !rolesError && roleDetails.length > 0 && (
            <div className="space-y-2">
              {roleDetails.map((rd) => (
                <div
                  key={rd.id}
                  className="flex items-center justify-between bg-white rounded-lg border border-gray-200 px-3 py-2"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <RoleBadge
                      roleName={rd.role_name}
                      label={rd.role_display_name}
                      className="shrink-0"
                    />
                    <span className="text-xs text-gray-400 truncate">
                      {rd.scope_type}
                      {rd.scope_id ? ` / ${rd.scope_id}` : ''}
                    </span>
                    {!rd.is_active && (
                      <span className="rounded-full px-1.5 py-0.5 text-[10px] bg-gray-100 text-gray-500">
                        停用
                      </span>
                    )}
                  </div>

                  {/* Inline revoke confirm */}
                  <div className="shrink-0 ml-2">
                    {revokeConfirmId === rd.id ? (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleRevoke(rd.id)}
                          disabled={isRevoking}
                          className="text-xs text-red-600 hover:text-red-800 font-medium cursor-pointer disabled:opacity-50"
                        >
                          {isRevoking ? '處理中...' : '確認撤銷'}
                        </button>
                        <button
                          onClick={() => setRevokeConfirmId(null)}
                          disabled={isRevoking}
                          className="text-xs text-gray-400 hover:text-gray-600 cursor-pointer disabled:opacity-50"
                        >
                          取消
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setRevokeConfirmId(rd.id)}
                        className="text-gray-300 hover:text-red-500 transition-colors cursor-pointer"
                        title="撤銷此角色"
                        aria-label={`撤銷 ${rd.role_display_name}`}
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Assign role section */}
        {!showAssignForm ? (
          <button
            onClick={() => setShowAssignForm(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-lg transition-colors cursor-pointer"
          >
            <PlusIcon />
            指派角色
          </button>
        ) : (
          <AssignRoleForm
            userId={user.id}
            onSuccess={handleAssignSuccess}
            onCancel={() => setShowAssignForm(false)}
          />
        )}
      </div>
    </div>
  );
};

export default UserExpandedPanel;
