/**
 * OmoHistoryPage — standalone page wrapper for the OMO upload history (#1975).
 *
 * Owns auth check, fetch, pagination state, error handling, and navigation
 * to individual upload results. Renders OmoHistoryList for the actual UI.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import OmoHistoryList from '../../components/omo/OmoHistoryList';
import { useAuth } from '../../contexts/AuthContext';
import { getOmoHistory } from '../../services/omoApi';
import type { OmoHistoryItem } from '../../services/omoApi';

const PAGE_SIZE = 20;

type LoadState = 'loading' | 'ready' | 'error';

const OmoHistoryPage: React.FC = () => {
  const { token } = useAuth();
  const navigate = useNavigate();

  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [items, setItems] = useState<OmoHistoryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);

  // Fetch the first page (also re-used by retry).
  const fetchFirstPage = useCallback(async () => {
    if (!token) return;
    setLoadState('loading');
    try {
      const data = await getOmoHistory(token, PAGE_SIZE, 0);
      setItems(data.items);
      setTotal(data.total);
      setOffset(data.items.length);
      setLoadState('ready');
    } catch {
      setLoadState('error');
    }
  }, [token]);

  useEffect(() => {
    fetchFirstPage();
  }, [fetchFirstPage]);

  const handleLoadMore = useCallback(async () => {
    if (!token || loadingMore || items.length >= total) return;
    setLoadingMore(true);
    try {
      const data = await getOmoHistory(token, PAGE_SIZE, offset);
      setItems((prev) => [...prev, ...data.items]);
      setOffset(offset + data.items.length);
    } catch {
      // Surface a small error inline rather than wiping the existing list.
      setLoadState('error');
    } finally {
      setLoadingMore(false);
    }
  }, [token, loadingMore, items.length, total, offset]);

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  const hasMore = items.length < total;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Sticky header — matches OmoResultStandalonePage style */}
      <div className="sticky top-0 z-10 bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate('/omo')}
          aria-label="返回上傳頁"
          className="p-1 rounded-lg text-gray-500 hover:text-gray-900 hover:bg-gray-100
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="w-5 h-5"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M17 10a.75.75 0 01-.75.75H5.612l4.158 3.96a.75.75 0 11-1.04 1.08l-5.5-5.25a.75.75 0 010-1.08l5.5-5.25a.75.75 0 111.04 1.08L5.612 9.25H16.25A.75.75 0 0117 10z"
              clipRule="evenodd"
            />
          </svg>
        </button>
        <h2 className="font-semibold text-gray-900">批改記錄</h2>
        {loadState === 'ready' && total > 0 && (
          <span className="ml-auto text-xs text-gray-400">共 {total} 筆</span>
        )}
      </div>

      <div className="px-4 py-5 max-w-md mx-auto pb-20">
        {loadState === 'loading' && (
          <div className="flex flex-col items-center gap-3 py-12">
            <div
              className="w-12 h-12 rounded-full border-4 border-blue-200 border-t-blue-600 animate-spin"
              role="status"
              aria-label="載入批改記錄中"
            />
            <p className="text-sm text-gray-500">載入批改記錄中…</p>
          </div>
        )}

        {loadState === 'error' && items.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <p className="text-sm text-red-600 font-medium">載入批改記錄失敗</p>
            <button
              type="button"
              onClick={fetchFirstPage}
              className="py-2 px-5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl"
            >
              重試
            </button>
          </div>
        )}

        {loadState !== 'loading' && (
          <OmoHistoryList
            items={items}
            onSelect={(uploadId) => navigate(`/omo/result/${uploadId}`)}
          />
        )}

        {hasMore && (
          <div className="mt-5 flex justify-center">
            <button
              type="button"
              onClick={handleLoadMore}
              disabled={loadingMore}
              className="px-5 py-2 text-sm font-medium rounded-xl border border-gray-300 bg-white
                hover:bg-gray-50 active:bg-gray-100 disabled:opacity-60 disabled:cursor-not-allowed
                transition-colors"
            >
              {loadingMore ? '載入中…' : '載入更多'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default OmoHistoryPage;
