export interface Point {
  x: number;
  y: number;
}

export interface CharacterStrokeData {
  character: string;
  strokePaths: string[];
  medians: Point[][];
  radicalIndices: number[];
  nStrokes: number;
}

export const CANVAS_SIZE = 1024;
export const HINT_THRESHOLD = 3;
const SPEED_REF_LENGTH = 520; // median length of first stroke of 你

const NO_SVG_LIST = [
  '吔','姍','媼','嬤','履','搧','枴','椏','欓','汙',
  '溼','漥','痠','礫','粄','粿','綰','蓆','襬','譟',
  '踖','踧','鎚','鏗','鏘','陳','颺','齒',
];

export function hasStrokeData(char: string): boolean {
  return !NO_SVG_LIST.includes(char);
}

export async function loadCharacterStrokeData(
  char: string,
): Promise<CharacterStrokeData | null> {
  if (!hasStrokeData(char)) return null;
  try {
    const res = await fetch(`/data/svg/${encodeURIComponent(char)}.json`);
    if (!res.ok) return null;
    const raw = await res.json();
    const strokePaths: string[] = raw.strokes ?? [];
    const medians: Point[][] = (raw.medians ?? []).map((stroke: number[][]) =>
      stroke.map((pt: number[]) => ({ x: pt[0], y: pt[1] * -1 + 900 })),
    );
    return {
      character: char,
      strokePaths,
      medians,
      radicalIndices: raw.radStrokes ?? [],
      nStrokes: strokePaths.length,
    };
  } catch {
    return null;
  }
}

export function dist(a: Point, b: Point): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

export function polyLength(pts: Point[]): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += dist(pts[i - 1], pts[i]);
  return len;
}

export function getStrokeDuration(median: Point[], speedMultiplier = 1): number {
  const len = polyLength(median);
  const norm = Math.max(0.5, Math.min(1.5, len / SPEED_REF_LENGTH));
  return (norm / speedMultiplier) * 1000;
}

export function isStrokeCorrect(user: Point[], median: Point[]): boolean {
  if (user.length < 2 || median.length < 2) return false;

  const uLen = polyLength(user);
  const mLen = polyLength(median);
  if (mLen === 0) return false;

  const short = mLen < 150;
  const minLen = (short ? 0.2 : 0.5) * mLen;
  const maxLen = (short ? 3.0 : 1.5) * mLen;
  if (uLen <= minLen || uLen >= maxLen) return false;

  const margin = short ? 200 : 150;
  const us = user[0];
  const ue = user[user.length - 1];
  const ms = median[0];
  const me = median[median.length - 1];

  if (Math.abs(us.x - ms.x) > margin || Math.abs(us.y - ms.y) > margin) return false;
  if (Math.abs(ue.x - me.x) > margin || Math.abs(ue.y - me.y) > margin) return false;

  const rightDir =
    dist(us, ms) < dist(ue, ms) || dist(ue, me) < dist(us, me);
  return rightDir;
}
