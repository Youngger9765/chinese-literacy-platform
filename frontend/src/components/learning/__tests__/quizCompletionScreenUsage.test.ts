/**
 * 完成卡（「你完成了！」/「全部答對！」+ 重做錯題/全部重做）只能畫一次。
 *
 * Issue #2834 (Young 2026-08-21)：「選擇題請統一用 vocab-application 的結束方式」。
 * 這個卡片 + CTA row 之前在 FillInBlankExercise.tsx 跟 VocabDefinitionMatchSummary.tsx
 * 裡各自手畫一份（同一份 tailwind class、同一句文案，複製貼上），comprehension 完全
 * 沒有。統一的做法不是給 comprehension 再貼一份第三份、而是抽成 `QuizCompletionScreen`，
 * 讓 FillInBlankExercise 跟 ComprehensionMcqPage 都改成 import 它。
 *
 * 這條鎖跟 `nextStepFooter.test.tsx` 是同一個病、同一種藥：
 * #2771 postmortem 講過，那次的鎖只抓「下一關」漏了「繼續下一步」，23 顆散在 14 個檔
 * 逃過掃描而測試本身是綠的。這次故意把 4 個觸發字串都列進來，並且對兩邊都驗證：
 *   (1) 目標消費者（FillInBlankExercise / ComprehensionMcqPage）真的 import 了共用元件
 *   (2) 除了共用元件本體跟已知例外（VocabDefinitionMatchSummary，pre-existing、
 *       out of scope），沒有第三個檔案自己手畫這段文案。
 *
 * VocabDefinitionMatchSummary 刻意排除在「不可手畫」名單外 —— 它的重複是這次改動之前
 * 就存在的技術債，不是新引入的，遷移它不在 #2834 的 scope 內。
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

const ROOT = path.resolve(__dirname, '../../..');
const SHARED_COMPONENT = path.join(ROOT, 'components/learning/QuizCompletionScreen.tsx');

// 已知、刻意不遷移的例外（pre-existing duplicate，out of scope for #2834）。
// - VocabDefinitionMatchSummary：詞語理解的完成卡，同款重複但不在這次的 scope。
// - ExitTicket：學習出場券，完全不同的步驟，不是「選擇題」。
// - ComprehensionChat：閱讀理解的舊版聊天式元件，已被 ComprehensionMcqPage 取代
//   （見 stepConfig / learningRoutes 的 'comprehension' → ComprehensionMcqPage），
//   不是這次要統一的目標路徑。
const KNOWN_EXCEPTIONS = new Set([
  'components/reading-steps/VocabDefinitionMatchSummary.tsx',
  'components/reading-steps/ExitTicket.tsx',
  'components/reading-steps/ComprehensionChat.tsx',
]);

const CONSUMERS = [
  'components/reading-steps/FillInBlankExercise.tsx',
  'pages/learning/ComprehensionMcqPage.tsx',
];

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, files);
    else if (entry.isFile() && p.endsWith('.tsx') && !p.includes('.test.')) files.push(p);
  }
  return files;
}

/**
 * 拿掉 `//` 行註解與 `/* *\/` 區塊註解 —— 這條鎖要抓的是「畫出來的文案」，不是
 * commit/comment 裡討論這個功能時提到同一組字（例如 `handleRetryWrong` 上面
 * 解釋這顆按鈕語義的中文註解）。不 strip 的話，光是解釋「這是在做重做錯題」
 * 的註解就會把鎖弄假紅，逼人拿掉有用的說明或改用不精確的詞。
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('QuizCompletionScreen 是完成卡唯一的畫法', () => {
  it('共用元件檔真的存在（掃描前提）', () => {
    expect(fs.existsSync(SHARED_COMPONENT)).toBe(true);
  });

  it.each(CONSUMERS)('%s 有 import QuizCompletionScreen', (rel) => {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    expect(src).toMatch(/from ['"].*QuizCompletionScreen['"]/);
  });

  it.each(CONSUMERS)('%s 不再自己寫死「你完成了」/「全部答對！」/「重做錯題」/「全部重做」的文案（註解裡討論這個功能不算）', (rel) => {
    const src = stripComments(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
    for (const phrase of ['你完成了', '全部答對！', '重做錯題', '全部重做']) {
      expect(src).not.toContain(phrase);
    }
  });

  it('全 repo 掃過，除了共用元件本體與已知例外，沒有第三個檔案手畫這段完成卡文案', () => {
    const files = walk(ROOT);
    expect(files.length).toBeGreaterThan(50); // 掃不到檔案的話下面恆綠

    const offenders: string[] = [];
    for (const f of files) {
      if (f === SHARED_COMPONENT) continue;
      const rel = path.relative(ROOT, f).split(path.sep).join('/');
      if (KNOWN_EXCEPTIONS.has(rel)) continue;

      const src = stripComments(fs.readFileSync(f, 'utf8'));
      // 「你完成了」跟「全部答對！」是完成卡標題的兩種措辭（allCorrect 分支）。
      // 「重做錯題」「全部重做」是 CTA row 的兩顆按鈕文字。任一個出現在非共用元件、
      // 非已知例外的檔案，就是有人又手畫了一份。
      const hit = ['你完成了', '全部答對！', '重做錯題', '全部重做'].some((phrase) => src.includes(phrase));
      if (hit) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });
});
