/**
 * #3191 回歸鎖：iPad 上點一次詞語，它會選起來又立刻被取消。
 *
 * 真環境量到的（staging，`/learn/20013/vocab-definition` → 分頁「2 拖拉配對」）：
 *   iPad（真觸控 tap） → 選取中的詞 0 個，class 完全沒變
 *   桌機（滑鼠 click） → 選取中的詞 1 個
 * 同一頁、同一個選擇器，只差輸入方式 —— 桌機那組是正向對照，證明點擊有打到、
 * 選取機制本身是好的。
 *
 * 機制（另外在真瀏覽器觸控引擎上量過，雙向對照）：
 *   一次 tap 發出 [touchstart → click] 兩個事件，而 `:578` 與 `:579` 兩個 handler
 *   都呼叫同一個 `handleTouchStart`，它是純 toggle 且沒有防重入 →
 *   touchstart 選起來、模擬 click 又取消。加 `preventDefault` 的對照組留得住。
 *
 * 所以這裡**兩個事件都要發**。只發 click 的測試（既有那幾支就是）永遠看不到這個 bug。
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { DragDropMode } from '../VocabDefinitionMatchDragDrop';
import type { VocabItem } from '../../../types';

const VOCAB: VocabItem[] = [
  { word: '勤奮', definition: '努力不懈地工作或學習。' },
  { word: '謙虛', definition: '不自誇，虛心接受他人意見。' },
];

const mount = () =>
  render(
    <DragDropMode
      vocab={VOCAB}
      activeDefIndices={[0, 1]}
      shuffledWords={[0, 1]}
      onAllDone={vi.fn()}
    />,
  );

/** 詞語方塊在桌機欄與手機欄各 render 一次，兩份共用同一個 handler */
const chip = (word: string) => screen.getAllByText(word)[0];

/**
 * 真瀏覽器對一次互動實際發出的序列 —— 在 Chromium 觸控／滑鼠 context 上各量過一次：
 *   觸控 tap  : touchstart → pointerup(touch) → click
 *   滑鼠 click:              pointerup(mouse) → click
 *   拖曳      : pointerdown → dragstart → drop → dragend   （沒有 pointerup）
 * 全部發出來，才分得出元件是接對了哪一個。只發其中一個的測試看不到這類 bug。
 */
const realTap = (el: Element) => {
  fireEvent.touchStart(el);
  fireEvent.pointerUp(el);
  fireEvent.click(el);
};

const mouseClick = (el: Element) => {
  fireEvent.pointerUp(el);
  fireEvent.click(el);
};

/** 拖曳：沒有 pointerup —— 不該選起任何東西 */
const dragGesture = (el: Element) => {
  fireEvent.pointerDown(el);
  fireEvent.dragStart(el);
  fireEvent.dragEnd(el);
};

/**
 * ⚠️ 提示會 render 兩份（桌機欄 + 手機欄，跟詞語方塊一樣），
 * 所以只能用 queryAllByText —— queryByText 遇到兩個命中會直接丟例外，
 * 那會讓「機制是好的」也長得像「壞掉」。第一版就是這樣，被對照組擋下來。
 */
const hints = () => screen.queryAllByText(/已選/);
const selectionHint = () => (hints().length ? hints()[0] : null);

describe('#3191 iPad 點一次詞語要選得起來', () => {
  it('⭐ 一次 tap（touchstart + click）之後，詞語仍然是選取狀態', () => {
    mount();
    expect(selectionHint(), '一開始不該有選取提示').toBeNull();
    realTap(chip('勤奮'));
    expect(selectionHint(), 'touchstart 選起來、模擬 click 又取消 —— 點了等於沒點').not.toBeNull();
    expect(selectionHint()!.textContent).toContain('勤奮');
  });

  it('⭐ 一次 tap 之後點格子，詞語要真的放得進去（使用者的目的，不只是亮起來）', () => {
    mount();
    realTap(chip('勤奮'));
    fireEvent.click(screen.getByText('努力不懈地工作或學習。'));
    expect(selectionHint(), '放進去之後選取狀態要清掉').toBeNull();
    // 放進去的詞會從詞庫消失（或至少不再是兩份可點的）—— 用提示消失＋不再可重選來確認
    realTap(chip('謙虛'));
    expect(selectionHint()!.textContent).toContain('謙虛');
  });

  it('⭐ 連點兩次同一個詞才是取消（toggle 的原意）', () => {
    mount();
    realTap(chip('勤奮'));
    expect(selectionHint()).not.toBeNull();
    realTap(chip('勤奮'));
    expect(selectionHint(), '第二次 tap 才該取消').toBeNull();
  });

  it('⭐ tap 完換一個詞，選的是後面那個', () => {
    mount();
    realTap(chip('勤奮'));
    realTap(chip('謙虛'));
    expect(selectionHint()!.textContent).toContain('謙虛');
  });

  it('⭐ 右鍵不可以選起詞語（pointerup 對任何按鍵都發，click 只對主鍵發）', () => {
    mount();
    fireEvent.pointerUp(chip('勤奮'), { button: 2 });
    expect(selectionHint(), '右鍵選起了詞語 —— 少了 e.button 守衛').toBeNull();
  });

  it('⭐ 中鍵也不可以', () => {
    mount();
    fireEvent.pointerUp(chip('勤奮'), { button: 1 });
    expect(selectionHint()).toBeNull();
  });

  it('對照：主鍵（button=0，觸控與左鍵都是這個值）要選得起來', () => {
    mount();
    fireEvent.pointerUp(chip('勤奮'), { button: 0 });
    expect(selectionHint(), '守衛擋過頭，連正常點擊都擋掉了').not.toBeNull();
  });

  it('⭐ 捲動手勢不可以選起詞語（實測捲動發的是 pointercancel，沒有 pointerup）', () => {
    mount();
    const el = chip('勤奮');
    fireEvent.pointerDown(el);
    fireEvent.touchStart(el);
    fireEvent.touchMove(el);
    fireEvent.pointerCancel(el);
    fireEvent.touchEnd(el);
    expect(selectionHint(), '捲一下就誤選一個詞').toBeNull();
  });

  // ── 對照組：證明量具有效，也證明我沒有把滑鼠路徑弄壞 ──────────────────

  it('對照（桌機滑鼠）：pointerup + click 一樣要選得起來', () => {
    mount();
    mouseClick(chip('勤奮'));
    expect(selectionHint(), '滑鼠路徑本來就是好的，弄壞它就不是修 bug 了').not.toBeNull();
  });

  it('⭐ 觸控之後緊接著用觸控板點另一個詞，那一下不可以被吃掉', () => {
    // iPad 配鍵盤保護殼時觸控板點擊是**真的滑鼠事件**（沒有 touchstart）。
    // 我上一版用「700 毫秒內的 click 不算」認模擬 click，這一下就會被靜靜丟掉 ——
    // 比原本的 bug 更糟，因為被吞掉的是使用者真的做過的動作。
    mount();
    realTap(chip('勤奮'));
    mouseClick(chip('謙虛'));
    expect(selectionHint()!.textContent, '觸控板那一下被吃掉了').toContain('謙虛');
  });

  it('⭐ 拖曳不可以順便選起一個詞（拖曳不發 pointerup，實測過）', () => {
    mount();
    dragGesture(chip('勤奮'));
    expect(selectionHint(), '拖完還多選一個 —— 接錯事件了').toBeNull();
  });

  it('量具有效：這兩個詞真的 render 出來了，而且是各兩份', () => {
    mount();
    expect(screen.getAllByText('勤奮').length, '詞語方塊沒 render —— 下面的斷言都不算數').toBeGreaterThan(0);
    expect(screen.getAllByText('謙虛').length).toBeGreaterThan(0);
  });
});
