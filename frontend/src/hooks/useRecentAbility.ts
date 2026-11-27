/**
 * 最近幾課的五項能力分數（#4162）
 *
 * 只看「已完成」的作業紀錄（剛開始、還沒分數的進行中紀錄不能蓋掉先前做完的成績）；
 * 每一課取最近一次完成的作答（同一課多次作答只算最新那次），逐課用成績單同一套邏輯
 * （buildStepReportCards → radarOf）算出五項，所以跟單課雷達圖是同一個定義。
 * 失敗一律當作沒有歷史資料，不擋住報告頁。
 */
import { useEffect, useState } from 'react';
import { fetchLearningSessions, loadStepProgress } from '../services/learning/session';
import { fetchStory, storyForStep } from '../services/api';
import { resolveActiveSteps } from '../config/stepConfig';
import { buildStepReportCards, radarOf } from '../components/report/reportCardsModel';
import type { LessonAbility } from '../components/report/abilityHistory';

/** 每批往回抓幾個不同的課（有些課可能沒有任何分數，不夠再抓下一批） */
const BATCH = 6;
/** 湊滿幾個有分數的課就停（矩陣 6 課，含這一課） */
const WANT = 6;
/** 最多往回看幾個不同的課，避免無止境地抓 */
const MAX_LOOKBACK = 18;

export function useRecentAbility(token: string | null | undefined): LessonAbility[] | null {
  const [lessons, setLessons] = useState<LessonAbility[] | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const { items } = await fetchLearningSessions(token, { limit: 60, status: 'completed' });
        // 新到舊：同一課只留最新那次
        const seen = new Set<string>();
        const picked = items.filter((s) => {
          if (!s.story_slug || seen.has(s.story_slug)) return false;
          seen.add(s.story_slug);
          return true;
        }).slice(0, MAX_LOOKBACK);

        const abilityOf = async (s: (typeof picked)[number]): Promise<LessonAbility | null> => {
          try {
            const [prog, story] = await Promise.all([
              loadStepProgress(token, s.id),
              fetchStory(s.story_slug as string),
            ]);
            const sp = prog.step_progress;
            const cards = buildStepReportCards(
              resolveActiveSteps(story.stepSequence),
              sp?.steps_completed,
              sp?.step_data,
              null,
              { vocabularyFor: (id) => storyForStep(story, id)?.vocabulary },
            );
            const points = radarOf(cards);
            if (!points.some((p) => p.state === 'scored')) return null;
            return { sessionId: s.id, storyId: s.story_slug as string, title: story.title, points };
          } catch {
            return null;
          }
        };

        // 分批往回抓（新到舊），湊滿 WANT 個有分數的課就停
        const built: LessonAbility[] = [];
        for (let i = 0; i < picked.length && built.length < WANT; i += BATCH) {
          if (cancelled) return;
          const got = await Promise.all(picked.slice(i, i + BATCH).map(abilityOf));
          built.push(...got.filter((l): l is LessonAbility => l !== null));
        }
        if (cancelled) return;
        // built 是新到舊；矩陣要舊到新
        setLessons(built.slice(0, WANT).reverse());
      } catch {
        if (!cancelled) setLessons([]);
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  return lessons;
}
