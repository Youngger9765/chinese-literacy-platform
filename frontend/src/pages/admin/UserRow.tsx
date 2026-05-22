/**
 * UserRow — a single row in the users table.
 *
 * Renders user name, email, role badges, active status, and a toggle button.
 * When isExpanded is true, renders the UserExpandedPanel inline below.
 */
import React from 'react';
import { UserListItem } from '../../services/userApi';
import RoleBadge, { getRoleDisplayName } from './RoleBadge';
import UserExpandedPanel from './UserExpandedPanel';

export interface UserRowProps {
  user: UserListItem;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onRolesChanged: () => void;
}

const UserRow: React.FC<UserRowProps> = ({ user, isExpanded, onToggleExpand, onRolesChanged }) => {
  return (
    <div className="border-b border-gray-100 last:border-b-0">
      {/* Main row */}
      <div
        onClick={onToggleExpand}
        className="grid grid-cols-1 sm:grid-cols-[1fr_1.5fr_1fr_80px_100px] gap-2 sm:gap-4 px-6 py-4 hover:bg-gray-50 cursor-pointer transition-colors items-center"
      >
        {/* Name */}
        <div className="font-medium text-gray-900 text-sm truncate">
          {user.name}
        </div>

        {/* Email */}
        <div className="text-sm text-gray-500 truncate">
          {user.email}
        </div>

        {/* Role badges */}
        <div className="flex flex-wrap gap-1">
          {user.roles.length === 0 && (
            <span className="text-xs text-gray-400">無角色</span>
          )}
          {user.roles.map((role, i) => (
            <RoleBadge
              key={`${role.role_name}-${role.scope_type}-${role.scope_id ?? 'null'}-${i}`}
              roleName={role.role_name}
              label={getRoleDisplayName(role.role_name)}
            />
          ))}
        </div>

        {/* Active status */}
        <div>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
              user.is_active
                ? 'bg-green-100 text-green-700'
                : 'bg-gray-100 text-gray-500'
            }`}
          >
            {user.is_active ? '啟用' : '停用'}
          </span>
        </div>

        {/* Expand/collapse toggle */}
        <div className="text-right">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand();
            }}
            className="text-xs text-accent hover:text-accent-hover font-medium cursor-pointer"
          >
            {isExpanded ? '收合' : '管理角色'}
          </button>
        </div>
      </div>

      {/* Expanded panel */}
      {isExpanded && (
        <UserExpandedPanel user={user} onRolesChanged={onRolesChanged} />
      )}
    </div>
  );
};

export default UserRow;
