/**
 * ZhuyinContext -- global zhuyin (bopomofo) 3-state segmented-control.
 *
 * THREE display states:
 *   'none'      -- no ruby annotation
 *   'difficult' -- ruby only on chars that appear in vocabulary words (char-level)
 *   'all'       -- ruby on all characters
 *
 * Backward-compat helpers:
 *   zhuyinActive  -- true when triState is 'all' AND processor is ready
 *   isZhuyinAny   -- true when triState is 'difficult' OR 'all' AND ready
 *   isZhuyinAll   -- alias of zhuyinActive
 *   isZhuyinNone  -- true when triState is 'none'
 *   zhuyinEnabled -- true when triState !== 'none' (legacy boolean compat)
 *
 * buildDifficultCharSet(vocabWords):
 *   Extracts the Set of unique individual characters from all vocabulary words.
 *   e.g. ["龍爭虎鬥", "捶胸頓足"] -> Set{"龍","爭","虎","鬥","捶","胸","頓","足"}
 *   Exported for unit testing.
 *
 * processLinesSelective(lines, vocabWords):
 *   - triState='none'      -> null
 *   - triState='all'       -> fully-processed ruby lines
 *   - triState='difficult' -> ruby only on individual chars from vocabulary words
 *                             (empty vocabulary -> null, graceful degrade like 'none')
 *
 * 'difficult' output is wrapped with DIFFICULT_SPAN_START/END sentinel markers
 * around each selected run (#3022). The zhuyin FONT must not be applied to the
 * whole line/container for 'difficult' mode -- it renders bopomofo for every
 * character it draws, so the font (not this text processing) was what leaked
 * annotation onto unselected passage text and onto unrelated interface text
 * sharing the same container. Callers should render this output through
 * components/zhuyin/difficultSpanRenderer.tsx, which strips the markers and
 * applies the zhuyin font only inside them. 'all' mode's output has no
 * markers -- callers keep applying the font at the container level there,
 * since the whole line is meant to be annotated.
 */

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { PolyphonicProcessor, buildZhuyinString } from '../components/zhuyin/polyphonicProcessor';
import { DIFFICULT_SPAN_START, DIFFICULT_SPAN_END } from '../components/zhuyin/bopomoConstants';

export type ZhuyinMode = 'none' | 'difficult' | 'all';

/**
 * Extract the set of individual characters from an array of vocabulary words.
 *
 * In 'difficult' mode we want ruby on every occurrence of a char that belongs
 * to any vocabulary word -- not just where the full word appears.  This gives
 * more coverage: a char like "龍" from "龍爭虎鬥" will be annotated wherever
 * it appears in the story text, even outside that exact phrase.
 *
 * Exported so it can be unit-tested independently of React.
 *
 * @param vocabWords  Array of vocabulary word strings (may include empty strings).
 * @returns           Deduplicated Set of individual Chinese characters.
 */
export function buildDifficultCharSet(vocabWords: string[]): Set<string> {
  const chars = new Set<string>();
  for (const word of vocabWords) {
    for (const ch of word) {
      if (ch.trim()) chars.add(ch);
    }
  }
  return chars;
}

const STORAGE_KEY = 'zhuyin_mode_v2';
const LEGACY_KEY  = 'zhuyin_enabled';

const MODE_CYCLE: ZhuyinMode[] = ['none', 'difficult', 'all'];

function readStoredMode(): ZhuyinMode {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === 'none' || raw === 'difficult' || raw === 'all') return raw;
    // Migrate from old boolean key (preserve returning users' existing choice)
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy === 'true') return 'all';
    if (legacy === 'false') return 'none';
    // Default for first-time visitors: no annotation (cleaner reading surface)
    return 'none';
  } catch {
    return 'none';
  }
}

interface ZhuyinContextValue {
  /** 3-state mode: 'none' | 'difficult' | 'all' */
  zhuyinMode: ZhuyinMode;
  zhuyinReady: boolean;
  /** true when mode='all' AND processor ready */
  zhuyinActive: boolean;
  /** true when mode='difficult' OR 'all' AND processor ready */
  isZhuyinAny: boolean;
  isZhuyinAll: boolean;
  isZhuyinNone: boolean;
  /** @deprecated -- true when mode !== 'none' */
  zhuyinEnabled: boolean;
  setZhuyinMode: (mode: ZhuyinMode) => void;
  /** @deprecated -- use setZhuyinMode */
  setZhuyinEnabled: (enabled: boolean) => void;
  /** Cycle: none -> difficult -> all -> none */
  toggleZhuyin: () => void;
  processZhuyin: (text: string) => string;
  processLines: (lines: string[]) => string[] | null;
  /** 3-state selective processing: respects 'none'/'difficult'/'all' modes */
  processLinesSelective: (lines: string[], vocabWords: string[]) => string[] | null;
}

const ZhuyinContext = createContext<ZhuyinContextValue>({
  zhuyinMode: 'none',
  zhuyinReady: false,
  zhuyinActive: false,
  isZhuyinAny: false,
  isZhuyinAll: false,
  isZhuyinNone: true,
  zhuyinEnabled: false,
  setZhuyinMode: () => {},
  setZhuyinEnabled: () => {},
  toggleZhuyin: () => {},
  processZhuyin: (t) => t,
  processLines: () => null,
  processLinesSelective: () => null,
});

export const ZhuyinProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [zhuyinMode, setZhuyinModeRaw] = useState<ZhuyinMode>(readStoredMode);
  const [zhuyinReady, setZhuyinReady] = useState(() => PolyphonicProcessor.instance.isLoaded);

  const zhuyinActive = zhuyinReady && zhuyinMode === 'all';
  const isZhuyinAny  = zhuyinReady && zhuyinMode !== 'none';
  const isZhuyinAll  = zhuyinActive;
  const isZhuyinNone = zhuyinMode === 'none';
  const zhuyinEnabled = zhuyinMode !== 'none';

  // Load polyphonic data once
  useEffect(() => {
    if (PolyphonicProcessor.instance.isLoaded) {
      setZhuyinReady(true);
      return;
    }
    PolyphonicProcessor.instance.loadPolyphonicData()
      .then(() => setZhuyinReady(true))
      .catch((err) => console.error('Failed to load zhuyin data:', err));
  }, []);

  const setZhuyinMode = useCallback((mode: ZhuyinMode) => {
    setZhuyinModeRaw(mode);
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // Storage full -- ignore
    }
  }, []);

  const setZhuyinEnabled = useCallback((enabled: boolean) => {
    setZhuyinMode(enabled ? 'all' : 'none');
  }, [setZhuyinMode]);

  const toggleZhuyin = useCallback(() => {
    setZhuyinModeRaw((prev) => {
      const idx = MODE_CYCLE.indexOf(prev);
      const next = MODE_CYCLE[(idx + 1) % MODE_CYCLE.length];
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {}
      return next;
    });
  }, []);

  // PRD 指定 Space 切換注音。切換本體早就在（上面那個 none→difficult→all 循環），
  // 但沒有任何地方綁鍵 —— 所以 PRD 那條一直是沒做的（#2787）。
  //
  // ⚠️ Space 同時是「捲頁」與「觸發焦點按鈕」，而造句練習那類步驟有自由輸入框。
  // 沒有下面這幾道防護，學生會打不出空白。
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== ' ' && e.code !== 'Space') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;   // 那些是別的快捷鍵
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        tag === 'BUTTON' ||          // Space 是按鈕的啟用鍵，不可以搶
        el?.isContentEditable
      ) {
        return;
      }
      e.preventDefault();            // 只有真的處理時才擋捲頁
      toggleZhuyin();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [toggleZhuyin]);

  const processZhuyin = useCallback((text: string): string => {
    if (!isZhuyinAny) return text;
    try {
      return buildZhuyinString(PolyphonicProcessor.instance.process(text));
    } catch {
      return text;
    }
  }, [isZhuyinAny]);

  const processLines = useCallback((lines: string[]): string[] | null => {
    if (!isZhuyinAny) return null;
    try {
      return lines.map((line) => buildZhuyinString(PolyphonicProcessor.instance.process(line)));
    } catch {
      return null;
    }
  }, [isZhuyinAny]);

  const processLinesSelective = useCallback(
    (lines: string[], vocabWords: string[]): string[] | null => {
      if (!zhuyinReady || zhuyinMode === 'none') return null;
      if (zhuyinMode === 'all') {
        try {
          return lines.map((line) =>
            buildZhuyinString(PolyphonicProcessor.instance.process(line))
          );
        } catch {
          return null;
        }
      }
      // 'difficult': ruby only on individual chars extracted from vocabulary words.
      //
      // We annotate each occurrence of every character that belongs to any vocab
      // word, regardless of whether the full word appears at that position.
      // e.g. vocab=["龍爭虎鬥"] → difficultChars={"龍","爭","虎","鬥"} →
      //   "有龍在此" → "有[ruby:龍]在此" (only 龍 gets ruby)
      //
      // Contiguous runs of difficult chars are processed as one span so the
      // polyphonic processor has full context across adjacent chars.
      //
      // Lessons with empty vocabulary fall back to null (same as 'none').
      const difficultChars = buildDifficultCharSet(vocabWords);
      if (difficultChars.size === 0) return null;
      try {
        return lines.map((line) => {
          let result = '';
          let plainCursor = 0;
          let inSpan = false;
          let spanStart = 0;

          for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            const isDifficult = difficultChars.has(ch);

            if (isDifficult && !inSpan) {
              // Start a new difficult-char span; emit buffered plain text first
              result += line.slice(plainCursor, i);
              spanStart = i;
              inSpan = true;
            } else if (!isDifficult && inSpan) {
              // Close the span and annotate it. Wrapped in DIFFICULT_SPAN_START/END
              // (#3022) so the renderer can apply the zhuyin FONT to exactly this
              // run -- without the markers, every consumer applied the font at the
              // container level, so the font (not this text processing) annotated
              // the whole line/page regardless of which chars were selected here.
              const span = line.slice(spanStart, i);
              try {
                result += DIFFICULT_SPAN_START + buildZhuyinString(PolyphonicProcessor.instance.process(span)) + DIFFICULT_SPAN_END;
              } catch {
                result += DIFFICULT_SPAN_START + span + DIFFICULT_SPAN_END;
              }
              plainCursor = i;
              inSpan = false;
            }
          }

          // Flush the final span or plain tail
          if (inSpan) {
            const span = line.slice(spanStart);
            try {
              result += DIFFICULT_SPAN_START + buildZhuyinString(PolyphonicProcessor.instance.process(span)) + DIFFICULT_SPAN_END;
            } catch {
              result += DIFFICULT_SPAN_START + span + DIFFICULT_SPAN_END;
            }
          } else {
            result += line.slice(plainCursor);
          }

          return result;
        });
      } catch {
        return null;
      }
    },
    [zhuyinReady, zhuyinMode]
  );

  return (
    <ZhuyinContext.Provider value={{
      zhuyinMode,
      zhuyinReady,
      zhuyinActive,
      isZhuyinAny,
      isZhuyinAll,
      isZhuyinNone,
      zhuyinEnabled,
      setZhuyinMode,
      setZhuyinEnabled,
      toggleZhuyin,
      processZhuyin,
      processLines,
      processLinesSelective,
    }}>
      {children}
    </ZhuyinContext.Provider>
  );
};

export function useZhuyin(): ZhuyinContextValue {
  return useContext(ZhuyinContext);
}
