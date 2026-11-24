/**
 * 學習批閱 ②：某位學生有開始的課（#4104）
 *
 * 「開始」= 任何一關有作答（只打開課文不算），由後端判斷。
 */
import React, { useEffect, useState } from 'react';
import { fetchReviewLessons, type ReviewLessonRow } from '../../../services/lessonReviewApi';

function when(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d);
}

function statusOf(r: ReviewLessonRow): { text: string; tone: string } {
  if (r.redone_count > 0) return { text: `已重做 ${r.redone_count} 關，待你看`, tone: 'bg-sky-50 text-sky-700 border-sky-200' };
  if (!r.sent_at) {
    return r.has_draft
      ? { text: '草稿，還沒送出', tone: 'bg-amber-50 text-amber-800 border-amber-200' }
      : { text: '還沒批閱', tone: 'bg-red-50 text-red-700 border-red-200' };
  }
  if (r.returned_count > 0) return { text: `退回 ${r.returned_count} 關，等學生重做`, tone: 'bg-gray-100 text-gray-600 border-gray-200' };
  return { text: '已送出', tone: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
}

const ReviewLessonList: React.FC<{
  classroomId: number;
  studentId: number;
  studentName: string;
  onBack: () => void;
  onOpen: (r: ReviewLessonRow) => void;
}> = ({ classroomId, studentId, studentName, onBack, onOpen }) => {
  const [rows, setRows] = useState<ReviewLessonRow[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setRows(null);
    setError('');
    fetchReviewLessons(classroomId, studentId)
      .then((r) => alive && setRows(r))
      .catch((e: Error) => alive && setError(e.message || '載入失敗'));
    return () => {
      alive = false;
    };
  }, [classroomId, studentId]);

  return (
    <div className="p-5 space-y-4" data-testid="review-lesson-list">
      <nav aria-label="批閱路徑" className="text-sm">
        <button type="button" onClick={onBack} className="text-[#4d6b7e] hover:underline font-medium">
          ← 全班
        </button>
        <span className="mx-2 text-gray-300">/</span>
        <span className="font-bold text-gray-900">{studentName}</span>
      </nav>
      <p className="text-sm text-gray-500">{studentName} 有開始練習的課（最近練習的在最上面）。點一課開始批閱。</p>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {!rows && !error && <p className="text-sm text-gray-500" role="status">載入課文…</p>}
      {rows && rows.length === 0 && (
        <p className="rounded-xl bg-gray-50 p-6 text-center text-sm text-gray-500">{studentName} 還沒開始任何一課。</p>
      )}
      {rows && rows.length > 0 && (
        <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 overflow-hidden">
          {rows.map((r) => {
            const st = statusOf(r);
            return (
              <li key={r.story_slug}>
                <button
                  type="button"
                  onClick={() => onOpen(r)}
                  data-testid="review-lesson-row"
                  className="w-full flex items-center gap-4 px-4 py-3 text-left bg-white hover:bg-gray-50"
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-gray-900 truncate">{r.title ?? r.story_slug}</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      完成 {r.steps_completed} 關
                      {r.last_activity_at && <>・最後練習 {when(r.last_activity_at)}</>}
                    </p>
                  </div>
                  <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-bold ${st.tone}`}>{st.text}</span>
                  {r.total_score != null && (
                    <span className="shrink-0 font-hand font-bold text-2xl text-[#d03a2f]" aria-label={`總分 ${r.total_score}`}>
                      {r.total_score}
                    </span>
                  )}
                  <span className="material-symbols-outlined text-gray-400" aria-hidden="true">chevron_right</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default ReviewLessonList;
