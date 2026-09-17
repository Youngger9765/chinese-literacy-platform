/**
 * 調門檻不可以把說明面板關掉（#3257）
 *
 * ## 為什麼有這一支
 *
 * 2026-09-18 在 preview 上實測到的：面板正在解釋「錯幾次才標」，而門檻的 −／＋ 就在
 * 它旁邊 —— 按下去會被外點判定當成「點到面板外面」而關閉。使用者剛讀到那句解釋、
 * 一動手就把解釋弄消失了。
 *
 * 留著不關還有一個更重要的作用：調數字的時候面板上那排字會**當場變多變少**，
 * 面板因此從「宣稱規則」變成「示範規則」。
 *
 * ⚠️ 這支必須 render `ZhuyinToggle`（而不是單獨 render 面板）—— 要鎖的正是
 * 「兩個相鄰元件之間」的關係，`data-zhuyin-controls` 掛在 toggle 上、判定寫在面板裡。
 * 只測面板的話這條關係測不到。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import ZhuyinToggle from '../ZhuyinToggle';

afterEach(() => { document.body.innerHTML = ''; });

function renderDifficult() {
  render(
    <div>
      <button type="button">外面的某個按鈕</button>
      <ZhuyinToggle
        mode="difficult"
        ready
        onModeChange={() => {}}
        difficultThreshold={2}
        onThresholdChange={() => {}}
      />
    </div>,
  );
  fireEvent.click(screen.getByRole('button', { name: '這些字為什麼有注音' }));
  expect(screen.getByRole('dialog')).toBeTruthy();
}

describe('#3257 面板與門檻控制項的關係', () => {
  it('⭐ 按門檻的「＋」時面板要留著', () => {
    renderDifficult();
    fireEvent.mouseDown(screen.getByRole('button', { name: '提高難字門檻（標更少字）' }));
    expect(
      screen.queryByRole('dialog'),
      '面板在講門檻是什麼意思，一按門檻就關掉等於解釋自己消失',
    ).toBeTruthy();
  });

  it('⭐ 按門檻的「−」時面板要留著', () => {
    renderDifficult();
    fireEvent.mouseDown(screen.getByRole('button', { name: '降低難字門檻（標更多字）' }));
    expect(screen.queryByRole('dialog')).toBeTruthy();
  });

  it('負向對照：點控制群以外的東西還是要關 —— 不可以變成關不掉', () => {
    renderDifficult();
    fireEvent.mouseDown(screen.getByRole('button', { name: '外面的某個按鈕' }));
    expect(
      screen.queryByRole('dialog'),
      '少了這條，「永遠不關」也會讓上面兩條綠',
    ).toBeNull();
  });

  it('負向對照：點頁面空白處也要關', () => {
    renderDifficult();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('非難字模式下不該有說明鈕（那時沒有難字可以解釋）', () => {
    render(<ZhuyinToggle mode="all" ready onModeChange={() => {}} />);
    expect(screen.queryByRole('button', { name: '這些字為什麼有注音' })).toBeNull();
  });
});
