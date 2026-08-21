/**
 * OrderingBlock — 聚光燈的排序題：拖拉排順序，送出才判分。
 *
 * 為什麼不是打字（2026-08-19 Young）
 * ----------------------------------
 * 原本每句前面是一個 `<input type="text">`，學生要自己判斷順序再打 1~4 進去。
 *
 * > 這種題目，明明可以用拖拉排序，送出答案確認啊！
 * > 我覺得用戶不會填寫，所以才要用拖拉
 *
 * 小學生面對一排空格不會去填 —— 他會空著，或亂填一個。整題等於沒作用。
 * 拖拉把「判斷順序」從一個抽象的填空題變成一個看得見、動得了的動作。
 *
 * 答案怎麼處理
 * ------------
 * 每個 item 帶 `answer`（或舊欄位 `correct_order`）＝ 正確名次。
 * 這個元件**在按下送出之前不碰它**，也永遠不渲染它。
 * ⚠️ 但它仍然在 API payload 裡（全庫 156 課 / 1676 個欄位），
 * 學生開 devtools 就翻得到 —— 那是另一條要修的線，不是這裡能解決的。
 *
 * 初始順序是洗過的，否則第一次進來就已經是正確答案。
 * 洗牌保證不等於原順序（單一元素或全同除外）。
 */
import React, { useRef, useState } from 'react';

export interface OrderingBlockItem {
  text: string;
  answer?: number;
  correct_order?: number;
}

export interface OrderingBlockState {
  /** 目前的排列，存 items 的原始索引 */
  order: number[];
  submitted: boolean;
  correct?: boolean;
}

/** 正確名次：新資料用 `answer`，舊的用 `correct_order`。 */
function rankOf(item: OrderingBlockItem): number | undefined {
  return item.answer ?? item.correct_order;
}

/**
 * 洗到「不等於原順序」**而且「不等於正確答案」**。
 *
 * 只避開原順序是不夠的 —— 洗牌是隨機的，總有機會剛好洗成正解，
 * 那學生一進來題目就已經做完了，而且沒有任何跡象說它壞了。
 * 罕見不等於不會發生，所以在這裡擋掉，不留給機率。
 */
function shuffledIndices(items: OrderingBlockItem[]): number[] {
  const n = items.length;
  const idx = Array.from({ length: n }, (_, i) => i);
  if (n < 2) return idx;
  const isAnswer = (arr: number[]) =>
    arr.every((originalIdx, position) => {
      const rank = rankOf(items[originalIdx]);
      return rank === undefined ? true : rank === position + 1;
    });
  for (let attempt = 0; attempt < 12; attempt += 1) {
    for (let i = n - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    if (idx.some((v, i) => v !== i) && !isAnswer(idx)) return idx;
  }
  // 洗不出來（例如每一句的名次都相同）就把頭兩個對調，至少不是原樣。
  [idx[0], idx[1]] = [idx[1], idx[0]];
  return idx;
}

interface Props {
  items: OrderingBlockItem[];
  state?: OrderingBlockState;
  onChange: (next: OrderingBlockState) => void;
  onSubmitted: (next: OrderingBlockState) => void;
}

const OrderingBlock: React.FC<Props> = ({ items, state, onChange, onSubmitted }) => {
  const [initial] = useState(() => shuffledIndices(items));
  const order = state?.order ?? initial;
  const submitted = state?.submitted ?? false;
  const correct = state?.correct;

  const dragFrom = useRef<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  const move = (from: number, to: number) => {
    if (from === to) return;
    const next = [...order];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange({ order: next, submitted: false });
  };

  const handleSubmit = () => {
    // 學生排出來的第 p 名是原始索引 order[p]；它的正確名次應該是 p + 1。
    const ok = order.every((originalIdx, position) => {
      const rank = rankOf(items[originalIdx]);
      return rank === undefined ? true : rank === position + 1;
    });
    onSubmitted({ order, submitted: true, correct: ok });
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <p className="text-sm text-on-surface-variant mb-3">
        拖曳句子排出正確的先後順序，排好後按「送出答案」
      </p>
      <ol className="space-y-2 list-none">
        {order.map((originalIdx, position) => (
          <li
            key={originalIdx}
            draggable={!submitted}
            onDragStart={(e) => {
              dragFrom.current = position;
              e.dataTransfer.effectAllowed = 'move';
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              setDragOver(position);
            }}
            onDragLeave={() => setDragOver(null)}
            onDrop={(e) => {
              e.preventDefault();
              if (dragFrom.current !== null) move(dragFrom.current, position);
              dragFrom.current = null;
              setDragOver(null);
            }}
            className={[
              'flex items-start gap-3 rounded-lg border-2 px-3 py-2.5 transition-all',
              submitted ? 'cursor-default' : 'cursor-grab active:cursor-grabbing',
              dragOver === position ? 'border-accent bg-accent/5' : 'border-gray-200 bg-white',
            ].join(' ')}
          >
            <span
              aria-hidden="true"
              className="material-symbols-outlined text-gray-400 shrink-0 mt-0.5 select-none"
            >
              drag_indicator
            </span>
            <span className="shrink-0 w-7 h-7 rounded-full bg-accent/10 text-accent font-bold text-sm flex items-center justify-center select-none">
              {position + 1}
            </span>
            <p className="text-base text-on-surface leading-relaxed">{items[originalIdx].text}</p>
          </li>
        ))}
      </ol>

      {submitted ? (
        <p
          className={`mt-4 text-sm font-bold ${correct ? 'text-emerald-700' : 'text-amber-700'}`}
        >
          {correct ? '順序正確 ✓' : '順序還不對，再調整看看'}
        </p>
      ) : (
        <button
          type="button"
          onClick={handleSubmit}
          className="mt-4 px-5 py-2 rounded-full font-bold text-sm text-white bg-accent hover:brightness-110 active:scale-95 transition-all"
        >
          送出答案
        </button>
      )}
    </div>
  );
};

export default OrderingBlock;
