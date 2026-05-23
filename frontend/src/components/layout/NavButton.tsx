/**
 * NavButton — single sidebar nav item.
 *
 * Extracted from Sidebar.tsx (Issue #1937).
 * Used by StudentSidebar, TeacherSidebar, AdminSidebar, and MobileTabBar.
 */

import React from 'react';

export interface NavItem {
  icon: string;
  label: string;
  path: string;
  badge?: number;
}

export interface NavButtonProps {
  item: NavItem;
  collapsed: boolean;
  active: boolean;
  onClick: () => void;
}

export const NavButton: React.FC<NavButtonProps> = ({ item, collapsed, active, onClick }) => {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={item.label}
      aria-current={active ? 'page' : undefined}
      title={collapsed ? item.label : undefined}
      className={`
        relative w-full flex items-center gap-3 rounded-lg transition-colors
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1
        ${collapsed ? 'justify-center px-2 py-2.5' : 'px-3 py-2.5'}
        ${active
          ? 'bg-accent-bg text-accent font-semibold border-l-2 border-accent'
          : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
        }
      `}
    >
      <span className="text-lg shrink-0" aria-hidden="true">{item.icon}</span>
      {!collapsed && (
        <span className="text-sm truncate">{item.label}</span>
      )}
      {item.badge != null && item.badge > 0 && (
        <span
          aria-label={`${item.badge} 個待辦項目`}
          className={`
            min-w-[18px] h-4.5 flex items-center justify-center bg-red-500 text-white text-[10px] font-bold rounded-full px-1 leading-none shrink-0
            ${collapsed ? 'absolute top-1 right-1' : 'ml-auto'}
          `}
        >
          {item.badge > 9 ? '9+' : item.badge}
        </span>
      )}
    </button>
  );
};
