/**
 * StudentProgress — visual learning path and per-text step completion tracker.
 *
 * Route: /progress
 * Issue #257
 *
 * Shows:
 *   - Overall stats (texts attempted, completed, average score)
 *   - Per-text card with 6-step completion indicators
 *   - Rule-based "Continue learning" recommendation
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import {
  getStudentProgress,
  StudentProgressResponse,
  TextProgressItem,
  StepStatusItem,
} from '../../services/progressApi';

const STEP_ROUTE: Record<string, string> = {
  intro: 'intro',
  live_tutor: 'tutor',
  comprehension: 'comprehension',
  vocab: 'vocab',
  full_reading: 'full-reading',
  report: 'report',
};

// ── Step pill ──────────────────────────────────────────────────────────────

const StepPill: React.FC<{ step: StepStatusItem }> = ({ step }) => {
  const base = 'inline-block px-2 py-0.5 rounded-full text-xs font-medium';
  if (step.status === 'completed') {
    return <span className={`${base} bg-green-100 text-green-700`}>{step.step_label}</span>;
  }
  if (step.status === 'in_progress') {
    return <span className={`${base} bg-blue-100 text-blue-700 ring-1 ring-blue-300`}>{step.step_label}</span>;
  }
  return <span className={`${base} bg-gray-100 text-gray-400`}>{step.step_label}</span>;
};

// ── Text progress card ─────────────────────────────────────────────────────

const TextCard: React.FC<{ item: TextProgressItem }> = ({ item }) => {
  const navigate = useNavigate();

  const handleContinue = () => {
    const { action, step } = item.next_step;
    if (action === 'new_text') {
      navigate('/library');
      return;
    }
    // Guard: only navigate if story_slug is a numeric lesson_number.
    // Legacy sessions may have slug-format story_slugs that the API cannot resolve.
    if (!item.story_slug || isNaN(Number(item.story_slug))) {
      navigate('/library');
      return;
    }
    const route = step ? STEP_ROUTE[step] ?? 'intro' : 'intro';
    navigate(`/learn/${item.story_slug}/${route}`);
  };

  const statusColor =
    item.status === 'completed'
      ? 'border-green-200 bg-green-50'
      : item.status === 'abandoned'
      ? 'border-gray-200 bg-gray-50'
      : 'border-blue-200 bg-white';

  const pctColor =
    item.completion_pct >= 100
      ? 'text-green-600'
      : item.completion_pct > 0
      ? 'text-blue-600'
      : 'text-gray-400';

  return (
    <div className={`rounded-xl border shadow-sm p-4 ${statusColor}`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-gray-900 truncate">{item.story_title ?? item.story_slug}</p>
          <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
            <span>開始：{new Date(item.started_at).toLocaleDateString('zh-TW')}</span>
            {item.overall_score != null && (
              <span className="font-medium text-gray-700">
                總分：{Math.round(item.overall_score)}%
              </span>
            )}
            {item.accuracy != null && (
              <span>正確率：{Math.round(item.accuracy)}%</span>
            )}
          </div>
        </div>
        <span className={`text-lg font-bold shrink-0 ${pctColor}`}>
          {item.completion_pct}%
        </span>
      </div>

      {/* Progress bar */}
      <div className="w-full h-1.5 bg-gray-200 rounded-full mb-3">
        <div
          className="h-1.5 bg-green-400 rounded-full transition-all"
          style={{ width: `${item.completion_pct}%` }}
        />
      </div>

      {/* Step pills */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {item.steps.map((s) => (
          <StepPill key={s.step_key} step={s} />
        ))}
      </div>

      {/* Recommendation */}
      <div className="flex items-center justify-between gap-3 pt-2 border-t border-gray-200">
        <p className="text-xs text-gray-500 flex-1">{item.next_step.reason}</p>
        <button
          onClick={handleContinue}
          className="shrink-0 px-3 py-1.5 rounded-lg bg-accent hover:bg-accent-hover text-white text-xs font-medium transition-colors cursor-pointer"
        >
          {item.next_step.action === 'new_text' ? '挑戰新課文' : '繼續學習'}
        </button>
      </div>
    </div>
  );
};

// ── Main page ──────────────────────────────────────────────────────────────

type ProgressTab = 'in_progress' | 'completed';

const StudentProgress: React.FC = () => {
  const { token, user } = useAuth();
  const navigate = useNavigate();

  const [data, setData] = useState<StudentProgressResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<ProgressTab>('in_progress');

  const load = useCallback(async () => {
    if (!token || !user) return;
    setIsLoading(true);
    setError('');
    try {
      const res = await getStudentProgress(token, user.id);
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : '無法載入進度資料');
    } finally {
      setIsLoading(false);
    }
  }, [token, user]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="flex-1 overflow-y-auto p-6 sm:p-8">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Title */}
        <div>
          <h1 className="text-xl font-bold text-gray-900">學習進度</h1>
          <p className="text-sm text-gray-500 mt-1">追蹤每篇課文的六步驟完成狀況</p>
        </div>

        {/* Cross-link to /history */}
        <div className="flex items-center justify-between bg-gray-50 border border-gray-200 rounded-lg px-4 py-2.5 text-sm">
          <span className="text-gray-600">想查看每次學習的 AI 對話紀錄？</span>
          <button
            onClick={() => navigate('/history')}
            className="ml-3 shrink-0 text-xs font-medium text-gray-500 hover:text-gray-700 underline cursor-pointer"
          >
            前往對話記錄
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
            {error}
            <button onClick={load} className="ml-2 underline cursor-pointer">重試</button>
          </div>
        )}

        {/* Loading */}
        {isLoading && (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="h-4 bg-gray-200 animate-pulse rounded w-1/2 mb-3" />
                <div className="h-2 bg-gray-200 animate-pulse rounded mb-3" />
                <div className="flex gap-2">
                  {Array.from({ length: 6 }).map((_, j) => (
                    <div key={j} className="h-5 w-14 bg-gray-200 animate-pulse rounded-full" />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Stats */}
        {!isLoading && data && (
          <>
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
                <p className="text-2xl font-bold text-gray-900">{data.texts_attempted}</p>
                <p className="text-xs text-gray-500 mt-1">嘗試課文</p>
              </div>
              <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
                <p className="text-2xl font-bold text-green-600">{data.texts_completed}</p>
                <p className="text-xs text-gray-500 mt-1">完成課文</p>
              </div>
              <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
                <p className="text-2xl font-bold text-accent">
                  {data.average_score != null ? `${Math.round(data.average_score)}%` : '-'}
                </p>
                <p className="text-xs text-gray-500 mt-1">平均分數</p>
              </div>
            </div>

            {/* Empty state */}
            {data.texts.length === 0 && (
              <div className="text-center py-16">
                <p className="text-sm font-medium text-gray-700 mb-1">還沒有學習記錄</p>
                <p className="text-xs text-gray-500 mb-4">開始閱讀課文後，進度會顯示在這裡</p>
                <button
                  onClick={() => navigate('/library')}
                  className="px-4 py-2 rounded-lg bg-accent hover:bg-accent-hover text-white text-sm font-medium transition-colors cursor-pointer"
                >
                  前往圖書館
                </button>
              </div>
            )}

            {/* Tab bar */}
            {data.texts.length > 0 && (() => {
              const inProgressTexts = data.texts.filter((t) => t.status !== 'completed');
              const completedTexts = data.texts.filter((t) => t.status === 'completed');
              const filteredTexts = activeTab === 'completed' ? completedTexts : inProgressTexts;
              return (
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
                  <div className="border-b border-gray-200 overflow-x-auto">
                    <nav className="flex -mb-px whitespace-nowrap" aria-label="Tabs">
                      <button
                        onClick={() => setActiveTab('in_progress')}
                        className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors cursor-pointer shrink-0 ${
                          activeTab === 'in_progress'
                            ? 'border-accent text-accent'
                            : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                        }`}
                      >
                        嘗試中
                        <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${
                          activeTab === 'in_progress'
                            ? 'bg-accent/10 text-accent'
                            : 'bg-gray-100 text-gray-500'
                        }`}>
                          {inProgressTexts.length}
                        </span>
                      </button>
                      <button
                        onClick={() => setActiveTab('completed')}
                        className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors cursor-pointer shrink-0 ${
                          activeTab === 'completed'
                            ? 'border-accent text-accent'
                            : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                        }`}
                      >
                        已完成
                        <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${
                          activeTab === 'completed'
                            ? 'bg-accent/10 text-accent'
                            : 'bg-gray-100 text-gray-500'
                        }`}>
                          {completedTexts.length}
                        </span>
                      </button>
                    </nav>
                  </div>
                  <div className="p-4 space-y-3">
                    {filteredTexts.length === 0 ? (
                      <p className="text-sm text-gray-500 text-center py-8">
                        {activeTab === 'in_progress' ? '沒有進行中的課文' : '還沒有完成任何課文'}
                      </p>
                    ) : (
                      filteredTexts.map((t) => (
                        <TextCard key={t.story_slug} item={t} />
                      ))
                    )}
                  </div>
                </div>
              );
            })()}
          </>
        )}
      </div>
    </div>
  );
};

export default StudentProgress;
