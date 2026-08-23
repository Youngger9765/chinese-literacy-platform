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
import { listAllToolboxSessions, type ToolboxSession } from '../../services/toolboxApi';
import { TOOL_OPTIONS } from '../../components/tools/ToolPicker';
import { ACTIVE_STEPS } from '../../config/stepConfig';
import StepProgressStrip from '../../components/ui/StepProgressStrip';

type TabKey = 'assignment' | 'self';

// Both rendered, in this order. 自學 first because it is where the volume is.
const SECTIONS: { key: TabKey; label: string }[] = [
  { key: 'self', label: '自學紀錄' },
  { key: 'assignment', label: '作業回顧' },
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
// Toolbox session card — single-shot practice from /tools (#1463)
// ---------------------------------------------------------------------------

const TOOL_LABEL_BY_ID = new Map(TOOL_OPTIONS.map((t) => [t.id, t.label] as const));

const ToolboxSessionCard: React.FC<{ session: ToolboxSession }> = ({ session }) => {
  const toolLabel = TOOL_LABEL_BY_ID.get(session.tool_id) ?? session.tool_id;
  const storySlug = (session.result?.story_slug as string | null | undefined) ?? null;

  return (
    <div className="bg-white rounded-2xl shadow-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-base font-medium text-gray-900 truncate">{toolLabel}</h3>
            <span className="inline-block px-1.5 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">
              已完成
            </span>
            <span className="inline-block px-1.5 py-0.5 rounded text-xs font-medium bg-accent-bg text-accent">
              練習工具箱
            </span>
          </div>
          <div className="flex items-center gap-3 mt-2 flex-wrap text-xs text-gray-400">
            <span>{formatDate(session.started_at)}</span>
            {storySlug && <span>課文：{storySlug}</span>}
            {session.score != null && (
              // Toolbox tools normalize score to [0, 1] (accuracy / matchRate).
              // Render as a percentage so the value is readable at a glance.
              <span>分數：{Math.round(session.score * 100)}%</span>
            )}
          </div>
        </div>
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
  const [toolboxSessions, setToolboxSessions] = useState<ToolboxSession[]>([]);
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
        // #1463 Phase 3: in 自學 tab, fire learning-sessions and toolbox-sessions
        // requests in parallel to avoid waterfall latency. Toolbox load is
        // wrapped so a failure there doesn't block the main self-practice list.
        const sessionsPromise = fetchLearningSessions(token, {
          learning_source: source,
          limit: PAGE_SIZE,
          offset,
          status: 'completed',
        });
        const toolboxPromise =
          source === 'self' && offset === 0
            ? listAllToolboxSessions(token, 100).catch(() => [])
            : Promise.resolve(null);

        const [result, toolbox] = await Promise.all([sessionsPromise, toolboxPromise]);

        setSessions((prev) => (append ? [...prev, ...result.items] : result.items));
        setTotal(result.total);
        if (toolbox !== null) setToolboxSessions(toolbox);
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
    setToolboxSessions([]);
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

  if (sessions.length === 0 && toolboxSessions.length === 0) {
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
            : '在圖書館或練習工具箱練習後會出現在這裡'}
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

      {/* #1463 Phase 3: toolbox sessions in the 自學 tab. Independent section
          so completed self-practice and toolbox runs are visually separated. */}
      {source === 'self' && toolboxSessions.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-2">
            練習工具箱
          </h3>
          <div className="space-y-3">
            {toolboxSessions.map((s) => (
              <ToolboxSessionCard key={`${s.tool_id}-${s.id}`} session={s} />
            ))}
          </div>
        </div>
      )}

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
  // Both lists, always, on one page — no tabs (#2889).
  //
  // This was two tabs defaulting to 作業回顧. For a student who practises on their
  // own that tab is empty: measured on staging for the demo student, 9 completed
  // assignment sessions against 554 self-study ones. You landed on
  // 「還沒有作業學習紀錄」 with 554 records behind an unlabelled click, and read it as
  // your history being gone. That is exactly how it was reported.
  //
  // Owner's call: 「自學紀錄跟作業回顧都要有」. Making 自學 the default would still have
  // put one of them behind a click, so neither is. Each section keeps its own
  // paging and its own empty state, so an empty 作業回顧 now reads as "no assignments
  // yet" sitting next to your work, rather than as the whole page.
  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-6">
      <div className="max-w-2xl mx-auto space-y-8">
        <div>
          <h1 className="text-base font-bold text-gray-900">學習紀錄</h1>
          <p className="text-sm text-gray-500 mt-0.5">回顧過去的學習練習</p>
        </div>

        {SECTIONS.map((section) => (
          <section key={section.key} aria-label={section.label}>
            <h2 className="text-sm font-bold text-gray-900 mb-3 pb-2 border-b border-gray-200">
              {section.label}
            </h2>
            <TabContent source={section.key} />
          </section>
        ))}
      </div>
    </div>
  );
};

export default LearningHistoryPage;
