/**
 * 課文清單搜尋（#4158）
 *
 * 能搜：標題、體裁、年級。
 * 年級的說法不只「第 4 級」：孩子會打「4」「四年級」「4年級」「第4級」，都要找得到。
 * 生詞搜尋要先有索引（列表 API 沒有生詞欄位），issue 明寫放第二期，這裡不做。
 */
import { gradeLabel } from './gradeLabel';

interface SearchableStory {
  title: string;
  grade?: string;
  genre?: string;
}

const CN_DIGIT: Record<string, string> = {
  一: '1', 二: '2', 三: '3', 四: '4', 五: '5', 六: '6', 七: '7', 八: '8', 九: '9',
};

/** 去空白、轉小寫、中文數字轉阿拉伯數字（只用在年級比對） */
function normalizeGradeText(s: string): string {
  return s.replace(/\s+/g, '').toLowerCase().replace(/[一二三四五六七八九]/g, (c) => CN_DIGIT[c]);
}

/** 查詢字串是不是在講某個數字年級：4、四、4年級、第4級、四年級 */
function gradeNumberFromQuery(q: string): string | null {
  const m = normalizeGradeText(q).match(/^第?(\d)(?:年級|級|年)?$/);
  return m ? m[1] : null;
}

export function matchesStory(story: SearchableStory, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (story.title.toLowerCase().includes(q)) return true;
  if (story.genre?.toLowerCase().includes(q)) return true;
  if (story.grade) {
    // 非數字年級（文言文、品格教育）直接比字串
    if (!/^\d+$/.test(story.grade)) return story.grade.toLowerCase().includes(q);
    const n = gradeNumberFromQuery(q);
    if (n !== null) return story.grade === n;
    if (gradeLabel(story.grade).replace(/\s+/g, '').includes(q.replace(/\s+/g, ''))) return true;
  }
  return false;
}

/** 沒結果時給的建議關鍵字：現有課文裡最常見的體裁，再補年級；每一個都保證搜得到東西 */
export function suggestKeywords(stories: SearchableStory[], max = 5): string[] {
  const genres = new Map<string, number>();
  const grades = new Map<string, number>();
  for (const s of stories) {
    if (s.genre) genres.set(s.genre, (genres.get(s.genre) ?? 0) + 1);
    if (s.grade) grades.set(s.grade, (grades.get(s.grade) ?? 0) + 1);
  }
  const rank = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  const out = [...rank(genres), ...rank(grades).map((g) => (/^\d+$/.test(g) ? `${g}年級` : g))];
  return out.filter((k) => stories.some((s) => matchesStory(s, k))).slice(0, max);
}
