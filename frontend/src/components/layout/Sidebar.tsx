/**
 * Sidebar — role-based navigation sidebar.
 *
 * Desktop: left sidebar, w-56 expanded / w-14 collapsed.
 * Mobile (<768px): bottom tab bar with slide-up drawer for extra items.
 *
 * Collapse state persisted to localStorage key `sidebar-collapsed`.
 * Auto-collapses when in learning mode (/learn/ routes).
 *
 * Header removed (2026-04-18): Logo, story title, notification bell,
 * zhuyin toggle, and logout are now integrated here.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useWorkspace, type WorkspaceView } from '../../contexts/WorkspaceContext';
import { useLearningNav } from '../../contexts/LearningNavContext';
import { useZhuyin } from '../../context/ZhuyinContext';
import { hasRole } from '../../services/authApi';
import NotificationBell from '../teacher/NotificationBell';
import ZhuyinToggle from '../ui/ZhuyinToggle';

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
  // Workspace switching (Issue #571)
  hasMultipleViews: boolean;
  activeView: WorkspaceView;
  availableViews: WorkspaceView[];
  viewLabels: Record<WorkspaceView, { icon: string; label: string }>;
  onSwitchView: (view: WorkspaceView) => void;
  onLogout: () => void;
}

const MobileTabBar: React.FC<MobileTabBarProps> = ({
  studentItems,
  teacherItems,
  extraItems,
  pathname,
  onNavigate,
  hasMultipleViews,
  activeView,
  availableViews,
  viewLabels,
  onSwitchView,
  onLogout,
}) => {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const allItems = [...studentItems, ...teacherItems];
  // Show top 4 items + "更多" tab
  const topItems = allItems.slice(0, 4);
  const moreItems = [...allItems.slice(4), ...extraItems];

  // Show the "更多" button if there are overflow nav items OR if multi-role switching is available
  const showMoreButton = moreItems.length > 0 || hasMultipleViews;

  return (
    <>
      {/* Bottom tab bar */}
      <nav
        role="navigation"
        aria-label="底部導覽列"
        className="fixed bottom-0 left-0 right-0 z-40 font-ui bg-white border-t border-gray-200 h-14 flex items-stretch md:hidden"
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
        {showMoreButton && (
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

            {/* Workspace / role switcher — only shown when user has multiple roles (Issue #571) */}
            {hasMultipleViews && (
              <div className="mb-4">
                <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-2 px-1">
                  切換身分
                </p>
                <div className="flex gap-2 flex-wrap">
                  {availableViews.map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => {
                        onSwitchView(v);
                        setDrawerOpen(false);
                      }}
                      aria-label={`切換至${viewLabels[v].label}`}
                      aria-pressed={v === activeView}
                      className={`
                        flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors
                        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent
                        ${v === activeView
                          ? 'bg-accent text-white'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }
                      `}
                    >
                      <span aria-hidden="true">{viewLabels[v].icon}</span>
                      <span>{viewLabels[v].label}</span>
                    </button>
                  ))}
                </div>
                {moreItems.length > 0 && (
                  <div className="mt-3 border-t border-gray-100" aria-hidden="true" />
                )}
              </div>
            )}

            {moreItems.length > 0 && (
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
            )}

            {/* Logout — always shown at bottom of drawer */}
            <div className="mt-4 border-t border-gray-100 pt-3">
              <button
                type="button"
                onClick={() => {
                  setDrawerOpen(false);
                  onLogout();
                }}
                aria-label="登出"
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-500 hover:text-red-600 hover:bg-red-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1"
              >
                <span aria-hidden="true">🚪</span>
                <span>登出</span>
              </button>
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
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { selectedStory: navStory } = useLearningNav();
  const { zhuyinEnabled, zhuyinReady, toggleZhuyin } = useZhuyin();

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

  // Teacher role check for notification bell
  const isTeacher = hasRole(
    user,
    'teacher',
    'system_admin',
    'principal',
    'director',
    'org_owner',
    'org_admin',
    'homeroom_teacher',
  );

  // ---------------------------------------------------------------------------
  // Build nav items based on active workspace view
  // ---------------------------------------------------------------------------

  // Simplified sidebar — focus on core workflows (#686)
  // Hidden items are NOT deleted, just removed from sidebar. Routes still work.
  const studentItems: NavItem[] = activeView === 'student'
    ? [
        { icon: '🏠', label: '主頁', path: '/student' },
        { icon: '📚', label: '圖書館', path: '/library' },
        { icon: '🏫', label: '班級作業', path: '/assignments', badge: pendingAssignmentCount },
        { icon: '📖', label: '學習紀錄', path: '/learning-history' },
        { icon: '⭐', label: '成就', path: '/achievements' },
        // Hidden: 學習進度, 生字本, 對話記錄 — 整合到「班級作業」(#643)
        // Hidden: 我的班級 — merged into /assignments (#1146)
        // Hidden: 加入班級 — students join via invite code, not sidebar (#838)

      ]
    : [];

  const teacherItems: NavItem[] = activeView === 'teacher' || activeView === 'admin'
    ? [
        { icon: '🏫', label: '班級管理', path: '/teacher' },
        { icon: '📋', label: '作業管理', path: '/teacher/assignments' },
        // Hidden: 主頁 (直接進班級管理), 我的課文 (降低優先)
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
          hidden md:flex flex-col font-ui bg-white border-r border-gray-200 shrink-0 transition-all duration-200
          ${collapsed ? 'w-14' : 'w-56'}
        `}
      >
        {/* Logo — home link */}
        <div className={`shrink-0 border-b border-gray-100 py-3 ${collapsed ? 'px-2 flex justify-center' : 'px-3'}`}>
          <button
            type="button"
            onClick={() => navigate('/')}
            aria-label="LingoLeap 首頁"
            title={collapsed ? 'LingoLeap 首頁' : undefined}
            className="flex items-center gap-2 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1"
          >
            <div
              className="bg-accent w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
              aria-hidden="true"
            >
              <span className="text-white font-bold text-sm">L</span>
            </div>
            {!collapsed && (
              <span className="text-sm font-bold text-gray-800 truncate">AI Reading Tutor</span>
            )}
          </button>
        </div>

        {/* Story title — learning mode only, hidden when collapsed */}
        {navStory && !collapsed && (
          <div className="shrink-0 px-3 py-2 border-b border-gray-100">
            <p
              className="text-xs font-medium text-gray-500 truncate"
              aria-live="polite"
              title={navStory.title}
            >
              {navStory.title}
            </p>
          </div>
        )}

        {/* User + role switcher (Issue #556, #557) */}
        {user && (
          <div className={`shrink-0 border-b border-gray-100 py-3 ${collapsed ? 'px-2 flex justify-center' : 'px-3'}`}>
            <div className={`flex items-center gap-2 ${collapsed ? 'flex-col' : ''}`}>
              <div
                className="w-8 h-8 rounded-full bg-accent text-white flex items-center justify-center shrink-0 text-sm font-semibold"
                aria-hidden="true"
              >
                {user.name?.charAt(0) ?? '?'}
              </div>
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
            className="p-2.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1"
          >
            <span className="text-base font-mono" aria-hidden="true">
              {collapsed ? '»' : '«'}
            </span>
          </button>
        </div>

        {/* Primary nav */}
        <nav aria-label="主要頁面" className="flex-1 flex flex-col gap-1.5 px-2 overflow-y-auto">
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

        {/* Bottom section — notification bell, zhuyin toggle, logout, footer */}
        <div className={`shrink-0 border-t border-gray-100 py-2 px-2 flex flex-col gap-1 ${collapsed ? 'items-center' : ''}`}>
          {/* Actions: notification bell + zhuyin toggle + logout — grouped together */}
          {isTeacher && (
            <div className={collapsed ? '' : 'w-full'}>
              <NotificationBell
                onNavigateToStudent={(classroomId) =>
                  navigate(`/teacher/classroom/${classroomId}`)
                }
              />
            </div>
          )}

          {navStory && (
            <div className={collapsed ? '' : 'w-full px-1'}>
              <ZhuyinToggle
                enabled={zhuyinEnabled}
                ready={zhuyinReady}
                onToggle={toggleZhuyin}
              />
            </div>
          )}

          <button
            type="button"
            onClick={logout}
            aria-label="登出"
            title={collapsed ? '登出' : undefined}
            className={`
              flex items-center gap-2 rounded-lg transition-colors text-gray-500 hover:text-red-600 hover:bg-red-50
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1
              min-h-[44px]
              ${collapsed ? 'justify-center px-2 py-2.5 w-full' : 'px-3 py-2 w-full text-sm'}
            `}
          >
            <span className="text-lg shrink-0" aria-hidden="true">🚪</span>
            {!collapsed && <span>登出</span>}
          </button>

          {/* Footer — privacy + version, visually separated from actions */}
          <div className={`${collapsed ? 'mt-1' : 'mt-2 pt-2 border-t border-gray-100'}`}>
            {!collapsed ? (
              <button
                type="button"
                onClick={() => navigate('/privacy')}
                className="w-full text-left text-xs text-gray-400 hover:text-gray-600 transition-colors px-3 py-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1"
              >
                隱私政策
              </button>
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

            {!collapsed && (
              <p className="text-[10px] text-gray-300 px-3 select-none">LingoLeap v2.0</p>
            )}
          </div>
        </div>
      </aside>

      {/* Mobile bottom tab bar */}
      <MobileTabBar
        studentItems={studentItems}
        teacherItems={teacherItems}
        extraItems={extraItems}
        pathname={pathname}
        onNavigate={handleNavigate}
        hasMultipleViews={hasMultipleViews}
        activeView={activeView}
        availableViews={availableViews}
        viewLabels={VIEW_LABELS}
        onSwitchView={(view) => {
          setActiveView(view);
          const home: Record<WorkspaceView, string> = {
            teacher: '/teacher-home', student: '/student',
            admin: '/admin', parent: '/parent',
          };
          navigate(home[view]);
        }}
        onLogout={logout}
      />
    </>
  );
};

export default Sidebar;
