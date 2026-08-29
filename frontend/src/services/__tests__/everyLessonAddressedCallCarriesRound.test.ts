/**
 * 只要用 `lessonId + 段落序號` 定址，就必須連篇次一起帶（#2930）。
 *
 * 那一對定址到的是整課頂層 ＝ 第 1 篇。一課印三篇時，
 * 漏帶篇次的呼叫會**靜默**唸到第 1 篇 —— 沒有錯誤、音檔照播、
 * 每一道格式門都綠，只有耳朵聽得出來。
 *
 * 所以這條鎖用靜態掃描：新增呼叫點時漏帶，這裡就會紅。
 * （不帶 lessonId 的呼叫不在管轄內 —— 那條路直接用傳進去的文字合成，本來就正確。）
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '../..');
const CALL = /\b(?:tts\.)?(speakText|prefetchText|speakTextWithProgress)\s*\(([^;]*?)\)\s*;/gs;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (!/node_modules|__tests__/.test(name)) walk(p, out); }
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

/** 逗號分隔的引數個數（忽略括號／樣板字串內的逗號）。 */
function arity(args: string): number {
  let depth = 0, n = args.trim() ? 1 : 0;
  for (const ch of args) {
    if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) depth--;
    else if (ch === ',' && depth === 0) n++;
  }
  return n;
}

describe('用課號定址的朗讀呼叫', () => {
  const files = walk(ROOT).filter((f) => !f.endsWith('ttsApi.ts'));

  it('掃描本身有效（正向對照：至少找得到已知的那幾個呼叫）', () => {
    const found = files.flatMap((f) => [...readFileSync(f, 'utf8').matchAll(CALL)]);
    expect(found.length, '一個呼叫都沒掃到 → 正則壞了，下面那條的綠沒有意義')
      .toBeGreaterThanOrEqual(3);
  });

  it('帶了課號＋段落序號的，一定也帶篇次', () => {
    const offenders: string[] = [];
    for (const f of files) {
      // 先剝掉註解 —— 註解裡寫 `speakText(text, lessonId, paragraphIdx)` 說明用法
      // 不該被當成呼叫（原本會誤報，讓真的那兩處混在雜訊裡）。
      const src = readFileSync(f, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
      for (const m of src.matchAll(CALL)) {
        const n = arity(m[2]);
        // 3 個引數 = text + lessonId + idx，少了篇次
        if (n === 3 && m[1] !== 'speakTextWithProgress') {
          const line = src.slice(0, m.index).split('\n').length;
          offenders.push(`${f.replace(ROOT, 'src')}:${line}  ${m[0].slice(0, 62).replace(/\s+/g, ' ')}`);
        }
      }
    }
    expect(offenders, `這些呼叫在多篇課會唸到第 1 篇：\n  ${offenders.join('\n  ')}`).toEqual([]);
  });
});
