/**
 * 降到瀏覽器機器音時，每一個朗讀畫面都要說出來（#2930）。
 *
 * `isTtsDegraded` 就是為此而生（#2609 的修法），註解寫得很清楚：
 * 「the UI should show a visible "this isn't the AI voice" notice」。
 * 但它只有念順順接了 —— 讀全文降級時畫面一片正常，聽起來就是機器音，
 * 而使用者無從得知那不是 AI 朗讀。
 *
 * 擁有者 2026-08-26：「為什麼是機器人音？？？？？ 我們應該用 azure 啊」
 * 他是用耳朵發現的，因為畫面上什麼都沒說。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(__dirname, '../../..');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (!/node_modules|__tests__|__smoke__/.test(name)) walk(p, out); }
    else if (/\.tsx$/.test(name) && !/\.test\.tsx$/.test(name)) out.push(p);
  }
  return out;
}

/** 會播朗讀的畫面：直接或透過朗讀佇列用到 useTtsPlayback 的元件。 */
const READS_ALOUD = /useTtsPlayback|useFullTextTtsQueue|useKeyPassageReadingTtsQueue/;

describe('降級成機器音時，畫面要說出來', () => {
  const files = walk(SRC).filter((f) => READS_ALOUD.test(readFileSync(f, 'utf8')));

  it('掃描有效（正向對照：至少找得到念順順與讀全文）', () => {
    const names = files.map((f) => f.split('/').pop());
    expect(names, `掃到的朗讀畫面：${names.join(', ')}`).toEqual(
      expect.arrayContaining(['KeyPassageReading.tsx', 'FullTextAnnotate.tsx']),
    );
  });

  /**
   * 白名單：拿不到那個狀態、或不是給學生看的畫面。具名列出，不用萬用字元 ——
   * 未來新增的朗讀畫面漏接時，要讓它紅，而不是被一條寬鬆規則吸收掉。
   */
  const EXEMPT: Record<string, string> = {
    'ReadingPlayer.tsx': '純控制列，刻意不持有音訊（它自己的註解就這麼寫）',
    'ParagraphCard.tsx': '純呈現，狀態在父層 ParagraphReading',
    'LessonAudioTable.tsx': '後台試聽，已顯示 ttsError；不是學生看的畫面',
  };

  it('每一個朗讀畫面都讀了 isTtsDegraded', () => {
    const silent = files
      .filter((f) => !EXEMPT[f.split('/').pop() as string])
      .filter((f) => !/isTtsDegraded/.test(readFileSync(f, 'utf8')))
      .map((f) => f.replace(SRC, 'src'));
    expect(silent, `這些畫面降級時不會告訴使用者：\n  ${silent.join('\n  ')}`).toEqual([]);
  });
});
