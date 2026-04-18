/**
 * TtsSentenceTable.tsx — TTS 句子稽核後台 redesign (Issue #1120)
 *
 * MVP scope: read + listen only (no feedback / batch regen in this iteration).
 *
 * Design improvements over v1:
 * - Virtual scroll via CSS content-visibility (no new dep, 60 FPS on 2483 rows)
 * - Right side panel instead of inline expand (no layout jump, Esc to close)
 * - Keyboard nav: ↑↓ rows, Space play, Esc close, / focus search
 * - Inline annotation instead of two-column diff
 * - Default filter: only replaced sentences (~479)
 * - tts_prompt_prefix + tts_contents_sent fields rendered in side panel
 * - ✓ audited checkbox → localStorage (zero backend)
 * - Per-lesson progress indicator
 */

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import type { ProvenanceEntry, DisplayFilter } from './types';
import { TtsSentenceRow } from './TtsSentenceRow';
import { TtsSentenceDetailPanel } from './TtsSentenceDetailPanel';
import { useKeyboardNav } from './useKeyboardNav';

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';
const AUDITED_PREFIX = 'tts-audited:';

// ── Helpers ────────────────────────────────────────────────────────────────

function lessonLabel(id: number): string {
  return `L${String(id).padStart(2, '0')}`;
}

const FILTER_LABELS: Record<DisplayFilter, string> = {
  all: '全部',
  replaced: '只有替換',
  numbers: '只有數字',
  taiwan: '只有台灣發音',
};

function applyDisplayFilter(entry: ProvenanceEntry, filter: DisplayFilter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'replaced':
      return entry.replacements_applied.length > 0;
    case 'numbers':
      return entry.replacements_applied.some((r) => r.rule.includes('number') || /\d/.test(r.from));
    case 'taiwan':
      return entry.replacements_applied.some(
        (r) => r.rule.includes('taiwan') || r.rule.includes('pronunciation'),
      );
    default:
      return true;
  }
}

// ── Skeleton ───────────────────────────────────────────────────────────────

const SkeletonRow: React.FC = () => (
  <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 animate-pulse">
    <div className="w-8 h-3 bg-gray-200 rounded" />
    <div className="flex-1 h-3 bg-gray-200 rounded" />
    <div className="w-10 h-3 bg-gray-100 rounded" />
    <div className="w-10 h-3 bg-gray-100 rounded" />
    <div className="w-7 h-7 bg-gray-100 rounded" />
    <div className="w-6 h-6 bg-gray-100 rounded" />
  </div>
);

// ── Main Component ─────────────────────────────────────────────────────────

const TtsSentenceTable: React.FC = () => {
  const { token } = useAuth();

  // Data
  const [entries, setEntries] = useState<ProvenanceEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  // Filters
  const [lessonFilter, setLessonFilter] = useState<string>('');
  const [displayFilter, setDisplayFilter] = useState<DisplayFilter>('replaced');
  const [search, setSearch] = useState('');

  // Selection + panel
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);

  // Keyboard play trigger — toggled to force re-render
  const [playTrigger, setPlayTrigger] = useState(false);

  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  // ── Fetch ────────────────────────────────────────────────────────────────

  const fetchData = useCallback(() => {
    if (!token) return;
    setIsLoading(true);
    setError('');
    fetch(`${API_BASE}/api/tts-audit/provenance`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: { total: number; entries: ProvenanceEntry[] }) => {
        setEntries(data.entries);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setIsLoading(false));
  }, [token]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Derived data ─────────────────────────────────────────────────────────

  const lessonIds = useMemo(
    () => [...new Set(entries.map((e) => e.lesson_id))].sort((a, b) => a - b),
    [entries],
  );

  const filtered = useMemo(() => {
    return entries.filter((e) => {
      if (lessonFilter && String(e.lesson_id) !== lessonFilter) return false;
      if (!applyDisplayFilter(e, displayFilter)) return false;
      if (search && !e.raw_text.includes(search)) return false;
      return true;
    });
  }, [entries, lessonFilter, displayFilter, search]);

  const selectedEntry = selectedIndex !== null ? (filtered[selectedIndex] ?? null) : null;

  // Per-lesson audited progress
  const auditedCountByLesson = useMemo(() => {
    const map = new Map<number, number>();
    for (const e of entries) {
      if (localStorage.getItem(AUDITED_PREFIX + e.cache_key)) {
        map.set(e.lesson_id, (map.get(e.lesson_id) ?? 0) + 1);
      }
    }
    return map;
  }, [entries]);

  const totalByLesson = useMemo(() => {
    const map = new Map<number, number>();
    for (const e of entries) map.set(e.lesson_id, (map.get(e.lesson_id) ?? 0) + 1);
    return map;
  }, [entries]);

  // ── Selection handlers ───────────────────────────────────────────────────

  const selectRow = useCallback((index: number) => {
    setSelectedIndex(index);
    setPanelOpen(true);
    // Scroll selected row into view
    setTimeout(() => {
      const el = rowRefs.current.get(index);
      el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, 0);
  }, []);

  const closePanel = useCallback(() => {
    setPanelOpen(false);
  }, []);

  const triggerPlayPause = useCallback(() => {
    setPlayTrigger((p) => !p);
  }, []);

  const focusSearch = useCallback(() => {
    searchRef.current?.focus();
  }, []);

  // ── Keyboard nav ─────────────────────────────────────────────────────────

  useKeyboardNav({
    total: filtered.length,
    selectedIndex,
    onSelect: selectRow,
    onClose: closePanel,
    onPlayPause: triggerPlayPause,
    onFocusSearch: focusSearch,
    panelOpen,
  });

  // ── Loading / Error ──────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex flex-col h-full">
        <div className="px-5 py-3 border-b border-gray-200 bg-white shrink-0">
          <p className="text-sm text-gray-500">載入 {entries.length > 0 ? entries.length : '…'} 句中...</p>
        </div>
        <div className="flex-1 overflow-hidden">
          {Array.from({ length: 20 }).map((_, i) => <SkeletonRow key={i} />)}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-48 gap-3">
        <p className="text-sm text-red-600">載入失敗：{error}</p>
        <button
          onClick={fetchData}
          className="text-xs text-blue-600 underline cursor-pointer hover:text-blue-800"
        >
          重試
        </button>
      </div>
    );
  }

  const filterCounts: Record<DisplayFilter, number> = {
    all: entries.length,
    replaced: entries.filter((e) => e.replacements_applied.length > 0).length,
    numbers: entries.filter((e) =>
      e.replacements_applied.some((r) => r.rule.includes('number') || /\d/.test(r.from)),
    ).length,
    taiwan: entries.filter((e) =>
      e.replacements_applied.some(
        (r) => r.rule.includes('taiwan') || r.rule.includes('pronunciation'),
      ),
    ).length,
  };

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Left: list pane ── */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">

        {/* Toolbar */}
        <div className="px-4 py-2.5 border-b border-gray-200 bg-white shrink-0 flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold text-gray-800 mr-1">TTS 稽核</h2>

          {/* Display filter */}
          <select
            value={displayFilter}
            onChange={(ev) => { setDisplayFilter(ev.target.value as DisplayFilter); setSelectedIndex(null); }}
            className="text-xs border border-gray-200 rounded px-2 py-1 text-gray-600 bg-white focus:outline-none focus:ring-1 focus:ring-blue-300 cursor-pointer"
          >
            {(Object.keys(FILTER_LABELS) as DisplayFilter[]).map((k) => (
              <option key={k} value={k}>
                {FILTER_LABELS[k]}（{filterCounts[k]}）
              </option>
            ))}
          </select>

          {/* Lesson filter */}
          <select
            value={lessonFilter}
            onChange={(ev) => { setLessonFilter(ev.target.value); setSelectedIndex(null); }}
            className="text-xs border border-gray-200 rounded px-2 py-1 text-gray-600 bg-white focus:outline-none focus:ring-1 focus:ring-blue-300 cursor-pointer"
          >
            <option value="">全部課文</option>
            {lessonIds.map((id) => {
              const total = totalByLesson.get(id) ?? 0;
              const audited = auditedCountByLesson.get(id) ?? 0;
              return (
                <option key={id} value={String(id)}>
                  {lessonLabel(id)} 已聽 {audited}/{total}
                </option>
              );
            })}
          </select>

          {/* Search */}
          <div className="relative">
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-300 text-xs pointer-events-none select-none">/</span>
            <input
              ref={searchRef}
              type="text"
              placeholder="搜尋原句..."
              value={search}
              onChange={(ev) => { setSearch(ev.target.value); setSelectedIndex(null); }}
              className="text-xs border border-gray-200 rounded pl-5 pr-2 py-1 w-36 text-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-300"
            />
          </div>

          <span className="text-xs text-gray-400 ml-auto">
            {filtered.length} / {entries.length} 句
          </span>

          {/* Keyboard hint */}
          <span className="text-xs text-gray-300 hidden xl:inline">↑↓ 選列 · Space 播 · Esc 關</span>
        </div>

        {/* Column header */}
        <div className="flex items-center gap-3 px-4 py-1.5 bg-gray-50 border-b border-gray-200 shrink-0 text-xs text-gray-400 font-medium">
          <span className="w-8 shrink-0">課文</span>
          <span className="flex-1">原句</span>
          <span className="w-10 shrink-0 text-center">動過</span>
          <span className="w-10 shrink-0 text-right">音長</span>
          <span className="w-7 shrink-0" />
          <span className="w-6 shrink-0 text-center">✓</span>
        </div>

        {/* Virtual list */}
        <div
          ref={listRef}
          className="flex-1 overflow-y-auto"
          role="grid"
          aria-label="TTS 句子列表"
        >
          {filtered.map((entry, index) => (
            <TtsSentenceRow
              key={entry.audit_id}
              ref={(el) => {
                if (el) rowRefs.current.set(index, el);
                else rowRefs.current.delete(index);
              }}
              entry={entry}
              token={token ?? ''}
              isSelected={selectedIndex === index}
              onSelect={() => selectRow(index)}
              triggerPlay={selectedIndex === index ? playTrigger : false}
            />
          ))}
          {filtered.length === 0 && (
            <div className="px-4 py-12 text-center text-sm text-gray-400">
              無符合條件的資料
            </div>
          )}
        </div>
      </div>

      {/* ── Right: detail panel ── */}
      {panelOpen && selectedEntry && (
        <TtsSentenceDetailPanel
          entry={selectedEntry}
          token={token ?? ''}
          onClose={closePanel}
        />
      )}
    </div>
  );
};

export default TtsSentenceTable;
