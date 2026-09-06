/**
 * 標記模式接線（#3134）—— 鎖的是「加法」這個設計決定
 *
 * 這個修法刻意做成加法：**模式關閉時，行為必須跟改之前完全一樣**。
 * 桌機使用者無感、原生選取那條路一行沒動，兩條路都測得到。
 *
 * 這一支不驗 iPad 上的手勢（那要真機，是 Hans 的驗收條件 2），
 * 驗的是原始碼層級的接線正確：模式關閉時不掛拖曳、不關選取、不換渲染器。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'FullTextAnnotate.tsx'),
  'utf-8',
);

describe('模式關閉時，一切照舊', () => {
  it('user-select 只有在模式開啟時才關掉', () => {
    expect(src).toContain("userSelect: markMode ? 'none' : 'text'");
  });

  it('拖曳只在模式開啟時掛上 —— 關閉時是 undefined，不攔任何手勢', () => {
    expect(src).toContain('onMouseDown={markMode ? handleMarkDragStart : undefined}');
    expect(src).toContain('onTouchStart={markMode ? handleMarkDragStart : undefined}');
  });

  it('原本的 handleMouseUp / handleTouchEnd 在模式關閉時仍然是那一支', () => {
    expect(src).toContain('markMode ? handleMarkDragEnd : handleMouseUp');
    expect(src).toContain('markMode ? handleMarkDragEnd : handleTouchEnd');
  });

  it('渲染器有兩條路，模式關閉走原本的 AnnotatedParagraph', () => {
    expect(src).toContain('{markMode ? (');
    expect(src).toContain('<MarkModeParagraph');
    expect(src).toContain('<AnnotatedParagraph');
  });
});

describe('拖曳定位用對機制', () => {
  it('用 elementFromPoint，⛔ 不用 caretRangeFromPoint', () => {
    expect(src).toContain('document.elementFromPoint');
    // ⚠️ 只看**實際呼叫**，不看註解 —— 檔案裡確實提到這個名字，因為註解在
    //    說明「為什麼不用它」。第一版沒排除註解，於是這條紅在自己的說明文字上。
    const calls = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(
      calls.includes('caretRangeFromPoint'),
      'caretRangeFromPoint 在 user-select:none 下回傳課文外的節點（Hans iPad 實測）',
    ).toBe(false);
  });

  it('拖曳結束後有清掉暫存狀態 —— 不清的話下一次拖曳會接續上一次的起點', () => {
    // ⚠️ 用**次數**不用「有沒有」：`handleMarkDragEnd` 兩條分支（沒有範圍就直接
    //    清掉、有範圍就先寫入再清掉）各要清一次。只驗 toContain 的話，刪掉其中
    //    一條照樣綠 —— mutation 當場證明了這件事。
    const clears = (src.match(/setDragAnchor\(null\)/g) || []).length;
    expect(clears, '兩條分支都要清起點').toBeGreaterThanOrEqual(2);
    expect((src.match(/setPendingRange\(null\)/g) || []).length).toBeGreaterThanOrEqual(2);
  });
});

describe('模式切換鈕', () => {
  it('兩種記號各一顆，再按一次關掉模式', () => {
    expect(src).toContain("['unknown', '❓', '不懂'], ['important', '💛', '重要']");
    expect(src).toContain('setMarkMode((m) => (m === kind ? null : kind))');
  });

  it('有 aria-pressed —— 螢幕閱讀器要知道模式開著', () => {
    expect(src).toContain('aria-pressed={markMode === kind}');
  });
});
