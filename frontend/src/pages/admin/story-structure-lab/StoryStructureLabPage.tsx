/**
 * StoryStructureLabPage — 文章重點表 Lab MVP
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import {
  fetchStoryStructureLabDetail,
  fetchStoryStructureLabIndex,
  type LabDetail,
  type LabLessonSummary,
  type QaGateResult,
} from '../../../services/storyStructureLabApi';

const TIER_LABELS: Record<string, string> = {
  docx_keypoints: 'DOCX keypoints',
  ai_fallback: 'AI fallback',
  no_keypoints_docx: '無 keypoints',
  parser_gap: 'Parser gap',
  no_structure: '無結構',
};

const MODE_LABELS: Record<string, string> = {
  fill_blank: '填空',
  checkbox: '勾選',
  mixed: '混合',
  display_only: '純展示',
};

function GateLight({ gate }: { gate: QaGateResult }) {
  const color = gate.pass ? 'bg-emerald-500' : 'bg-red-500';
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs ${gate.pass ? 'text-emerald-700' : 'text-red-700'}`}
      title={gate.issues.join('\n') || gate.gate}
    >
      <span className={`w-2 h-2 rounded-full ${color}`} />
      {gate.gate}
    </span>
  );
}

function JsonPanel({ title, data }: { title: string; data: unknown }) {
  if (data == null) {
    return (
      <section className="rounded-xl border border-gray-200 bg-white overflow-hidden">
        <header className="px-4 py-2 border-b border-gray-100 bg-gray-50 text-sm font-semibold text-gray-700">
          {title}
        </header>
        <p className="p-4 text-sm text-gray-400">（無資料）</p>
      </section>
    );
  }
  return (
    <section className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      <header className="px-4 py-2 border-b border-gray-100 bg-gray-50 text-sm font-semibold text-gray-700">
        {title}
      </header>
      <pre className="p-4 text-xs overflow-auto max-h-80 whitespace-pre-wrap break-words text-gray-800">
        {JSON.stringify(data, null, 2)}
      </pre>
    </section>
  );
}

const StoryStructureLabPage: React.FC = () => {
  const { token } = useAuth();
  const [lessons, setLessons] = useState<LabLessonSummary[]>([]);
  const [qaReportAvailable, setQaReportAvailable] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<LabDetail | null>(null);
  const [filter, setFilter] = useState('');
  const [tierFilter, setTierFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState('');

  const loadIndex = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError('');
    try {
      const data = await fetchStoryStructureLabIndex(token);
      setLessons(data.lessons);
      setQaReportAvailable(data.qa_report_available);
      const pinned = data.lessons.filter((l) => l.pinned);
      if (pinned.length > 0) {
        setSelectedId(pinned[0].story_id);
      } else if (data.lessons.length > 0) {
        setSelectedId(data.lessons[0].story_id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '無法載入 Lab 索引');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadIndex();
  }, [loadIndex]);

  useEffect(() => {
    if (!token || selectedId == null) return;
    let cancelled = false;
    setDetailLoading(true);
    fetchStoryStructureLabDetail(token, selectedId)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '無法載入課文詳情');
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, selectedId]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return lessons.filter((l) => {
      if (tierFilter !== 'all' && l.tier !== tierFilter) return false;
      if (!q) return true;
      const blob = `${l.title} ${l.catalog_code} ${l.parsed_code} ${l.story_id}`.toLowerCase();
      return blob.includes(q);
    });
  }, [lessons, filter, tierFilter]);

  const pinnedLessons = useMemo(() => lessons.filter((l) => l.pinned), [lessons]);

  return (
    <div className="flex h-full min-h-0">
      <aside className="w-72 shrink-0 border-r border-gray-200 bg-white flex flex-col min-h-0">
        <div className="p-3 border-b border-gray-100 space-y-2">
          <h2 className="text-sm font-bold text-gray-900">文章重點表 Lab</h2>
          <input
            type="search"
            placeholder="搜尋課文…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5"
          />
          <select
            value={tierFilter}
            onChange={(e) => setTierFilter(e.target.value)}
            className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5"
          >
            <option value="all">全部 tier</option>
            {Object.entries(TIER_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>

        {pinnedLessons.length > 0 && (
          <div className="px-3 py-2 border-b border-gray-100">
            <p className="text-xs font-semibold text-gray-500 mb-1">代表課</p>
            <div className="flex flex-wrap gap-1">
              {pinnedLessons.map((l) => (
                <button
                  key={l.story_id}
                  type="button"
                  onClick={() => setSelectedId(l.story_id)}
                  className={`text-xs px-2 py-0.5 rounded-full border ${
                    selectedId === l.story_id
                      ? 'bg-sky-100 border-sky-300 text-sky-800'
                      : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {l.catalog_code || l.story_id}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <p className="p-3 text-sm text-gray-400">載入中…</p>
          ) : (
            filtered.map((l) => (
              <button
                key={l.story_id}
                type="button"
                onClick={() => setSelectedId(l.story_id)}
                className={`w-full text-left px-3 py-2 border-b border-gray-50 hover:bg-gray-50 ${
                  selectedId === l.story_id ? 'bg-sky-50' : ''
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${l.overall_pass ? 'bg-emerald-500' : 'bg-red-500'}`} />
                  <span className="text-sm font-medium text-gray-900 truncate">{l.title}</span>
                </div>
                <p className="text-xs text-gray-500 mt-0.5 pl-4">
                  {l.catalog_code} · id {l.story_id} · {TIER_LABELS[l.tier] || l.tier}
                  {l.interaction_profile?.mode ? ` · ${MODE_LABELS[l.interaction_profile.mode] || l.interaction_profile.mode}` : ''}
                </p>
              </button>
            ))
          )}
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto p-4 sm:p-6 bg-gray-50 min-h-0">
        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>
        )}
        {!detail && !detailLoading && <p className="text-sm text-gray-500">從左側選一課</p>}
        {detailLoading && <p className="text-sm text-gray-400">載入課文詳情…</p>}
        {detail && !detailLoading && (
          <div className="max-w-5xl mx-auto space-y-4">
            <header className="bg-white rounded-xl border border-gray-200 p-4">
              <h1 className="text-lg font-bold text-gray-900">{detail.title}</h1>
              <p className="text-sm text-gray-500 mt-1">
                story_id {detail.story_id}
                {detail.catalog_code ? ` · catalog ${detail.catalog_code}` : ''}
                {detail.parsed_code ? ` · parsed ${detail.parsed_code}` : ''}
                {' · '}{TIER_LABELS[detail.tier] || detail.tier}
                {detail.known_data_gap ? (
                  <span className="ml-2 text-xs font-semibold text-red-600">已知資料缺口</span>
                ) : null}
              </p>
              {detail.interaction_profile && (
                <p className="text-sm text-gray-600 mt-2">
                  mode: <strong>{MODE_LABELS[detail.interaction_profile.mode || ''] || detail.interaction_profile.mode}</strong>
                  {' · '}layout: {detail.interaction_profile.layout}
                  {' · '}fill_blank: {detail.interaction_profile.fill_blank_count ?? 0}
                  {' · '}checkbox: {detail.interaction_profile.checkbox_count ?? 0}
                </p>
              )}
              <div className="flex flex-wrap gap-3 mt-3">
                {Object.values(detail.qa_gates).map((g) => (
                  <GateLight key={g.gate} gate={g} />
                ))}
                {!qaReportAvailable && (
                  <span className="text-xs text-amber-600">QA report 未掛載（僅 L3_live）</span>
                )}
              </div>
            </header>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <JsonPanel title="B · YAML story_structure_table" data={detail.yaml_table} />
              <JsonPanel title="C · keypoints.yml" data={detail.keypoints} />
            </div>

            <section className="rounded-xl border border-gray-200 bg-white overflow-hidden">
              <header className="px-4 py-2 border-b border-gray-100 bg-gray-50 text-sm font-semibold text-gray-700">
                D · 學生端即時渲染
              </header>
              <iframe
                title="story-structure-preview"
                src={`/learn/${detail.story_id}/story-structure`}
                className="w-full h-[520px] border-0 bg-white"
              />
            </section>

            <section className="rounded-xl border border-gray-200 bg-white overflow-hidden">
              <header className="px-4 py-2 border-b border-gray-100 bg-gray-50 text-sm font-semibold text-gray-700">
                E · QA gates + interaction_profile
              </header>
              <div className="p-4 space-y-3">
                {Object.entries(detail.qa_gates).map(([key, g]) => (
                  <div key={key} className="text-sm">
                    <GateLight gate={g} />
                    {g.issues.length > 0 && (
                      <ul className="mt-1 ml-4 text-xs text-gray-600 list-disc">
                        {g.issues.map((issue) => (
                          <li key={issue}>{issue}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
                <JsonPanel title="structure (sanitized API)" data={detail.structure} />
              </div>
            </section>
          </div>
        )}
      </main>
    </div>
  );
};

export default StoryStructureLabPage;
