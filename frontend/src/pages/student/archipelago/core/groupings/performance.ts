/**
 * core/groupings/performance.ts — 「依學習表現」分群策略（108 課綱三層之一，
 * `.claude/skills/archipelago-module/SKILL.md` §2.2 `GroupingStrategy`）。
 *
 * 薄層，實際判斷與排序都委派給 `../archipelagoClusters.ts`（搬不重寫）。
 * 資料來源是 AI 草稿（`../data/lessonCurriculum.json`），未經老師審核——
 * `label` 只標中文可讀名稱＋代碼，不在這裡標示草稿狀態，草稿提示交給
 * HUD 分群切換旁的文字（PRD §2.2）。
 */
import { clusterKeyFor, groupIntoClusters, type ClusterStory } from '../archipelagoClusters';
import type { GroupingStrategy, ClusterSummary } from './types';

export const performanceGrouping: GroupingStrategy = {
  id: 'performance',
  label: '學習表現',
  clusterOf: (story: ClusterStory) => clusterKeyFor(story, 'performance'),
  clusters: (stories: ClusterStory[]): ClusterSummary[] =>
    groupIntoClusters(stories, 'performance').map((c) => ({
      key: c.key,
      label: c.label,
      storyCount: c.stories.length,
    })),
};
