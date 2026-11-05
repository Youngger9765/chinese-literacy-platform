/**
 * readingBabyAppearance.ts — 閱讀寶貝造型公式（#3780 第三階段，
 * docs/design/reading-babies/game-design.md §1.3）。
 *
 *   造型 = 劇情類型（體型）× 年級（色系）× 招牌小物（能力家族）
 *
 * - 體型：沿用島上的劇情規則 `storyTypeForLesson`（不另抄一份規則）
 * - 色系：年級 4–9 + 品格教育 + 文言文，共 8 組；低年級亮、圓潤，高年級深、俐落
 * - 招牌小物：依教授課程地圖家族選一個小物池，用 lesson_uid 做決定性雜湊挑一件
 * - 花紋：前三層組合撞在一起時（同體型、同年級、同小物），依 lesson_uid 排序
 *   給不同花紋，保證 179 隻沒有兩隻完全一樣（game-design §1.3 的承諾，測試鎖住）
 *
 * 純資料、決定性：同一課每次算出來都一樣，不用亂數。美術正式稿未定（PRD §11），
 * 這裡全部用程式畫的 SVG，不使用任何未授權的圖。
 */
import raw from '../../data/readingBabyAppearanceInputs.json';
import { storyTypeForLesson, type StoryType } from '../../pages/lab/island/islandTemplate';

interface RawInput {
  grade: string;
  category: string;
  genre: string;
  family: string;
}

const INPUTS = (raw as unknown as { lessons: Record<string, RawInput> }).lessons;

export interface GradePalette {
  body: string;
  belly: string;
  accent: string;
  cheek: string;
  outline: string;
}

/** 年級色系：4 年級最亮最暖，往上漸深；兩個系列各自一組。 */
export const GRADE_GROUPS: Record<string, GradePalette> = {
  '4': { body: '#FFD666', belly: '#FFF4C2', accent: '#F59E0B', cheek: '#FCA5A5', outline: '#8A5A00' },
  '5': { body: '#FFB38A', belly: '#FFE6D6', accent: '#EA580C', cheek: '#F87171', outline: '#8A3A12' },
  '6': { body: '#86E3B5', belly: '#DDF8EA', accent: '#059669', cheek: '#FDA4AF', outline: '#165A3C' },
  '7': { body: '#7CC7F2', belly: '#DCF0FC', accent: '#0369A1', cheek: '#FDA4AF', outline: '#0C4A6E' },
  '8': { body: '#B9A3F2', belly: '#ECE6FD', accent: '#6D28D9', cheek: '#F9A8D4', outline: '#3B2373' },
  '9': { body: '#7F8FE0', belly: '#DDE2FA', accent: '#3730A3', cheek: '#F9A8D4', outline: '#1E2563' },
  品格教育: { body: '#F7A8C4', belly: '#FDE4EE', accent: '#DB2777', cheek: '#FB7185', outline: '#7A1D45' },
  文言文: { body: '#A8C99A', belly: '#EAF3E4', accent: '#7C5A2E', cheek: '#F4A6A6', outline: '#3F4F2A' },
};

export type AccessoryIcon =
  | 'funnel' | 'scroll' | 'magnifier' | 'lightbulb' | 'question' | 'chart' | 'map'
  | 'compass' | 'bookmark' | 'key' | 'puzzle' | 'pen' | 'flask' | 'tablet' | 'books'
  | 'heart' | 'brush' | 'star' | 'book';

/** 能力家族 → 小物池（呼應那個家族練的能力；同家族的課小物會重複，這是刻意的）。 */
export const FAMILY_ACCESSORIES: Record<string, AccessoryIcon[]> = {
  F01: ['funnel', 'scroll', 'bookmark'], // 摘要與概括
  F02: ['magnifier', 'lightbulb', 'question'], // 推論
  F03: ['chart', 'map', 'tablet'], // 圖表與資訊整合
  F04: ['question', 'lightbulb', 'bookmark'], // 自我提問
  F05: ['compass', 'bookmark', 'map'], // 主動調整閱讀
  F06: ['key', 'magnifier', 'book'], // 詞彙推測
  F07: ['puzzle', 'pen', 'key'], // 認識句型
  F08: ['pen', 'scroll', 'brush'], // 寫作手法
  F09: ['flask', 'magnifier', 'chart'], // 科學推理
  F10: ['tablet', 'magnifier', 'question'], // 媒體素養與識讀
  F11: ['books', 'bookmark', 'puzzle'], // 多文本閱讀
  F12: ['heart', 'lightbulb', 'pen'], // 讀後反思與回應
  F13: ['scroll', 'brush', 'book'], // 文言文閱讀
  F14: ['star', 'compass', 'heart'], // 品格／學習／生涯能力
  AI00: ['book', 'question', 'star'], // 尚無教授節點
};

export type Pattern = 'none' | 'spots' | 'stripes' | 'freckles' | 'heart' | 'star' | 'leaf' | 'moon';
const PATTERNS: Pattern[] = ['none', 'spots', 'stripes', 'freckles', 'heart', 'star', 'leaf', 'moon'];

export interface ReadingBabyAppearance {
  lessonUid: string;
  storyType: StoryType;
  gradeGroup: string;
  palette: GradePalette;
  family: string;
  accessory: { family: string; icon: AccessoryIcon };
  pattern: Pattern;
}

/** FNV-1a 32-bit——小、決定性、不需要任何套件。 */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function baseFor(uid: string, input: RawInput) {
  const storyType = storyTypeForLesson(input.grade, input.category, input.genre);
  const gradeGroup = GRADE_GROUPS[input.grade] ? input.grade : '4';
  const pool = FAMILY_ACCESSORIES[input.family] ?? FAMILY_ACCESSORIES.AI00;
  const icon = pool[hash(uid) % pool.length];
  return { storyType, gradeGroup, family: input.family, icon };
}

let patternIndex: Map<string, Pattern> | null = null;

/** 前三層撞在一起的課，依 lesson_uid 排序給不同花紋。 */
function patternFor(uid: string): Pattern {
  if (!patternIndex) {
    const groups = new Map<string, string[]>();
    for (const id of Object.keys(INPUTS).sort()) {
      const b = baseFor(id, INPUTS[id]);
      const key = `${b.storyType}|${b.gradeGroup}|${b.icon}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(id);
    }
    patternIndex = new Map();
    for (const ids of groups.values()) {
      ids.forEach((id, i) => patternIndex!.set(id, PATTERNS[i % PATTERNS.length]));
    }
  }
  return patternIndex.get(uid) ?? 'none';
}

export function appearanceFor(lessonUid: string): ReadingBabyAppearance | null {
  const input = INPUTS[lessonUid];
  if (!input) return null;
  const b = baseFor(lessonUid, input);
  return {
    lessonUid,
    storyType: b.storyType,
    gradeGroup: b.gradeGroup,
    palette: GRADE_GROUPS[b.gradeGroup],
    family: b.family,
    accessory: { family: b.family, icon: b.icon },
    pattern: patternFor(lessonUid),
  };
}

/** 外觀的完整指紋（測試用：179 隻兩兩不同）。 */
export function appearanceSignature(a: ReadingBabyAppearance): string {
  return `${a.storyType}|${a.gradeGroup}|${a.accessory.icon}|${a.pattern}`;
}
