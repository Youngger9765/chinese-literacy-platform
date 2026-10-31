/**
 * core/groupings/content.ts — 「依學習內容」分群策略（108 課綱三層之一，
 * `.claude/skills/archipelago-module/SKILL.md` §2.2 `GroupingStrategy`）。
 *
 * 薄層，實際判斷與排序都委派給 `../archipelagoClusters.ts`（搬不重寫）。
 */
import { clusterKeyFor, groupIntoClusters, type ClusterStory } from '../archipelagoClusters';
import type { GroupingStrategy, ClusterSummary } from './types';

export const contentGrouping: GroupingStrategy = {
  id: 'content',
  label: '學習內容',
  clusterOf: (story: ClusterStory) => clusterKeyFor(story, 'content'),
  clusters: (stories: ClusterStory[]): ClusterSummary[] =>
    groupIntoClusters(stories, 'content').map((c) => ({
      key: c.key,
      label: c.label,
      storyCount: c.stories.length,
    })),
};
