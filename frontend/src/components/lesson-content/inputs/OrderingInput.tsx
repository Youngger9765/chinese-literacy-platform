/**
 * OrderingInput — drag-to-reorder widget for the `ordering` kind (grader 'ordered').
 *
 * Emits the current permutation as an array of ORIGINAL item indices (number[]) — the
 * same runtime shape as the exercise's `answer` (G5 ex-order answer:[0,1,2,3]), so
 * `grade()` does a deep order-sensitive compare. Drag handler pattern mirrors the
 * legacy OrderingExercise (self-contained, no external drag lib).
 */
import React, { useState } from 'react';

interface Props {
  items: string[];
  /** Current permutation as original indices; defaults to identity order. */
  value: number[] | null;
  onChange: (permutation: number[]) => void;
  disabled?: boolean;
  verdict?: boolean | null;
}

const OrderingInput: React.FC<Props> = ({ items, value, onChange, disabled, verdict }) => {
  const locked = disabled || (verdict !== undefined && verdict !== null);
  const order = value && value.length === items.length ? value : items.map((_, i) => i);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDragIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };
  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverIndex(index);
  };
  const handleDrop = (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    if (dragIndex === null || dragIndex === dropIndex) {
      setDragIndex(null);
      setDragOverIndex(null);
      return;
    }
    const next = [...order];
    const [removed] = next.splice(dragIndex, 1);
    next.splice(dropIndex, 0, removed);
    onChange(next);
    setDragIndex(null);
    setDragOverIndex(null);
  };
  const handleDragEnd = () => {
    setDragIndex(null);
    setDragOverIndex(null);
  };

  return (
    <ul className="space-y-2" aria-label="排序清單">
      {order.map((originalIdx, position) => (
        <li
          key={originalIdx}
          data-testid="ordering-item"
          draggable={!locked}
          onDragStart={(e) => handleDragStart(e, position)}
          onDragOver={(e) => handleDragOver(e, position)}
          onDrop={(e) => handleDrop(e, position)}
          onDragEnd={handleDragEnd}
          className={[
            'flex items-center gap-3 rounded-lg border px-4 py-3 text-base bg-white transition-colors',
            locked ? 'cursor-default' : 'cursor-grab active:cursor-grabbing',
            dragOverIndex === position && dragIndex !== null
              ? 'border-violet-500 bg-violet-50'
              : 'border-gray-200',
          ].join(' ')}
        >
          <span className="shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full bg-violet-100 text-violet-700 text-xs font-bold">
            {position + 1}
          </span>
          {!locked && (
            <span className="material-symbols-outlined text-on-surface-variant/50 text-base" aria-hidden="true">
              drag_indicator
            </span>
          )}
          <span className="flex-1 whitespace-pre-wrap">{items[originalIdx]}</span>
        </li>
      ))}
    </ul>
  );
};

export default OrderingInput;
