/**
 * themes/index.ts — 主題登錄表（`.claude/skills/archipelago-module/
 * SKILL.md` §2「新增主題皮膚」的登錄點）。
 *
 * 新增一個主題：複製 `ocean.ts` 改造型與色票，在這裡加一行，不用改
 * `createArchipelagoWorld.ts` 一行程式碼（SKILL §5 鐵律）。
 */
import { oceanTheme } from './ocean';
import { skyTheme } from './sky';
import type { ArchipelagoTheme } from './types';

export const THEMES: Record<string, ArchipelagoTheme> = {
  ocean: oceanTheme,
  sky: skyTheme,
};

export const DEFAULT_THEME_ID = 'ocean';

export type {
  ArchipelagoTheme,
  SceneCtx,
  CellInfo,
  ClusterInfo,
  LandmarkFactory,
  PortalFactory,
} from './types';
