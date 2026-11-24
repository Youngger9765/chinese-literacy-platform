/**
 * 學習批閱 ①：全班學生名片（#4104）
 */
import React, { useEffect, useState } from 'react';
import { fetchReviewStudents, type ReviewStudentCard } from '../../../services/lessonReviewApi';

const Chip: React.FC<{ tone: 'red' | 'blue' | 'gray'; children: React.ReactNode; testId?: string }> = ({
  tone,
  children,
  testId,
}) => (
  <span
    data-testid={testId}
    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold ${
      tone === 'red'
        ? 'bg-red-50 text-red-700 border border-red-200'
        : tone === 'blue'
          ? 'bg-sky-50 text-sky-700 border border-sky-200'
          : 'bg-gray-100 text-gray-500'
    }`}
  >
    {children}
  </span>
);

const ReviewStudentGrid: React.FC<{ classroomId: number; onOpen: (s: ReviewStudentCard) => void }> = ({
  classroomId,
  onOpen,
}) => {
  const [cards, setCards] = useState<ReviewStudentCard[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setCards(null);
    setError('');
    fetchReviewStudents(classroomId)
      .then((c) => alive && setCards(c))
      .catch((e: Error) => alive && setError(e.message || '載入失敗'));
    return () => {
      alive = false;
    };
  }, [classroomId]);

  if (error) return <p className="p-6 text-sm text-red-600">{error}</p>;
  if (!cards) return <p className="p-6 text-sm text-gray-500" role="status">載入學生…</p>;
  if (!cards.length) return <p className="p-6 text-sm text-gray-500">這個班級還沒有學生。</p>;

  const waiting = cards.reduce((n, c) => n + c.unreviewed_count + c.redone_count, 0);

  return (
    <div className="p-5 space-y-4" data-testid="review-student-grid">
      <div>
        <h2 className="text-lg font-bold text-gray-900">學習批閱</h2>
        <p className="text-sm text-gray-500 mt-1">
          點學生的名片，看他練過的課、批改每一關。
          {waiting > 0 && <span className="ml-1 font-bold text-red-600">全班有 {waiting} 件等你批閱。</span>}
        </p>
      </div>
      <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {cards.map((c) => {
          const todo = c.unreviewed_count + c.redone_count;
          return (
            <li key={c.student_id}>
              <button
                type="button"
                onClick={() => onOpen(c)}
                data-testid="review-student-card"
                aria-label={`${c.seat_number != null ? `${c.seat_number} 號 ` : ''}${c.name}，練過 ${c.started_count} 課${
                  todo > 0 ? `，${todo} 件待批閱` : ''
                }`}
                className={`relative w-full text-left rounded-xl border-2 bg-white px-4 py-3 transition-all hover:shadow-md active:scale-[0.98] ${
                  todo > 0 ? 'border-red-200 hover:border-red-300' : 'border-gray-200 hover:border-[#7C9AAD]'
                }`}
              >
                {todo > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 rounded-full bg-red-500 ring-2 ring-white" aria-hidden="true" />
                )}
                <div className="flex items-center gap-3">
                  <span className="shrink-0 w-9 h-9 rounded-full bg-[#7C9AAD]/15 text-[#4d6b7e] font-bold flex items-center justify-center text-sm">
                    {c.seat_number ?? '–'}
                  </span>
                  <span className="font-bold text-gray-900 truncate text-base">{c.name}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {c.started_count === 0 ? (
                    <Chip tone="gray">還沒開始任何一課</Chip>
                  ) : (
                    <Chip tone="gray">練過 {c.started_count} 課</Chip>
                  )}
                  {c.unreviewed_count > 0 && <Chip tone="red" testId="chip-unreviewed">待批 {c.unreviewed_count} 課</Chip>}
                  {c.redone_count > 0 && <Chip tone="blue" testId="chip-redone">已重做 {c.redone_count} 關</Chip>}
                  {c.returned_count > 0 && <Chip tone="gray">退回中 {c.returned_count} 關</Chip>}
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export default ReviewStudentGrid;
