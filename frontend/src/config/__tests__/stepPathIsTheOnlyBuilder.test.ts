import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 沒有人可以自己組步驟網址 —— 一律走 `stepPath`（#2916）。
 *
 * `navigate(`/learn/${id}/${step.id}`)` 會把帶輪次的 step id
 * （`full-text-annotate#p3kud`）整個塞進路徑，`#` 之後變成 fragment，
 * 前端讀不到 → 三篇的網址不一樣、slug 也對，**內容卻一模一樣**。
 *
 * 2026-08-25 staging 實測到這件事時，`stepPath` 這種 helper 還不存在；
 * 六個導向點各自手組路徑，改一個不會讓其他五個跟著對。
 * 所以這條鎖的不是 helper 對不對，是**有沒有人繞過它**。
 */
const SRC = join(__dirname, '..', '..');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((e) => {
    const f = join(dir, e);
    if (statSync(f).isDirectory()) return walk(f);
    return /\.tsx?$/.test(e) ? [f] : [];
  });
}

describe('stepPath 是唯一的步驟網址組法', () => {
  const files = walk(SRC).filter((f) => !/\.test\.|__tests__|stepPath\.ts$/.test(f));

  it('掃得到檔案 —— 少了這條，下面那條可能在掃空集合', () => {
    expect(files.length).toBeGreaterThan(200);
  });

  it('沒有人用樣板字串自己組 `/learn/{id}/{step}`', () => {
    // 帶兩個以上插值的 `/learn/...` 樣板 = 在組步驟路徑
    const re = /`\/learn\/\$\{[^`]*\}\/\$\{[^`]*\}`/;
    const offenders = files
      .map((f) => [f, readFileSync(f, 'utf8')] as const)
      .filter(([, s]) => re.test(s))
      .map(([f]) => f.replace(SRC, 'src'));
    expect(offenders, `這些檔自己組步驟網址，改走 stepPath()：\n  ${offenders.join('\n  ')}`)
      .toEqual([]);
  });
});
