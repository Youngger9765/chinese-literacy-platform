/**
 * RoleBadge — colored pill for a role name.
 *
 * Displays a human-readable role label in a color-coded pill badge.
 * Colors follow the admin UI convention (red=system, blue=org, green=staff, etc.).
 */
import React from 'react';

// ── Color mapping ────────────────────────────────────────────────────────────

export const ROLE_BADGE_STYLES: Record<string, string> = {
  system_admin: 'bg-red-100 text-red-700',
  org_admin: 'bg-blue-100 text-blue-700',
  org_owner: 'bg-blue-100 text-blue-700',
  teacher: 'bg-green-100 text-green-700',
  principal: 'bg-green-100 text-green-700',
  director: 'bg-green-100 text-green-700',
  student: 'bg-yellow-100 text-yellow-700',
  parent: 'bg-purple-100 text-purple-700',
};

export const ROLE_DISPLAY_NAMES: Record<string, string> = {
  system_admin: '系統管理員',
  org_admin: '機構管理員',
  org_owner: '機構擁有者',
  teacher: '教師',
  principal: '校長',
  director: '主任',
  student: '學生',
  parent: '家長',
};

export function getRoleBadgeStyle(roleName: string): string {
  return ROLE_BADGE_STYLES[roleName] ?? 'bg-gray-100 text-gray-700';
}

export function getRoleDisplayName(roleName: string): string {
  return ROLE_DISPLAY_NAMES[roleName] ?? roleName;
}

// ── Component ────────────────────────────────────────────────────────────────

export interface RoleBadgeProps {
  /** Internal role name key (e.g. 'teacher', 'org_admin'). */
  roleName: string;
  /** Override display label. Falls back to ROLE_DISPLAY_NAMES map. */
  label?: string;
  /** Extra className applied to the pill. */
  className?: string;
}

const RoleBadge: React.FC<RoleBadgeProps> = ({ roleName, label, className = '' }) => {
  const displayLabel = label ?? getRoleDisplayName(roleName);
  const colorClass = getRoleBadgeStyle(roleName);

  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${colorClass} ${className}`.trim()}
    >
      {displayLabel}
    </span>
  );
};

export default RoleBadge;
