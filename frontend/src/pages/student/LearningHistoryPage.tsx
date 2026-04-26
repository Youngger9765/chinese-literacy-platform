/**
 * LearningHistoryPage — student's learning history overview.
 *
 * Two tabs:
 *  - 作業回顧: sessions with learning_source = 'assignment'
 *  - 自學紀錄: sessions with learning_source = 'self'
 *
 * Card layout mirrors MyAssignments (step progress strip + metadata),
 * but all actions are read-only (查看 report only).
 * Route: /learning-history
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { fetchLearningSessions, type LearningSummary } from '../../services/learningApi';
import { ACTIVE_STEPS } from '../../config/stepConfig';
import StepProgressStrip from '../../components/ui/StepProgressStrip';

type TabKey = 'assignment' | 'self';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'assignment', label: '作業回顧' },
  { key: 'self', label: '自學紀錄' },
];

const PAGE_SIZE = 20;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('zh-TW', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function groupByMonth(sessions: LearningSummary[]): { label: string; items: LearningSummary[] }[] {
  const map = new Map<string, LearningSummary[]>();
  for (const s of sessions) {
    const d = new Date(s.started_at);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(s);
  }
  return Array.from(map.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([, items]) => ({
      label: new Date(items[0].started_at).toLocaleDateString('zh-TW', {
        year: 'numeric',
        month: 'long',
      }),
      items,
    }));
}

// ---------------------------------------------------------------------------
// Session card — mirrors MyAssignments layout, read-only
// ---------------------------------------------------------------------------

const SessionCard: React.FC<{ session: LearningSummary }> = ({ session }) => {
  const navigate = useNavigate();

  // All completed sessions have all steps done
  const allStepIds = useMemo(() => new Set(ACTIVE_STEPS.map((s) => s.id)), []);

  return (
    <div className="bg-white rounded-2xl shadow-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {/* Title + status — enlarged to text-base to match /student and /assignments/my */}
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-base font-medium text-gray-900 truncate">
              {session.story_title ?? session.story_slug ?? '未知課文'}
            </h3>
            <span className="inline-block px-1.5 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">
              已完成
            </span>
          </div>

          {/* Metadata row — Issue #1094: 學生端不顯示得分 / 準確率 */}
          <div className="flex items-center gap-3 mt-2 flex-wrap">
            <span className="text-xs text-gray-400">{formatDate(session.started_at)}</span>
          </div>

          {/* Step progress strip */}
          {ACTIVE_STEPS.length > 0 && (
            <div className="mt-2.5">
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs text-gray-500">學習關卡進度</p>
                <p className="text-xs text-gray-400">
                  {ACTIVE_STEPS.length}/{ACTIVE_STEPS.length}
                </p>
              </div>
              <StepProgressStrip
                steps={ACTIVE_STEPS}
                completedSteps={allStepIds}
              />
            </div>
          )}
        </div>

        {/* Read-only action */}
        <button
          onClick={() => navigate(`/sessions/${session.id}/report`)}
          className="px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors cursor-pointer shrink-0"
        >
          查看
        </button>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Tab content
// ---------------------------------------------------------------------------

const TabContent: React.FC<{ source: TabKey }> = ({ source }) => {
  const { token } = useAuth();
  const [sessions, setSessions] = useState<LearningSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(
    async (offset: number, append: boolean) => {
      if (!token) return;
      if (offset === 0) setIsLoading(true);
      else setIsLoadingMore(true);
      setError('');
      try {
        const result = await fetchLearningSessions(token, {
          learning_source: source,
          limit: PAGE_SIZE,
          offset,
          status: 'completed',
        });
        setSessions((prev) => (append ? [...prev, ...result.items] : result.items));
        setTotal(result.total);
      } catch {
        setError('無法載入學習紀錄，請稍後再試');
      } finally {
        setIsLoading(false);
        setIsLoadingMore(false);
      }
    },
    [token, source],
  );

  useEffect(() => {
    setSessions([]);
    setTotal(0);
    load(0, false);
  }, [load]);

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="bg-white rounded-2xl shadow-card p-4">
            <div className="h-4 bg-gray-200 animate-pulse rounded w-2/3 mb-3" />
            <div className="h-3 bg-gray-200 animate-pulse rounded w-1/3 mb-2" />
            <div className="h-4 bg-gray-200 animate-pulse rounded w-full" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
        {error}
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="inline-flex items-center justify-center w-14 h-14 bg-accent-bg rounded-xl mb-4">
          <svg className="w-7 h-7 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25"
            />
          </svg>
        </div>
        <p className="text-sm font-medium text-gray-700 mb-1">
          {source === 'assignment' ? '還沒有作業學習紀錄' : '還沒有自學紀錄'}
        </p>
        <p className="text-xs text-gray-500">
          {source === 'assignment'
            ? '完成老師指派的作業後會出現在這裡'
            : '在圖書館自主練習後會出現在這裡'}
        </p>
      </div>
    );
  }

  const groups = groupByMonth(sessions);
  const hasMore = sessions.length < total;

  return (
    <div className="space-y-6">
      {groups.map((group) => (
        <div key={group.label}>
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-2">
            {group.label}
          </h3>
          <div className="space-y-3">
            {group.items.map((s) => (
              <SessionCard key={s.id} session={s} />
            ))}
          </div>
        </div>
      ))}

      {hasMore && (
        <div className="text-center pt-2">
          <button
            onClick={() => load(sessions.length, true)}
            disabled={isLoadingMore}
            className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-xs font-medium hover:bg-gray-50 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoadingMore ? '載入中...' : `載入更多（還有 ${total - sessions.length} 筆）`}
          </button>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const LearningHistoryPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabKey>('assignment');

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-6">
      <div className="max-w-2xl mx-auto space-y-4">
        <div>
          <h1 className="text-base font-bold text-gray-900">學習紀錄</h1>
          <p className="text-sm text-gray-500 mt-0.5">回顧過去的學習練習</p>
        </div>

        {/* Tabs */}
        <div className="border-b border-gray-200">
          <nav className="flex -mb-px" aria-label="學習紀錄分頁">
            {TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`px-3 py-1.5 text-sm font-medium border-b-2 transition-colors cursor-pointer ${
                  activeTab === tab.key
                    ? 'border-accent text-accent'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        <TabContent key={activeTab} source={activeTab} />
      </div>
    </div>
  );
};

export default LearningHistoryPage;
