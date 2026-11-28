/**
 * 跨課能力診斷的純計算（#4162）：最近 5 課平均、能力 × 課文矩陣、診斷句
 *
 * ⛔ 沒有副作用：不 fetch、不讀 localStorage。資料由 useRecentAbility 抓好後傳進來。
 * 診斷句由規則產生，不用模型。
 * 門檻與老師端熱度矩陣同一套（80、60），老師與學生看到同一個意思。
 */
import { RADAR_AXES, type RadarPoint } from './reportCardsModel';
import { STEP_REGISTRY } from '../../config/stepConfig';

export interface LessonAbility {
  sessionId: number;
  storyId: string;
  title: string;
  /** radarOf 的結果（五項固定順序） */
  points: RadarPoint[];
}

export type Band = 'green' | 'yellow' | 'low' | 'none';

export const GREEN_MIN = 80;
export const YELLOW_MIN = 60;
/** 雷達的平均線取最近幾課（不含這一課） */
export const AVERAGE_LESSONS = 5;
/** 矩陣顯示最近幾課（含這一課） */
export const MATRIX_LESSONS = 6;
/** 連續幾課偏低才點名 */
export const STREAK_LESSONS = 3;

export function bandOf(rate: number | null | undefined): Band {
  if (typeof rate !== 'number') return 'none';
  if (rate >= GREEN_MIN) return 'green';
  if (rate >= YELLOW_MIN) return 'yellow';
  return 'low';
}

const scoreOf = (l: LessonAbility, key: string): number | null => {
  const p = l.points.find((x) => x.key === key);
  return p && p.state === 'scored' && typeof p.value === 'number' ? p.value : null;
};

/**
 * 「最近 5 課平均」：lessons 由舊到新；排除 current 本身，取其餘最近 5 課，
 * 每一項只平均有分數的課。沒有其他課回 null（畫不出平均線）。
 */
export function averageOfOthers(current: LessonAbility, lessons: LessonAbility[]): RadarPoint[] | null {
  const others = lessons.filter((l) => l.sessionId !== current.sessionId).slice(-AVERAGE_LESSONS);
  if (!others.length) return null;
  return RADAR_AXES.map((axis) => {
    const vals = others.map((l) => scoreOf(l, axis.key)).filter((v): v is number => v !== null);
    if (!vals.length) return { key: axis.key, label: axis.label, value: null, state: 'todo' as const };
    const value = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
    return { key: axis.key, label: axis.label, value, state: 'scored' as const };
  });
}

export interface MatrixCell { band: Band; value: number | null }
export interface MatrixData {
  columns: LessonAbility[];
  rows: { key: string; label: string; cells: MatrixCell[] }[];
  /** 不足 MATRIX_LESSONS 時，右邊補幾欄灰色 */
  padding: number;
}

export function matrixOf(lessons: LessonAbility[]): MatrixData {
  const columns = lessons.slice(-MATRIX_LESSONS);
  const rows = RADAR_AXES.map((axis) => ({
    key: axis.key,
    label: axis.label,
    cells: columns.map((l) => {
      const value = scoreOf(l, axis.key);
      return { band: bandOf(value), value };
    }),
  }));
  return { columns, rows, padding: MATRIX_LESSONS - columns.length };
}

/** 做不到兩課時，還差幾課才能比較 */
export function lessonsNeeded(count: number): number {
  return Math.max(0, 2 - count);
}

/** 每一項能力建議先做的關卡 */
const SUGGESTED_STEP: Record<string, string> = {
  vocab: 'vocab-review',
  meaning: 'comprehension',
  structure: 'keypoints-table',
  strategy: 'spotlight',
  fluency: 'key-passage-reading',
};

export interface Diagnosis {
  axisKey: string;
  axisLabel: string;
  suggestedStepId: string;
  suggestedStepLabel: string;
  text: string;
}

/**
 * 某一項能力「最近連續三課」都有分數且都低於 60 才點名；多項都符合時點平均最低的。
 * lessons 由舊到新。
 */
export function diagnose(lessons: LessonAbility[]): Diagnosis | null {
  const recent = lessons.slice(-STREAK_LESSONS);
  if (recent.length < STREAK_LESSONS) return null;
  let worst: { key: string; label: string; avg: number } | null = null;
  for (const axis of RADAR_AXES) {
    const vals = recent.map((l) => scoreOf(l, axis.key));
    if (vals.some((v) => v === null || (v as number) >= YELLOW_MIN)) continue;
    const avg = (vals as number[]).reduce((a, b) => a + b, 0) / vals.length;
    if (!worst || avg < worst.avg) worst = { key: axis.key, label: axis.label, avg };
  }
  if (!worst) return null;
  const stepId = SUGGESTED_STEP[worst.key];
  const stepLabel = STEP_REGISTRY[stepId]?.label ?? stepId;
  return {
    axisKey: worst.key,
    axisLabel: worst.label,
    suggestedStepId: stepId,
    suggestedStepLabel: stepLabel,
    text: `你的${worst.label}最近三課都偏低，建議先做${stepLabel}`,
  };
}
