/**
 * 練習工具箱在導覽上必須到不了（Young 2026-08-20 指示，#2801）。
 *
 * #2801 只清了側欄，**首頁那顆「看更多 →」漏掉了** —— 於是學生從主頁一鍵
 * 就進得去 `/tools`，等於沒有隱藏。同一次還留下一支斷言「側欄要有練習工具箱」
 * 的舊測試，而它不在 CI 的具名清單裡，所以 staging 紅著也沒人知道。
 *
 * 這條掃全部原始碼，用數量斷言（漏接數 == 0），不是「檢查某一個檔」。
 * `/tools` 路由本身保留，既有連結／書籤不會變 404 —— 要擋的是導覽入口。
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

const SRC = path.resolve(__dirname, '../../..');

/** 工具箱自己的檔案：在裡面「回到工具箱」是正常的，不算外部入口 */
const INSIDE_TOOLBOX = [
  /components[/\\]tools[/\\]/,
  /pages[/\\]student[/\\]PracticeToolbox\.tsx$/,
  /routes[/\\]AppRoutes\.tsx$/,
  /services[/\\]toolboxApi\.ts$/,
];

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(tsx?|jsx?)$/.test(e.name) && !/\.test\./.test(e.name)) out.push(p);
  }
  return out;
}

describe('練習工具箱在導覽上到不了', () => {
  const files = walk(SRC);

  it('掃到的檔案數要夠多（否則這條在測空氣）', () => {
    expect(files.length).toBeGreaterThan(200);
  });

  it('沒有任何檔案在工具箱之外導到 /tools', () => {
    const offenders: string[] = [];

    for (const f of files) {
      if (INSIDE_TOOLBOX.some((re) => re.test(f))) continue;
      const src = fs.readFileSync(f, 'utf-8');
      const lines = src.split('\n');
      lines.forEach((line, i) => {
        if (!/['"`]\/tools['"`]/.test(line)) return;
        // 純註解不算
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
        // 只有在 toolbox 模式下才回工具箱的，是內部返回不是入口。
        // 守衛常寫在前幾行（`if (inToolbox) {` 換行後才 navigate），
        // 所以要看一個小窗口 —— 只看同一行會把已經守好的判成漏接，
        // 而會誤報的 gate 最後會被關掉。
        const window = lines.slice(Math.max(0, i - 4), i + 1).join('\n');
        if (/isToolboxMode\(\)|inToolbox|toolboxMode/.test(window)) return;
        offenders.push(`${path.relative(SRC, f)}:${i + 1}  ${line.trim().slice(0, 70)}`);
      });
    }

    expect(offenders, `這些地方還導得到練習工具箱：\n${offenders.join('\n')}`).toEqual([]);
  });
});
