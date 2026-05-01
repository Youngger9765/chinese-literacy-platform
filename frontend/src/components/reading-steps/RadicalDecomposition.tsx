/**
 * RadicalDecomposition
 *
 * Displays component (部件) breakdown for a single Chinese character,
 * including radical meanings (形符/聲符) and related characters that share
 * the same radical.
 *
 * Based on 部件教學法 by Prof. Tseng Shih-chieh (曾世杰教授).
 */

import React, { useState, useEffect } from 'react';
import {
  getDecomposition,
  getDecompositionSource,
  getRadicalInfo,
  getRelatedChars,
  initGeneratedDecompositions,
  initRadicalMeanings,
  RadicalRole,
  RelatedChar,
} from '../../data/radicals';
import { lookupCharactersBatch } from '../../services/learningApi';

// Shared cache for moedict short meanings across all RadicalDecomposition
// instances (same session). Null = confirmed unavailable (not_found or
// network error); undefined = never queried yet.
const moedictMeaningCache = new Map<string, string | null>();

// Max relatedChars chips shown in the grid (keep in sync with both the
// effect that batch-fetches meanings and the JSX that renders chips).
const MAX_CHIPS = 8;

/** Shorten a full moedict definition to a display-friendly snippet. */
const shortenMoedictDef = (full: string): string => {
  const cleaned = full.trim();
  if (!cleaned) return '';
  for (const sep of ['。', '；', '，', '、']) {
    const idx = cleaned.indexOf(sep);
    if (idx > 0 && idx <= 18) return cleaned.slice(0, idx);
  }
  return cleaned.length > 20 ? cleaned.slice(0, 20) + '…' : cleaned;
};

/**
 * Skip moedict "pronunciation-only" entries such as "(一)之讀音。" that are
 * disambiguation notes rather than real meanings. Picks the first definition
 * string that looks like an actual explanation.
 */
const pickFirstRealDef = (defs: Array<{ definition: string }> | undefined): string => {
  if (!defs?.length) return '';
  const isPronNote = (s: string) => /^[（(][一二三四五六七八九十][）)]之(讀音|又音|俗音|讀)/.test(s.trim());
  for (const d of defs) {
    const text = (d.definition || '').trim();
    if (text && !isPronNote(text)) return text;
  }
  return defs[0]?.definition || '';
};

interface RadicalDecompositionProps {
  /** The character to decompose */
  char: string;
}

// Role badge colours
const ROLE_STYLES: Record<RadicalRole, string> = {
  '形符': 'bg-blue-100 text-blue-700 border-blue-200',
  '聲符': 'bg-amber-100 text-amber-700 border-amber-200',
  '部件': 'bg-gray-100 text-gray-600 border-gray-200',
};

const ROLE_DESCRIPTIONS: Record<RadicalRole, string> = {
  '形符': '表示意義',
  '聲符': '提示讀音',
  '部件': '組成部分',
};

interface RelatedCharCardProps {
  item: RelatedChar;
  isSelected: boolean;
  onClick: () => void;
}

const RelatedCharCard: React.FC<RelatedCharCardProps> = ({ item, isSelected, onClick }) => (
  <button
    onClick={onClick}
    className={[
      'flex flex-col items-center gap-1 px-3 py-2 rounded-xl border transition-all active:scale-95 text-left',
      isSelected
        ? 'bg-indigo-50 border-indigo-300 ring-1 ring-indigo-200'
        : 'bg-surface-container-low border-gray-200 hover:bg-surface-container hover:border-gray-300',
    ].join(' ')}
    aria-pressed={isSelected}
  >
    <span className="text-2xl font-bold text-on-surface leading-none">{item.char}</span>
  </button>
);

const RadicalDecomposition: React.FC<RadicalDecompositionProps> = ({ char }) => {
  const [selectedRelated, setSelectedRelated] = useState<RelatedChar | null>(null);
  const [activeRadical, setActiveRadical] = useState<string | null>(null);
  const [, forceUpdate] = useState(0);
  const [, setMoedictRev] = useState(0);

  // Load generated decomposition database on first render (lazy chunk).
  // forceUpdate triggers a re-render after the data is available so that
  // characters not in the hand-curated set are shown immediately.
  useEffect(() => {
    Promise.all([initGeneratedDecompositions(), initRadicalMeanings()])
      .then(() => forceUpdate(n => n + 1));
  }, []);

  const decomp = getDecomposition(char);

  if (!decomp) {
    // Character is an independent form (獨體字) or not in the database.
    // Show a friendly educational message instead of silently hiding the panel.
    return (
      <div className="bg-surface rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
        <div className="px-4 py-3 bg-gradient-to-r from-indigo-50 to-purple-50 border-b border-gray-100 flex items-center gap-2">
          <span className="text-base font-bold text-on-surface-variant whitespace-nowrap">部件拆解</span>
        </div>
        <div className="p-4 flex flex-col items-center gap-3 text-center">
          <span className="text-4xl font-black text-on-surface leading-none">{char}</span>
          <p className="text-sm text-gray-600">
            此字為<span className="font-semibold text-indigo-700">獨體字</span>，無法再拆解
          </p>
          <p className="text-xs text-gray-400">
            獨體字是最小的漢字單位，本身就是一個完整的象形或指事字
          </p>
        </div>
      </div>
    );
  }

  // Collect unique radicals from components
  const uniqueRadicals = Array.from(new Set(decomp.components.map(c => c.radical)));

  // Related chars from all form-radicals (形符) in decomposition, excluding current char
  const primaryFormRadical = decomp.components.find(c => c.role === '形符')?.radical;
  const displayRadical = activeRadical ?? primaryFormRadical ?? uniqueRadicals[0];
  const relatedChars = displayRadical
    ? getRelatedChars(displayRadical, char)
    : [];
  const displayRadicalInfo = displayRadical ? getRadicalInfo(displayRadical) : null;

  // Fetch moedict short meanings for chips whose meaning came from the
  // open-data fallback (empty string). Batch API (max 20), cached in a
  // shared Map. Referenced via moedictRev so a state bump re-renders
  // popups once data arrives.
  const fallbackChips = relatedChars
    .slice(0, MAX_CHIPS)
    .filter(c => !c.meaning.trim())
    .map(c => c.char);
  const fallbackChipsKey = fallbackChips.join('');
  useEffect(() => {
    const missing = fallbackChips.filter(c => !moedictMeaningCache.has(c));
    if (missing.length === 0) return;
    let cancelled = false;
    lookupCharactersBatch(missing.slice(0, 20))
      .then(res => {
        if (cancelled) return;
        for (const entry of res.results) {
          const picked = pickFirstRealDef(entry.definitions);
          const shortened = shortenMoedictDef(picked);
          moedictMeaningCache.set(entry.character, shortened || null);
        }
        // Mark any char we asked about but got no reply (defensive)
        for (const c of missing) {
          if (!moedictMeaningCache.has(c)) moedictMeaningCache.set(c, null);
        }
        setMoedictRev(n => n + 1);
      })
      .catch(() => {
        for (const c of missing) moedictMeaningCache.set(c, null);
        if (!cancelled) setMoedictRev(n => n + 1);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fallbackChipsKey]);

  const getRelatedDisplayMeaning = (item: RelatedChar): string => {
    if (item.meaning.trim().length > 0) return item.meaning;
    const cached = moedictMeaningCache.get(item.char);
    if (cached) return cached;
    if (!displayRadicalInfo) return '此字含有相同部件';
    return `此字含「${displayRadical}」，與「${char}」同屬${displayRadicalInfo.role}`;
  };

  const handleRelatedClick = (item: RelatedChar) => {
    setSelectedRelated(prev => (prev?.char === item.char ? null : item));
  };

  const handleRadicalClick = (radical: string) => {
    setActiveRadical(prev => (prev === radical ? null : radical));
    setSelectedRelated(null);
  };

  return (
    <div className="bg-surface rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
      {/* Header */}
      <div className="px-4 py-3 bg-gradient-to-r from-indigo-50 to-purple-50 border-b border-gray-100 flex items-center gap-2">
        <span className="text-base font-bold text-on-surface-variant whitespace-nowrap">部件拆解</span>
        <span className="text-xs text-gray-400 whitespace-nowrap">點擊部件查看相關字</span>
      </div>

      <div className="p-4 space-y-4">
        {/* Decomposition: character → components grid */}
        <div className="flex items-center justify-center gap-3">
          {/* The character itself */}
          <div className="flex flex-col items-center shrink-0">
            <span className="text-3xl font-black text-on-surface leading-none">{char}</span>
            <span className="text-[10px] text-gray-400 mt-1 whitespace-nowrap">目標字</span>
          </div>

          <span className="text-gray-400 text-lg font-light shrink-0">=</span>

          {/* Components — wrap into a grid */}
          <div className="flex flex-wrap items-center gap-1.5 min-w-0">
            {decomp.components.map((comp, idx) => {
              const info = getRadicalInfo(comp.radical);
              const isActive = activeRadical === comp.radical || (!activeRadical && comp.radical === primaryFormRadical);
              return (
                <React.Fragment key={`${comp.radical}-${idx}`}>
                  {idx > 0 && <span className="text-gray-400 text-sm shrink-0">+</span>}
                  <button
                    onClick={() => handleRadicalClick(comp.radical)}
                    className={[
                      'flex flex-col items-center gap-0.5 px-2.5 py-1.5 rounded-xl border transition-all active:scale-95',
                      isActive
                        ? 'bg-indigo-50 border-indigo-300 ring-1 ring-indigo-200'
                        : 'bg-gray-50 border-gray-200 hover:bg-indigo-50 hover:border-indigo-200',
                    ].join(' ')}
                    title={info?.meaning ?? comp.label}
                  >
                    <span className="text-2xl font-bold text-on-surface leading-none">{comp.radical}</span>
                    <span
                      className={`text-[8px] px-1 py-0.5 rounded-full border font-medium whitespace-nowrap ${ROLE_STYLES[comp.role]}`}
                    >
                      {comp.role}
                    </span>
                    <span className="text-[9px] text-gray-500 whitespace-nowrap">{comp.label}</span>
                  </button>
                </React.Fragment>
              );
            })}
          </div>
        </div>

        {/* Active radical detail */}
        {displayRadicalInfo ? (
          <div className="rounded-xl bg-indigo-50 border border-indigo-100 px-4 py-3 space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-lg font-bold text-indigo-800">{displayRadical}</span>
              <span
                className={`text-[9px] px-1.5 py-0.5 rounded-full border font-medium ${ROLE_STYLES[displayRadicalInfo.role]}`}
              >
                {displayRadicalInfo.role} — {ROLE_DESCRIPTIONS[displayRadicalInfo.role]}
              </span>
            </div>
            <p className="text-sm text-indigo-700">{displayRadicalInfo.meaning}</p>
          </div>
        ) : displayRadical && relatedChars.length === 0 ? (
          /* 部件資料庫尚未收錄此部件 — 顯示 fallback 以免點擊無回饋（#1099） */
          <div className="rounded-xl bg-surface-container border border-dashed border-gray-300 px-4 py-3 space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-lg font-bold text-on-surface-variant">{displayRadical}</span>
              <span className="text-[9px] px-1.5 py-0.5 rounded-full border border-gray-200 bg-surface-container-low text-on-surface-variant font-medium">
                部件
              </span>
            </div>
            <p className="text-sm text-gray-600">此部件目前暫無詳細資料</p>
            <p className="text-xs text-gray-400">教學團隊持續補充中</p>
          </div>
        ) : null}

        {/* Related characters */}
        {relatedChars.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-gray-600">含「{displayRadical}」的相關字</span>
              <span className="text-[10px] text-gray-400">（點擊查看意思）</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {relatedChars.slice(0, MAX_CHIPS).map(item => (
                <RelatedCharCard
                  key={item.char}
                  item={item}
                  isSelected={selectedRelated?.char === item.char}
                  onClick={() => handleRelatedClick(item)}
                />
              ))}
            </div>

            {/* Selected character meaning popup */}
            {selectedRelated && (
              <div className="mt-2 px-3 py-2 bg-surface-container-low rounded-xl border border-gray-200 text-sm text-on-surface-variant">
                <span className="font-bold text-on-surface">{selectedRelated.char}</span>
                {' — '}
                {getRelatedDisplayMeaning(selectedRelated)}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Data source label */}
      <p className="text-[10px] text-gray-400 text-right mt-2 mb-3 pr-1">
        {getDecompositionSource(char) === 'hand-curated'
          ? '資料來源：教學團隊手動編寫'
          : '資料來源：makemeahanzi（開源漢字資料庫）'}
      </p>
    </div>
  );
};

export default RadicalDecomposition;
