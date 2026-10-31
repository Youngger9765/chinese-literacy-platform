/**
 * core/groupings/genre.ts — 「依文體」分群策略（`.claude/skills/
 * archipelago-module/SKILL.md` §2.2 `GroupingStrategy`）。
 *
 * 薄層，實際判斷與排序都委派給 `../archipelagoClusters.ts`（搬不重寫）。
 */
import { clusterKeyFor, groupIntoClusters, type ClusterStory } from '../archipelagoClusters';
import type { GroupingStrategy, ClusterSummary } from './types';

export const genreGrouping: GroupingStrategy = {
  id: 'genre',
  label: '文體',
  clusterOf: (story: ClusterStory) => clusterKeyFor(story, 'genre'),
  clusters: (stories: ClusterStory[]): ClusterSummary[] =>
    groupIntoClusters(stories, 'genre').map((c) => ({
      key: c.key,
      label: c.label,
      storyCount: c.stories.length,
    })),
};
