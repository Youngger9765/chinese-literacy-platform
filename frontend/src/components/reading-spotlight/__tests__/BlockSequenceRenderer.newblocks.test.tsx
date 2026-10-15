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

  /**
   * #3559 / #3562 回歸鎖 —— 現場老師回報「聚光燈沒有選項可以點」
   * 「填答時沒有辦法作答」，真環境（staging，lesson 20016 聚光燈 7/11）
   * 用 gstack browse 重現：帶 `answer` 的子題選項畫出來的是純文字
   * `<div>`（只有一個 aria-hidden 的 ☐ 符號），完全沒有 onClick / button /
   * role，手指怎麼點都沒有任何反應。
   *
   * 這條鎖只問一件事：帶 `options` + `answer` 的巢狀子題，畫出來的
   * 選項必須是**真的可以互動的控制項**（role=button），不能只是印文字。
   * 舊版本這條會紅：之前的 renderSubBlock 把每個選項畫成純文字 <div>，
   * `getByRole('button', { name: /旁邊的朋友/ })` 找不到任何東西。
   */
  it('帶 answer 的子題選項要能點選（真環境重現：L0016 第 7 關「小試身手」）', () => {
    renderSpotlight([
      {
        type: 'sub_block',
        label: '◎ 小試身手',
        items: [
          {
            type: 'single',
            prompt: '(第一段)我心想這人的確蠻不錯，聽說還常常幫忙同學，講話又幽默，或許是個很有意思的人。',
            options: { '1': '旁邊的朋友', '2': '隔壁班同學' },
            answer: 2,
          },
        ],
      },
    ]);
    const option = screen.getByRole('button', { name: /隔壁班同學/ });
    fireEvent.click(option);
    fireEvent.click(screen.getByRole('button', { name: '確認' }));
    expect(screen.getByText(/答對了/)).toBeTruthy();
  });

  it('帶 answer 的子題選錯要顯示再想想看，不可以謊報答對', () => {
    renderSpotlight([
      {
        type: 'sub_block',
        items: [
          {
            type: 'single',
            prompt: '(第一段)但我最愛的笑話類型是諧音冷笑話，不知道他會不會覺得跟這種人相處起來很沒意思呢？',
            options: { '1': '喜歡', '2': '不喜歡' },
            answer: 1,
          },
        ],
      },
    ]);
    fireEvent.click(screen.getByRole('button', { name: /不喜歡/ }));
    fireEvent.click(screen.getByRole('button', { name: '確認' }));
    expect(screen.getByText(/再想想看/)).toBeTruthy();
    expect(screen.queryByText(/答對了/)).toBeNull();
  });

  it('沒有 answer 的子題（純展示／填空類）維持現狀不報錯', () => {
    // 「◎推論小偵探」那類填空子題沒有 options/answer，不在本次修復範圍，
    // 只要確保它不會因為這次改動而壞掉。
    renderSpotlight([
      { type: 'sub_block', label: '◎推論小偵探', stem: 'A：第一個「這」是指（　）' },
    ]);
    expect(screen.getByText(/第一個「這」是指/)).toBeTruthy();
  });

  /**
   * self-review 抓到的真實邊界案例 —— 不是這次要修的兩張票，但如果沒有
   * 這條鎖就會在合併時悄悄引入新的 regression。
   *
   * 78 課用 sub_block 的課裡，有 6 課（L0002/L0005/L0006/L0010/L0012/
   * L0174）的子題是**複選**，`answer` 是一個陣列（如 `[1, 2, 3]`），不是
   * 單一值。真環境資料見 L0002「堅殼硬甲」第 1 題。
   *
   * 把陣列直接丟給 `resolveSingleCorrect`（單選題用的判分函式）會在
   * `answer.trim()` 那行丟出 TypeError，把這 6 課的聚光燈一起弄壞 ——
   * 跟 #3559/#3562 同一種「學生點不下去」，只是換一個死法、換一批課。
   */
  it('answer 是陣列的子題（複選，真實資料：L0002 堅殼硬甲）要能複選且不能 throw', () => {
    renderSpotlight([
      {
        type: 'sub_block',
        label: '◎小試身手：堅殼硬甲',
        items: [
          {
            type: 'single',
            stem: '這一段舉哪些動物的例子？',
            options: { '1': '柴棺龜', '2': '食蛇龜', '3': '穿山甲', '4': '枯葉蝶' },
            answer: [1, 2, 3],
          },
        ],
      },
    ]);
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes).toHaveLength(4);
    fireEvent.click(boxes[0]); // 柴棺龜
    fireEvent.click(boxes[1]); // 食蛇龜
    fireEvent.click(boxes[2]); // 穿山甲
    fireEvent.click(screen.getByRole('button', { name: '確認' }));
    expect(screen.getByText(/答對了/)).toBeTruthy();
  });

  it('answer 是陣列的子題選錯數量要顯示再想想看，不能謊報答對', () => {
    renderSpotlight([
      {
        type: 'sub_block',
        items: [
          {
            type: 'single',
            stem: '這一段舉哪些動物的例子？',
            options: { '1': '柴棺龜', '2': '食蛇龜', '3': '穿山甲', '4': '枯葉蝶' },
            answer: [1, 2, 3],
          },
        ],
      },
    ]);
    const boxes = screen.getAllByRole('checkbox');
    fireEvent.click(boxes[0]); // 只選一個，答案要三個
    fireEvent.click(screen.getByRole('button', { name: '確認' }));
    expect(screen.getByText(/再想想看/)).toBeTruthy();
    expect(screen.queryByText(/答對了/)).toBeNull();
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
    // #3559 修復後「扇子」「鑽石」除了代號表本身，每一小題也各有一顆可點的
    // 選項按鈕 —— 所以現在會出現不只一次，改用 getAllByText。
    expect(screen.getAllByText(/扇子/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/鑽石/).length).toBeGreaterThan(0);
    expect(screen.getByText(/孔雀開屏/)).toBeTruthy();
    expect(screen.getByText(/璀璨/)).toBeTruthy();
  });

  /**
   * #3559 回歸鎖 —— 現場老師回報《感情小日記1》「聚光燈沒有選項可以點」。
   * 真環境重現（staging，lesson 20017）：這個 exercise block 的每一題
   * (`items[].stem`) 只印成一行純文字，連 ☐ 符號都沒有，`option_bank`
   * 的代號表印在上面但跟題目完全沒有連動 —— 學生看不到任何可以點的東西。
   *
   * 這個形狀教材本身明印「沒有標準答案」（L0017：
   * 「◎小試身手：(沒有標準答案，請依據你自己的想法、感受判斷)」），
   * 所以不要求判對錯，只要求**每一題都能選出 option_bank 裡的一個選項**，
   * 而且選了之後畫面上看得出來「已經選了哪一個」。
   */
  it('沒有專屬 answer 的 exercise 子題要能從代號表選一個（真環境重現：L0017 小試身手）', () => {
    renderSpotlight([
      {
        type: 'exercise',
        label: '小試身手（第一張表·課文中的互動）',
        instruction: '◎小試身手：(沒有標準答案，請依據你自己的想法、感受判斷)',
        option_bank: { '1': '友情', '2': '愛情', '3': '難以區分' },
        items: [
          { type: 'single', index: 1, prompt: '被詢問要不要幫忙時，突然結巴、害羞' },
          { type: 'single', index: 2, prompt: '上體育課被分到同一組時，感到害羞、緊張' },
        ],
      },
    ]);
    // 每一題都要有三個可點的選項按鈕（友情／愛情／難以區分）
    const rows = screen.getAllByText(/突然結巴、害羞$/);
    expect(rows.length).toBeGreaterThan(0);
    const loveButtons = screen.getAllByRole('button', { name: '愛情' });
    expect(loveButtons.length).toBe(2); // 兩題各一顆「愛情」按鈕
    fireEvent.click(loveButtons[0]);
    expect(loveButtons[0].getAttribute('aria-pressed')).toBe('true');
    // 另一題沒被點到的仍是未選取
    const ambiguousButtons = screen.getAllByRole('button', { name: '難以區分' });
    expect(ambiguousButtons[1].getAttribute('aria-pressed')).toBe('false');
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

describe('table 的兩種 rows 形狀', () => {
  // 🔴 這是「整頁白屏」等級的缺陷，不是「一格畫不出來」。
  //    多模態抽取寫「以欄名為 key 的物件」，renderer 原本只認陣列的陣列，
  //    `row.map is not a function` 直接讓整個聚光燈步驟掛掉（文-L6 preview 實測）。
  it('以欄名為 key 的 rows 要畫得出來，而且不可以 throw', () => {
    renderSpotlight([
      {
        type: 'table',
        label: '常見用字',
        columns: ['指示代詞', '作用', '例句'],
        rows: [
          { 指示代詞: '之、此', 作用: '指「近的」', 例句: ['學而時習之', '此物最相思'] },
          { 指示代詞: '彼、其', 作用: '指「遠的」', 例句: '顧此失彼' },
        ],
      },
    ]);
    // 表頭要來自 columns
    expect(screen.getByText('指示代詞')).toBeTruthy();
    expect(screen.getByText('之、此')).toBeTruthy();
    expect(screen.getByText('彼、其')).toBeTruthy();
    // 一格多個例句：兩個都要在，不能只留第一個
    expect(screen.getByText(/學而時習之/)).toBeTruthy();
    expect(screen.getByText(/此物最相思/)).toBeTruthy();
    // 同一欄有時字串有時陣列，字串那筆也要出來
    expect(screen.getByText('顧此失彼')).toBeTruthy();
  });

  it('陣列的陣列（既有形狀）不可以壞掉', () => {
    renderSpotlight([
      { type: 'table', rows: [['欄一', '欄二'], ['值一', '值二']] },
    ]);
    expect(screen.getByText('欄一')).toBeTruthy();
    expect(screen.getByText('值二')).toBeTruthy();
  });
});

describe('fill_table 的兩種用途', () => {
  it('沒有 rows → 指路牌，叫學生去重點表那一步', () => {
    renderSpotlight([{ type: 'fill_table' }]);
    expect(screen.getByText(/請在「文章重點表」步驟填寫/)).toBeTruthy();
  });

  it('自己帶 rows → 這張表就住在聚光燈裡，要畫出來', () => {
    // L0034 的策略對照表。以前被換成一句「請到重點表填寫」，而那一步沒有這張表 ——
    // 學生照指路牌走過去會撲空。
    renderSpotlight([
      {
        type: 'fill_table',
        columns: ['策略', '改變環境', '設定規範'],
        rows: [{ 列: '目的', 改變環境: '調整周遭環境，減少誘惑', 設定規範: '事前訂出明確規則' }],
      },
    ]);
    expect(screen.queryByText(/請在「文章重點表」步驟填寫/)).toBeNull();
    expect(screen.getByText('改變環境')).toBeTruthy();
    expect(screen.getByText('調整周遭環境，減少誘惑')).toBeTruthy();
  });
});

describe('options 是物件而不是陣列', () => {
  // 🔴 白屏等級：對物件呼叫 .map 會讓整個聚光燈步驟畫不出來。
  //    L0003（single）與 L0007（multi）的真資料都是物件形狀。
  it('single 的物件選項要畫得出來', () => {
    renderSpotlight([
      { type: 'single', prompt: '哪一個對？', options: { A: '保護色', B: '偽裝' }, answer: 'A' },
    ]);
    expect(screen.getByText(/保護色/)).toBeTruthy();
    expect(screen.getByText(/偽裝/)).toBeTruthy();
  });

  it('multi 的物件選項要畫得出來，而且每個都可以點', () => {
    renderSpotlight([
      { type: 'multi', prompt: '哪些對？', options: { '1': '甲', '2': '乙', '3': '丙' }, answer: [0] },
    ]);
    expect(screen.getAllByRole('checkbox')).toHaveLength(3);
    for (const t of ['甲', '乙', '丙']) expect(screen.getByText(new RegExp(t))).toBeTruthy();
  });
});

describe('題幹欄位有三個名字', () => {
  // 契約門會擋掉沒有 prompt 的題目，這裡是萬一溜過去時的降級：
  // 只讀 prompt 的話，畫面會是「四個選項但不知道在問什麼」，而且不報錯。
  it.each(['prompt', 'instruction', 'stem'])('用 %s 當題幹也要顯示得出來', (field) => {
    renderSpotlight([
      { type: 'multi', [field]: '這個故事想告訴我們什麼？', options: { 1: '甲', 2: '乙' }, answer: [1] },
    ]);
    expect(screen.getByText('這個故事想告訴我們什麼？')).toBeTruthy();
  });
});
