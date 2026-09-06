/**
 * 標記模式的段落渲染（#3134）
 *
 * 核心是三件事：逐字包 span 讓 elementFromPoint 定位得到、關掉原生選取讓 iOS
 * 不跳系統選單、索引直接對得上 `Annotation.charStart`（因為兩邊都是剝除 PUA 後的文字）。
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import MarkModeParagraph from '../MarkModeParagraph';
import { PARA_ATTR, CHAR_ATTR } from '../markModeSelection';
import type { Annotation } from '../annotationReducer';

const SEL = '\u{E01E1}';                       // 真實課文每個字後面嵌的選擇碼
const withSelectors = ['滿', '座', '皆', '驚'].map(c => c + SEL).join('');

const cells = () => [...document.querySelectorAll(`[${CHAR_ATTR}]`)];

describe('逐字 span', () => {
  it('剝掉選擇碼之後每個字一格 —— 序號就是 charStart', () => {
    render(<MarkModeParagraph rawText={withSelectors} paraIdx={2} annotations={[]} />);
    const c = cells();
    expect(c).toHaveLength(4);
    expect(c.map(e => e.textContent)).toEqual(['滿', '座', '皆', '驚']);
    expect(c.map(e => e.getAttribute(CHAR_ATTR))).toEqual(['0', '1', '2', '3']);
    expect(c.every(e => e.getAttribute(PARA_ATTR) === '2')).toBe(true);
  });

  it('⛔ 負向對照：選擇碼不可以自己佔一格 —— 佔了的話拖曳位置全部偏移', () => {
    render(<MarkModeParagraph rawText={withSelectors} paraIdx={0} annotations={[]} />);
    expect(cells()).toHaveLength(4);          // 不是 8，也不是 12
    expect(document.body.textContent).not.toContain(SEL);
  });
});

describe('關掉原生選取（iOS 選單的根因）', () => {
  it('段落設了 user-select:none 與 touch-action:none', () => {
    render(<MarkModeParagraph rawText="測試文字" paraIdx={0} annotations={[]} />);
    const p = document.querySelector('[data-mark-mode="true"]') as HTMLElement;
    expect(p, '找不到標記模式的段落').toBeTruthy();
    expect(p.style.userSelect).toBe('none');
    expect(p.style.touchAction).toBe('none');
  });
});

describe('既有記號上底色', () => {
  const ann = (over: Partial<Annotation>): Annotation => ({
    id: 'a', paragraphIndex: 0, charStart: 1, charEnd: 3, type: 'unknown', ...over,
  });

  it('學生的記號蓋在正確的字上', () => {
    render(<MarkModeParagraph rawText="滿座皆驚" paraIdx={0} annotations={[ann({})]} />);
    const c = cells();
    expect(c[0].className).toBe('');
    expect(c[1].className).toContain('bg-');
    expect(c[2].className).toContain('bg-');
    expect(c[3].className).toBe('');
  });

  it('別的段落的記號不會漏過來', () => {
    render(<MarkModeParagraph rawText="滿座皆驚" paraIdx={5} annotations={[ann({ paragraphIndex: 0 })]} />);
    expect(cells().every(e => e.className === '')).toBe(true);
  });

  it('拖曳中的暫時範圍看得到 —— 手指還沒放開就要有回饋', () => {
    render(
      <MarkModeParagraph rawText="滿座皆驚" paraIdx={0} annotations={[]}
        pending={{ charStart: 0, charEnd: 2 }} />
    );
    const c = cells();
    expect(c[0].className).toContain('bg-');
    expect(c[1].className).toContain('bg-');
    expect(c[2].className).toBe('');
  });
});
