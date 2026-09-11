/**
 * TeacherSidebar — nav items for teacher workspace view.
 *
 * Extracted from Sidebar.tsx (Issue #1937).
 */

import React from 'react';
import { NavButton, type NavItem } from './NavButton';
import { isActive } from './sidebarUtils';
import { useLocation } from 'react-router-dom';

export interface TeacherSidebarProps {
  collapsed: boolean;
  onNavigate: (path: string) => void;
}

export const TeacherSidebar: React.FC<TeacherSidebarProps> = ({
  collapsed,
  onNavigate,
}) => {
  const { pathname } = useLocation();

  const items: NavItem[] = getTeacherNavItems();

  return (
    <nav aria-label="教師導覽" className="flex flex-col gap-1.5">
      {items.map((item) => (
        <NavButton
          key={item.path}
          item={item}
          collapsed={collapsed}
          active={isActive(pathname, item.path)}
          onClick={() => onNavigate(item.path)}
        />
      ))}
    </nav>
  );
};

/**
 * Flat list of teacher nav items — the single source (used by the sidebar
 * above AND by MobileTabBar).
 *
 * These used to be written out twice, once here and once inline in the
 * component. Adding an entry to one copy and not the other is invisible:
 * the sidebar gains it, the mobile tab bar silently does not (#3142).
 */
export function getTeacherNavItems(): NavItem[] {
  return [
    { icon: '🏫', label: '班級管理', path: '/teacher' },
    { icon: '📋', label: '作業管理', path: '/teacher/assignments' },
    // /help had no entry anywhere in the UI until #3142 — it existed only in
    // the un-authenticated route allowlist, so nobody could reach it.
    { icon: '❓', label: '使用說明', path: '/help' },
  ];
}
