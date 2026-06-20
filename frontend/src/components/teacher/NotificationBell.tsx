/* eslint-disable no-use-before-define -- pre-existing pattern, not TDZ risk (#2289) */
/**
 * NotificationBell — bell icon with unread badge for teacher notification center.
 * Shown in the app header for users with teacher role.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import {
  getTeacherNotifications,
  markAllNotificationsRead,
  markNotificationsRead,
  NotificationItem,
  NotificationSummary,
} from '../../services/teacherApi';

const ALERT_TYPE_LABEL: Record<string, string> = {
  inactive: '長期未練習',
  low_performance: '成績偏低',
  declining: '成績下滑',
};

const ALERT_TYPE_COLOR: Record<string, string> = {
  inactive: 'bg-orange-100 text-orange-700',
  low_performance: 'bg-red-100 text-red-700',
  declining: 'bg-yellow-100 text-yellow-700',
};

// How often to poll for new notifications (ms)
const POLL_INTERVAL_MS = 60_000;

interface NotificationBellProps {
  onNavigateToStudent?: (classroomId: number, studentId: number) => void;
}

const NotificationBell: React.FC<NotificationBellProps> = ({ onNavigateToStudent }) => {
  const { token } = useAuth();
  const [summary, setSummary] = useState<NotificationSummary | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [filterType, setFilterType] = useState<string>('all');
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const fetchNotifications = useCallback(async () => {
    if (!token) return;
    try {
      const data = await getTeacherNotifications(token);
      setSummary(data);
    } catch {
      // Silently fail for background polling
    }
  }, [token]);

  // Initial fetch + poll
  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  // Close panel on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen]);

  const handleOpen = async () => {
    setIsOpen((prev) => !prev);
    if (!isOpen) {
      await fetchNotifications();
    }
  };

  const handleMarkRead = async (alertKey: string) => {
    if (!token) return;
    try {
      await markNotificationsRead(token, [alertKey]);
      setSummary((prev) => {
        if (!prev) return prev;
        const items = prev.items.map((item) =>
          item.alert_key === alertKey ? { ...item, is_read: true } : item
        );
        return { ...prev, items, unread: items.filter((i) => !i.is_read).length };
      });
    } catch {
      // ignore
    }
  };

  const handleMarkAllRead = async () => {
    if (!token) return;
    setIsLoading(true);
    try {
      await markAllNotificationsRead(token);
      setSummary((prev) => {
        if (!prev) return prev;
        const items = prev.items.map((item) => ({ ...item, is_read: true }));
        return { ...prev, items, unread: 0 };
      });
    } catch {
      // ignore
    } finally {
      setIsLoading(false);
    }
  };

  const handleNavigate = (item: NotificationItem) => {
    handleMarkRead(item.alert_key);
    setIsOpen(false);
    onNavigateToStudent?.(item.classroom_id, item.student_id);
  };

  const unreadCount = summary?.unread ?? 0;

  const filteredItems = (summary?.items ?? []).filter((item) => {
    if (filterType === 'all') return true;
    if (filterType === 'unread') return !item.is_read;
    return item.alert_type === filterType;
  });

  return (
    <div className="relative">
      {/* Bell button */}
      <button
        ref={buttonRef}
        onClick={handleOpen}
        aria-label={`通知中心${unreadCount > 0 ? `，${unreadCount} 則未讀` : ''}`}
        className="relative p-1.5 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors"
      >
        <svg
          className="w-5 h-5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          strokeWidth={1.8}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
          />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 flex items-center justify-center bg-red-500 text-white text-[10px] font-bold rounded-full px-1 leading-none">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Notification panel */}
      {isOpen && (
        <div
          ref={panelRef}
          className="absolute right-0 top-full mt-2 w-96 bg-white rounded-xl shadow-xl border border-gray-200 z-50 flex flex-col max-h-[80vh]"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <div>
              <h2 className="text-sm font-bold text-gray-900">通知中心</h2>
              <p className="text-xs text-gray-400 mt-0.5">
                {summary ? `共 ${summary.total} 則，${unreadCount} 則未讀` : '載入中…'}
              </p>
            </div>
            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllRead}
                disabled={isLoading}
                className="text-xs text-accent hover:text-accent-hover font-medium disabled:opacity-50 transition-colors"
              >
                全部標為已讀
              </button>
            )}
          </div>

          {/* Filter tabs */}
          <div className="flex gap-1 px-3 pt-2 pb-1 border-b border-gray-100 overflow-x-auto shrink-0">
            {[
              { key: 'all', label: '全部' },
              { key: 'unread', label: '未讀' },
              { key: 'inactive', label: '未練習' },
              { key: 'low_performance', label: '成績低' },
              { key: 'declining', label: '下滑' },
            ].map((tab) => (
              <button
                key={tab.key}
                onClick={() => setFilterType(tab.key)}
                className={`text-xs px-2.5 py-1 rounded-full whitespace-nowrap font-medium transition-colors ${
                  filterType === tab.key
                    ? 'bg-accent text-white'
                    : 'text-gray-500 hover:bg-gray-100'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Notification list */}
          <div className="overflow-y-auto flex-1">
            {filteredItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center px-4">
                <svg
                  className="w-10 h-10 text-gray-300 mb-3"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <p className="text-sm text-gray-400">
                  {filterType === 'unread' ? '沒有未讀通知' : '目前沒有預警'}
                </p>
              </div>
            ) : (
              <ul>
                {filteredItems.map((item) => (
                  <NotificationRow
                    key={item.alert_key}
                    item={item}
                    onMarkRead={handleMarkRead}
                    onNavigate={handleNavigate}
                  />
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

interface NotificationRowProps {
  item: NotificationItem;
  onMarkRead: (key: string) => void;
  onNavigate: (item: NotificationItem) => void;
}

const NotificationRow: React.FC<NotificationRowProps> = ({ item, onMarkRead, onNavigate }) => {
  const typeColor = ALERT_TYPE_COLOR[item.alert_type] ?? 'bg-gray-100 text-gray-600';
  const typeLabel = ALERT_TYPE_LABEL[item.alert_type] ?? item.alert_type;

  return (
    <li
      className={`px-4 py-3 border-b border-gray-50 hover:bg-gray-50 transition-colors ${
        item.is_read ? 'opacity-60' : ''
      }`}
    >
      <div className="flex items-start gap-3">
        {/* Unread dot */}
        <div className="mt-1.5 shrink-0">
          {!item.is_read ? (
            <span className="block w-2 h-2 rounded-full bg-accent" />
          ) : (
            <span className="block w-2 h-2 rounded-full bg-transparent" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${typeColor}`}>
              {typeLabel}
            </span>
            <span className="text-xs font-medium text-gray-700 truncate">{item.student_name}</span>
            <span className="text-xs text-gray-400 truncate">{item.classroom_name}</span>
          </div>
          <p className="text-xs text-gray-600 leading-relaxed">{item.detail}</p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => onNavigate(item)}
            title="查看學生"
            className="p-1 rounded text-gray-400 hover:text-accent hover:bg-accent-bg transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.8}
                d="M9 5l7 7-7 7"
              />
            </svg>
          </button>
          {!item.is_read && (
            <button
              onClick={() => onMarkRead(item.alert_key)}
              title="標為已讀"
              className="p-1 rounded text-gray-400 hover:text-green-600 hover:bg-green-50 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.8}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </button>
          )}
        </div>
      </div>
    </li>
  );
};

export default NotificationBell;
