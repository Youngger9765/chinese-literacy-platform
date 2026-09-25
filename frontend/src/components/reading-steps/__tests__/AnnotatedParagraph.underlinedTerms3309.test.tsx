/**
 * #3309 — 專有名詞底線要真的畫在課文上，而且不可以動到字元位移。
 *
 * ⛔ 這條刻意渲染**真的元件**，不是重跑一次 `underlinedFlagsByRawIndex`。
 *    helper 的單元測試已經證明旗標算得對；那不代表它有被接上去。
 *    這個 repo 反覆出現的病正是「抽對了、算對了、學生看不到」。
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import AnnotatedParagraph from '../AnnotatedParagraph';

const base = {
  paraIdx: 0,
  annotations: [],
  focusedAnnotationId: null,
  isZhuyinAny: false,
  fontSizePx: 18,
  annotationElementRefs: { current: new Map() } as React.MutableRefObject<
    Map<string, HTMLSpanElement>
  >,
  onRemoveAnnotation: vi.fn(),
  markMode: true,
};

function cells(container: HTMLElement) {
  return Array.from(container.querySelectorAll('[data-ci]')) as HTMLElement[];
}

describe('AnnotatedParagraph — 專有名詞底線（#3309）', () => {
  it('落在詞裡的字被標記，其他字沒有', () => {
    const text = '孟嘗君逃出秦國';
    const { container } = render(
      <AnnotatedParagraph
        {...base}
        rawText={text}
        displayText={text}
        underlinedTerms={['孟嘗君', '秦國']}
      />,
    );
    const marked = cells(container).map((el) =>
      el.dataset.underlinedTerm === 'true' ? '1' : '.',
    );
    expect(marked.join('')).toBe('111..11');
  });

  it('沒有詞表時一個字都不標', () => {
    const text = '孟嘗君逃出秦國';
    const { container } = render(
      <AnnotatedParagraph {...base} rawText={text} displayText={text} />,
    );
    expect(
      cells(container).filter((el) => el.dataset.underlinedTerm === 'true'),
    ).toHaveLength(0);
  });

  it('⭐ 字元位移不受影響 —— data-ci 還是連續的 0..n-1', () => {
    // 這是整個設計的重點。插 `<u>` 會多出節點、動到 countRawChars 的基準，
    // 而那正是 #2165「側邊面板顯示錯位兩個字」的成因。
    const text = '孟嘗君逃出秦國';
    const withTerms = render(
      <AnnotatedParagraph
        {...base}
        rawText={text}
        displayText={text}
        underlinedTerms={['孟嘗君', '秦國']}
      />,
    );
    const without = render(
      <AnnotatedParagraph {...base} rawText={text} displayText={text} />,
    );
    const idx = (c: HTMLElement) => cells(c).map((el) => el.dataset.ci).join(',');
    expect(idx(withTerms.container)).toBe('0,1,2,3,4,5,6');
    // 有沒有底線，索引序列必須完全一樣
    expect(idx(withTerms.container)).toBe(idx(without.container));
    // 文字內容也必須一字不差
    expect(withTerms.container.textContent).toBe(without.container.textContent);
  });

  it('詞表裡有課文沒有的詞時，不會亂標', () => {
    const text = '孟嘗君逃出秦國';
    const { container } = render(
      <AnnotatedParagraph
        {...base}
        rawText={text}
        displayText={text}
        underlinedTerms={['韓信', '屈原']}
      />,
    );
    expect(
      cells(container).filter((el) => el.dataset.underlinedTerm === 'true'),
    ).toHaveLength(0);
  });
});
