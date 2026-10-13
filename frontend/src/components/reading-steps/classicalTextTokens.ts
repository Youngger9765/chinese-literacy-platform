/**
 * The 文言文 worksheets print two marks inside the passage (#3485):
 *  - 「.」 between characters = 斷詞 (read the group together)
 *  - a number right after a word = its 注釋 entry
 * The extracted text keeps them as an ASCII "." and ASCII digits, which on
 * screen read as typos (「賈人.某，至.直隸1界」). This splits a paragraph so
 * the component can draw them as a word-group dot and a superscript.
 */
export type ClassicalToken =
  | { kind: 'text'; value: string }
  | { kind: 'dot' }
  | { kind: 'note'; value: number };

const CJK = /[㐀-鿿豈-﫿」』）)]/;

/** `noteCount` = number of 注釋 entries; only digits 1..noteCount become notes. */
export function tokenizeClassical(text: string, noteCount: number): ClassicalToken[] {
  const out: ClassicalToken[] = [];
  const push = (value: string) => {
    const last = out[out.length - 1];
    if (last && last.kind === 'text') last.value += value;
    else out.push({ kind: 'text', value });
  };
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '.') {
      out.push({ kind: 'dot' });
      i += 1;
      continue;
    }
    // The number may follow the word directly (界1) or its 斷詞 dot (胡賊.1).
    const prev = text[i - 1] === '.' ? text[i - 2] : text[i - 1];
    if (/[0-9]/.test(c) && i > 0 && prev !== undefined && CJK.test(prev)) {
      let j = i;
      while (j < text.length && /[0-9]/.test(text[j])) j += 1;
      const n = Number(text.slice(i, j));
      if (n >= 1 && n <= noteCount) {
        out.push({ kind: 'note', value: n });
        i = j;
        continue;
      }
    }
    push(c);
    i += 1;
  }
  return out;
}

export const DEFAULT_DOT_NOTE = '文章中的「·」是表示斷詞的地方，朗讀時，不要把「同組的詞」分開。';
