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

/** 一題的作答對照（你的答案 vs 正確答案）。 */
export interface AnswerRow {
  label: string;
  correct: boolean;
  studentAnswer?: string | null;
  correctAnswer?: string | null;
}

/** 卡片點開後的細節區塊。 */
export type DetailBlock =
  | { kind: 'stats'; items: { label: string; value: string }[] }
  | { kind: 'answers'; title: string; rows: AnswerRow[] }
  | { kind: 'marks'; marks: MarkedWord[] }
  | { kind: 'words'; title: string; words: string[] }
  | { kind: 'note'; text: string };

export interface StepReportCard {
  /** 完整 step id（多篇課帶 `#slug`），用來組網址。 */
  stepId: string;
  baseId: string;
  label: string;
  icon: string;
  completed: boolean;
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

  'vocab-definition': ({ data }) => {
    const r = isObj(data.result) ? data.result : {};
    const n = num(r.matchedCount);
    const t = num(r.totalCount);
    if (n === null || t === null) return { summary: null, details: [] };
    return {
      summary: correctOf(n, t),
      details: [{ kind: 'stats', items: [{ label: '答對', value: `${n} / ${t} 題` }] }],
    };
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
    const rows = firstTryRows(data.firstTry);
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
 * 組出報告頁的卡片清單。
 *
 * @param steps         這一課學生走得到的關卡（resolveActiveSteps），已排除 report。
 * @param stepsCompleted DB 的 step_progress.steps_completed
 * @param stepData       DB 的 step_progress.step_data
 * @param marks          讀全文-做記號的記號；null = 還在載入，undefined = 這份呼叫方
 *                       沒有能力提供記號資料（例如老師端：後端沒有教師專屬的
 *                       annotations 端點，見 TeacherSessionReportPage）—— 卡片
 *                       會略過記號細節，不會誤報「還沒有做記號」或卡在「載入中」。
 */
export function buildStepReportCards(
  steps: StepConfig[],
  stepsCompleted: string[] | null | undefined,
  stepData: Record<string, unknown> | null | undefined,
  marks: MarkedWord[] | null | undefined,
): StepReportCard[] {
  const done = new Set((stepsCompleted ?? []).map(normalizeStepKey));
  const data = normalizeStepData(stepData);
  // 課程簡介從來不會被寫進 steps_completed（按「開始」只存 current_step），
  // 所以只要後面任何一關有進度，就代表學生看過簡介了。
  // report 本身不算：一進報告頁就會把 report 寫進 steps_completed。
  const anyLaterProgress = steps.some((s) => {
    const base = s.baseId ?? s.id;
    return base !== 'lesson-intro' && base !== 'report' && (done.has(s.id) || s.id in data);
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
      const completed =
        done.has(s.id) ||
        (unique && done.has(baseId)) ||
        entry.completed === true ||
        (baseId === 'lesson-intro' && anyLaterProgress);
      const builder = BUILDERS[baseId];
      const stepMarks = s.id === firstAnnotateId ? marks : undefined;
      const built = builder ? builder({ data: entry, completed, marks: stepMarks }) : { summary: null, details: [] };
      return {
        stepId: s.id,
        baseId,
        label: s.label,
        icon: STEP_ICONS[baseId] ?? 'task_alt',
        completed,
        summary: built.summary,
        details: built.details,
      };
    });
}
