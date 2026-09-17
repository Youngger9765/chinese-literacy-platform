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

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
// ⛔ 只拿 `buildZhuyinString`（把槽位轉成 IVS 變體選擇器）。
//    `PolyphonicProcessor`（執行期讀音選擇器）在 #3237 從執行期路徑移除 ——
//    它現在只服務產表的 oracle `frontend/scripts/zhuyinAnswers.ts`。
import { buildZhuyinString } from '../components/zhuyin/polyphonicProcessor';
import type { ProcessedChar } from '../components/zhuyin/bopomoConstants';
import { API_BASE } from '../services/apiConfig';
import { AuthContext } from '../contexts/AuthContext';
import { DIFFICULT_SPAN_START, DIFFICULT_SPAN_END } from '../components/zhuyin/bopomoConstants';

/**
 * 解開後端表的緊湊槽位字串（#3230）。
 *
 * ⛔ 這個編碼有三份同語意的實作 —— 產生器 `_pack_slots`、後端 `unpack_slots`、
 *    這裡。改編碼要三處一起改，`test_served_text_all_in_table_3230` 會抓到不一致。
 */
export function unpackSlots(z: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < z.length; i++) {
    const c = z[i];
    out.push(c === '.' ? '0000' : `ss0${c}`);
  }
  return out;
}

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

/** 難字是從哪一層來的（#3257）。順序就是 `resolveDifficultSource` 的優先序。 */
export type DifficultSource = 'errors' | 'grade' | 'vocab';

/** 一個唸錯過的字，連同它的次數與最後一次的日期（#3257） */
export interface DifficultErrorDetail {
  char: string;
  count: number;
  /** ISO 字串；端點可能沒給 */
  lastDate: string | null;
}

/**
 * 難字模式要標哪些字 —— **三層優先序的唯一實作**（#3257）。
 *
 * ⛔ 這支之前是 `processLinesSelective` 裡的一行三元運算式。抽出來的理由不是
 *    整潔，是**畫面要能說出現在生效的是哪一層**，而那件事若在 UI 自己再判一次，
 *    就變成同一條規則有兩份實作 —— 這個 repo 已經因為「同語意兩份實作」付過
 *    很貴的代價（#3218：執行期選擇器與逐課表對同一段課文給不同答案，
 *    實測 7,682 / 65,754 個破音字位置不一致）。
 *
 *    所以規則住這裡，兩個消費端都叫它：
 *      ① `processLinesSelective` —— 傳真的生詞清單，拿 `chars` 去標
 *      ② `difficultExplain`（給說明面板）—— 傳空清單，只拿 `source`
 *    傳空清單時 `source` 完全不變（它不看生詞多寡，只看前兩層是不是空的），
 *    所以兩邊報的層級**不可能**分岔。
 *
 * 三層的意義差很多，順序不能換：
 *   errors — 這個孩子自己唸錯過的字（#3224）。讀者的屬性，最準
 *   grade  — 這一課對這個年級最少見的字（#3247）。教材的屬性
 *   vocab  — 本課生詞拆成單字。**只服務還沒回 `hard` 的舊後端**（部署順序保險），
 *            它會標出「之 加 千 同 大 失 小 手 成」那種早就會的字
 */
export function resolveDifficultSource(
  errorChars: Set<string>,
  hardChars: Set<string>,
  vocabWords: string[],
): { source: DifficultSource; chars: Set<string> } {
  if (errorChars.size > 0) return { source: 'errors', chars: errorChars };
  if (hardChars.size > 0) return { source: 'grade', chars: hardChars };
  return { source: 'vocab', chars: buildDifficultCharSet(vocabWords) };
}

/**
 * 說明面板要講的內容（#3257）。
 *
 * ⚠️ `chars` 在 `source === 'vocab'` 時是空陣列 —— 生詞清單是由消費端逐次傳進
 *    `processLinesSelective` 的，provider 沒有它。面板在那一層改成只講規則不列字，
 *    這是誠實的降級，不是 bug。
 */
export interface DifficultExplain {
  source: DifficultSource;
  /** 生效那一層要標的字（已排序）。`source === 'vocab'` 時為空 —— 見上面 */
  chars: string[];
  /** 只有 `source === 'errors'` 時有內容，按錯的次數多寡排 */
  errors: DifficultErrorDetail[];
  /** 這一課的表載到了沒 —— 用來分辨「舊後端沒回 hard」跟「還沒進到課文頁」 */
  lessonLoaded: boolean;
}

/** 沒有課表時的空值 —— 用同一個實例，否則每次 render 都換身分、memo 白重算 */
const _EMPTY_ANSWERS: Map<string, string[]> = new Map();
const _EMPTY_HARD: Set<string> = new Set();

const STORAGE_KEY = 'zhuyin_mode_v2';
const LEGACY_KEY  = 'zhuyin_enabled';

/** 難字門檻的儲存 key（#3240）。跟 mode 分開存，這樣清掉一個不會連坐。 */
const THRESHOLD_KEY = 'zhuyin_difficult_threshold_v1';
export const THRESHOLD_MIN = 1;
export const THRESHOLD_MAX = 5;

function readStoredThreshold(): number {
  try {
    const n = Number(localStorage.getItem(THRESHOLD_KEY));
    if (Number.isInteger(n) && n >= THRESHOLD_MIN && n <= THRESHOLD_MAX) return n;
  } catch {
    // 私密視窗／關掉 site data —— 用預設，不要炸掉整個 Provider
  }
  return 1;   // #3224 的預設：才剛唸完，錯一次就是真的卡點
}

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
  /** 難字門檻：錯幾次算「還不會」（#3240，1–5） */
  difficultThreshold: number;
  setDifficultThreshold: (n: number) => void;
  /** 說明面板要講的內容：現在生效哪一層、標了哪些字、錯幾次（#3257） */
  difficultExplain: DifficultExplain;
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
  difficultThreshold: 1,
  setDifficultThreshold: () => {},
  // 沒有 Provider 時的空說明 —— `ZhuyinToggle` 有測試不包 Provider 直接 render，
  // 面板讀到這個就不會顯示任何一層的字（它自己會判斷空的情況）
  difficultExplain: { source: 'vocab', chars: [], errors: [], lessonLoaded: false },
  processLinesSelective: () => null,
  loadLessonZhuyin: async () => {},
});

export const ZhuyinProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [zhuyinMode, setZhuyinModeRaw] = useState<ZhuyinMode>(readStoredMode);
  // ── #3240 難字門檻：錯幾次算「還不會」──────────────────────────────────
  //
  // #3224 把難字改成「這孩子唸錯過的字」，門檻寫死 1 次。1 對「才剛開始唸」的孩子
  // 是對的，但唸久了錯字會累積 —— 那時 2 次或 3 次才是「真的還不會」。
  // 調它的人就是在裝置前面的人（同一個翻注音開關的人），所以跟 mode 一樣存 localStorage。
  //
  // ⛔ 不做成老師端的班級設定：那要 DB 欄位 + 後台介面，而這是「當下看得舒服」的
  //    偏好，不是教學決定。做成班級設定反而讓家長在家裡調不動。
  const [difficultThreshold, setDifficultThresholdRaw] = useState<number>(readStoredThreshold);

  // #3237：執行期不再需要 `poyin_db.json`（188 KB）。
  //
  // 以前這個旗標等的是「破音字資料載好了嗎」—— 因為讀音是執行期算的。
  // 現在讀音來自逐課對照表，這裡不需要等任何東西：注音的形狀由字型的 IVS 變體畫，
  // 字型是 CSS 載的、不經過 JS。
  //
  // ⛔ 不可以直接拿掉這個旗標（它在 context 的型別裡、有 5 個地方在讀）——
  //    改成恆真，語意變成「注音功能可用」。表還沒載完時 `toProcessed()` 會回
  //    字型預設讀音（見那裡的說明），不是空白。
  const [zhuyinReady] = useState(true);

  const zhuyinActive = zhuyinReady && zhuyinMode === 'all';
  const isZhuyinAny  = zhuyinReady && zhuyinMode !== 'none';
  const isZhuyinAll  = zhuyinActive;
  const isZhuyinNone = zhuyinMode === 'none';
  const zhuyinEnabled = zhuyinMode !== 'none';

  const setDifficultThreshold = useCallback((n: number) => {
    const clamped = Math.min(THRESHOLD_MAX, Math.max(THRESHOLD_MIN, Math.round(n)));
    setDifficultThresholdRaw(clamped);
    try {
      localStorage.setItem(THRESHOLD_KEY, String(clamped));
    } catch {
      // 存不進去就只在這個 session 有效 —— 不要因此不讓他調
    }
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

  // ── #3224 難字 = 這個孩子唸錯過的字，不是本課生詞拆成的單字 ────────────
  //
  // 家長實測（2026-09-16）：三段鷹架的第二段要**收斂到孩子的卡點**，而原本的難字
  // 集合是 `buildDifficultCharSet(story.vocabulary)` —— 取本課生詞拆成單字。於是
  //
  //   「人」來自「寒氣逼人」·「水」「石」來自「滴水穿石」→ 早就會了卻每次都標
  //   「臼」「匪」「筋」不在生詞清單裡              → 一個都不標
  //
  // 它不是判錯難度，是**沒有在判難度**：生詞是課程的屬性，難字是讀者的屬性。
  //
  // 平台已經在收正確的那份資料（`character_errors`，每次朗讀落地一次），所以這是
  // 接線不是建表。門檻用 `min_errors=1` —— 她才剛唸完，錯一次就是真的卡點
  // （端點的全域預設是 2，那對只唸過幾次的孩子會幾乎是空的）。
  //
  // ⚠️ 用 `useContext(AuthContext)` 而不是 `useAuth()`：後者沒有 Provider 會 throw，
  //    而有 12 個測試檔 render 真的 ZhuyinProvider 卻沒包 auth。沒登入就是 null，
  //    自然退回生詞清單。
  const auth = useContext(AuthContext);
  // #3257：改存 Map 不是 Set —— 端點本來就回 `total_error_count` 與 `last_error_date`，
  // 而之前只撈 `character` 就把它們丟掉了。說明面板要講「這個字你 8/24 唸錯過 2 次」，
  // 那句話的資料一直都在，只是沒留下來。
  const [errorDetails, setErrorDetails] = useState<Map<string, DifficultErrorDetail>>(
    () => new Map(),
  );
  // ⛔ 必須 memo。`processLinesSelective` 的 dep 是這個 Set —— 每次 render 現做一個
  //    新 Set 會讓它每次都換身分，於是四個消費端的 memo 全部每次重算（那是
  //    整頁課文重跑一遍注音）。綁在 `errorDetails` 的身分上才穩。
  const errorChars = React.useMemo(() => new Set(errorDetails.keys()), [errorDetails]);
  // 同一段只叫一次 —— alert 洗版比沒有 alert 更糟（#3166）
  const warnedMissRef = useRef<Set<string>>(new Set());

  const studentId = auth?.user?.id;
  const authToken = auth?.token;
  useEffect(() => {
    if (!authToken || studentId === undefined) return;
    let alive = true;
    void (async () => {
      try {
        const res = await fetch(
          `${API_BASE}/api/learning/students/${studentId}/error-patterns`
            + `?min_errors=${difficultThreshold}`,
          { headers: { Authorization: `Bearer ${authToken}` } },
        );
        if (!res.ok) return; // fail-open：拿不到就退回生詞，不要整段不標
        const data = await res.json();
        if (!alive) return;
        const m = new Map<string, DifficultErrorDetail>();
        for (const p of data.patterns ?? []) {
          if (typeof p?.character === 'string' && p.character.trim() && !p.is_corrected) {
            m.set(p.character, {
              char: p.character,
              // 端點的欄位是 `total_error_count` / `last_error_date`（#3257 開始用到）。
              // 型別守衛是因為這是跨網域 JSON —— 舊後端沒有這兩個欄位時要降級成
              // 「有這個字但不知道幾次」，不是整筆丟掉。
              count: typeof p.total_error_count === 'number' ? p.total_error_count : 0,
              lastDate: typeof p.last_error_date === 'string' ? p.last_error_date : null,
            });
          }
        }
        setErrorDetails(m);
      } catch {
        // fail-open，同上
      }
    })();
    return () => { alive = false; };
  }, [authToken, studentId, difficultThreshold]);

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
  // ⛔ 注音表跟難字**綁在同一個 state**，不是兩個（2026-09-17 複審擋下的上一版是
  //    兩個）。理由是它們的失效方式不對稱：`answers` 用整行文字當 key，過期的表
  //    對不到新課的文字 → 自然掉到 fallback，壞法是「少一排注音」；難字是**沒有 key
  //    的裸 Set**，過期的集合會直接套到當下渲染的任何文字上 → 壞法是**標錯字**，
  //    而這個檔自己的註解就寫著「漏標只是少一排注音，標錯是教錯讀音」。
  //
  //    綁成一個之後：一個身分 → 一個 dep（沒有東西可以漏掉，而遺漏 dep 這件事
  //    只有 lint 的 warn 擋得到）；取得失敗就是「沒有表」而不是「上一課的表」。
  const [lessonTable, setLessonTable] = useState<{
    uid: string;
    answers: Map<string, string[]>;
    hard: Set<string>;
  } | null>(null);
  const answers = lessonTable?.answers ?? _EMPTY_ANSWERS;
  const hardChars = lessonTable?.hard ?? _EMPTY_HARD;

  const loadLessonZhuyin = useCallback(async (lessonUid: string) => {
    // 先清掉上一課 —— 任何失敗路徑都不可以留著別課的難字（見上面的註解）
    setLessonTable((prev) => (prev && prev.uid === lessonUid ? prev : null));
    try {
      const res = await fetch(`${API_BASE}/api/lessons/${encodeURIComponent(lessonUid)}/zhuyin`);
      if (!res.ok) return;   // 404 = 這課還沒產表 → 靜靜走 fallback
      const data = await res.json();
      const m = new Map<string, string[]>();
      for (const t of data.texts ?? []) {
        // `ssz` = 一槽一個字元的緊湊字串（#3230）：'.' = 預設槽、'1'..'5' = ss01..ss05。
        // 全庫 96.9% 的槽位是預設，存成 JSON 陣列是 53 MB、壓成字串是 8.3 MB。
        // ⛔ 位置語意不變：第 i 個字元 == 第 i 個 **UTF-16 單位**，跟下面 `text[i]` 一致。
        if (typeof t.text === 'string' && typeof t.ssz === 'string') {
          m.set(t.text, unpackSlots(t.ssz));
        }
      }
      // `hard` = 這一課對這個年級的難字（#3247）。舊後端沒有這個欄位 → 空集合，
      // 讓消費端退回生詞，部署順序（前端先上、後端還沒）不會讓第二段鷹架消失。
      setLessonTable({
        uid: lessonUid,
        answers: m,
        hard: new Set(typeof data.hard === 'string' ? data.hard : ''),
      });
    } catch {
      // fail-open：拿不到表就走 fallback。漏標只是少一排注音，標錯是教錯讀音
    }
  }, []);

  /**
   * 說明面板的內容（#3257）—— 難字模式的判定法對使用者一直是隱形的。
   *
   * 那個資訊落差本身就是誤判的來源，而且已經害過一次：#3247 的起點是家長在四年級
   * 課文上看到標了「之 加 千 同 大 失 小 手 成」，判定判定法壞了。實際上那是走到
   * 第三層（生詞拆字）的正常結果 —— 規則如果講清楚，那次誤判不會發生。
   *
   * ⛔ `source` 由 `resolveDifficultSource` 給，不在這裡重判。傳空的生詞清單是刻意的：
   *    provider 沒有生詞（它逐次由消費端傳進 `processLinesSelective`），而 `source`
   *    不看生詞多寡，只看前兩層是不是空的 —— 所以空清單不影響層級判定。
   */
  const difficultExplain = React.useMemo<DifficultExplain>(() => {
    const { source, chars } = resolveDifficultSource(errorChars, hardChars, []);
    return {
      source,
      chars: [...chars].sort(),
      errors:
        source === 'errors'
          ? [...errorDetails.values()].sort(
              // 錯最多次的排前面；同次數按字排，否則順序會隨 Map 的插入序飄
              (a, b) => b.count - a.count || a.char.localeCompare(b.char),
            )
          : [],
      lessonLoaded: lessonTable !== null,
    };
  }, [errorChars, hardChars, errorDetails, lessonTable]);

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
      // ⛔ 對齊守衛：表的槽位與這裡的索引**都是 UTF-16 單位**（#3230 起）。
      //    以前表是按碼點產的，所以這裡還要多一條 `[...key].length === key.length`
      //    把含非 BMP 字的字串整串排除 —— 課名〈𪹚龍慶元宵〉(U+2AE5A) 因此永遠
      //    拿不到表、只能掉回舊選擇器。現在兩邊同一種索引，那條排除不需要了。
      if (ss && ss.length === key.length && offset + text.length <= ss.length) {
        const out: ProcessedChar[] = [];
        for (let i = 0; i < text.length; i++) {
          out.push({ char: text[i], styleSet: ss[offset + i] });
        }
        return out;
      }
      // 表載入了卻對不到 —— #3230 之後這在課文內容上**不該發生**
      // （服務端 45,606 個中文字串 100% 在表裡，`test_served_text_all_in_table_3230` 鎖住）。
      // 會走到這裡的只有兩種：表還沒載完，或這段字不是課文（老師臨時打的）。
      // 叫一聲是為了讓「靜默掉回另一套引擎」變得看得見 —— 那正是 #3218 之前
      // 前後端對同一段課文給不同答案的來源。
      if (answers.size > 0 && !warnedMissRef.current.has(key)) {
        warnedMissRef.current.add(key);
        // eslint-disable-next-line no-console
        console.warn('[zhuyin] 表裡沒有這段字，用字型預設讀音：', key.slice(0, 40));
      }
      // ⛔ 這裡**不再跑執行期選擇器**（#3237）。
      //
      // 以前是 `PolyphonicProcessor.instance.process(text)` —— 那是第二套讀音來源，
      // 跟表對同一段課文會給不同答案（#3218 量到全庫 7,682 / 65,754 個破音字位置不一致）。
      // #3230 之後服務端會交給前端的 45,606 個中文字串 100% 在表裡，所以課文永遠走上面
      // 那條；會走到這裡的只剩「老師臨時貼的字」與表還沒載完的瞬間。
      //
      // 那兩種情況給**字型預設讀音**（`0000` 就是字型的預設槽）—— 這是**查表**不是選擇：
      // 單音字（字型收了 11,050 個）本來就唯一，破音字給預設音。
      // 破音字在老師貼的字裡可能不準，但「不準」跟「另一套引擎給出跟表不同的答案」
      // 是兩件事 —— 後者才是 #3202/#3204/#3215 三張票疊出四層的來源。
      //
      // ⚠️ `polyphonicProcessor.ts` 這個檔還留著，因為 ① `buildZhuyinString`（IVS 渲染）
      // 住在裡面 ② 產表的 oracle `frontend/scripts/zhuyinAnswers.ts` 要 import 它。
      // 它從執行期路徑變成**產表工具**，那正是它該在的位置。
      const out: ProcessedChar[] = [];
      for (let i = 0; i < text.length; i++) {
        out.push({ char: text[i], styleSet: '0000' });
      }
      return out;
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
      // #3224：她唸錯過的字優先；沒有紀錄（第一次唸這課／新學生／沒登入）才退回生詞，
      // 否則第二段鷹架會整片空白。
      // #3247：沒有她的錯字紀錄時，用後端按**年級字頻**算好的難字，而不是本課生詞
      //   拆成的單字。生詞是課程的屬性、難字是讀者的屬性 —— 拿生詞當難字會標出
      //   「之 加 千 同 大 失 小 手 成」（家長 2026-09-17 實測），生詞 0 的課則整個靜音。
      // ⛔ 三段的順序不能換：她的錯字 > 這課的難字 > 生詞（最後那層只服務舊後端）。
      // #3257：優先序搬進 `resolveDifficultSource` —— 說明面板要報「現在是哪一層」，
      // 而那不可以是第二份實作。這裡跟面板叫的是同一支。
      const { chars: difficultChars } = resolveDifficultSource(errorChars, hardChars, vocabWords);
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
    [zhuyinReady, zhuyinMode, toProcessed, errorChars, hardChars]
  );

  return (
    <ZhuyinContext.Provider value={{
      zhuyinMode,
      zhuyinReady,
      difficultThreshold,
      setDifficultThreshold,
      difficultExplain,
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
