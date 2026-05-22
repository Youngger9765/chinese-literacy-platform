/**
 * UsersPanel — admin page for managing users and their role assignments.
 *
 * Refactored (Issue #1852) to use shared primitives:
 *   - useDebouncedSearch hook for debounced search + page reset
 *   - RoleBadge for role pill display
 *   - UserRow for the clickable table row
 *   - UserExpandedPanel for role detail + assignment form
 *   - AssignRoleForm for the role assignment form
 */
import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { UsersIcon } from '../../components/icons';
import { listUsers, UserListItem, UserApiError } from '../../services/userApi';
import { useDebouncedSearch } from '../../hooks/useDebouncedSearch';
import UserRow from './UserRow';

const UsersPanel: React.FC = () => {
  const { token } = useAuth();

  // User list state
  const [users, setUsers] = useState<UserListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  // Debounced search + pagination via shared hook
  const { query: searchQuery, setQuery, debouncedQuery: debouncedSearch, page, setPage } =
    useDebouncedSearch({ delay: 300 });

  const pageSize = 20;

  // Expanded user (show role details + assignment form)
  const [expandedUserId, setExpandedUserId] = useState<number | null>(null);

  // ── Load users ─────────────────────────────────────────────────────────────

  const loadUsers = useCallback(async (search: string, offset: number) => {
    if (!token) return;
    setIsLoading(true);
    setError('');
    try {
      const data = await listUsers(token, {
        limit: pageSize,
        offset,
        search: search || undefined,
      });
      setUsers(data.items);
      setTotal(data.total);
    } catch (err) {
      if (err instanceof UserApiError) {
        setError(err.message);
      } else {
        setError('無法載入使用者列表');
      }
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadUsers(debouncedSearch, page * pageSize);
  }, [loadUsers, debouncedSearch, page]);

  // Handle search input — delegates debounce logic to hook
  const handleSearchChange = (value: string) => {
    setQuery(value);
  };

  // Toggle expanded user
  const toggleExpand = (userId: number) => {
    setExpandedUserId((prev) => (prev === userId ? null : userId));
  };

  // Refresh user list after role change
  const refreshUserInList = useCallback(async () => {
    await loadUsers(debouncedSearch, page * pageSize);
  }, [loadUsers, debouncedSearch, page]);

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="p-6 sm:p-8">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h2 className="text-xl font-bold text-gray-900">使用者管理</h2>
          <p className="text-sm text-gray-500 mt-1">
            {isLoading ? '載入中...' : `共 ${total} 位使用者`}
          </p>
        </div>

        {/* Search bar */}
        <div>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="搜尋使用者姓名或 Email..."
            className="w-full h-11 px-4 rounded-lg border border-gray-300 text-gray-900 bg-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent text-sm"
          />
        </div>

        {/* Error state */}
        {error && (
          <div className="text-center py-6 bg-red-50 rounded-xl border border-red-200">
            <p className="text-red-700 text-sm">{error}</p>
            <button
              onClick={() => loadUsers(searchQuery, page * pageSize)}
              className="mt-2 text-sm text-red-600 underline hover:text-red-800 cursor-pointer"
            >
              重試
            </button>
          </div>
        )}

        {/* Loading skeleton */}
        {isLoading && (
          <div className="bg-white rounded-2xl shadow-card overflow-hidden">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-6 py-4 border-b border-gray-100 last:border-b-0">
                <div className="h-4 bg-gray-200 animate-pulse rounded w-1/4" />
                <div className="h-4 bg-gray-200 animate-pulse rounded w-1/3" />
                <div className="h-4 bg-gray-200 animate-pulse rounded w-16" />
                <div className="h-4 bg-gray-200 animate-pulse rounded w-12 ml-auto" />
              </div>
            ))}
          </div>
        )}

        {/* User table */}
        {!isLoading && !error && users.length > 0 && (
          <div className="bg-white rounded-2xl shadow-card overflow-hidden">
            {/* Table header */}
            <div className="hidden sm:grid sm:grid-cols-[1fr_1.5fr_1fr_80px_100px] gap-4 px-6 py-3 bg-gray-50 border-b border-gray-200 text-xs font-medium text-gray-500 uppercase tracking-wider">
              <span>姓名</span>
              <span>Email</span>
              <span>角色</span>
              <span>狀態</span>
              <span className="text-right">操作</span>
            </div>

            {users.map((user) => (
              <UserRow
                key={user.id}
                user={user}
                isExpanded={expandedUserId === user.id}
                onToggleExpand={() => toggleExpand(user.id)}
                onRolesChanged={refreshUserInList}
              />
            ))}
          </div>
        )}

        {/* Empty state */}
        {!isLoading && !error && users.length === 0 && (
          <div className="text-center py-16">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-accent-bg rounded-2xl mb-4">
              <UsersIcon className="w-8 h-8 text-accent" />
            </div>
            <h3 className="text-lg font-bold text-gray-900 mb-1">
              {searchQuery ? '找不到符合的使用者' : '尚無使用者'}
            </h3>
            <p className="text-sm text-gray-500">
              {searchQuery ? '請嘗試不同的搜尋條件' : '系統中尚無使用者資料'}
            </p>
          </div>
        )}

        {/* Pagination */}
        {!isLoading && !error && totalPages > 1 && (
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500">
              顯示 {page * pageSize + 1}-{Math.min((page + 1) * pageSize, total)} / {total}
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                上一頁
              </button>
              <span className="text-sm text-gray-500">
                {page + 1} / {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                下一頁
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default UsersPanel;
