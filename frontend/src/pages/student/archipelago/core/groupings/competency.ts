/**
 * core/groupings/competency.ts — 「依核心素養」分群策略（108 課綱三層之一，
 * `.claude/skills/archipelago-module/SKILL.md` §2.2 `GroupingStrategy`）。
 *
 * 薄層，實際判斷與排序都委派給 `../archipelagoClusters.ts`（搬不重寫）。
 */
import { clusterKeyFor, groupIntoClusters, type ClusterStory } from '../archipelagoClusters';
import type { GroupingStrategy, ClusterSummary } from './types';

export const competencyGrouping: GroupingStrategy = {
  id: 'competency',
  label: '核心素養',
  clusterOf: (story: ClusterStory) => clusterKeyFor(story, 'competency'),
  clusters: (stories: ClusterStory[]): ClusterSummary[] =>
    groupIntoClusters(stories, 'competency').map((c) => ({
      key: c.key,
      label: c.label,
      storyCount: c.stories.length,
    })),
};
