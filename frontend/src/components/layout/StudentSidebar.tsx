/**
 * StudentSidebar — nav items for student workspace view.
 *
 * Extracted from Sidebar.tsx (Issue #1937).
 * Receives collapsed state and onNavigate from SidebarShell (parent).
 */

import React from 'react';
import { NavButton, type NavItem } from './NavButton';
import { isActive } from './sidebarUtils';
import { useLocation } from 'react-router-dom';

export interface StudentSidebarProps {
  pendingAssignmentCount: number;
  collapsed: boolean;
  onNavigate: (path: string) => void;
}

export const StudentSidebar: React.FC<StudentSidebarProps> = ({
  pendingAssignmentCount,
  collapsed,
  onNavigate,
}) => {
  const { pathname } = useLocation();

  const primaryItems: NavItem[] = [
    { icon: '🏠', label: '主頁', path: '/student' },
    { icon: '📚', label: '圖書館', path: '/library' },
    { icon: '🏫', label: '班級作業', path: '/assignments', badge: pendingAssignmentCount },
    { icon: '➕', label: '加入班級', path: '/join' },
    { icon: '📖', label: '學習紀錄', path: '/learning-history' },
  ];

  const toolsItems: NavItem[] = [
    { icon: '🧰', label: '練習工具箱', path: '/tools' },
  ];

  return (
    <nav aria-label="學生導覽" className="flex flex-col gap-1.5">
      {primaryItems.map((item) => (
        <NavButton
          key={item.path}
          item={item}
          collapsed={collapsed}
          active={isActive(pathname, item.path)}
          onClick={() => onNavigate(item.path)}
        />
      ))}

      {/* Divider before targeted practice tools (#1165) */}
      <div className="my-1 border-t border-gray-100" aria-hidden="true" />

      {toolsItems.map((item) => (
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

/** Flat list of all student nav items (used by MobileTabBar) */
export function getStudentNavItems(pendingAssignmentCount: number): NavItem[] {
  return [
    { icon: '🏠', label: '主頁', path: '/student' },
    { icon: '📚', label: '圖書館', path: '/library' },
    { icon: '🏫', label: '班級作業', path: '/assignments', badge: pendingAssignmentCount },
    { icon: '➕', label: '加入班級', path: '/join' },
    { icon: '📖', label: '學習紀錄', path: '/learning-history' },
  ];
}

/** Tools items shown below divider (used by MobileTabBar extra items) */
export const studentToolsItems: NavItem[] = [
  { icon: '🧰', label: '練習工具箱', path: '/tools' },
];
