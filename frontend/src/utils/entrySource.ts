/**
 * #4161：記住「這一課是從 AI 派發的卡點進來的」，建立學習紀錄時帶給後端（entry_source）。
 *
 * 點卡片到真正建立 session 中間會換頁，所以暫存在 sessionStorage（同一個分頁、關掉就沒了），
 * 並設有效期限：點了卻沒真的開始，不會讓之後別的進入方式被誤標成 AI 派發。
 * 建立一次就清掉；同一課已有進行中紀錄而沒有新建時，也要清掉。
 */
export type EntrySource = 'ai_dispatch';

const KEY = 'lingoleap_entry_source';
export const ENTRY_SOURCE_TTL_MS = 30 * 60 * 1000;

interface Stored { storyId: string; source: EntrySource; at: number }

export function markEntrySource(storyId: string, source: EntrySource = 'ai_dispatch', now = Date.now()): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ storyId: String(storyId), source, at: now } satisfies Stored));
  } catch { /* 沒有儲存空間就不標記，學習照常 */ }
}

/** 讀出並清掉；不是這一課、過期、格式不對都回 undefined */
export function takeEntrySource(storyId: string, now = Date.now()): EntrySource | undefined {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return undefined;
    sessionStorage.removeItem(KEY);
    const v = JSON.parse(raw) as Partial<Stored>;
    if (v.source !== 'ai_dispatch') return undefined;
    if (String(v.storyId) !== String(storyId)) return undefined;
    if (typeof v.at !== 'number' || now - v.at > ENTRY_SOURCE_TTL_MS) return undefined;
    return v.source;
  } catch {
    return undefined;
  }
}

export function clearEntrySource(): void {
  try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
}
