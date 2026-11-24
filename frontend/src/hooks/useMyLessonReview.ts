/**
 * 學生端：這一課老師送出的批閱（#4104 學習批閱）。
 *
 * 「退回」什麼時候解除是後端算的（退回之後這一關有新的作答 / 訂正 / 重新完成），
 * 所以學生存檔後要重新抓一次 —— `refreshKey` 傳 step_progress 的 version。
 * 只有在還有退回中的關卡時才跟著存檔重抓，沒有退回就只在換課時抓一次。
 */
import { useEffect, useRef, useState } from 'react';
import { fetchMyReview, type MyReview } from '../services/lessonReviewApi';
import type { CardsReview } from '../components/report/StepReportCards';

export function toCardsReview(r: MyReview | null): CardsReview | null {
  if (!r || !r.sent_at) return null;
  return { totalScore: r.total_score, teacherName: r.teacher_name, steps: r.steps };
}

export function useMyLessonReview(storyId: string | null | undefined, refreshKey?: unknown): CardsReview | null {
  const [review, setReview] = useState<CardsReview | null>(null);
  const hasReturned = useRef(false);
  const lastStory = useRef<string | null>(null);

  useEffect(() => {
    if (!storyId) {
      setReview(null);
      lastStory.current = null;
      return;
    }
    // lastStory 只在抓成功後才更新：抓到一半被下一次存檔打斷時，下一輪仍會重抓。
    const storyChanged = lastStory.current !== storyId;
    if (!storyChanged && !hasReturned.current) return;
    let alive = true;
    const load = () => fetchMyReview(storyId)
      .then((r) => {
        if (!alive) return;
        lastStory.current = storyId;
        const v = toCardsReview(r);
        hasReturned.current = !!v && Object.values(v.steps).some((s) => s.returned);
        setReview(v);
      })
      .catch(() => {
        // 讀不到批閱不影響學習；不顯示就好。
        if (alive && storyChanged) setReview(null);
      });
    // 換課：馬上抓。存檔後重抓：等一下，讓這次存檔先寫進 DB（退回是否解除由後端算）。
    const timer = storyChanged ? null : setTimeout(load, 1200);
    if (storyChanged) load();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [storyId, refreshKey]);

  return review;
}
