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
  '踖','踧','鎚','鏗','鏘','颺','齒',
  // 譁 (U+8B41) — not in makemeahanzi; appears in 譁眾取寵、一片譁然
  '譁',
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
  const long = mLen > 500;
  const minLen = (short ? 0.2 : long ? 0.3 : 0.5) * mLen;
  const maxLen = (short ? 3.0 : long ? 2.0 : 1.5) * mLen;

  if (uLen <= minLen || uLen >= maxLen) return false;

  const margin = short ? 200 : long ? 250 : 150;
  const us = user[0];
  const ue = user[user.length - 1];
  let ms = median[0];
  let me = median[median.length - 1];

  // Some stroke data (e.g. 「一」) has median as a closed outline path where
  // start≈end. In that case, find the two points on the median path that are
  // farthest apart and use those as effective start/end.
  if (dist(ms, me) < 50 && median.length > 2) {
    let maxD = 0;
    let pi = 0, pj = median.length - 1;
    // Sample pairs to find the diameter (O(n) approximation)
    for (let i = 0; i < median.length; i++) {
      for (let j = i + 1; j < median.length; j += Math.max(1, Math.floor(median.length / 30))) {
        const d2 = dist(median[i], median[j]);
        if (d2 > maxD) { maxD = d2; pi = i; pj = j; }
      }
    }
    ms = median[pi];
    me = median[pj];
  }

  // Try normal direction: user start→median start, user end→median end
  const normalStart = Math.abs(us.x - ms.x) <= margin && Math.abs(us.y - ms.y) <= margin;
  const normalEnd = Math.abs(ue.x - me.x) <= margin && Math.abs(ue.y - me.y) <= margin;

  // Try reversed direction
  const revStart = Math.abs(us.x - me.x) <= margin && Math.abs(us.y - me.y) <= margin;
  const revEnd = Math.abs(ue.x - ms.x) <= margin && Math.abs(ue.y - ms.y) <= margin;

  if (normalStart && normalEnd) return true;
  if (revStart && revEnd) return true;

  return false;
}
