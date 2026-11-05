/**
 * core/islandStatus.ts — 三種島嶼狀態（骨架概念，PRD §8.5 表格左欄「三種
 * 狀態判定」）。單獨一個檔案是因為 `core/`（骨架）跟 `themes/`（皮膚）都
 * 需要同一份型別——骨架用它判斷邏輯，皮膚用它決定長相
 * （`ArchipelagoTheme.statusLook`），兩邊共用同一個定義才不會有一邊多了
 * 或少了一種狀態卻沒人發現。
 */
export type IslandStatus = 'occupied' | 'in_progress' | 'not_started';
