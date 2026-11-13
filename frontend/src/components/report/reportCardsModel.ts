/**
 * reportCardsModel.ts — 報告頁「關卡完成卡片」的純邏輯（#3399）
 *
 * Mentor 回饋：報告頁不需要複雜的 AI 診斷，學生只要一眼看出哪些關卡做完了，
 * 想看細節再點進去。這支把 DB 存的 `step_progress`（steps_completed + step_data）
 * 轉成每一關一張卡片要顯示的東西。
 *
 * ⛔ 沒有副作用：不 fetch、不讀 localStorage。讀全文-做記號的記號存在另一張表
 * （annotation_entries），由呼叫端載入後傳進來。
 *
 * 各關 step_data 的形狀見 `types/stepProgress.ts` 與各頁的 saveStepProgressPatch；
 * 已知的分數讀法跟 `practiceStepsSummary.ts`（#2835）一致。
 */
import { resolveStepId, type StepConfig } from '../../config/stepConfig';
import { stripPUASelectors } from '../reading-steps/annotationOffsets';
import type { AnnotationRecord } from '../../services/learning/annotationApi';

export type AnnotationKind = 'unknown' | 'important';

export interface MarkedWord {
  type: AnnotationKind;
  text: string;
  paragraphIndex: number;
}

/** 一題的作答對照（你的答案 vs 正確答案）。`correct` 一律是「第一次就答對」。 */
export interface AnswerRow {
  label: string;
  correct: boolean;
  /** 題目本身（例如詞語的解釋），有的話顯示在標號下面。 */
  prompt?: string | null;
  studentAnswer?: string | null;
  correctAnswer?: string | null;
  /**
   * 第一次答錯之後，後來有沒有改對（#4028）。true = 已訂正、false = 還沒訂正、
   * null/undefined = 這一關沒有記下（不顯示）。
   */
  corrected?: boolean | null;
}

/** 詞語理解用的詞語表（story.vocabulary 的形狀）。 */
export interface VocabWord {
  word: string;
  definition?: string;
}

/** 卡片點開後的細節區塊。 */
export type DetailBlock =
  | { kind: 'stats'; items: { label: string; value: string }[] }
  | { kind: 'answers'; title: string; rows: AnswerRow[] }
  | { kind: 'marks'; marks: MarkedWord[] }
  | { kind: 'words'; title: string; words: string[] }
  | { kind: 'note'; text: string };

/**
 * 這一關的完成狀態（#4028）。
 * - `this`：這一次（這個 session）完成的
 * - `previous`：上一次做過、這一次還沒做 —— #2889 把上次的進度帶過來，
 *   但不能跟這次做的混在一起算
 * - `none`：沒完成
 */
export type CardStatus = 'this' | 'previous' | 'none';

export interface StepReportCard {
  /** 完整 step id（多篇課帶 `#slug`），用來組網址。 */
  stepId: string;
  baseId: string;
  label: string;
  icon: string;
  /** 這一次完成的才是 true（#4028）。上次做過、這次沒做的是 false，看 status。 */
  completed: boolean;
  status: CardStatus;
  /** status === 'previous' 時，上一次的時間（ISO），沒有就是 null。 */
  previousAt: string | null;
  /** 卡片上的一行摘要，例如「答對 7/8 題」「做了 5 個記號」。 */
  summary: string | null;
  details: DetailBlock[];
}

/** 每一關的圖示（Material Symbols）。沒列到的用預設。 */
const STEP_ICONS: Record<string, string> = {
  'lesson-intro': 'menu_book',
  'full-text-annotate': 'edit_note',
  'key-passage-reading': 'record_voice_over',
  'paragraph-reading': 'record_voice_over',
  'vocab-definition': 'join_inner',
  'vocab-application': 'edit',
  spotlight: 'highlight',
  'keypoints-table': 'table_chart',
  comprehension: 'quiz',
  'vocab-review': 'search',
  'knowledge-station': 'lightbulb',
  'classical-text': 'history_edu',
  'classical-sentence-matching': 'compare_arrows',
  'classical-word-matching': 'compare_arrows',
  'classical-self-challenge': 'emoji_events',
};

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null;
}

const correctOf = (n: number, total: number) => `答對 ${n}/${total} 題`;

/**
 * 把 step_data / steps_completed 的 key 正規化成現行 step id。
 * 舊 key（`reading-annotation`、`reading-strategy`…）走 LEGACY_STEP_ID_ALIASES；
 * 多篇課的 `#slug` 後綴保留。
 */
export function normalizeStepKey(key: string): string {
  const i = key.indexOf('#');
  if (i < 0) return resolveStepId(key);
  return `${resolveStepId(key.slice(0, i))}${key.slice(i)}`;
}

/** 把 step_data 的 key 正規化；新舊 key 都有時淺合併（新 key 優先）。 */
export function normalizeStepData(stepData: Record<string, unknown> | null | undefined): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  if (!stepData) return out;
  // 先放舊 key、再放新 key，讓現行 id 的值覆蓋舊值
  const entries = Object.entries(stepData).sort(([a], [b]) => {
    const aLegacy = normalizeStepKey(a) !== a ? 0 : 1;
    const bLegacy = normalizeStepKey(b) !== b ? 0 : 1;
    return aLegacy - bLegacy;
  });
  for (const [k, v] of entries) {
    if (!isObj(v)) continue;
    const nk = normalizeStepKey(k);
    out[nk] = { ...(out[nk] ?? {}), ...v };
  }
  return out;
}

/** 記號 → 被標記的文字。offset 是去掉 PUA 選字符之後的位置（#2165）。 */
export function marksFromAnnotations(
  annotations: AnnotationRecord[] | null | undefined,
  paragraphs: string[] | null | undefined,
): MarkedWord[] {
  if (!annotations?.length) return [];
  const paras = paragraphs ?? [];
  return [...annotations]
    .sort((a, b) =>
      a.paragraph_index !== b.paragraph_index
        ? a.paragraph_index - b.paragraph_index
        : a.char_start - b.char_start,
    )
    .map((a) => ({
      type: a.annotation_type,
      paragraphIndex: a.paragraph_index,
      text: stripPUASelectors(paras[a.paragraph_index] ?? '').slice(a.char_start, a.char_end),
    }))
    .filter((m) => m.text.length > 0);
}

// ── 各關的摘要與細節 ─────────────────────────────────────────────────────────

interface BuildCtx {
  data: Record<string, unknown>;
  completed: boolean;
  /** null = 載入中；undefined = 這一關沒有記號可顯示（多篇課的第 2 篇之後）。 */
  marks: MarkedWord[] | null | undefined;
  /** 這一關（這一輪）的詞語表；拿不到時是 undefined，細節就只列對錯不列詞語。 */
  vocabulary?: VocabWord[];
}

/**
 * 詞語理解的一個模式（選擇題 / 拖拉配對）→ 每題的作答列（#4028）。
 * 跟關卡頁的錯題回顧同一套讀法（VocabDefinitionMatch.StageCompletedPlaceholder）：
 * 對錯看 firstTryCorrect（只寫一次），學生選的看 firstTryAnsweredWordIdx ——
 * answeredWordIdx 是「最後一次」，重做之後一定是對的。
 */
function vocabMatchRows(list: unknown, vocab: VocabWord[] | undefined, prefix: string): AnswerRow[] {
  if (!Array.isArray(list)) return [];
  return list.filter(isObj).map((a, i) => {
    const defIndex = num(a.defIndex);
    const item = defIndex !== null ? vocab?.[defIndex] : undefined;
    const firstOk = (a.firstTryCorrect ?? a.correct) === true;
    const pickIdx = num(a.firstTryAnsweredWordIdx) ?? num(a.answeredWordIdx);
    return {
      label: `${prefix}第 ${i + 1} 題`,
      correct: firstOk,
      prompt: item?.definition ?? null,
      studentAnswer: !firstOk && pickIdx !== null ? vocab?.[pickIdx]?.word ?? null : null,
      correctAnswer: item?.word ?? null,
      corrected: firstOk ? null : a.correct === true,
    };
  });
}

type Builder = (ctx: BuildCtx) => { summary: string | null; details: DetailBlock[] };

function firstTryRows(list: unknown, prefix = '第'): AnswerRow[] {
  if (!Array.isArray(list)) return [];
  return list.filter(isObj).map((r, i) => ({
    label: `${prefix} ${i + 1} 題`,
    correct: r.firstTryCorrect === true,
    studentAnswer: str(r.studentFirstAnswer),
    correctAnswer: str(r.correctAnswer),
  }));
}

const BUILDERS: Record<string, Builder> = {
  'full-text-annotate': ({ marks }) => {
    if (marks === undefined) return { summary: null, details: [] };
    if (marks === null) return { summary: null, details: [{ kind: 'note', text: '記號載入中…' }] };
    const unknown = marks.filter((m) => m.type === 'unknown').length;
    const important = marks.length - unknown;
    return {
      summary: marks.length ? `做了 ${marks.length} 個記號` : '還沒有做記號',
      details: [
        {
          kind: 'stats',
          items: [
            { label: '❓ 不懂', value: `${unknown} 個` },
            { label: '💛 重要', value: `${important} 個` },
          ],
        },
        marks.length ? { kind: 'marks', marks } : { kind: 'note', text: '這一課還沒有標記任何詞語。' },
      ],
    };
  },

  'key-passage-reading': ({ data }) => {
    const result = isObj(data.result) ? data.result : {};
    const cpm = num(result.cpm);
    const rate = num(result.matchRate) ?? num(result.accuracy);
    const pct = rate === null ? null : Math.round(rate <= 1 ? rate * 100 : rate);
    const selfRating = num(data.self_rating);
    const items: { label: string; value: string }[] = [];
    if (cpm !== null) items.push({ label: '每分鐘字數', value: `${Math.round(cpm)} 字` });
    if (pct !== null) items.push({ label: '正確率', value: `${pct}%` });
    if (selfRating !== null) items.push({ label: '自我評分', value: '★'.repeat(selfRating) + '☆'.repeat(Math.max(0, 5 - selfRating)) });
    return {
      summary: cpm !== null ? `每分鐘 ${Math.round(cpm)} 字` : null,
      details: items.length ? [{ kind: 'stats', items }] : [{ kind: 'note', text: '沒有朗讀紀錄。' }],
    };
  },

  'vocab-definition': ({ data, vocabulary }) => {
    // #4028：以前讀 result.matchedCount —— 那是「訂正完」的數字，重做錯題之後永遠是
    // 全對（本機實測：第一次錯了一半，報告寫「答對 22/22」）。改用每題的第一次作答。
    const mc = vocabMatchRows(data.mcAnswers, vocabulary, '選擇題 ');
    const dd = vocabMatchRows(data.dragDropAnswers, vocabulary, '配對 ');
    const rows = [...mc, ...dd];
    if (!rows.length) {
      // 舊資料只有 result：照舊顯示，但標明那是訂正後的結果。
      const r = isObj(data.result) ? data.result : {};
      const n = num(r.matchedCount);
      const t = num(r.totalCount);
      if (n === null || t === null) return { summary: null, details: [] };
      return {
        summary: correctOf(n, t),
        details: [{ kind: 'stats', items: [{ label: '答對（含訂正）', value: `${n} / ${t} 題` }] }],
      };
    }
    const first = rows.filter((r) => r.correct).length;
    const wrong = rows.length - first;
    const fixed = rows.filter((r) => r.corrected === true).length;
    const details: DetailBlock[] = [
      {
        kind: 'stats',
        items: [
          { label: '第一次就答對', value: `${first} / ${rows.length} 題` },
          { label: '答錯後訂正', value: `${fixed} / ${wrong} 題` },
        ],
      },
    ];
    if (mc.length) details.push({ kind: 'answers', title: '選擇題', rows: mc });
    if (dd.length) details.push({ kind: 'answers', title: '拖拉配對', rows: dd });
    return { summary: correctOf(first, rows.length), details };
  },

  'vocab-application': ({ data }) => {
    const n = num(data.score);
    const t = num(data.total);
    const rows = firstTryRows(data.firstTryResults);
    const details: DetailBlock[] = [];
    if (n !== null && t !== null) details.push({ kind: 'stats', items: [{ label: '第一次就答對', value: `${n} / ${t} 題` }] });
    if (rows.length) details.push({ kind: 'answers', title: '作答紀錄', rows });
    return { summary: n !== null && t !== null ? correctOf(n, t) : null, details };
  },

  spotlight: ({ data }) => {
    // 沒有分數欄位；有對錯回饋的題目才算進來（lesson_v1 / spotlight_v2 都寫 feedback）。
    const fb = isObj(data.feedback) ? Object.values(data.feedback) : [];
    const graded = fb.filter((v) => v === true || v === false);
    if (!graded.length) return { summary: null, details: [] };
    const n = graded.filter((v) => v === true).length;
    return {
      summary: correctOf(n, graded.length),
      details: [{ kind: 'stats', items: [{ label: '選擇題答對', value: `${n} / ${graded.length} 題` }] }],
    };
  },

  'keypoints-table': ({ data }) => {
    // gradeResult.score = -1 + results=[] 是網路失敗的哨兵值，不能當分數（見 practiceStepsSummary）。
    const g = isObj(data.gradeResult) ? data.gradeResult : null;
    const results = g && Array.isArray(g.results) ? g.results.filter(isObj) : [];
    if (!results.length) return { summary: null, details: [] };
    const n = results.filter((r) => r.correct === true).length;
    const rows: AnswerRow[] = results.map((r, i) => ({
      label: `第 ${i + 1} 格`,
      correct: r.correct === true,
      correctAnswer: r.correct === true ? null : str(r.correct_answer),
    }));
    return {
      summary: correctOf(n, results.length),
      details: [
        { kind: 'stats', items: [{ label: '答對', value: `${n} / ${results.length} 格` }] },
        { kind: 'answers', title: '每一格', rows },
      ],
    };
  },

  comprehension: ({ data }) => {
    const n = num(data.mcqScore) ?? num(data.mcq_score);
    const t = num(data.mcqTotal) ?? num(data.mcq_total);
    // #4028：feedback 是「最新一次」的對錯 —— 第一次錯、後來改對就是已訂正。
    const latest = isObj(data.feedback) ? data.feedback : {};
    const records = Array.isArray(data.firstTry) ? data.firstTry.filter(isObj) : [];
    const rows = firstTryRows(records).map((r, i) => {
      const id = str(records[i]?.id);
      const now = id ? latest[id] : undefined;
      return r.correct || (now !== true && now !== false) ? r : { ...r, corrected: now === true };
    });
    const details: DetailBlock[] = [];
    if (n !== null && t !== null) details.push({ kind: 'stats', items: [{ label: '第一次就答對', value: `${n} / ${t} 題` }] });
    if (rows.length) details.push({ kind: 'answers', title: '作答紀錄', rows });
    return { summary: n !== null && t !== null && t > 0 ? correctOf(n, t) : null, details };
  },

  'vocab-review': ({ data }) => {
    const found = Array.isArray(data.foundWords) ? data.foundWords.filter((w): w is string => typeof w === 'string') : [];
    if (!found.length) return { summary: null, details: [] };
    return {
      summary: `找到 ${found.length} 個語詞`,
      details: [{ kind: 'words', title: '找到的語詞', words: found }],
    };
  },
};

/**
 * 哪些勾是這次打的、哪些是從上一次帶過來的（#4028）。
 * 由 `progressOrigin()` 從 DB 的 step_progress 取出。
 */
export interface ProgressOrigin {
  /** step_progress.session_steps_completed —— 這個 session 裡完成的。舊資料沒有這個欄位。 */
  sessionStepsCompleted?: string[] | null;
  /** step_progress.__meta.carried_from.steps_completed —— 從上一次帶過來的。 */
  carriedStepsCompleted?: string[] | null;
  /** step_progress.__meta.carried_from.at */
  carriedAt?: string | null;
  /** step_progress.__meta.carried_from.session_id */
  carriedSessionId?: number | null;
}

export interface ReportCardOptions {
  /** 哪些勾是這次的、哪些是上次帶過來的（#4028）。不給 = 全部當這次的。 */
  origin?: ProgressOrigin;
  /**
   * 某一關（完整 step id，含 `#slug`）的詞語表，詞語理解的細節要用它把作答還原成詞語。
   * 呼叫端通常是 `(id) => storyForStep(story, id)?.vocabulary`。
   */
  vocabularyFor?: (stepId: string) => VocabWord[] | undefined;
}

/** 從 DB 回來的 step_progress 取出 ProgressOrigin；形狀不對的一律當沒有。 */
export function progressOrigin(progress: unknown): ProgressOrigin {
  if (!isObj(progress)) return {};
  const strList = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : null);
  const meta = isObj(progress.__meta) ? progress.__meta : {};
  const carried = isObj(meta.carried_from) ? meta.carried_from : null;
  return {
    sessionStepsCompleted: strList(progress.session_steps_completed),
    carriedStepsCompleted: carried ? strList(carried.steps_completed) ?? [] : null,
    carriedAt: carried ? str(carried.at) : null,
    carriedSessionId: carried ? num(carried.session_id) : null,
  };
}

/**
 * 這個 session 自己完成了哪些關卡（#4028），不含 report 本身（一進報告頁就會被標完成）。
 * 有 session_steps_completed 就用它，再加上累計清單裡不是繼承來的；跟卡片的「這次」同一套規則。
 */
export function stepsDoneThisSession(progress: unknown): string[] {
  if (!isObj(progress)) return [];
  const o = progressOrigin(progress);
  const done = Array.isArray(progress.steps_completed)
    ? progress.steps_completed.filter((x): x is string => typeof x === 'string').map(normalizeStepKey)
    : [];
  const carried = new Set((o.carriedStepsCompleted ?? []).map(normalizeStepKey));
  const out = new Set((o.sessionStepsCompleted ?? []).map(normalizeStepKey));
  for (const id of done) if (!carried.has(id)) out.add(id);
  out.delete('report');
  return [...out];
}

/**
 * 組出報告頁的卡片清單。
 *
 * @param steps         這一課學生走得到的關卡（resolveActiveSteps），已排除 report。
 * @param stepsCompleted DB 的 step_progress.steps_completed
 * @param stepData       DB 的 step_progress.step_data
 * @param marks          讀全文-做記號的記號；null = 還在載入，undefined = 這份呼叫方
 *                       沒有能力提供記號資料（例如老師端：後端沒有教師專屬的
 *                       annotations 端點，見 TeacherSessionReportPage）—— 卡片
 *                       會略過記號細節，不會誤報「還沒有做記號」或卡在「載入中」。
 * @param opts           origin：哪些勾是這次的、哪些是上次帶過來的（#4028），不給 = 全部當
 *                       這次的；vocabularyFor：每一關的詞語表（詞語理解的作答細節）。
 */
export function buildStepReportCards(
  steps: StepConfig[],
  stepsCompleted: string[] | null | undefined,
  stepData: Record<string, unknown> | null | undefined,
  marks: MarkedWord[] | null | undefined,
  opts: ReportCardOptions = {},
): StepReportCard[] {
  const origin = opts.origin ?? {};
  const done = new Set((stepsCompleted ?? []).map(normalizeStepKey));
  const data = normalizeStepData(stepData);
  // #4028：這次完成 = 這個 session 自己記下完成的 ∪ 累計清單裡不是從上一次帶過來的。
  // 後半段讓沒有 session_steps_completed 的舊 session 照舊顯示；前半段讓「上次做過、
  // 這次又重做」的關卡算成這次。
  const carriedList = origin.carriedStepsCompleted;
  const carried = new Set((carriedList ?? []).map(normalizeStepKey));
  const sessionDone = new Set((origin.sessionStepsCompleted ?? []).map(normalizeStepKey));
  const doneNow = (id: string) => sessionDone.has(id) || (done.has(id) && !carried.has(id));
  // step_data 也會跟著帶過來，所以 entry.completed 只有在沒有繼承紀錄時才能當成「這次」。
  const hasCarry = carriedList != null;
  // 課程簡介從來不會被寫進 steps_completed（按「開始」只存 current_step），
  // 所以只要後面任何一關有進度，就代表學生看過簡介了。
  // report 本身不算：一進報告頁就會把 report 寫進 steps_completed。
  const anyLaterProgress = steps.some((s) => {
    const base = s.baseId ?? s.id;
    return base !== 'lesson-intro' && base !== 'report' && (done.has(s.id) || s.id in data);
  });
  // 同一個規則，只看這一次（#4028）。
  const anyLaterProgressNow = steps.some((s) => {
    const base = s.baseId ?? s.id;
    if (base === 'lesson-intro' || base === 'report') return false;
    const unique = steps.filter((o) => (o.baseId ?? o.id) === base).length === 1 && base !== s.id;
    return doneNow(s.id) || (unique && doneNow(base)) || (!hasCarry && s.id in data);
  });

  // 記號的 offset 只對得上第一篇的課文（多篇課的第 2、3 篇不能標記），
  // 所以只掛在第一個讀全文-做記號上，其餘篇次不顯示記號。
  const firstAnnotateId = steps.find((s) => (s.baseId ?? s.id) === 'full-text-annotate')?.id;

  // 多篇課的 step id 帶 `#slug`（`full-text-annotate#dcavv`），但舊 session 與紙本
  // OMO 同步寫的是不帶後綴的 id（`reading-strategy`）。同一個大題在這課只出現
  // 一次時，兩種 key 都認；出現好幾次（真的多篇）就只認帶後綴的，免得張冠李戴。
  const baseCount = new Map<string, number>();
  for (const s of steps) baseCount.set(s.baseId ?? s.id, (baseCount.get(s.baseId ?? s.id) ?? 0) + 1);

  return steps
    .filter((s) => (s.baseId ?? s.id) !== 'report')
    .map((s) => {
      const baseId = s.baseId ?? s.id;
      const unique = baseCount.get(baseId) === 1 && baseId !== s.id;
      const entry = data[s.id] ?? (unique ? data[baseId] : undefined) ?? {};
      const everCompleted =
        done.has(s.id) ||
        (unique && done.has(baseId)) ||
        entry.completed === true ||
        (baseId === 'lesson-intro' && anyLaterProgress);
      const completedNow =
        doneNow(s.id) ||
        (unique && doneNow(baseId)) ||
        (!hasCarry && entry.completed === true) ||
        (baseId === 'lesson-intro' && anyLaterProgressNow);
      const status: CardStatus = completedNow ? 'this' : everCompleted ? 'previous' : 'none';
      const builder = BUILDERS[baseId];
      const stepMarks = s.id === firstAnnotateId ? marks : undefined;
      const built = builder
        ? builder({ data: entry, completed: completedNow, marks: stepMarks, vocabulary: opts.vocabularyFor?.(s.id) })
        : { summary: null, details: [] };
      return {
        stepId: s.id,
        baseId,
        label: s.label,
        icon: STEP_ICONS[baseId] ?? 'task_alt',
        completed: completedNow,
        status,
        previousAt: status === 'previous' ? origin.carriedAt ?? null : null,
        summary: built.summary,
        details: built.details,
      };
    });
}
