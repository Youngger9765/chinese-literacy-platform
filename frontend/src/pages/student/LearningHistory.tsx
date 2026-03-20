/**
 * LearningHistory — lists the student's past learning sessions.
 * Completed sessions with comprehension data show a "查看對話" link.
 * Sessions are split into "進行中" and "已完成" tabs.
 *
 * Route: /history
 * Issue #242, #553, #580
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { fetchLearningSessions, LearningSummary } from '../../services/api';

const STEP_LABELS: Record<number, string> = {
  1: '簡介',
  2: '逐段朗讀',
  3: '課文理解',
  4: '生字練習',
  5: '全文朗讀',
  6: '學習報告',
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('zh-TW', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  switch (status) {
    case 'completed':
      return (
        <span className="inline-block px-1.5 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">
          已完成
        </span>
      );
    case 'abandoned':
      return (
        <span className="inline-block px-1.5 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-500">
          已放棄
        </span>
      );
    default:
      return (
        <span className="inline-block px-1.5 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700">
          進行中
        </span>
      );
  }
};

type TabKey = 'in_progress' | 'completed';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'in_progress', label: '進行中' },
  { key: 'completed', label: '已完成' },
];

function tabToStatusFilter(tab: TabKey): string {
  if (tab === 'completed') return 'completed,abandoned';
  return 'in_progress';
}

const SessionCard: React.FC<{ s: LearningSummary; onNavigate: (path: string) => void }> = ({ s, onNavigate }) => {
  const hasDialogue = s.current_step >= 3;
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-medium text-gray-900 truncate">
              {s.story_title ?? s.story_slug ?? '未知課文'}
            </h3>
            <StatusBadge status={s.status} />
          </div>

          <div className="flex items-center gap-3 mt-2 flex-wrap text-xs text-gray-500">
            <span>開始：{formatDate(s.started_at)}</span>
            {s.completed_at && (
              <span>完成：{formatDate(s.completed_at)}</span>
            )}
            {!s.completed_at && (
              <span>進度：{STEP_LABELS[s.current_step] ?? `步驟 ${s.current_step}`}</span>
            )}
            {s.overall_score != null && (
              <span className="text-gray-700 font-medium">
                總分：{Math.round(s.overall_score)}%
              </span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2 shrink-0">
          {s.status === 'completed' && s.story_slug && (
            <button
              onClick={() => onNavigate(`/learn/${s.story_slug}/report`)}
              className="px-3 py-1.5 rounded-lg border border-accent text-accent text-xs font-medium hover:bg-accent-bg transition-colors cursor-pointer"
            >
              查看報告
            </button>
          )}
          {hasDialogue && s.status !== 'completed' && (
            <button
              onClick={() => onNavigate(`/sessions/${s.id}/dialogue`)}
              className="px-3 py-1.5 rounded-lg border border-accent text-accent text-xs font-medium hover:bg-accent-bg transition-colors cursor-pointer"
            >
              查看對話
            </button>
          )}
          {s.status === 'in_progress' && s.story_slug && !isNaN(Number(s.story_slug)) && (
            <button
              onClick={() => onNavigate(`/learn/${s.story_slug}/intro`)}
              className="px-3 py-1.5 rounded-lg border border-blue-400 text-blue-600 hover:bg-blue-50 text-xs font-medium transition-colors cursor-pointer"
            >
              繼續
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

const LearningHistory: React.FC = () => {
  const { token } = useAuth();
  const navigate = useNavigate();

  const [sessions, setSessions] = useState<LearningSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [tabTotals, setTabTotals] = useState<Record<TabKey, number>>({ in_progress: 0, completed: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [offset, setOffset] = useState(0);
  const [activeTab, setActiveTab] = useState<TabKey>('in_progress');
  const LIMIT = 20;

  const loadSessions = useCallback(async (off: number) => {
    if (!token) return;
    setIsLoading(true);
    setError('');
    try {
      const data = await fetchLearningSessions(token, {
        limit: LIMIT,
        offset: off,
        status: tabToStatusFilter(activeTab),
      });
      setSessions(data.items);
      setTotal(data.total);
      setTabTotals((prev) => ({ ...prev, [activeTab]: data.total }));
    } catch (err) {
      setError(err instanceof Error ? err.message : '無法載入學習記錄');
    } finally {
      setIsLoading(false);
    }
  }, [token, activeTab]);

  useEffect(() => {
    loadSessions(offset);
  }, [loadSessions, offset]);

  const hasNextPage = offset + LIMIT < total;
  const hasPrevPage = offset > 0;

  return (
    <div className="flex-1 overflow-y-auto p-6 sm:p-8">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Page title */}
        <div>
          <h1 className="text-xl font-bold text-gray-900">對話記錄</h1>
          <p className="text-sm text-gray-500 mt-1">每次學習的詳細紀錄，可查看 AI 課文理解對話</p>
        </div>

        {/* Cross-link to /progress */}
        <div className="flex items-center justify-between bg-blue-50 border border-blue-200 rounded-lg px-4 py-2.5 text-sm">
          <span className="text-blue-700">想追蹤每篇課文的六步驟完成狀況？</span>
          <button
            onClick={() => navigate('/progress')}
            className="ml-3 shrink-0 text-xs font-medium text-blue-600 hover:text-blue-800 underline cursor-pointer"
          >
            前往學習進度
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
            {error}
            <button onClick={() => loadSessions(offset)} className="ml-2 underline cursor-pointer">
              重試
            </button>
          </div>
        )}

        {/* Tab bar + content card */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
          {/* Tab bar */}
          <div className="border-b border-gray-200 overflow-x-auto">
            <nav className="flex -mb-px whitespace-nowrap" aria-label="Tabs">
              {TABS.map((tab) => {
                const count = tabTotals[tab.key];
                return (
                  <button
                    key={tab.key}
                    onClick={() => {
                      setActiveTab(tab.key);
                      setOffset(0);
                    }}
                    className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors cursor-pointer shrink-0 ${
                      activeTab === tab.key
                        ? 'border-accent text-accent'
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                    }`}
                  >
                    {tab.label}
                    {!isLoading && (
                      <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${
                        activeTab === tab.key
                          ? 'bg-accent/10 text-accent'
                          : 'bg-gray-100 text-gray-500'
                      }`}>
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>
          </div>

          {/* Tab content */}
          <div className="p-4">
            {/* Loading skeletons */}
            {isLoading && (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="rounded-xl border border-gray-200 p-4">
                    <div className="h-5 bg-gray-200 animate-pulse rounded w-1/2 mb-2" />
                    <div className="h-4 bg-gray-200 animate-pulse rounded w-1/3" />
                  </div>
                ))}
              </div>
            )}

            {/* Empty state — no sessions at all */}
            {!isLoading && !error && sessions.length === 0 && (
              <div className="text-center py-12">
                <div className="inline-flex items-center justify-center w-14 h-14 bg-accent-bg rounded-xl mb-4">
                  <svg className="w-7 h-7 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                      d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                  </svg>
                </div>
                <p className="text-sm font-medium text-gray-700 mb-1">還沒有學習記錄</p>
                <p className="text-xs text-gray-500 mb-4">開始閱讀課文後，記錄會顯示在這裡</p>
                <button
                  onClick={() => navigate('/library')}
                  className="px-4 py-2 rounded-lg bg-accent hover:bg-accent-hover text-white text-sm font-medium transition-colors cursor-pointer"
                >
                  前往圖書館
                </button>
              </div>
            )}

            {/* Empty state — current tab has no sessions */}
            {!isLoading && !error && sessions.length === 0 && tabTotals[activeTab] > 0 && (
              <div className="text-center py-10">
                <p className="text-sm text-gray-500">
                  {activeTab === 'in_progress' ? '沒有進行中的學習記錄' : '還沒有已完成的學習記錄'}
                </p>
              </div>
            )}

            {/* Session cards */}
            {!isLoading && !error && sessions.length > 0 && (
              <div className="space-y-3">
                {sessions.map((s) => (
                  <SessionCard key={s.id} s={s} onNavigate={navigate} />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Pagination */}
        {!isLoading && !error && total > LIMIT && (
          <div className="flex items-center justify-between pt-2">
            <button
              onClick={() => setOffset(Math.max(0, offset - LIMIT))}
              disabled={!hasPrevPage}
              className="px-3 py-1.5 text-xs text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
            >
              上一頁
            </button>
            <span className="text-xs text-gray-500">
              共 {total} 筆記錄
            </span>
            <button
              onClick={() => setOffset(offset + LIMIT)}
              disabled={!hasNextPage}
              className="px-3 py-1.5 text-xs text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
            >
              下一頁
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default LearningHistory;
