/**
 * AssignRoleForm — form for assigning a role to a user.
 *
 * Loads available roles + organizations + schools on mount.
 * Shows a scope picker (org or school) when the selected role requires it.
 * Calls assignRole on submit.
 *
 * Security: scope_type is derived server-side from role.scope_level.
 * We send the correct scope_type based on SCOPE_LEVEL_FOR_ASSIGN mapping.
 */
import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import {
  listRoles,
  assignRole,
  RoleResponse,
  RoleApiError,
} from '../../services/roleApi';
import {
  listOrganizations,
  OrganizationResponse,
} from '../../services/organizationApi';
import { listSchools, SchoolResponse } from '../../services/schoolApi';

// scope_level from role → scope_type sent to API
const SCOPE_LEVEL_FOR_ASSIGN: Record<string, string> = {
  global: 'platform',
  organization: 'organization',
  school: 'school',
  classroom: 'classroom',
};

export interface AssignRoleFormProps {
  userId: number;
  onSuccess: () => void;
  onCancel: () => void;
}

const AssignRoleForm: React.FC<AssignRoleFormProps> = ({ userId, onSuccess, onCancel }) => {
  const { token } = useAuth();

  const [availableRoles, setAvailableRoles] = useState<RoleResponse[]>([]);
  const [organizations, setOrganizations] = useState<OrganizationResponse[]>([]);
  const [schools, setSchools] = useState<SchoolResponse[]>([]);
  const [isLoadingRoles, setIsLoadingRoles] = useState(true);

  const [selectedRoleName, setSelectedRoleName] = useState('');
  const [scopeId, setScopeId] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  const selectedRole = availableRoles.find((r) => r.name === selectedRoleName);
  const scopeLevel = selectedRole?.scope_level ?? '';
  const scopeType = SCOPE_LEVEL_FOR_ASSIGN[scopeLevel] ?? 'platform';
  const needsScope = scopeLevel === 'organization' || scopeLevel === 'school';

  // Load roles + scope options on mount
  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    async function load() {
      setIsLoadingRoles(true);
      try {
        const [rolesData, orgsData, schoolsData] = await Promise.all([
          listRoles(token!),
          listOrganizations(token!).then((r) => r.items),
          listSchools(token!).then((r) => r.items),
        ]);
        if (!cancelled) {
          setAvailableRoles(rolesData);
          setOrganizations(orgsData);
          setSchools(schoolsData);
        }
      } catch {
        if (!cancelled) setFormError('無法載入角色列表');
      } finally {
        if (!cancelled) setIsLoadingRoles(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [token]);

  // Reset scope when role changes
  useEffect(() => {
    setScopeId('');
  }, [selectedRoleName]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !selectedRoleName) return;

    if (needsScope && !scopeId) {
      setFormError('請選擇範圍');
      return;
    }

    setIsSubmitting(true);
    setFormError('');

    try {
      await assignRole(token, {
        user_id: userId,
        role_name: selectedRoleName,
        scope_type: scopeType,
        scope_id: needsScope ? scopeId : undefined,
      });
      onSuccess();
    } catch (err) {
      const msg = err instanceof RoleApiError ? err.message : '指派角色失敗';
      setFormError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoadingRoles) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 border-2 border-gray-300 border-t-transparent rounded-full animate-spin" />
          <span className="text-xs text-gray-400">載入角色選項...</span>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
      <h5 className="text-sm font-semibold text-gray-700">指派新角色</h5>

      {formError && (
        <p className="text-xs text-red-600">{formError}</p>
      )}

      {/* Role selector */}
      <div>
        <label htmlFor="assign-role-select" className="block text-xs text-gray-500 mb-1">
          角色
        </label>
        <select
          id="assign-role-select"
          value={selectedRoleName}
          onChange={(e) => setSelectedRoleName(e.target.value)}
          className="w-full h-9 px-3 rounded-lg border border-gray-300 text-gray-900 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
        >
          <option value="">請選擇角色</option>
          {availableRoles.map((role) => (
            <option key={role.id} value={role.name}>
              {role.display_name}
            </option>
          ))}
        </select>
      </div>

      {/* Scope selector (organization) */}
      {selectedRole && scopeLevel === 'organization' && (
        <div>
          <label htmlFor="assign-scope-org" className="block text-xs text-gray-500 mb-1">
            機構
          </label>
          <select
            id="assign-scope-org"
            value={scopeId}
            onChange={(e) => setScopeId(e.target.value)}
            className="w-full h-9 px-3 rounded-lg border border-gray-300 text-gray-900 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
          >
            <option value="">請選擇機構</option>
            {organizations.map((org) => (
              <option key={org.id} value={org.id}>
                {org.display_name || org.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Scope selector (school) */}
      {selectedRole && scopeLevel === 'school' && (
        <div>
          <label htmlFor="assign-scope-school" className="block text-xs text-gray-500 mb-1">
            學校
          </label>
          <select
            id="assign-scope-school"
            value={scopeId}
            onChange={(e) => setScopeId(e.target.value)}
            className="w-full h-9 px-3 rounded-lg border border-gray-300 text-gray-900 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
          >
            <option value="">請選擇學校</option>
            {schools.map((school) => (
              <option key={school.id} value={String(school.id)}>
                {school.display_name || school.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {selectedRole && scopeLevel === 'global' && (
        <p className="text-xs text-gray-400">此角色為全域角色，不需要選擇範圍</p>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1">
        <button
          type="submit"
          disabled={!selectedRoleName || isSubmitting}
          className="px-4 py-1.5 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-lg transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSubmitting ? '指派中...' : '指派'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={isSubmitting}
          className="px-4 py-1.5 text-sm text-gray-500 hover:text-gray-700 cursor-pointer disabled:opacity-50"
        >
          取消
        </button>
      </div>
    </form>
  );
};

export default AssignRoleForm;
