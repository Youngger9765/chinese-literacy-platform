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
import type { ProcessedChar } from '../components/zhuyin/bopomoConstants';
import { API_BASE } from '../services/apiConfig';
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
  /** #3218：載入這一課的逐字注音對照表；載入後 process 都改成查表 */
  loadLessonZhuyin: (lessonUid: string) => Promise<void>;
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
  loadLessonZhuyin: async () => {},
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

  // ── #3218 逐課注音對照表 ──────────────────────────────────────────────
  //
  // 注音是**課文的一部分**，不是執行期算出來的。離線用多來源產出（字型的合法讀音
  // 集合 → 出貨的 processor → pypinyin 當兩岸分歧偵測器 → 教育部辭典裁決 → 人審），
  // 固化成 `backend/data/lessons/<uid>/v3/zhuyin.json`，前後端讀同一份 ——
  // 前後端不一致（實測 7,682 / 65,754 個破音字位置）因此**不可能存在**。
  //
  // ⚠️ `process()` 留著當 fallback，只服務「表裡沒有的文字」：老師臨時貼的段落、
  //    還沒產表的課。⛔ 不要再往它身上加能力 —— 要改讀音請改表。
  // ⛔ **必須是 state 不是 ref**。用 ref 的話「表到了」不會進到任何 dep 鏈 ——
  //    四個消費端都是 `useMemo(..., [story.content, vocabWords, processLinesSelective])`，
  //    而 `story.content`／`vocabWords` 每課固定、`processLinesSelective` 只在
  //    `zhuyinReady`/`zhuyinMode` 變動時換身分。
  //
  //    2026-09-15 對抗式複審實測的失敗形狀：poyin_db（同源靜態檔、常被快取）先載完
  //    → `zhuyinReady=true` → memo 用**空表**算完 → 之後 `/api/lessons/{uid}/zhuyin`
  //    （跨網域，還要等 story detail 那趟先回）才到 → 寫進 ref → **畫面不動**。
  //    於是第一個有注音的步驟停在 fallback，第二個步驟以後才用表 ——
  //    同一課同一段在不同步驟顯示不同注音，**正是這個 PR 要消滅的東西**。
  const [answers, setAnswers] = useState<Map<string, string[]>>(() => new Map());

  const loadLessonZhuyin = useCallback(async (lessonUid: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/lessons/${encodeURIComponent(lessonUid)}/zhuyin`);
      if (!res.ok) return;   // 404 = 這課還沒產表 → 靜靜走 fallback
      const data = await res.json();
      const m = new Map<string, string[]>();
      for (const t of data.texts ?? []) {
        if (typeof t.text === 'string' && Array.isArray(t.ss)) m.set(t.text, t.ss);
      }
      setAnswers(m);
    } catch {
      // fail-open：拿不到表就走 fallback。漏標只是少一排注音，標錯是教錯讀音
    }
  }, []);

  /**
   * 查表優先，查不到才算。
   *
   * @param text   要標注音的字串（可能是整行，也可能是難字模式的 span）
   * @param line   `text` 所屬的整行（span 的情況才給）
   * @param offset `text` 在 `line` 裡的起始位置
   *
   * ⚠️ 難字模式原本把 span 當獨立字串丟給 processor，所以它看不到 span 以外的上下文。
   *    改成切整行之後上下文變完整（跟整行模式一致）。
   *
   *    2026-09-15 對抗式複審實測 147 課 1,487 段：**1,296 個位置會變**，絕大多數是
   *    改善（一/不變調、為了→ㄨㄟˋ、互相→ㄒㄧㄤ、供應→ㄧㄥˋ、成分→ㄈㄣˋ…），
   *    **但有 4 處變差**，機制都是「整行讓樣式跨過詞界命中」：
   *
   *      時間|接受 → 間 ㄐㄧㄢ→ㄐㄧㄢˋ（當成「間接」）
   *      有著落    → 著 ㄓㄨㄛˊ→ㄓㄜ˙
   *      痛苦難當  → 難 ㄋㄢˊ→ㄋㄢˋ
   *      得意忘形  → 得 ㄉㄜˊ→ㄉㄜ˙
   *
   *    ⛔ 所以不能說「不是 regression」—— 那四處在整行模式本來就錯（那條路徑沒變），
   *    變的是難字模式原本靠「只處理選到的字」意外躲過了它們。
   *    前三處已由 `backend/data/zhuyin/lesson_corrections.json` 在內容層修掉
   *    （教育部辭典為據），第四處在語料裡那一處本來就對。
   */
  const toProcessed = useCallback(
    (text: string, line?: string, offset = 0): ProcessedChar[] => {
      const key = line ?? text;
      const ss = answers.get(key);
      // ⛔ 代理對守衛：表的槽位是按**碼點**產的，而這裡的索引是 UTF-16 單位。
      //    課文實測 0 個非 BMP 字（2026-09-15 掃 1,667 段），但老師貼的字可能有
      //    emoji／擴充 B 漢字 —— 兩者不等就走 fallback，不要拿位移的答案去標。
      if (ss && ss.length === key.length && [...key].length === key.length
          && offset + text.length <= ss.length) {
        const out: ProcessedChar[] = [];
        for (let i = 0; i < text.length; i++) {
          out.push({ char: text[i], styleSet: ss[offset + i] });
        }
        return out;
      }
      return PolyphonicProcessor.instance.process(text);
    },
    // `answers` 必須在 deps 裡 —— 它換身分才會讓下游的 memo 重算（見上面那段註解）
    [answers],
  );

  const processZhuyin = useCallback((text: string): string => {
    if (!isZhuyinAny) return text;
    try {
      return buildZhuyinString(toProcessed(text));
    } catch {
      return text;
    }
  }, [isZhuyinAny, toProcessed]);

  const processLines = useCallback((lines: string[]): string[] | null => {
    if (!isZhuyinAny) return null;
    try {
      return lines.map((line) => buildZhuyinString(toProcessed(line)));
    } catch {
      return null;
    }
  }, [isZhuyinAny, toProcessed]);

  const processLinesSelective = useCallback(
    (lines: string[], vocabWords: string[]): string[] | null => {
      if (!zhuyinReady || zhuyinMode === 'none') return null;
      if (zhuyinMode === 'all') {
        try {
          return lines.map((line) => buildZhuyinString(toProcessed(line)));
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
                result += DIFFICULT_SPAN_START + buildZhuyinString(toProcessed(span, line, spanStart)) + DIFFICULT_SPAN_END;
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
              result += DIFFICULT_SPAN_START + buildZhuyinString(toProcessed(span, line, spanStart)) + DIFFICULT_SPAN_END;
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
    [zhuyinReady, zhuyinMode, toProcessed]
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
      loadLessonZhuyin,
    }}>
      {children}
    </ZhuyinContext.Provider>
  );
};

export function useZhuyin(): ZhuyinContextValue {
  return useContext(ZhuyinContext);
}
