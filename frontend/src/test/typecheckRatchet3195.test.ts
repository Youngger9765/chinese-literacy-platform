/**
 * #3195 回歸鎖：型別檢查棘輪。
 *
 * 這道門的存在理由是「抽對了、門全綠、學生看不到」—— 前後端形狀不一致，
 * 而唯一靜態抓得到它的工具沒有接線。所以這裡測的是**判斷邏輯本身**：
 * 哪些錯算數、什麼時候該紅、紅的時候說不說得出是哪幾條。
 *
 * ⚠️ 跑 tsc 本身不在這裡測（那是 workflow 的事）。這裡餵的是 tsc 的輸出文字，
 *    所以測得到「輸出長這樣時，這道門會怎麼判」，而不是「tsc 有沒有裝好」。
 */
import { describe, it, expect } from 'vitest';
import { isShippedCode, parseErrors, evaluateRatchet, CURRENT_SCHEMA_VERSION } from '../../scripts/typecheckRatchet.mjs';

const SHIPPED = `src/services/api.ts(281,5): error TS2322: Type 'any[]' is not assignable.
src/components/reading-spotlight/BlockSequenceRenderer.tsx(44,9): error TS2339: Property 'x' does not exist.`;
const TESTS = `src/pages/teacher/__tests__/Foo.test.tsx(10,1): error TS2345: Argument of type.
src/components/ui/__tests__/Bar.test.tsx(3,2): error TS2304: Cannot find name.
src/__smoke__/render-smoke.test.tsx(9,1): error TS2339: Property 'y' does not exist.
src/test/setup.ts(1,1): error TS2304: Cannot find name 'foo'.`;

describe('#3195 哪些錯算進棘輪', () => {
  it('出貨程式碼算', () => {
    expect(isShippedCode('src/services/api.ts')).toBe(true);
    expect(isShippedCode('src/components/reading-spotlight/BlockSequenceRenderer.tsx')).toBe(true);
  });

  it('⭐ 測試檔不算（四種形狀都要認得）', () => {
    for (const f of [
      'src/pages/teacher/__tests__/Foo.test.tsx',
      'src/components/ui/__tests__/Bar.tsx',
      'src/__smoke__/render-smoke.test.tsx',
      'src/test/setup.ts',
      'src/utils/encouragement.test.ts',
    ]) {
      expect(isShippedCode(f), `${f} 不該算進棘輪`).toBe(false);
    }
  });

  it('⭐ 每個排除分支都要有「只有它擋得住」的案例', () => {
    // ⚠️ 第一版每個例子都同時符合檔名 regex（`*.test.tsx`），所以把 `__smoke__` 或
    //    `tests` 那兩個分支整個拿掉，12 條照樣全過 —— 那兩條分支等於沒被測到。
    //    這裡的四個例子刻意**不帶** .test/.spec 檔名，只有對應的路徑片段擋得住。
    expect(isShippedCode('src/__smoke__/Helper.tsx'), '__smoke__ 分支沒被測到').toBe(false);
    expect(isShippedCode('src/pages/tests/Recorder.tsx'), 'tests（複數）分支沒被測到').toBe(false);
    expect(isShippedCode('src/components/__tests__/Helper.tsx'), '__tests__ 分支沒被測到').toBe(false);
    expect(isShippedCode('src/test/setup.ts'), 'test（單數）分支沒被測到').toBe(false);
  });

  it('⭐ scripts/eval 的 *.eval.ts 不算出貨（它刻意不進 CI、會打真的 staging）', () => {
    expect(isShippedCode('scripts/eval/tts-alignment.eval.ts')).toBe(false);
    expect(isShippedCode('src/utils/evaluate.ts'), 'evaluate.ts 不是 eval 檔，不可以誤擋').toBe(true);
  });

  it('⭐ 名字裡剛好有 test 的出貨檔不可以被誤判（testset / latest / contest）', () => {
    for (const f of ['src/pages/testset/Recorder.tsx', 'src/utils/latestVersion.ts', 'src/components/ContestBanner.tsx']) {
      expect(isShippedCode(f), `${f} 是出貨程式碼，不該被當成測試`).toBe(true);
    }
  });
});

describe('#3195 從 tsc 輸出數出貨錯誤', () => {
  it('只數出貨那幾條', () => {
    const r = parseErrors([SHIPPED, TESTS].join('\n'));
    expect(r.shipped.length).toBe(2);
    expect(r.test.length).toBe(4);
  });

  it('⭐ 每一條都要留住「哪個檔、哪一行、哪個錯碼」，否則紅了也講不出是什麼', () => {
    const [first] = parseErrors(SHIPPED).shipped;
    expect(first.file).toBe('src/services/api.ts');
    expect(first.line).toBe(281);
    expect(first.code).toBe('TS2322');
  });

  it('空輸出 = 零個錯，不可以丟例外', () => {
    expect(() => parseErrors('')).not.toThrow();
    expect(parseErrors('').shipped.length).toBe(0);
  });

  it('⭐ 認不得的行不可以被靜靜吞掉（那會讓真的錯誤變成 0）', () => {
    const r = parseErrors('這一行不是 tsc 的錯誤格式\n' + SHIPPED);
    expect(r.unparsed.length, '不認得的行要被回報，不是丟掉').toBe(1);
  });
});

describe('#3195 棘輪怎麼判', () => {
  const mk = (n: number) => Array.from({ length: n }, (_, i) => ({ file: `src/a${i}.ts`, line: i, code: 'TS2339', text: `err ${i}` }));

  it('⭐ 比基準多 → 紅，而且說得出多的是哪幾條', () => {
    const base = mk(2);
    const now = [...base, { file: 'src/new.ts', line: 9, code: 'TS2322', text: 'the new one' }];
    const v = evaluateRatchet(now, 2, base, CURRENT_SCHEMA_VERSION);
    expect(v.ok).toBe(false);
    expect(v.added.length).toBe(1);
    expect(v.added[0].file).toBe('src/new.ts');
    expect(v.message).toContain('src/new.ts');
  });

  it('跟基準一樣 → 綠', () => {
    expect(evaluateRatchet(mk(39), 39, mk(39), CURRENT_SCHEMA_VERSION).ok).toBe(true);
  });

  it('⭐ 比基準少 → 綠，而且提示把基準調降（棘輪要收緊）', () => {
    const v = evaluateRatchet(mk(30), 39, mk(39), CURRENT_SCHEMA_VERSION);
    expect(v.ok).toBe(true);
    // ⚠️ 第一版這裡比對 /調降|降到|baseline/，但「降到」出現在「型別錯誤從 39 降到 30」
    //    那句 —— 那句不管有沒有提示都會在，所以那條斷言為它宣稱檢查的事情**無法失敗**。
    //    突變（把提示整段換成「很好。」）證明了這點：12 條照樣全過。
    //    改成比對那句**可執行的指示**：要動的是哪個檔、改成什麼數字。
    expect(v.message, '少了卻不說要改哪個檔，棘輪就永遠停在舊數字')
      .toContain('typecheck-baseline.json');
    expect(v.message).toContain('shippedErrors');
    expect(v.message, '要說出調降到多少').toMatch(/調降到 30|shippedErrors.*30/);
  });

  it('⭐ 總數沒變但換了檔案 → 仍要紅（否則修一個加一個就溜過去了）', () => {
    const base = [{ file: 'src/old.ts', line: 1, code: 'TS2339', text: 'old' }];
    const now  = [{ file: 'src/new.ts', line: 1, code: 'TS2339', text: 'new' }];
    const v = evaluateRatchet(now, 1, base, CURRENT_SCHEMA_VERSION);
    expect(v.ok, '數字相同但內容換了，等於新增了一個錯').toBe(false);
    expect(v.added[0].file).toBe('src/new.ts');
  });

  it('⭐ 同一個檔、同一個錯碼，但換成不同的錯 → 要算新增（一換一不可以隱形）', () => {
    const base = [{ file: 'src/services/api.ts', line: 10, code: 'TS2339', text: '舊的那個錯' }];
    const now  = [{ file: 'src/services/api.ts', line: 10, code: 'TS2339', text: '完全不同的新錯' }];
    const v = evaluateRatchet(now, 1, base, CURRENT_SCHEMA_VERSION);
    expect(v.ok, '修好一個、同檔同碼新增一個，數量沒變但那是新的錯').toBe(false);
    expect(v.added[0].text).toContain('新錯');
  });

  it('行號位移不可以被當成新增（無關的編輯天天在動行號）', () => {
    const base = [{ file: 'src/a.ts', line: 10, code: 'TS2339', text: '同一個錯' }];
    const now  = [{ file: 'src/a.ts', line: 87, code: 'TS2339', text: '同一個錯' }];
    expect(evaluateRatchet(now, 1, base, CURRENT_SCHEMA_VERSION).ok, '只是行號變了就報紅，這道門會被關掉').toBe(true);
  });

  it('⭐ 把既有錯誤搬到別的檔會被判成新增 —— 訊息要說得出怎麼處理（刻意的取捨）', () => {
    const base = [{ file: 'src/old/Foo.tsx', line: 1, code: 'TS2339', text: '同一個錯' }];
    const now  = [{ file: 'src/new/Foo.tsx', line: 1, code: 'TS2339', text: '同一個錯' }];
    const v = evaluateRatchet(now, 1, base, CURRENT_SCHEMA_VERSION);
    expect(v.ok).toBe(false);
    expect(v.message, '搬檔被擋下來卻不說怎麼辦，這道門會很煩人').toContain('--write-baseline');
    expect(v.message).toContain('搬檔');
  });

  it('⭐ 基準檔的格式版本不符 → 直接說是格式問題，不列「新增」清單', () => {
    // 實際踩過：把 keyOf 從 file|code 改成 file|code|text 而基準只存了 file 與 code，
    // 39 條全部對不上 → 訊息說「新增的 39 個」，那會讓人去追一個不存在的回歸。
    //
    // ⚠️ 第一版我改用「file+code 重疊率 > 80%」去反推成因。那行不通 ——
    //    「同檔同碼換成另一個錯」放大之後重疊率也是 100%，而那是**真的回歸**。
    //    兩種成因在那個軸上分不開，任何門檻都會錯。改成直接查版本號。
    const base = Array.from({ length: 5 }, (_, i) => ({ file: `src/a${i}.ts`, line: 1, code: 'TS2339', text: '' }));
    const now = Array.from({ length: 5 }, (_, i) => ({ file: `src/a${i}.ts`, line: 1, code: 'TS2339', text: '真的訊息' }));
    const v = evaluateRatchet(now, 5, base, 1);   // 基準是舊格式
    expect(v.ok).toBe(false);
    expect(v.message).toContain('格式版本');
    expect(v.message).toContain('write-baseline');
    expect(v.added.length, '格式對不上時算出來的清單沒有意義，不該列').toBe(0);
  });

  it('⭐ 版本對但檔案被手改壞（少了 text）→ 要說是檔案的問題，不是「全部都是新的」', () => {
    // 版本檢查對這種情況結構性地看不見：它只讀宣告的數字，而壞掉的檔正是在那說謊。
    const base = Array.from({ length: 4 }, (_, i) => ({ file: `src/a${i}.ts`, line: 1, code: 'TS2339' })) as never[];
    const v = evaluateRatchet(base as never[], 4, base, CURRENT_SCHEMA_VERSION);
    expect(v.ok).toBe(false);
    expect(v.message).toContain('text');
    expect(v.message).toContain('write-baseline');
    expect(v.added.length, '檔案壞掉時算出來的清單沒有意義').toBe(0);
  });

  it('⭐ 同檔同碼的大規模一換一 → 版本相符，所以是真回歸，要列出清單', () => {
    // 這是重疊率那套會判錯的情境：重疊率 100%，但每一條都是不同的錯。
    const base = Array.from({ length: 6 }, (_, i) => ({ file: `src/hot${i}.tsx`, line: 10, code: 'TS2339', text: `舊錯 ${i}` }));
    const now = base.map((e, i) => ({ ...e, line: e.line + 500, text: `完全不同的新錯 ${i}` }));
    const v = evaluateRatchet(now, 6, base, CURRENT_SCHEMA_VERSION);
    expect(v.ok).toBe(false);
    expect(v.message, '真回歸不可以被講成格式問題').not.toContain('格式版本');
    expect(v.message, '要把清單印出來給人看').toContain('完全不同的新錯 0');
    expect(v.added.length).toBe(6);
  });

  it('⭐ 基準沒有版本欄位（更舊的格式）也要被認出來', () => {
    const base = [{ file: 'src/a.ts', line: 1, code: 'TS2339', text: 'x' }];
    const v = evaluateRatchet(base, 1, base, undefined);
    expect(v.ok).toBe(false);
    expect(v.message).toContain('格式版本');
  });

  it('沒有基準清單時（第一次接線）只比數字', () => {
    expect(evaluateRatchet(mk(39), 39, null, CURRENT_SCHEMA_VERSION).ok).toBe(true);
    expect(evaluateRatchet(mk(40), 39, null, CURRENT_SCHEMA_VERSION).ok).toBe(false);
  });
});
