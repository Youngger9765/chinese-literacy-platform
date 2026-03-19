/**
 * Sidebar — role-based navigation sidebar.
 *
 * Desktop: left sidebar, w-56 expanded / w-14 collapsed.
 * Mobile (<768px): bottom tab bar with slide-up drawer for extra items.
 *
 * Collapse state persisted to localStorage key `sidebar-collapsed`.
 * Auto-collapses when in learning mode (/learn/ routes).
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useWorkspace, type WorkspaceView } from '../../contexts/WorkspaceContext';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SidebarProps {
  pendingAssignmentCount: number;
}

interface NavItem {
  icon: string;
  label: string;
  path: string;
  badge?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'sidebar-collapsed';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isActive(pathname: string, path: string): boolean {
  if (path === '/student' || path === '/teacher-home') {
    return pathname === path;
  }
  // /teacher matches only dashboard and classroom detail, not /teacher/my-texts or /teacher/assignments
  if (path === '/teacher') {
    return pathname === '/teacher' || /^\/teacher\/classroom\/\d+/.test(pathname);
  }
  return pathname === path || pathname.startsWith(`${path}/`);
}

// ---------------------------------------------------------------------------
// NavButton — single sidebar item (expanded or icon-only)
// ---------------------------------------------------------------------------

interface NavButtonProps {
  item: NavItem;
  collapsed: boolean;
  active: boolean;
  onClick: () => void;
}

const NavButton: React.FC<NavButtonProps> = ({ item, collapsed, active, onClick }) => {
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

// ---------------------------------------------------------------------------
// MobileTabBar — bottom tab bar for mobile
// ---------------------------------------------------------------------------

interface MobileTabBarProps {
  studentItems: NavItem[];
  teacherItems: NavItem[];
  extraItems: NavItem[];
  pathname: string;
  onNavigate: (path: string) => void;
}

const MobileTabBar: React.FC<MobileTabBarProps> = ({
  studentItems,
  teacherItems,
  extraItems,
  pathname,
  onNavigate,
}) => {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const allItems = [...studentItems, ...teacherItems];
  // Show top 4 items + "更多" tab
  const topItems = allItems.slice(0, 4);
  const moreItems = [...allItems.slice(4), ...extraItems];

  return (
    <>
      {/* Bottom tab bar */}
      <nav
        role="navigation"
        aria-label="底部導覽列"
        className="fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-gray-200 h-14 flex items-stretch md:hidden"
      >
        {topItems.map((item) => (
          <button
            key={item.path}
            type="button"
            onClick={() => onNavigate(item.path)}
            aria-label={item.label}
            aria-current={isActive(pathname, item.path) ? 'page' : undefined}
            className={`
              flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent
              ${isActive(pathname, item.path) ? 'text-accent' : 'text-gray-500'}
            `}
          >
            <span className="text-xl relative" aria-hidden="true">
              {item.icon}
              {item.badge != null && item.badge > 0 && (
                <span className="absolute -top-0.5 -right-1 min-w-[14px] h-3.5 flex items-center justify-center bg-red-500 text-white text-[9px] font-bold rounded-full px-0.5 leading-none">
                  {item.badge > 9 ? '9+' : item.badge}
                </span>
              )}
            </span>
            <span>{item.label}</span>
          </button>
        ))}
        {moreItems.length > 0 && (
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="更多選項"
            aria-expanded={drawerOpen}
            className="flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium text-gray-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
          >
            <span className="text-xl" aria-hidden="true">☰</span>
            <span>更多</span>
          </button>
        )}
      </nav>

      {/* Slide-up drawer */}
      {drawerOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/40 md:hidden"
            aria-hidden="true"
            onClick={() => setDrawerOpen(false)}
          />
          <div
            role="dialog"
            aria-label="更多導覽選項"
            aria-modal="true"
            className="fixed bottom-14 left-0 right-0 z-50 bg-white rounded-t-2xl shadow-2xl p-4 md:hidden animate-slide-up"
          >
            <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-4" aria-hidden="true" />
            <div className="grid grid-cols-3 gap-3">
              {moreItems.map((item) => (
                <button
                  key={item.path}
                  type="button"
                  onClick={() => {
                    onNavigate(item.path);
                    setDrawerOpen(false);
                  }}
                  aria-label={item.label}
                  className={`
                    flex flex-col items-center gap-1 p-3 rounded-xl text-sm font-medium transition-colors
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent
                    ${isActive(pathname, item.path)
                      ? 'bg-accent-bg text-accent'
                      : 'bg-gray-50 text-gray-700 hover:bg-gray-100'
                    }
                  `}
                >
                  <span className="text-2xl" aria-hidden="true">{item.icon}</span>
                  <span className="text-xs">{item.label}</span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </>
  );
};

// ---------------------------------------------------------------------------
// Sidebar (main export)
// ---------------------------------------------------------------------------

const Sidebar: React.FC<SidebarProps> = ({ pendingAssignmentCount }) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  // Determine initial collapsed state from localStorage
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });

  // Auto-collapse when in learning mode
  const isLearningMode = pathname.includes('/learn/');
  useEffect(() => {
    if (isLearningMode) {
      setCollapsed(true);
    }
  }, [isLearningMode]);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const handleNavigate = useCallback(
    (path: string) => {
      navigate(path);
    },
    [navigate],
  );

  // ---------------------------------------------------------------------------
  // Workspace context — determines which nav items to show
  // ---------------------------------------------------------------------------

  const { activeView, setActiveView, availableViews, hasMultipleViews } = useWorkspace();

  const VIEW_LABELS: Record<WorkspaceView, { icon: string; label: string }> = {
    admin: { icon: '⚙️', label: '管理員' },
    teacher: { icon: '🏫', label: '老師' },
    student: { icon: '📚', label: '學生' },
    parent: { icon: '👨‍👩‍👧', label: '家長' },
  };

  const roleLabel = VIEW_LABELS[activeView].label;

  // ---------------------------------------------------------------------------
  // Build nav items based on active workspace view
  // ---------------------------------------------------------------------------

  const studentItems: NavItem[] = activeView === 'student'
    ? [
        { icon: '🏠', label: '主頁', path: '/student' },
        { icon: '📚', label: '圖書館', path: '/library' },
        { icon: '📋', label: '我的作業', path: '/assignments', badge: pendingAssignmentCount },
        { icon: '📊', label: '學習進度', path: '/progress' },
        { icon: '🏆', label: '成就', path: '/achievements' },
        { icon: '📖', label: '生字本', path: '/vocabulary' },
        { icon: '📝', label: '學習記錄', path: '/history' },
        { icon: '🏫', label: '我的班級', path: '/classroom-dashboard' },
        { icon: '🔗', label: '加入班級', path: '/join' },
        { icon: '👤', label: '個人檔案', path: '/profile' },
      ]
    : [];

  const teacherItems: NavItem[] = activeView === 'teacher' || activeView === 'admin'
    ? [
        { icon: '🏠', label: '主頁', path: '/teacher-home' },
        { icon: '🏫', label: '班級管理', path: '/teacher' },
        { icon: '📖', label: '我的課文', path: '/teacher/my-texts' },
        { icon: '📋', label: '作業管理', path: '/teacher/assignments' },
      ]
    : [];

  const adminItems: NavItem[] = activeView === 'admin'
    ? [{ icon: '⚙️', label: '系統管理', path: '/admin' }]
    : [];

  const parentItems: NavItem[] = activeView === 'parent'
    ? [{ icon: '👨‍👩‍👧', label: '孩子進度', path: '/parent' }]
    : [];

  const primaryItems = [...studentItems, ...teacherItems];
  const extraItems = [...adminItems, ...parentItems];

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        role="navigation"
        aria-label="側邊導覽列"
        className={`
          hidden md:flex flex-col bg-white border-r border-gray-200 shrink-0 transition-all duration-200
          ${collapsed ? 'w-14' : 'w-56'}
        `}
      >
        {/* User + role switcher (Issue #556, #557) */}
        {user && (
          <div className={`shrink-0 border-b border-gray-100 py-3 ${collapsed ? 'px-2 flex justify-center' : 'px-3'}`}>
            <div className={`flex items-center gap-2 ${collapsed ? 'flex-col' : ''}`}>
              <span className="text-lg shrink-0" aria-hidden="true">👤</span>
              {!collapsed && (
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900 truncate">{user.name}</p>
                  {hasMultipleViews ? (
                    <select
                      value={activeView}
                      onChange={(e) => {
                        setActiveView(e.target.value as WorkspaceView);
                        const home: Record<WorkspaceView, string> = {
                          teacher: '/teacher-home', student: '/student',
                          admin: '/admin', parent: '/parent',
                        };
                        navigate(home[e.target.value as WorkspaceView]);
                      }}
                      className="mt-0.5 text-xs text-gray-500 bg-transparent border border-gray-200 rounded px-1.5 py-0.5 cursor-pointer hover:border-gray-400 focus:outline-none focus:ring-1 focus:ring-accent w-full"
                    >
                      {availableViews.map((v) => (
                        <option key={v} value={v}>
                          {VIEW_LABELS[v].icon} {VIEW_LABELS[v].label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <p className="text-xs text-gray-500">{roleLabel}</p>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Collapse toggle */}
        <div className={`flex items-center py-3 shrink-0 ${collapsed ? 'justify-center px-2' : 'justify-end px-3'}`}>
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={collapsed ? '展開側邊欄' : '收合側邊欄'}
            title={collapsed ? '展開側邊欄' : '收合側邊欄'}
            className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1"
          >
            <span className="text-sm font-mono" aria-hidden="true">
              {collapsed ? '»' : '«'}
            </span>
          </button>
        </div>

        {/* Primary nav */}
        <nav aria-label="主要頁面" className="flex-1 flex flex-col gap-1 px-2 overflow-y-auto">
          {primaryItems.map((item) => (
            <NavButton
              key={item.path}
              item={item}
              collapsed={collapsed}
              active={isActive(pathname, item.path)}
              onClick={() => handleNavigate(item.path)}
            />
          ))}

          {/* Divider before extra items */}
          {extraItems.length > 0 && (
            <div className="my-1 border-t border-gray-100" aria-hidden="true" />
          )}

          {extraItems.map((item) => (
            <NavButton
              key={item.path}
              item={item}
              collapsed={collapsed}
              active={isActive(pathname, item.path)}
              onClick={() => handleNavigate(item.path)}
            />
          ))}
        </nav>

        {/* Footer — privacy + version */}
        <div className={`shrink-0 border-t border-gray-100 py-3 px-2 ${collapsed ? 'flex flex-col items-center gap-1' : ''}`}>
          {!collapsed ? (
            <>
              <button
                type="button"
                onClick={() => navigate('/privacy')}
                className="w-full text-left text-xs text-gray-400 hover:text-gray-600 transition-colors px-3 py-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1"
              >
                隱私政策
              </button>
              <p className="text-[10px] text-gray-300 px-3 mt-0.5 select-none">LingoLeap v2.0</p>
            </>
          ) : (
            <button
              type="button"
              onClick={() => navigate('/privacy')}
              title="隱私政策"
              aria-label="隱私政策"
              className="p-1.5 text-gray-300 hover:text-gray-500 transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1"
            >
              <span className="text-sm" aria-hidden="true">🔒</span>
            </button>
          )}
        </div>
      </aside>

      {/* Mobile bottom tab bar */}
      <MobileTabBar
        studentItems={studentItems}
        teacherItems={teacherItems}
        extraItems={extraItems}
        pathname={pathname}
        onNavigate={handleNavigate}
      />
    </>
  );
};

export default Sidebar;
