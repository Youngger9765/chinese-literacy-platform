/**
 * 五個新 block type 的回歸鎖。
 *
 * 為什麼需要這一支：`multi` 的型別在 types.ts 待了很久，renderer 卻沒有對應
 * 的 case，於是 68 個 block、37 課的複選題掉進 default 分支 —— 題目印得出來、
 * 選項一個都沒有，而且沒有任何錯誤訊息。沒有測試會發現這件事，因為「畫出東西」
 * 跟「畫出正確的東西」在 render 不 throw 的層次上完全一樣。
 *
 * 所以這裡的每條斷言都問同一件事：**選項/子題/對應項有沒有真的出現在畫面上**，
 * 不是「元件有沒有 mount」。
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import BlockSequenceRenderer from '../BlockSequenceRenderer';
import type { SpotlightV2 } from '../../../types';

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ token: null, user: null }),
}));
vi.mock('../../../services/learningApi', () => ({
  validateStrategyAnswer: vi.fn(),
}));

const wrap = (blocks: unknown[]): SpotlightV2 =>
  ({
    lesson: 'TEST-L1',
    strategy_name: '測試策略',
    strategy_type: 'test',
    blocks,
  }) as SpotlightV2;

const renderSpotlight = (blocks: unknown[]) =>
  render(<BlockSequenceRenderer spotlight={wrap(blocks)} />);

describe('multi（複選題）', () => {
  const block = {
    type: 'multi',
    prompt: '哪些是小主題？',
    options: ['保護色', '竹節蟲', '偽裝'],
    answer: [0, 2],
  };

  it('每一個選項都要出現在畫面上', () => {
    renderSpotlight([block]);
    // 缺了 case 的時候，prompt 出得來、options 一個都不會出現 —— 這裡逐一斷言
    for (const opt of block.options) {
      expect(screen.getByText(new RegExp(opt))).toBeTruthy();
    }
  });

  it('選項數量要跟資料一致，不能少畫', () => {
    renderSpotlight([block]);
    expect(screen.getAllByRole('checkbox')).toHaveLength(block.options.length);
  });

  it('可以複選 —— 點兩個之後兩個都是選取狀態', () => {
    renderSpotlight([block]);
    const boxes = screen.getAllByRole('checkbox');
    fireEvent.click(boxes[0]);
    fireEvent.click(boxes[2]);
    expect(boxes[0].getAttribute('aria-checked')).toBe('true');
    expect(boxes[2].getAttribute('aria-checked')).toBe('true');
    expect(boxes[1].getAttribute('aria-checked')).toBe('false');
  });

  it('answer 等於整個 options 時（抽取器的已知缺陷）不謊報對錯', () => {
    // 現行資料有這種 block：answer 欄位把所有選項都列成答案。
    // 那種情況判不出對錯，收下作答即可，但**不可以**顯示「答對了」。
    renderSpotlight([{ ...block, answer: block.options }]);
    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    fireEvent.click(screen.getByText('確認'));
    expect(screen.queryByText(/答對了/)).toBeNull();
    expect(screen.getByText(/已作答/)).toBeTruthy();
  });
});

describe('concept_box（策略說明框）', () => {
  const text = '譬喻是把一個事物A，用另一個熟悉的事物B來說明。';

  it('說明文字要完整顯示', () => {
    renderSpotlight([{ type: 'concept_box', text }]);
    expect(screen.getByText(text)).toBeTruthy();
  });

  // ⚠️ 只斷言 text 是假綠：default 分支也會印 text，拔掉 case 測試照樣過
  //    （2026-08-17 mutation 實測，5 個 case 只有這條沒紅）。
  //    label 只有 concept_box 這條路徑會畫，所以拿它當識別。
  it('label 要畫出來 —— 這是跟 default 灰框的分辨點', () => {
    renderSpotlight([{ type: 'concept_box', text, label: '什麼是譬喻' }]);
    expect(screen.getByText('什麼是譬喻')).toBeTruthy();
  });
});

describe('matching（連連看）', () => {
  const block = {
    type: 'matching',
    label: '一、連連看',
    instruction: '請把左欄和右欄連起來',
    left: { '1': '植物肉口感與真肉相似', '2': '營養價值不輸動物肉' },
    right: { A: '蛋白質含量與動物肉相媲美', B: '口感和牛肉漢堡不分軒輊' },
    answer: { '1': ['B'], '2': ['A'] },
  };

  it('左欄每一項都要出現', () => {
    renderSpotlight([block]);
    for (const v of Object.values(block.left)) {
      expect(screen.getByText(new RegExp(v))).toBeTruthy();
    }
  });

  it('右欄每一項都要能被選到（不是只印文字）', () => {
    renderSpotlight([block]);
    const selects = screen.getAllByRole('combobox');
    expect(selects).toHaveLength(Object.keys(block.left).length);
    for (const v of Object.values(block.right)) {
      expect(screen.getAllByText(new RegExp(v)).length).toBeGreaterThan(0);
    }
  });
});

describe('sub_block（巢狀小題）', () => {
  it('巢狀的子題也要畫出來，不能只畫最外層', () => {
    renderSpotlight([
      {
        type: 'sub_block',
        label: '（一）大主題',
        stem: '這篇文章的大主題是什麼？',
        items: [
          { label: '1.', stem: '第一層子題' },
          { label: '2.', stem: '第二層子題', items: [{ stem: '更深一層的孫題' }] },
        ],
      },
    ]);
    expect(screen.getByText(/這篇文章的大主題/)).toBeTruthy();
    expect(screen.getByText(/第一層子題/)).toBeTruthy();
    expect(screen.getByText(/第二層子題/)).toBeTruthy();
    // 遞迴壞掉的話這一條會紅 —— 舊抽取正是在這裡把層級壓平的
    expect(screen.getByText(/更深一層的孫題/)).toBeTruthy();
  });

  it('子題的選項要出現', () => {
    renderSpotlight([
      { type: 'sub_block', stem: '作者想說明的事物A是：', options: { '1': '工作記憶', '2': '籃子' } },
    ]);
    expect(screen.getByText(/工作記憶/)).toBeTruthy();
    expect(screen.getByText(/籃子/)).toBeTruthy();
  });
});

describe('exercise（小試身手）', () => {
  it('代號表與每一小題都要出現', () => {
    renderSpotlight([
      {
        type: 'exercise',
        prompt: '請選出最適合用來比喻的事物',
        option_bank: { A: '扇子', G: '鑽石' },
        items: [
          { index: 1, stem: '孔雀開屏，尾巴如同張開的【　】。' },
          { index: 2, stem: '露珠像一顆顆璀璨的【　】。' },
        ],
      },
    ]);
    expect(screen.getByText(/扇子/)).toBeTruthy();
    expect(screen.getByText(/鑽石/)).toBeTruthy();
    expect(screen.getByText(/孔雀開屏/)).toBeTruthy();
    expect(screen.getByText(/璀璨/)).toBeTruthy();
  });
});

describe('未知型別仍走 default，不可讓整頁 crash', () => {
  it('沒見過的 type 至少印得出 text', () => {
    renderSpotlight([{ type: 'brand_new_type_nobody_wrote_yet', text: '暫時只印文字' }]);
    expect(screen.getByText('暫時只印文字')).toBeTruthy();
  });
});

describe('figure 帶轉錄步驟（沒有圖檔資產）', () => {
  // L0002 的三層階梯圖：字只在圖片像素裡，多模態轉錄下來但配不到圖檔。
  // 舊寫法只畫佔位方塊，轉錄到的教學內容整段消失且不報錯。
  it('配不到圖檔時，要畫出轉錄的步驟而不是佔位方塊', () => {
    renderSpotlight([
      {
        type: 'figure',
        id: '三層階梯圖',
        referent: 'diagram',
        text_carrier: 'image',
        steps: [
          { no: 1, label: '先找主題', hint: '常可在文章名稱找到' },
          { no: 2, label: '再找小主題', hint: '常可在段落前的小標題找到' },
          { no: 3, label: '補充細節', hint: '可以說明小主題的重要細節或舉例' },
        ],
      },
    ]);
    expect(screen.getByText('先找主題')).toBeTruthy();
    expect(screen.getByText('再找小主題')).toBeTruthy();
    expect(screen.getByText('補充細節')).toBeTruthy();
    expect(screen.getByText(/常可在文章名稱找到/)).toBeTruthy();
  });
});
