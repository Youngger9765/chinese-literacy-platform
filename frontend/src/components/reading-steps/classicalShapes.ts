/**
 * The classical-lesson modules come from worksheets that were extracted
 * lesson by lesson, so the same module arrives in more than one shape
 * (#3483). The components used to read only one of them and threw on the
 * rest -- 7 of 10 文白句子比對 lessons and 2 of 6 自我挑戰 lessons crashed,
 * and 2 more 自我挑戰 lessons showed the passage with no questions.
 *
 * These functions turn every shape seen in the served data into the one the
 * components render. Unknown input yields null (the step's empty state)
 * rather than a crash.
 */
import type {
  ClassicalSelfChallengeContent,
  ClassicalSelfChallengePart,
  ClassicalSelfChallengeQuestionItem,
} from '../../types';

type Dict = Record<string, unknown>;
const isObj = (v: unknown): v is Dict => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined);
const num = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
};

/** Ａ–Ｚ／０–９ printed full-width in some worksheets → the half-width keys the options use. */
export function halfWidth(s: string): string {
  return s.replace(/[０-９Ａ-Ｚａ-ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
}

// ── 文白句子比對 ────────────────────────────────────────────────────────────

export interface SentenceSegment {
  index: number;
  classical: string;
  answer: number;
}

export interface SentenceMatchingPart {
  label?: string;
  passageParagraphs: string[];
  referenceLabel?: string;
  referenceSentences: Record<string, string>;
  example?: { classical: string; answer: number };
  segments: SentenceSegment[];
}

export interface SentenceMatchingView {
  instruction?: string;
  parts: SentenceMatchingPart[];
}

function paragraphs(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((p) => (typeof p === 'string' ? p : isObj(p) ? str(p.text) ?? '' : '')).filter(Boolean);
}

function refs(v: unknown): Record<string, string> {
  if (!isObj(v)) return {};
  const out: Record<string, string> = {};
  for (const [k, t] of Object.entries(v)) if (typeof t === 'string') out[k] = t;
  return out;
}

function segmentsFrom(v: unknown): SentenceSegment[] {
  if (!Array.isArray(v)) return [];
  const out: SentenceSegment[] = [];
  v.forEach((s, i) => {
    if (!isObj(s)) return;
    const classical = str(s.classical) ?? str(s['文言']);
    const answer = num(s.answer);
    if (!classical || answer === undefined) return;
    out.push({ index: num(s.index) ?? i + 1, classical, answer });
  });
  return out;
}

function partFrom(p: Dict, fallbackLabel?: string): SentenceMatchingPart | null {
  // Shape A uses `segments`; shape C uses `items` keyed by 文言.
  const segments = segmentsFrom(p.segments ?? p.items);
  if (segments.length === 0) return null;
  const ex = isObj(p.example) ? p.example : undefined;
  const exClassical = ex && (str(ex.classical) ?? str(ex['文言']));
  const exAnswer = ex ? num(ex.answer) : undefined;
  return {
    label: str(p.part) ?? fallbackLabel,
    passageParagraphs: paragraphs(p.passage_paragraphs),
    referenceLabel: str(p.reference_label),
    referenceSentences: refs(p.reference_sentences),
    example: exClassical && exAnswer !== undefined ? { classical: exClassical, answer: exAnswer } : undefined,
    segments,
  };
}

export function normalizeSentenceMatching(raw: unknown): SentenceMatchingView | null {
  if (!isObj(raw)) return null;
  const parts = Array.isArray(raw.parts)
    ? raw.parts.filter(isObj).map((p) => partFrom(p)).filter((p): p is SentenceMatchingPart => p !== null)
    : [partFrom(raw)].filter((p): p is SentenceMatchingPart => p !== null);
  if (parts.length === 0) return null;
  return { instruction: str(raw.instruction), parts };
}

// ── 自我挑戰 ────────────────────────────────────────────────────────────────

function questions(v: unknown): ClassicalSelfChallengeQuestionItem[] {
  if (!Array.isArray(v)) return [];
  const out: ClassicalSelfChallengeQuestionItem[] = [];
  v.forEach((q, i) => {
    if (!isObj(q)) return;
    const stem = str(q.stem) ?? str(q.prompt);
    if (!stem || (typeof q.answer !== 'string' && typeof q.answer !== 'number')) return;
    const options = isObj(q.options) ? refs(q.options) : undefined;
    const answer = typeof q.answer === 'string' && options ? halfWidth(q.answer.trim()) : q.answer;
    out.push({
      index: num(q.index) ?? i + 1,
      stem,
      options: options && Object.keys(options).length > 0 ? options : undefined,
      answer,
      instruction: str(q.instruction),
    });
  });
  return out;
}

/** `{label, questions}` or `{label, items}` → one part. */
function partOf(v: unknown): ClassicalSelfChallengePart | undefined {
  if (!isObj(v)) return undefined;
  const items = questions(v.questions ?? v.items);
  return items.length ? { label: str(v.label), items } : undefined;
}

/** `items` is either one `{label, questions}` or a list of them (each with its own instruction). */
function partFromItems(v: unknown): ClassicalSelfChallengePart | undefined {
  if (isObj(v)) return partOf(v);
  if (!Array.isArray(v)) return undefined;
  const groups = v.filter(isObj);
  const items = groups.flatMap((g) => questions(g.questions));
  if (!items.length) return undefined;
  const label = groups
    .map((g) => [str(g.label), str(g.instruction)].filter(Boolean).join(''))
    .filter(Boolean)
    .join(' ');
  return { label: label || undefined, items };
}

type Annotation = { index?: number; term: string; text: string };

function annotations(v: unknown): Annotation[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v
    .filter(isObj)
    .map((a) => ({ index: num(a.index ?? a.no), term: str(a.term) ?? '', text: str(a.text) ?? '' }))
    .filter((a) => a.term || a.text);
  return out.length ? out : undefined;
}

export function normalizeSelfChallenge(raw: unknown): ClassicalSelfChallengeContent | null {
  if (!isObj(raw)) return null;
  // Shape B nests the passage: {classical, source, annotations, modern}.
  const p = isObj(raw.passage) ? raw.passage : undefined;
  const passage = p ? str(p.classical) : str(raw.passage);
  if (!passage) return null;
  const flow = Array.isArray(raw.strategy_flow)
    ? raw.strategy_flow.filter((s) => typeof s === 'string').join(' → ')
    : str(raw.strategy_flow);
  return {
    optional_note: str(raw.optional_note),
    instruction: str(raw.instruction),
    strategy_banner: str(raw.strategy_banner) ?? flow,
    passage: p && str(p.source) ? `${passage} ${str(p.source)}` : passage,
    annotations: annotations(p?.annotations ?? raw.annotations),
    translation: str(p?.modern) ?? str(raw.translation),
    part_one: partOf(raw.part_one) ?? partFromItems(raw.items),
    part_two: partOf(raw.part_two) ?? partOf(raw.quiz),
  };
}
