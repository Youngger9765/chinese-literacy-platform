/**
 * OrderingExercise — drag-and-drop ordering exercise sub-component.
 * Extracted from StrategyExercise.tsx (#1884).
 */
import React, { useRef, useState } from 'react';
import { StrategyExercise as StrategyExerciseType, StrategyExerciseOrderingItem } from '../../types';
import StrategyHeader from './StrategyHeader';

interface OrderingItem extends StrategyExerciseOrderingItem {
  id: string;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

interface Props {
  exercise: StrategyExerciseType;
  onComplete?: () => void;
}

const OrderingExercise: React.FC<Props> = ({ exercise, onComplete }) => {
  const items = exercise.items ?? [];

  const [orderedItems, setOrderedItems] = useState<OrderingItem[]>(() =>
    shuffle(items.map((it, i) => ({ ...it, id: `item-${i}` }))),
  );
  const [submitted, setSubmitted] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);

  const dragIndexRef = useRef<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const handleDragStart = (e: React.DragEvent, index: number) => {
    dragIndexRef.current = index;
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverIndex(index);
  };

  const handleDrop = (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    const dragIndex = dragIndexRef.current;
    if (dragIndex === null || dragIndex === dropIndex) {
      setDragOverIndex(null);
      return;
    }
    const next = [...orderedItems];
    const [removed] = next.splice(dragIndex, 1);
    next.splice(dropIndex, 0, removed);
    setOrderedItems(next);
    dragIndexRef.current = null;
    setDragOverIndex(null);
  };

  const handleDragEnd = () => {
    dragIndexRef.current = null;
    setDragOverIndex(null);
  };

  const handleSubmit = () => {
    const correct = orderedItems.every((item, idx) => item.correct_order === idx + 1);
    setIsCorrect(correct);
    setSubmitted(true);
    if (correct) onComplete?.();
  };

  const handleReset = () => {
    setOrderedItems(shuffle(items.map((it, i) => ({ ...it, id: `item-${i}` }))));
    setSubmitted(false);
    setIsCorrect(false);
  };

  return (
    <div>
      <StrategyHeader name={exercise.strategy_name} instruction={exercise.instruction} />

      <p className="text-xs text-gray-500 mb-3">拖曳下方事件，依照故事發生的先後順序排列：</p>

      <div className="space-y-2 mb-5">
        {orderedItems.map((item, index) => {
          const itemCorrect = submitted && item.correct_order === index + 1;
          const itemWrong = submitted && item.correct_order !== index + 1;
          return (
            <div
              key={item.id}
              draggable={!submitted}
              onDragStart={(e) => handleDragStart(e, index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDrop={(e) => handleDrop(e, index)}
              onDragEnd={handleDragEnd}
              className={[
                'flex items-center gap-3 px-4 py-3 rounded-xl border-2 transition-all select-none',
                submitted
                  ? itemCorrect
                    ? 'bg-emerald-50 border-emerald-300'
                    : itemWrong
                    ? 'bg-red-50 border-red-300'
                    : 'bg-gray-50 border-gray-200'
                  : dragOverIndex === index
                  ? 'bg-violet-50 border-violet-300 scale-[1.02]'
                  : 'bg-surface-container-low border-gray-200 cursor-grab hover:border-violet-200 hover:bg-violet-50/30',
              ].join(' ')}
            >
              <span className="w-6 h-6 flex-shrink-0 rounded-full bg-gray-100 text-gray-500 text-xs font-bold flex items-center justify-center">
                {index + 1}
              </span>
              <span className="flex-1 text-sm text-on-surface">{item.text}</span>
              {submitted && itemCorrect && (
                <span className="text-emerald-500 text-base flex-shrink-0">&#10003;</span>
              )}
              {submitted && itemWrong && (
                <span className="text-red-400 text-base flex-shrink-0">&#10007;</span>
              )}
              {!submitted && (
                <span className="text-gray-300 text-lg flex-shrink-0 cursor-grab">&#8801;</span>
              )}
            </div>
          );
        })}
      </div>

      {submitted ? (
        <div
          className={`rounded-xl p-4 mb-4 ${
            isCorrect
              ? 'bg-emerald-50 border border-emerald-200'
              : 'bg-amber-50 border border-amber-200'
          }`}
        >
          {isCorrect ? (
            <p className="text-emerald-700 font-semibold text-sm text-center">
              你答對了！順序完全正確
            </p>
          ) : (
            <div className="text-center">
              <p className="text-amber-700 font-semibold text-sm mb-1">順序還不對，再想想看</p>
              <p className="text-amber-600 text-xs">
                正確順序：
                {[...items]
                  .sort((a, b) => a.correct_order - b.correct_order)
                  .map((it) => it.text)
                  .join(' → ')}
              </p>
            </div>
          )}
        </div>
      ) : null}

      <div className="flex gap-2">
        {!submitted && (
          <button
            onClick={handleSubmit}
            className="flex-1 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-semibold text-sm transition-colors"
          >
            送出答案
          </button>
        )}
        {submitted && (
          <button
            onClick={handleReset}
            className="flex-1 py-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-600 font-semibold text-sm transition-colors"
          >
            重新練習
          </button>
        )}
      </div>
    </div>
  );
};

export default OrderingExercise;
