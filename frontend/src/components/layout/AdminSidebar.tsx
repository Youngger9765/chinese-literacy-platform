/**
 * AdminSidebar — nav items for admin workspace view.
 *
 * Admin sees teacher items (班級管理 + 作業管理) PLUS 系統管理.
 * Extracted from Sidebar.tsx (Issue #1937).
 */

import React from 'react';
import { NavButton, type NavItem } from './NavButton';
import { isActive } from './sidebarUtils';
import { useLocation } from 'react-router-dom';

export interface AdminSidebarProps {
  collapsed: boolean;
  onNavigate: (path: string) => void;
}

export const AdminSidebar: React.FC<AdminSidebarProps> = ({
  collapsed,
  onNavigate,
}) => {
  const { pathname } = useLocation();

  const primaryItems: NavItem[] = [
    { icon: '🏫', label: '班級管理', path: '/teacher' },
    { icon: '📋', label: '作業管理', path: '/teacher/assignments' },
  ];

  const adminItems: NavItem[] = [
    { icon: '⚙️', label: '系統管理', path: '/admin' },
  ];

  return (
    <nav aria-label="管理員導覽" className="flex flex-col gap-1.5">
      {primaryItems.map((item) => (
        <NavButton
          key={item.path}
          item={item}
          collapsed={collapsed}
          active={isActive(pathname, item.path)}
          onClick={() => onNavigate(item.path)}
        />
      ))}

      {/* Divider before admin-only items */}
      <div className="my-1 border-t border-gray-100" aria-hidden="true" />

      {adminItems.map((item) => (
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

/** Flat list of admin-only extra items (used by MobileTabBar extra items) */
export function getAdminExtraItems(): NavItem[] {
  return [{ icon: '⚙️', label: '系統管理', path: '/admin' }];
}
