/**
 * #3185 回歸鎖：段落上有標記時，注音開啟的多音字校正不可以消失。
 *
 * 壞掉的樣子（staging L20013 實測）：有老師預標的段落 4/4 個變體選擇器數為 0，
 * 沒有標記的段落全部都有。「功夫了得」的了因此唸成 ㄌㄜ˙ 而不是 ㄌㄧㄠˇ。
 *
 * 根因：renderAnnotatedContent() 在 isZhuyinAny 時把 baseText 換成 rawText
 * 再 stripPUASelectors，整段校正一起被丟掉。那是為了讓標記的原始字元索引
 * 對得上 slice 位置（PR #1155 的回歸），代價沒有被補回來也沒有被記錄。
 *
 * 所以這裡兩件事要同時成立，少一件都不算修好：
 *   (a) 校正出現在畫面上
 *   (b) 標記仍然落在正確的字上  ← 這條是 #1155，不可以為了 (a) 再壞一次
 */
import React from 'react';
import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import AnnotatedParagraph from '../AnnotatedParagraph';
import { Annotation } from '../annotationReducer';
import { DIFFICULT_SPAN_START, DIFFICULT_SPAN_END } from '../../zhuyin/bopomoConstants';
import { toRawUnits, stripPUASelectors } from '../annotationOffsets';

/** 字型的變體選擇器：ss01 = U+E01E1、ss02 = U+E01E2 …（buildZhuyinString 的輸出形狀） */
const SS = (n: number) => String.fromCodePoint(0xe01e0 + n);
const hasSel = (s: string) => /\uDB40[\uDC00-\uDFFF]/.test(s);
const stripSel = (s: string) => s.replace(/\uDB40[\uDC00-\uDFFF]/g, '');

// 功(0)夫(1)了(2)得(3)，(4)他(5)以(6)一(7)敵(8)二(9)。(10)
const RAW = '功夫了得，他以一敵二。';
/** 'all' 模式的產物：了→ss01（ㄌㄧㄠˇ）、一→ss02 */
const DISPLAY_ALL = `功夫了${SS(1)}得，他以一${SS(2)}敵二。`;

const mark = (over: Partial<Annotation> = {}): Annotation =>
  ({
    id: 'a1',
    paragraphIndex: 0,
    charStart: 6,
    charEnd: 10, // 「以一敵二」
    type: 'important',
    text: '以一敵二',
    ...over,
  }) as Annotation;

function renderPara(props: Partial<React.ComponentProps<typeof AnnotatedParagraph>> = {}) {
  const refs = { current: new Map<string, HTMLSpanElement>() };
  return render(
    <AnnotatedParagraph
      rawText={RAW}
      displayText={DISPLAY_ALL}
      paraIdx={0}
      annotations={[mark()]}
      focusedAnnotationId={null}
      isZhuyinAny
      fontSizePx={20}
      annotationElementRefs={refs}
      onRemoveAnnotation={vi.fn()}
      {...props}
    />,
  );
}

describe('#3185 有標記的段落，注音校正不可以消失', () => {
  it('⭐ 有標記 + 注音全 → 「了」仍帶 ss01（ㄌㄧㄠˇ），不是回到預設的 ㄌㄜ˙', () => {
    const { container } = renderPara();
    const text = container.textContent ?? '';
    expect(hasSel(text), '整段一個變體選擇器都沒有 = 校正被丟掉了').toBe(true);
    expect(text).toContain(`了${SS(1)}`);
  });

  it('⭐ 同段的其他多音字也要保留（一 → ss02）', () => {
    const { container } = renderPara();
    expect(container.textContent ?? '').toContain(`一${SS(2)}`);
  });

  it('校正保留之後，標記仍然畫在「以一敵二」上（#1155 不可以再壞）', () => {
    const { container } = renderPara();
    const el = container.querySelector('[role="mark"]');
    expect(el, '找不到標記').not.toBeNull();
    expect(stripSel(el!.textContent ?? '')).toBe('以一敵二');
  });

  it('⭐ 校正要活在標記「裡面」，不是只有標記外面有', () => {
    // 一（原始索引 7）落在標記的 6..10 之內。只看整段 textContent 的話，
    // 「只把標記內的選擇器剝掉」這種壞法會整組測試都綠 —— 所以這條單獨看標記。
    const { container } = renderPara();
    const mark = container.querySelector('[role="mark"]')!;
    expect(mark.textContent ?? '').toContain(`一${SS(2)}`);
  });

  it('標記的 aria-label 唸出來是乾淨的字，不夾選擇器', () => {
    const { container } = renderPara();
    const label = container.querySelector('[role="mark"]')!.getAttribute('aria-label') ?? '';
    expect(hasSel(label), 'aria-label 夾了看不見的選擇器，讀屏會唸壞').toBe(false);
    expect(label).toContain('以一敵二');
  });

  it('整段拿掉選擇器之後，字仍然跟原文一模一樣（沒有多字也沒有少字）', () => {
    const { container } = renderPara();
    expect(stripSel(container.textContent ?? '')).toBe(RAW);
  });

  // ── 對照組：這些在修之前就該是綠的，用來證明沒有把別的東西弄壞 ──────────

  it('對照：沒有標記的段落，本來就有校正（修之前修之後都一樣）', () => {
    const { container } = renderPara({ annotations: [] });
    expect(container.textContent ?? '').toContain(`了${SS(1)}`);
  });

  it('對照：注音關閉時走 displayText，行為不變', () => {
    const { container } = renderPara({ isZhuyinAny: false, displayText: RAW });
    expect(stripSel(container.textContent ?? '')).toBe(RAW);
    expect(container.querySelector('[role="mark"]')!.textContent).toBe('以一敵二');
  });

  it('對照：標記模式（#3134）仍然刻意不套注音，逐字 span 不變', () => {
    const { container } = renderPara({ markMode: true });
    expect(hasSel(container.textContent ?? ''), '標記模式不該出現選擇器').toBe(false);
    expect(container.querySelectorAll('[data-ci]').length).toBe([...RAW].length);
  });
});

describe('#3185 難字模式同樣不可以掉校正', () => {
  /** 'difficult' 模式：只有「敵二」在生字裡，而「了」的校正在標記區之外 */
  const DISPLAY_DIFFICULT =
    `功夫了${SS(1)}得，他以一${SS(2)}${DIFFICULT_SPAN_START}敵二${DIFFICULT_SPAN_END}。`;

  it('⭐ 難字模式 + 有標記 → 難字 run 之外的校正也要在', () => {
    const { container } = renderPara({ displayText: DISPLAY_DIFFICULT });
    expect(container.textContent ?? '').toContain(`了${SS(1)}`);
  });

  it('⭐ 難字模式：字型真的只套在難字 run 上（span 存在，不是只看 textContent）', () => {
    // textContent 對 flagsUsable 完全不敏感 —— 哨兵早就被剝掉、選擇器早就在 units 上，
    // 所以 flagsUsable=false 會讓這個 block 的其他測試照樣綠。要驗就得驗到 span。
    const { container } = renderPara({ displayText: DISPLAY_DIFFICULT });
    const zhuyinSpans = [...container.querySelectorAll('span')].filter((e) =>
      (e.getAttribute('style') ?? '').includes('BpmfZihiSerif'),
    );
    expect(zhuyinSpans.length, '難字 run 沒有拿到注音字型 = #3022 的字型範圍壞了').toBeGreaterThan(0);
    expect(zhuyinSpans.map((e) => stripSel(e.textContent ?? '')).join('')).toBe('敵二');
  });

  it('難字模式的哨兵標記不可以被渲染出來（它們是控制字元不是內容）', () => {
    const { container } = renderPara({ displayText: DISPLAY_DIFFICULT });
    const t = container.textContent ?? '';
    expect(t.includes(DIFFICULT_SPAN_START) || t.includes(DIFFICULT_SPAN_END)).toBe(false);
    expect(stripSel(t)).toBe(RAW);
  });
});

describe('#3185 toRawUnits：切片索引對得上，選擇器跟著它的字走', () => {
  const T = `功夫了${SS(1)}得，他以一${SS(2)}敵二。`;

  it('長度等於剝掉選擇器之後的長度 —— 所以原始字元索引可以直接當切片索引', () => {
    expect(toRawUnits(T).length).toBe(stripPUASelectors(T).length);
  });

  it('接回去等於原字串，一個字元都不會掉', () => {
    expect(toRawUnits(T).join('')).toBe(T);
  });

  it('選擇器歸給它前面那個字，不是後面那個', () => {
    const u = toRawUnits(T);
    expect(u[2]).toBe(`了${SS(1)}`);
    expect(u[3]).toBe('得');
  });

  it('任意切片都跟剝掉選擇器的同一段對齊', () => {
    const u = toRawUnits(T);
    const stripped = stripPUASelectors(T);
    for (let a = 0; a < stripped.length; a++)
      for (let b = a; b <= stripped.length; b++)
        expect(stripPUASelectors(u.slice(a, b).join(''))).toBe(stripped.slice(a, b));
  });

  it('沒有選擇器的字串：逐字元切開，行為跟 split 一樣', () => {
    expect(toRawUnits('沒有選擇器')).toEqual(['沒', '有', '選', '擇', '器']);
  });

  it('開頭就是選擇器（畸形輸入）：併進第一格，不自成一格', () => {
    // 只驗 join() 抓不到「自成一格」那種壞法 —— 那會讓 units 比 stripped 多一格，
    // 之後每個切片都往後位移一個字（#1155 的形狀）。所以直接鎖格數與格內容。
    expect(toRawUnits(`${SS(1)}字`)).toEqual([`${SS(1)}字`]);
    expect(toRawUnits(`${SS(1)}字`).length).toBe(stripPUASelectors(`${SS(1)}字`).length);
  });
});

describe('#3185 保險絲：處理後的文字對不上原文時，退回舊路徑保住標記位置', () => {
  it('displayText 剝掉選擇器後跟 rawText 不一致 → 標記仍畫在正確的字上', () => {
    // 模擬上游壞掉：處理器多吐了一個字，原始索引對它就不再可信
    const { container } = renderPara({ displayText: `【壞】功夫了${SS(1)}得，他以一敵二。` });
    const el = container.querySelector('[role="mark"]');
    expect(stripSel(el!.textContent ?? ''), '寧可沒有注音，也不可以把記號畫到別的字上').toBe('以一敵二');
  });

  it('保險絲觸發時整段內容仍是原文，不會把壞掉的字吐到畫面上', () => {
    const { container } = renderPara({ displayText: `【壞】功夫了${SS(1)}得，他以一敵二。` });
    expect(stripSel(container.textContent ?? '')).toBe(RAW);
  });
});

describe('#3185 保險絲二：兩條平行結構對不齊時，寧可沒注音也不畫錯字', () => {
  /**
   * stripPUASelectors 吃 \uDB40 + [\uDC00-\uDFFF]（U+E0000–U+E03FF），
   * toRawUnits 只吃 [\uDD00-\uDDEF]（U+E0100–U+E01EF）。
   * 落在中間的碼位（如 U+E0001 這種 tag 字元）會讓 units 比 stripped 多兩格，
   * 之後每個切片都畫到別的字上 —— 正是 PR #1155。
   * 全庫現在沒有這種碼位（掃過：只有 E01E0–E01E4），所以這是預防不是修現況。
   */
  const TAG = '\uDB40\uDC01'; // U+E0001，在 stripPUASelectors 範圍內、不在 toRawUnits 範圍內

  it('兩個剝除範圍不一致的輸入，長度確實會對不上（先證明這個風險是真的）', () => {
    const t = `功${TAG}夫`;
    expect(toRawUnits(t).length).not.toBe(stripPUASelectors(t).length);
  });

  it('⭐ 遇到那種輸入時，標記仍然落在「以一敵二」上', () => {
    const { container } = renderPara({ displayText: `功${TAG}夫了${SS(1)}得，他以一${SS(2)}敵二。` });
    const mark = container.querySelector('[role="mark"]');
    expect(mark, '找不到標記').not.toBeNull();
    expect(stripSel(mark!.textContent ?? '')).toBe('以一敵二');
  });

  it('保險絲觸發時退成純文字：整段內容仍是原文', () => {
    const { container } = renderPara({ displayText: `功${TAG}夫了${SS(1)}得，他以一${SS(2)}敵二。` });
    expect(stripSel(container.textContent ?? '')).toBe(RAW);
  });
});
