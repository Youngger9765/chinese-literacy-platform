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

  const items: NavItem[] = [
    { icon: '🏫', label: '班級管理', path: '/teacher' },
    { icon: '📋', label: '作業管理', path: '/teacher/assignments' },
  ];

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

/** Flat list of teacher nav items (used by MobileTabBar) */
export function getTeacherNavItems(): NavItem[] {
  return [
    { icon: '🏫', label: '班級管理', path: '/teacher' },
    { icon: '📋', label: '作業管理', path: '/teacher/assignments' },
  ];
}
