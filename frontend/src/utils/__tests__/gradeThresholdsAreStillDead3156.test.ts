/**
 * 那幾個分年級門檻常數**仍然沒有正式消費端**（#3156 ④）。
 *
 * ## 這條鎖在守什麼
 *
 * `personaConfig.ts` 與 `fluencyAnalyzer.ts` 現在有一大段註解寫著「這些是死的，
 * 學生看到的判定在 `GoalAchievementCard`」。那段註解是**唯一**阻止下一個人重蹈覆轍
 * 的東西 —— 2026-09-26 我就是沒查消費端，把 `passed` 的語意改掉、寫了鎖、跑了
 * mutation，整輪做完才被複審擋下，因為那個值根本沒有人讀。
 *
 * 註解會過期。所以這條鎖把它釘住：**有人真的接線時它會紅**，逼那個人回來
 * 把註解一起改掉，而不是留一段跟現實相反的說明給再下一個人。
 *
 * ⛔ 這不是在禁止接線。要做分年級就去做 —— 只是做的時候這條會紅，
 *    提醒你連同註解與 #3156 ④ 的結論一起更新（尤其那個「接上去會讓通過數
 *    從 16 掉到 6」的實測）。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.resolve(__dirname, '../..');

/** ⚠️ 比對前一定要剝註解 —— 這個 repo 2026-09-17 一天三次被自家的門 regex 到註解，
 *  而這次要找的名字正好大量出現在我新寫的說明裡。 */
function stripComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => {
      let out = '';
      let inStr: string | null = null;
      for (let i = 0; i < l.length; i++) {
        const c = l[i];
        if (inStr) {
          out += c;
          if (c === '\\') { out += l[++i] ?? ''; continue; }
          if (c === inStr) inStr = null;
          continue;
        }
        if (c === '"' || c === "'" || c === '`') { inStr = c; out += c; continue; }
        if (c === '/' && l[i + 1] === '/') break;
        out += c;
      }
      return out;
    })
    .join('\n');
}

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === '__tests__' || e.name === 'node_modules') continue;
        walk(p);
      } else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
        out.push(p);
      }
    }
  };
  walk(SRC);
  return out;
}

const FILES = sourceFiles();
const OWN = new Set(['utils/personaConfig.ts', 'utils/fluencyAnalyzer.ts'].map((f) => path.join(SRC, f)));

function consumersOf(symbol: string): string[] {
  const re = new RegExp(`\\b${symbol}\\b`);
  return FILES.filter((f) => !OWN.has(f) && re.test(stripComments(fs.readFileSync(f, 'utf-8'))))
    .map((f) => path.relative(SRC, f));
}

describe('對照組 —— 先證明這個查法找得到東西', () => {
  it('掃到的原始碼檔案數量合理', () => {
    expect(FILES.length).toBeGreaterThan(200);
  });

  it('一個真的有人用的符號要找得到（不然下面的 0 什麼都不證明）', () => {
    expect(consumersOf('cleanChineseText').length).toBeGreaterThan(5);
  });

  it('剝註解真的有作用 —— 只出現在註解裡的名字不算命中', () => {
    const fake = 'ZZ_ONLY_IN_A_COMMENT_3156';
    const src = `// ${fake}\nconst x = 1;`;
    expect(new RegExp(`\\b${fake}\\b`).test(src)).toBe(true);
    expect(new RegExp(`\\b${fake}\\b`).test(stripComments(src))).toBe(false);
  });
});

describe('分年級門檻仍然沒有接線（#3156 ④）', () => {
  it.each(['GRADE_CPM_DEFAULTS', 'getThresholdsFromBenchmark', 'FULLREADING_CPM_PASS'])(
    '%s 沒有正式消費端',
    (symbol) => {
      const found = consumersOf(symbol);
      expect(
        found,
        `${symbol} 現在有人用了（${found.join(', ')}）。\n` +
          '這不是壞事 —— 但 personaConfig.ts / fluencyAnalyzer.ts 裡那段「這些是死的」的說明\n' +
          '現在變成假的了，請連同 #3156 ④ 的結論一起更新，特別是：\n' +
          '  getThresholdsFromBenchmark 取的是三段式評量表**中間那段的下界**，\n' +
          '  prod 實測接上去之後通過數 16 → 6，14 筆改判全部是「本來過、改完不過」。',
      ).toEqual([]);
    },
  );

  it('analyzeFluency 回的 passed 沒有正式消費端', () => {
    const re = /\.passed\b/;
    const found = FILES.filter((f) => {
      const rel = path.relative(SRC, f);
      // GoalAchievementCard 的 g.passed 是它自己算的 goals，不是 fluency 的
      if (OWN.has(f) || rel.includes('GoalAchievementCard')) return false;
      return re.test(stripComments(fs.readFileSync(f, 'utf-8')));
    }).map((f) => path.relative(SRC, f));
    expect(
      found,
      `有人開始讀 .passed 了（${found.join(', ')}）—— 請確認讀的是不是 analyzeFluency 那個，\n` +
        '若是，fluencyAnalyzer.ts 裡「沒有任何人讀」那段註解要改掉。',
    ).toEqual([]);
  });
});

describe('學生真正看到的判定仍然是兩條平線', () => {
  it('GoalAchievementCard 用 cpmPassed && accPassed', () => {
    const src = fs.readFileSync(path.join(SRC, 'components/ui/GoalAchievementCard.tsx'), 'utf-8');
    const code = stripComments(src);
    expect(code).toMatch(/cpmPassed\s*=\s*actualCpmVal\s*>=\s*effectiveCpm/);
    expect(code).toMatch(/accPassed\s*=\s*actualAccVal\s*>=\s*effectiveAccuracy/);
    expect(code).toMatch(/allPassed\s*=\s*cpmPassed\s*&&\s*accPassed/);
  });
});
