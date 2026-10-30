/**
 * core/groupings/index.ts — 分群策略登錄表（`.claude/skills/
 * archipelago-module/SKILL.md` §2「新增分群方式」的登錄點）。
 *
 * 新增一種分群方式：寫一個新的 `<id>.ts` 實作 `GroupingStrategy`，在這裡
 * 加一行，不用改任何其他檔案。
 */
import { gradeGrouping } from './grade';
import { genreGrouping } from './genre';
import { categoryGrouping } from './category';
import type { GroupingStrategy } from './types';

export const GROUPINGS: Record<string, GroupingStrategy> = {
  grade: gradeGrouping,
  genre: genreGrouping,
  category: categoryGrouping,
};

export type { GroupingStrategy, ClusterInfo } from './types';
