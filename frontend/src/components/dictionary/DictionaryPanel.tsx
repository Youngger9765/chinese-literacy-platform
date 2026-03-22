/**
 * DictionaryPanel — displays MOE dictionary data for a Chinese character.
 *
 * Shows zhuyin (注音), stroke count, and definitions with examples.
 * Fetches from /api/dictionary/character/{char} and caches results in the
 * component to avoid repeat API calls within the same session.
 *
 * Issue #259: MOE Dictionary API + stroke order database integration
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { lookupCharacter, type DictionaryEntry } from '../../services/learningApi';

interface DictionaryPanelProps {
  /** The Chinese character to look up. Must be a single character. */
  character: string;
  /** Additional CSS classes for the container */
  className?: string;
}

type LoadState = 'idle' | 'loading' | 'success' | 'error' | 'not_found';

// Module-level in-memory cache so re-renders don't re-fetch
const entryCache = new Map<string, DictionaryEntry>();

const DictionaryPanel: React.FC<DictionaryPanelProps> = ({ character, className = '' }) => {
  const [entry, setEntry] = useState<DictionaryEntry | null>(null);
  const [state, setState] = useState<LoadState>('idle');
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async (ch: string) => {
    if (!ch) return;

    // Serve from in-memory cache first
    const cached = entryCache.get(ch);
    if (cached) {
      setEntry(cached);
      setState(cached.not_found ? 'not_found' : 'success');
      return;
    }

    setState('loading');
    setEntry(null);

    // Cancel any pending request for a previous character
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    try {
      const data = await lookupCharacter(ch);
      entryCache.set(ch, data);

      if (data.not_found || data.error === 'dictionary_unavailable') {
        setState(data.not_found ? 'not_found' : 'error');
      } else {
        setEntry(data);
        setState('success');
      }
    } catch {
      setState('error');
    }
  }, []);

  useEffect(() => {
    load(character);
    return () => {
      abortRef.current?.abort();
    };
  }, [character, load]);

  // Loading skeleton
  if (state === 'loading') {
    return (
      <div className={`animate-pulse space-y-2 ${className}`}>
        <div className="h-5 bg-gray-200 rounded w-1/3" />
        <div className="h-4 bg-gray-200 rounded w-2/3" />
        <div className="h-4 bg-gray-200 rounded w-1/2" />
      </div>
    );
  }

  // Character not found in dictionary
  if (state === 'not_found') {
    return (
      <div className={`text-xs text-gray-400 italic ${className}`}>
        字典中查無「{character}」的資料
      </div>
    );
  }

  // API error / unavailable
  if (state === 'error') {
    return (
      <div className={`text-xs text-amber-600 ${className}`}>
        字典暫時無法使用，請稍後再試
      </div>
    );
  }

  // No data yet (idle or waiting for first character)
  if (!entry) return null;

  return (
    <div className={`text-sm space-y-2 ${className}`}>
      {/* Header: character + zhuyin + stroke count */}
      <div className="flex items-baseline gap-3 flex-wrap">
        <span className="text-2xl font-bold text-gray-900 leading-none">{entry.character}</span>

        {entry.zhuyin && (
          <span
            className="text-lg text-indigo-700 font-medium"
            style={{ fontFamily: "'BpmfIansui', 'Iansui', 'Noto Sans TC', sans-serif" }}
          >
            {entry.zhuyin}
          </span>
        )}

        {entry.stroke_count != null && (
          <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
            {entry.stroke_count} 畫
          </span>
        )}
      </div>

      {/* Definitions */}
      {entry.definitions.length > 0 ? (
        <ol className="space-y-2 list-none">
          {entry.definitions.map((def, idx) => (
            <li key={idx} className="flex gap-2">
              {/* Part of speech badge */}
              {def.type && (
                <span className="shrink-0 mt-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 h-fit">
                  {def.type}
                </span>
              )}
              <div className="space-y-1">
                <p className="text-gray-800 leading-relaxed">{def.definition}</p>
                {def.examples.length > 0 && (
                  <ul className="space-y-0.5">
                    {def.examples.map((ex, exIdx) => (
                      <li key={exIdx} className="text-xs text-gray-500 italic">
                        {ex}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-gray-400 text-xs">無詳細釋義</p>
      )}
    </div>
  );
};

export default DictionaryPanel;
