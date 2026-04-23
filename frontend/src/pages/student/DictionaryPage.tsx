/**
 * DictionaryPage — /dictionary
 *
 * Stand-alone dictionary lookup page for students.
 * Supports single-character lookup (via DictionaryPanel) and multi-character
 * input (splits into individual characters and shows result cards in a grid).
 *
 * Backend: GET /api/dictionary/lookup?chars=X or /api/dictionary/character/{c}
 * Auth: JWT required (learningApi reads from localStorage)
 *
 * Issue #1230
 */

import React, { useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import DictionaryPanel from '../../components/dictionary/DictionaryPanel';

// ─── Types ──────────────────────────────────────────────────────────────────

interface SearchState {
  query: string;       // raw input (may be multi-char)
  chars: string[];     // parsed individual CJK characters
}

const MAX_CHARS = 10;

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Extract unique CJK characters from a string, preserve order. */
function extractCJKChars(input: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const ch of input) {
    // CJK Unified Ideographs (U+4E00–U+9FFF) + Extension A/B common range
    if (/\p{Script=Han}/u.test(ch) && !seen.has(ch)) {
      seen.add(ch);
      result.push(ch);
    }
  }
  return result;
}

// ─── Component ──────────────────────────────────────────────────────────────

const DictionaryPage: React.FC = () => {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);

  const [inputValue, setInputValue] = useState('');
  const [search, setSearch] = useState<SearchState | null>(null);

  const handleSearch = useCallback(() => {
    const trimmed = inputValue.trim();
    if (!trimmed) return;
    const chars = extractCJKChars(trimmed);
    if (chars.length === 0) return;
    setSearch({ query: trimmed, chars: chars.slice(0, MAX_CHARS) });
  }, [inputValue]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') handleSearch();
    },
    [handleSearch],
  );

  const handleClear = useCallback(() => {
    setInputValue('');
    setSearch(null);
    inputRef.current?.focus();
  }, []);

  const isSingle = search != null && search.chars.length === 1;
  const isMulti   = search != null && search.chars.length > 1;

  return (
    <div className="flex-1 overflow-y-auto bg-surface">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 pt-6 pb-10 space-y-6">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="
              shrink-0 w-9 h-9 flex items-center justify-center rounded-full
              bg-surface-container-lowest border border-[#E5E0D5]
              text-on-surface-variant hover:text-on-surface
              hover:border-accent/40 hover:shadow-sm
              transition-all duration-150
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1
            "
            aria-label="返回"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold font-headline text-on-surface leading-tight">
              字典查詢
            </h1>
            <p className="text-xs sm:text-sm text-on-surface-variant mt-0.5">
              查字義、注音、例句
            </p>
          </div>
        </div>

        {/* ── Search input ────────────────────────────────────────────────── */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <label htmlFor="dict-search-input" className="sr-only">
              輸入要查詢的字
            </label>
            <input
              id="dict-search-input"
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="輸入要查詢的字，例如：攻擊"
              maxLength={MAX_CHARS + 5}
              className="
                w-full rounded-xl border border-[#E5E0D5] bg-surface-container-lowest
                px-4 py-3 text-base text-on-surface placeholder:text-on-surface-variant/50
                focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent
                transition-shadow duration-150
              "
              aria-label="輸入要查詢的字"
              aria-describedby="dict-search-hint"
            />
            {inputValue && (
              <button
                type="button"
                onClick={handleClear}
                className="
                  absolute right-3 top-1/2 -translate-y-1/2
                  text-on-surface-variant hover:text-on-surface transition-colors
                "
                aria-label="清除輸入"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={handleSearch}
            disabled={!inputValue.trim()}
            className="
              shrink-0 px-5 py-3 rounded-xl
              bg-accent text-white font-semibold text-sm
              hover:opacity-90 active:scale-[0.98]
              disabled:opacity-40 disabled:cursor-not-allowed
              transition-all duration-150
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1
            "
            aria-label="查詢"
          >
            查詢
          </button>
        </div>

        <p
          id="dict-search-hint"
          className="text-xs text-on-surface-variant -mt-4"
        >
          最多可一次查 {MAX_CHARS} 個字
        </p>

        {/* ── Empty state ─────────────────────────────────────────────────── */}
        {search == null && (
          <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
            <span className="text-5xl" aria-hidden="true">📖</span>
            <p className="text-base font-semibold text-on-surface">輸入字，立刻查字義</p>
            <p className="text-sm text-on-surface-variant max-w-xs">
              支援多字查詢：輸入「攻擊」會同時顯示「攻」和「擊」的字典資料
            </p>
          </div>
        )}

        {/* ── No CJK found ────────────────────────────────────────────────── */}
        {search != null && search.chars.length === 0 && (
          <div className="rounded-xl border border-[#E5E0D5] bg-surface-container-lowest p-6 text-center">
            <p className="text-sm text-on-surface-variant">
              「{search.query}」沒有找到中文字，請重新輸入
            </p>
          </div>
        )}

        {/* ── Single character result ──────────────────────────────────────── */}
        {isSingle && (
          <div className="rounded-xl border border-[#E5E0D5] bg-surface-container-lowest p-5">
            <DictionaryPanel character={search!.chars[0]} />
          </div>
        )}

        {/* ── Multi-character results ──────────────────────────────────────── */}
        {isMulti && (
          <div className="space-y-4">
            <p className="text-sm font-semibold text-on-surface">
              找到 {search!.chars.length} 個字
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {search!.chars.map((ch) => (
                <div
                  key={ch}
                  className="rounded-xl border border-[#E5E0D5] bg-surface-container-lowest p-5"
                >
                  <DictionaryPanel character={ch} />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Over-limit notice (if input had > MAX_CHARS CJK) ────────────── */}
        {search != null &&
          extractCJKChars(search.query).length > MAX_CHARS && (
            <p className="text-xs text-on-surface-variant text-center">
              僅顯示前 {MAX_CHARS} 個字的結果
            </p>
          )}

      </div>
    </div>
  );
};

export default DictionaryPage;
