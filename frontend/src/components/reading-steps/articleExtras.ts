/**
 * 課文層「印在正文上」的額外內容 → 既有 TableDisplay 吃的形狀（#3277）。
 *
 * 這幾欄（`source_line` / `inline_table` / `inline_tables` /
 * `comparison_table` / `summary_table`）從 #2736 起就在 yml 裡，過了逐字門、
 * 也進了忠實度證明，但服務端那一列是逐欄寫死的字典、沒有宣告它們，
 * 所以**送不出去，前端也就沒人接** —— 抽出來了，學生看不到。
 *
 * ⛔ 不另寫一套表格渲染：轉成 `LessonTable` 餵給既有的 `TableDisplay`，
 *    連放大檢視與焦點鎖都一起沿用。
 */
import type { LessonTable, LessonTableRow, Story } from '../../types';

type Raw = Record<string, unknown>;

/** rows 有兩種形狀，而且混在同一批資料裡（跟聚光燈的 table 同一個坑）：
 *  (a) 陣列的陣列 —— `[["股東","投資金額"], ["瑪莉","1000元"]]`
 *  (b) 以欄名為 key 的物件 + 另一個 `columns` */
function toRows(rows: unknown, columns: string[]): LessonTableRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => {
    if (Array.isArray(r)) return { cells: r.map((c) => cellText(c)) };
    if (r && typeof r === 'object') {
      const o = r as Raw;
      const keys = columns.length ? columns : Object.keys(o);
      return { cells: keys.map((k) => cellText(o[k])) };
    }
    return { cells: [cellText(r)] };
  });
}

function cellText(v: unknown): string {
  if (Array.isArray(v)) return v.map((x) => String(x ?? '')).join('\n');
  return String(v ?? '');
}

/** 一張表自己的出處行（原稿印在表底下的「資料來源：…」）。 */
export function tableSourceLine(raw: unknown): string | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const v = (raw as Raw).source_line;
  return typeof v === 'string' && v.trim() ? v : undefined;
}

export function tableFrom(raw: unknown, id: string, fallbackTitle: string): LessonTable | null {
  return one(raw, id, fallbackTitle);
}

function one(raw: unknown, id: string, fallbackTitle: string): LessonTable | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Raw;
  const columns = Array.isArray(o.columns) ? o.columns.map((c) => String(c ?? '')) : [];
  const rows = toRows(o.rows, columns);
  if (!rows.length) return null;
  const title = String(o.label ?? o.title ?? fallbackTitle);
  return { id, title, headers: columns, rows };
}

/** 課文正文裡的表格，照原稿的出現順序。 */
export function articleTables(story: Story): LessonTable[] {
  const out: LessonTable[] = [];
  const push = (t: LessonTable | null) => { if (t) out.push(t); };
  push(one(story.inlineTable, 'inline-table', '表'));
  (Array.isArray(story.inlineTables) ? story.inlineTables : []).forEach((t, i) =>
    push(one(t, `inline-tables-${i}`, `表 ${i + 1}`)),
  );
  push(one(story.comparisonTable, 'comparison-table', '對照表'));
  push(one(story.summaryTable, 'summary-table', '摘要表'));
  return out;
}
