/**
 * 課程簡介的跳轉清單不可以自稱是「本課的步驟總數」。
 *
 * 清單刻意排除 `lesson-intro`（人就在那頁），底部進度條卻把簡介算進去 ——
 * 於是學生同時看到「本課共 10 個步驟」和「第 11 步」。三課實測都差一：
 * 20003 → 10 / 11、20011 → 9 / 10、20001 → 10 / 11。
 *
 * 掃原始碼，因為要鎖的是**用詞**：清單本身沒錯，錯的是它宣稱自己是什麼。
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

const INTRO = path.resolve(__dirname, '../Intro.tsx');

describe('課程簡介的步驟清單不謊報總數', () => {
  const src = fs.readFileSync(INTRO, 'utf-8');

  it('清單確實排除了 lesson-intro（前提，否則這條在測空氣）', () => {
    expect(src).toMatch(/filter\(\s*s\s*=>\s*s\.id\s*!==\s*'lesson-intro'\s*\)/);
  });

  it('不可以用「本課共 N」這種總數說法', () => {
    // 只看 JSX 文字，不看註解 —— 註解裡解釋這段歷史是應該的
    const codeOnly = src
      .split('\n')
      .filter((l) => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(l))
      .join('\n');
    const offenders = codeOnly
      .split('\n')
      .filter((l) => /本課共\s*\{/.test(l));
    expect(
      offenders,
      `這段文字會跟底部「第 N / N+1 步」打架：\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('用的是不含總數承諾的說法', () => {
    expect(src).toMatch(/接下來還有\s*\{digitalSteps\.length\}\s*個步驟/);
  });
});
