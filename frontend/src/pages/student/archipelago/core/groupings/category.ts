/**
 * core/groupings/category.ts — 「依類別」分群策略（`.claude/skills/
 * archipelago-module/SKILL.md` §2.2 `GroupingStrategy`）。
 *
 * 薄層，實際判斷與排序都委派給 `../archipelagoClusters.ts`（搬不重寫）。
 */
import { clusterKeyFor, groupIntoClusters, type ClusterStory } from '../archipelagoClusters';
import type { GroupingStrategy, ClusterInfo } from './types';

export const categoryGrouping: GroupingStrategy = {
  id: 'category',
  label: '類別',
  clusterOf: (story: ClusterStory) => clusterKeyFor(story, 'category'),
  clusters: (stories: ClusterStory[]): ClusterInfo[] =>
    groupIntoClusters(stories, 'category').map((c) => ({
      key: c.key,
      label: c.label,
      storyCount: c.stories.length,
    })),
};
