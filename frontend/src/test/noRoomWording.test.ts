/**
 * #3753 回歸鎖：學生／老師看得到的畫面文字不可再出現「開房」「房間」「本房」
 * 「房號」——這是給國小高年級～國中生用的產品，「開一間房」這類用語帶有不當
 * 聯想（見 issue #3753）。
 *
 * 只掃「字面字串」，不掃註解：`StudentTeamArenaPlay.tsx` 開頭的 JSDoc 與
 * `detectSideEvents.ts` 的註解合法引用了舊設計文件的措辭（如「開房者端」），
 * 這些是解釋歷史脈絡的文字，不是畫面上會出現的字。先用 `stripComments` 把
 * 區塊與行內註解剝掉，再檢查剩下的字面內容。
 *
 * 下面的 positive control 證明這條鎖不是「剛好掃到空字串」的假綠：先確認
 * 剝註解「之前」的原始檔案真的含有被禁字樣（因為它們就活在註解裡），
 * 再確認剝除之後這些字樣真的不見了。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const BANNED_TERMS = ['開房', '房間', '本房', '房號'] as const;

const SCAN_DIRS = [join(__dirname, '..', 'pages'), join(__dirname, '..', 'components')];

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
    .replace(/\/\/.*$/gm, ''); // line comments
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === '__tests__') continue;
      out.push(...sourceFiles(p));
    } else if (/\.tsx?$/.test(name) && !/\.test\./.test(name)) {
      out.push(p);
    }
  }
  return out;
}

function relLabel(p: string): string {
  return p.replace(/.*\/src\//, 'src/');
}

describe('team-arena / game UI copy never says "開房/房間/本房/房號" (#3753)', () => {
  it('known comment-only mentions still exist in the raw source (sanity check for the control below)', () => {
    const playTsx = readFileSync(
      join(__dirname, '..', 'pages', 'team-arena', 'StudentTeamArenaPlay.tsx'),
      'utf-8',
    );
    const detectSideEvents = readFileSync(
      join(__dirname, '..', 'components', 'team-arena', 'detectSideEvents.ts'),
      'utf-8',
    );
    expect(playTsx).toContain('開房');
    expect(detectSideEvents).toContain('開房');
  });

  it('after stripping comments, those same files no longer contain the banned terms', () => {
    const playTsx = stripComments(
      readFileSync(join(__dirname, '..', 'pages', 'team-arena', 'StudentTeamArenaPlay.tsx'), 'utf-8'),
    );
    const detectSideEvents = stripComments(
      readFileSync(join(__dirname, '..', 'components', 'team-arena', 'detectSideEvents.ts'), 'utf-8'),
    );
    for (const term of BANNED_TERMS) {
      expect(playTsx).not.toContain(term);
      expect(detectSideEvents).not.toContain(term);
    }
  });

  it('no literal string in pages/ or components/ contains a banned term', () => {
    const offenders: string[] = [];
    for (const dir of SCAN_DIRS) {
      for (const file of sourceFiles(dir)) {
        const stripped = stripComments(readFileSync(file, 'utf-8'));
        for (const term of BANNED_TERMS) {
          if (stripped.includes(term)) offenders.push(`${relLabel(file)}: ${term}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('stripComments actually removes a planted banned term inside both comment styles', () => {
    const blockComment = '/** 說明：開房者端會看到不同畫面 */\nconst x = 1;';
    const lineComment = '// 這裡原本是房間代碼 debug log\nconst y = 2;';
    expect(stripComments(blockComment)).not.toContain('開房');
    expect(stripComments(lineComment)).not.toContain('房間');
    const realLiteral = "const label = '房間代碼';";
    expect(stripComments(realLiteral)).toContain('房間');
  });
});
