/**
 * 一張「帶 rows 的 fill_table」會把整個聚光燈卡死在第一段。
 *
 * `isBlockAnswered` 對 `fill_table` 要求 `val === true`，而只有**沒有 rows**
 * 的那種（指路牌「文章重點表請在…步驟填寫」）畫得出「知道了」去設那個值。
 * 帶 rows 的那種 fall through 到 `table` 分支，只把表格畫出來 ——
 * 畫面上沒有任何東西能把它標成完成。
 *
 * 後果不是「那一格怪怪的」，是 `countVisibleSegments` 在它所在的段就停住，
 * **後面每一段都永遠不顯示**。L0087 的聚光燈有六節，學生只看得到三節；
 * 第四節「小試身手」那張表、第五節、第六節自我檢核，都在後面的段裡。
 *
 * staging 實測（2026-09-21，學生「小明」）：兩個 single 題都答完、
 * 選項全部 disabled、頁面上沒有任何未填輸入框，第四～六節仍然不出現。
 */
import { describe, it, expect } from 'vitest';
import {
  countVisibleSegments,
  isBlockAnswered,
  isSegmentComplete,
  segmentBlocks,
} from '../spotlightBlockLogic';
import type { SpotlightBlock } from '../spotlightBlockLogic';

const guide = (text: string) => ({ type: 'guide', text }) as unknown as SpotlightBlock;
const single = (q: string) =>
  ({ type: 'single', question: q, options: ['甲', '乙'], answer: 1 }) as unknown as SpotlightBlock;
const tableWithRows = () =>
  ({
    type: 'fill_table',
    prompt: '四、小試身手',
    columns: ['段落', '讀到的地方'],
    rows: [{ 段落: '1~3', 讀到的地方: '作者小時候和姊姊分餅的經驗' }],
  }) as unknown as SpotlightBlock;
const signpostTable = () => ({ type: 'fill_table', prompt: '文章重點表' }) as unknown as SpotlightBlock;

describe('帶 rows 的 fill_table 不該擋住後面的段落', () => {
  it('畫面上沒有控制項能標記它，所以它不可以是完成條件', () => {
    // 這張表只是被畫出來的表格（`table` 分支），沒有輸入框也沒有「知道了」
    expect(isBlockAnswered(tableWithRows(), {}, '0-0')).toBe(true);
  });

  it('沒有 rows 的指路牌仍然要按過「知道了」才算完成', () => {
    // 那一種畫得出按鈕，所以維持原本的把關
    expect(isBlockAnswered(signpostTable(), {}, '0-0')).toBe(false);
    expect(isBlockAnswered(signpostTable(), { '0-0': true }, '0-0')).toBe(true);
  });

  it('L0087 的形狀：答完該段所有題目之後，下一段要出現', () => {
    const blocks = [
      guide('一、一邊讀，一邊問自己好問題'),
      tableWithRows(),
      guide('二、先判斷：現在需要問哪一個問題'),
      tableWithRows(),
      guide('三、比較看看：自我提問後，理解有什麼不同？'),
      single('你覺得課文的作者，希望告訴讀者的是哪一個層次呢？'),
      guide('四、小試身手：在關鍵處依需求問自己一個好問題'),
      tableWithRows(),
      guide('五、換我試試看：少一點提示'),
      guide('六、我的發現與自我檢核'),
    ];
    // 段落起始只認「練習N／例N／小試身手／步驟N」，所以這一課切成兩段：
    // 第一段 = 一、二、三節；第二段 = 四（小試身手）、五、六節。
    const segments = segmentBlocks(blocks);
    expect(segments.length).toBe(2);
    expect(segments[0].map((b) => b.type)).toContain('fill_table');

    // 第一段裡唯一要作答的是那個 single（段內第 5 個位置）
    const answered = { '0-5': 0 };
    expect(isSegmentComplete(segments[0], 0, answered)).toBe(true);
    // 第二段（四、五、六節）要跟著出現 —— staging 上它永遠不出現
    expect(countVisibleSegments(segments, answered)).toBe(2);
  });
});

/**
 * 全庫棘輪：沒有任何一課的聚光燈，會有「學生永遠到不了的段」。
 *
 * 單元測試鎖的是判定函式；這一支鎖的是**真資料上的後果**。修之前 13 課中招
 * （L0030 L0034 L0063 L0071 L0076 L0087 L0090 L0096 L0097 L0103 L0123 L0165 L0179），
 * 其中 L0076 四段只看得到一段、L0096 五段看不到三段。
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';

const LESSON_DIR = resolve(__dirname, '../../../../../backend/data/lessons');

function collectBlockLists(node: unknown, out: SpotlightBlock[][] = []): SpotlightBlock[][] {
  if (Array.isArray(node)) {
    node.forEach((v) => collectBlockLists(v, out));
  } else if (node && typeof node === 'object') {
    const rec = node as Record<string, unknown>;
    if (Array.isArray(rec.blocks)) out.push(rec.blocks as SpotlightBlock[]);
    Object.values(rec).forEach((v) => collectBlockLists(v, out));
  }
  return out;
}

describe('全庫：聚光燈沒有到不了的段', () => {
  it('每一課的每一段，都在學生做得完的前提下顯示得出來', () => {
    const uids = existsSync(LESSON_DIR)
      ? readdirSync(LESSON_DIR).filter((n) => /^L\d+$/.test(n))
      : [];
    // 對照組：查法要真的看得到課，否則這條斷言什麼都沒證明
    expect(uids.length).toBeGreaterThan(100);

    const stuck: string[] = [];
    let withSpotlight = 0;
    for (const uid of uids) {
      const dir = resolve(LESSON_DIR, uid, 'v3');
      if (!existsSync(dir)) continue;
      const file = readdirSync(dir).find((n) => /^spotlight(\.[^.]+)?\.yml$/.test(n));
      if (!file) continue;
      const doc = parse(readFileSync(resolve(dir, file), 'utf8'));
      for (const blocks of collectBlockLists(doc)) {
        if (!blocks.length) continue;
        withSpotlight += 1;
        const segments = segmentBlocks(blocks);
        if (segments.length < 2) continue;
        // 把每一段裡「學生做得到的」都當成做完了，再問還有沒有段是看不到的
        const state: Record<string, unknown> = {};
        segments.forEach((seg, segIdx) =>
          seg.forEach((b, i) => {
            const key = `${segIdx}-${i}`;
            if (b.type === 'single' || b.type === 'multi') state[key] = 0;
            else if (b.type === 'free_text') state[key] = 'x';
            else if (b.type === 'self_check')
              state[key] = new Array((b as { items?: unknown[] }).items?.length ?? 1).fill(true);
            // ⛔ 這裡**只能**填「畫面上真的給了控制項」的東西。對 fill_table
            // 一律塞 true 會讓這條鎖失去牙齒 —— 它等於預設學生標得掉，而
            // 「標不掉」正是要抓的缺陷（埋 mutant 實測過：那樣寫照樣綠）。
            // 帶 rows 的表格沒有任何控制項，所以這裡不給它值。
            else if (b.type === 'highlight') state[key] = true;
            else if (b.type === 'fill_table') {
              const rows = (b as { rows?: unknown[] }).rows;
              if (!Array.isArray(rows) || rows.length === 0) state[key] = true; // 指路牌有「知道了」
            }
          }),
        );
        if (countVisibleSegments(segments, state) !== segments.length) {
          stuck.push(`${uid}（共 ${segments.length} 段，只看得到 ${countVisibleSegments(segments, state)} 段）`);
        }
        break;
      }
    }
    expect(withSpotlight).toBeGreaterThan(50);
    expect(stuck, `這些課有學生永遠到不了的段：\n  ${stuck.join('\n  ')}`).toEqual([]);
  });
});
