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
  /**
   * Optional one-line hint shown under the label on the expanded sidebar
   * (tablet+ widths). 2026-10-16 (#3554 follow-up, Young-approved copy):
   * tells apart 課堂搶答 ("現在全班一起玩，約 10 分鐘") from 跨班賽季
   * ("和別班比幾週，平常讀課文就累積") — two features that otherwise look
   * alike from the icon+label alone. Not rendered when collapsed (no
   * room) — the mobile bottom tab bar never renders it either (icon+label
   * only, see Sidebar.tsx's MobileTabBar).
   */
  description?: string;
}

export interface NavButtonProps {
  item: NavItem;
  collapsed: boolean;
  active: boolean;
  onClick: () => void;
  /**
   * #3992: the teacher workspace's primary nav (班級管理/作業管理/遊戲區/
   * 使用說明) was the last "left sidebar active item" still on the app's
   * indigo accent after #3989 already recolored ClassListSidebar's
   * per-classroom list (that one is a *different* component, the nested
   * "我的班級" list inside a classroom's own page -- this is the shared
   * top-level NavButton every role's main sidebar renders through).
   * 'teacher' swaps the active state to the same plain-gray-row +
   * orange (#FFA500) accent already established there, matching Junyi's
   * d1-class.png sidebar selection. Default ('default', or omitted) keeps
   * every other caller (StudentSidebar, AdminSidebar, MobileTabBar) on the
   * indigo brand accent -- this is additive, not a site-wide recolor.
   */
  variant?: 'default' | 'teacher';
}

export const NavButton: React.FC<NavButtonProps> = ({ item, collapsed, active, onClick, variant = 'default' }) => {
  const activeClassName = variant === 'teacher'
    ? 'bg-gray-100 text-gray-900 font-semibold border-l-2 border-[#FFA500]'
    : 'bg-accent-bg text-accent font-semibold border-l-2 border-accent';
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
        ${active ? activeClassName : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'}
      `}
    >
      <span className="text-lg shrink-0" aria-hidden="true">{item.icon}</span>
      {!collapsed && (
        <span className="flex flex-col items-start min-w-0 text-left">
          <span className="text-sm truncate">{item.label}</span>
          {item.description && (
            <span className="text-[11px] font-normal text-gray-400 truncate w-full">
              {item.description}
            </span>
          )}
        </span>
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
