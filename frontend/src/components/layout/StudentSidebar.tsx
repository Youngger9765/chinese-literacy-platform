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
  /** issue #3607: 跨班賽季／課堂搶答 sidebar entries are hidden unless ANY
   * of the student's enrolled classrooms has the corresponding flag on
   * (same "ANY enrolled classroom" pattern as PK's internal entry logic —
   * see pages/pk/StudentPkEntry.tsx). Default false (hide until known) so
   * a feature the student can't use is never flashed before the real
   * enrollment data loads. */
  leagueEnabled?: boolean;
  liveQuizEnabled?: boolean;
}

export const StudentSidebar: React.FC<StudentSidebarProps> = ({
  pendingAssignmentCount,
  collapsed,
  onNavigate,
  leagueEnabled = false,
  liveQuizEnabled = false,
}) => {
  const { pathname } = useLocation();

  const primaryItems: NavItem[] = getStudentNavItems(pendingAssignmentCount, {
    league: leagueEnabled,
    liveQuiz: liveQuizEnabled,
  });

  // 練習工具箱入口已隱藏（Young 2026-08-20 指示，#2801）。
  // `/tools` 路由本身保留 —— 既有的連結／書籤不會變 404，只是導覽上到不了。
  // 學習紀錄頁那個「練習工具箱」是**過去紀錄的標籤**，不是入口，刻意沒動。
  const toolsItems: NavItem[] = [];

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

      {/* Divider before targeted practice tools (#1165)。
          toolsItems 空的時候不畫 —— 否則側欄底下留一條沒有東西的分隔線。 */}
      {toolsItems.length > 0 && (
        <div className="my-1 border-t border-gray-100" aria-hidden="true" />
      )}

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

/**
 * Flat list of all student nav items — the single source (used by the sidebar
 * above AND by MobileTabBar).
 *
 * These used to be written out twice, once here and once inline in the
 * component. Adding an entry to one copy and not the other is invisible:
 * the sidebar gains it, the mobile tab bar silently does not (#3142).
 */
export interface StudentNavFeatureFlags {
  /** issue #3607: show "我們班" (跨班賽季) only when ANY enrolled classroom
   * has `league` on. Default false — hidden until known. */
  league?: boolean;
  /** issue #3607: show "課堂搶答" only when ANY enrolled classroom has
   * `live_quiz` on. Default false — hidden until known. */
  liveQuiz?: boolean;
}

export function getStudentNavItems(
  pendingAssignmentCount = 0,
  flags: StudentNavFeatureFlags = {},
): NavItem[] {
  const { league = false, liveQuiz = false } = flags;
  return [
    { icon: '🏠', label: '主頁', path: '/student' },
    { icon: '📚', label: '圖書館', path: '/library' },
    { icon: '🏫', label: '班級作業', path: '/assignments', badge: pendingAssignmentCount },
    // issue #3607: default OFF per classroom — hidden unless the teacher
    // has turned it on for at least one of this student's classes.
    ...(league
      ? [
          {
            icon: '🏆',
            label: '我們班',
            path: '/student/our-class',
            description: '和別班比幾週，平常讀課文就累積',
          },
        ]
      : []),
    ...(liveQuiz
      ? [
          {
            icon: '🎮',
            label: '課堂搶答',
            path: '/live',
            description: '現在全班一起玩，約 10 分鐘',
          },
        ]
      : []),
    {
      icon: '⚔️',
      label: 'PK 對戰',
      path: '/pk',
      description: '一對一，隨時挑戰同學或文學家',
    },
    { icon: '➕', label: '加入班級', path: '/join' },
    { icon: '📖', label: '學習紀錄', path: '/learning-history' },
    // /help had no entry anywhere in the UI until #3142.
    { icon: '❓', label: '使用說明', path: '/help' },
  ];
}

/** Tools items shown below divider (used by MobileTabBar extra items) */
export const studentToolsItems: NavItem[] = [];   // 入口已隱藏，見上方 #2801 註解
