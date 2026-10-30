/**
 * themes/types.ts — 皮膚層契約（`.claude/skills/archipelago-module/
 * SKILL.md` §2.1 `ArchipelagoTheme`）。
 *
 * 骨架（`createArchipelagoWorld.ts`）呼叫這些工廠函式拿 three.js 物件，
 * 自己完全不知道「海」「天空」長什麼樣子——換主題只換這份設定檔，骨架
 * 程式碼一行都不用改（SKILL §5：禁止在骨架寫 `if (theme.id === 'sky')`）。
 *
 * 跟 SKILL 原文介面有兩處刻意調整（team-lead 2026-10-30 授權「介面不合理
 * 就直接改」）：
 * 1. `connector(ctx, a, b)` 吃 `{x,z}` 不是完整 `CellInfo`——棧橋/光束/
 *    海流這類連接物只需要兩個端點的座標，沒有任何現有或規劃中的連接物
 *    樣式需要知道對面那座島的類別/狀態；硬塞完整 CellInfo 只會讓呼叫端
 *    （傳送門廣場→第一座島這種「虛擬端點」）要生一個假的 CellInfo。
 * 2. `ctx` 的快取是**鍵控**的 `geometry(key, factory)`/`material(key, factory)`
 *    （SKILL 原文只寫「共用的幾何、材質快取」，沒給簽名，定義在
 *    `core/sceneCtx.ts`——骨架不知道皮膚長什麼樣子，但皮膚要用骨架提供
 *    的資源快取詞彙，依賴方向是皮膚→骨架，不是反過來）。同一把鍵在
 *    同一次群載入期間回傳同一個物件，不同鍵才新建，換群時整批 dispose。
 *    這樣主題函式可以放心每次都呼叫（例如每座科學類別的島都呼叫
 *    `ctx.material('science-roof', () => ...)`），不用自己在模組層級
 *    手動管理「這個材質有沒有建過」。
 */
import * as THREE from 'three';
import type { IslandStatus } from '../core/islandStatus';
import type { SceneCtx } from '../core/sceneCtx';

export type { SceneCtx };

/** 一座課程島在蜂巢佈局裡的身分與位置——皮膚畫「這座島」要知道的最小
 *  子集，不含 three.js 物件本身（那是皮膚自己建的）。 */
export interface CellInfo {
  storySlug: string;
  title: string;
  /** 已正規化（自然科學/寓言故事/歷史人文/生活/其他）。 */
  category: string;
  status: IslandStatus;
  stationsDone: number;
  stationsTotal: number;
  position: { x: number; z: number };
}

/** 傳送門目的地的摘要——皮膚畫「這座門」要知道的最小子集。 */
export interface PortalTargetInfo {
  key: string;
  label: string;
  occupiedCount: number;
  total: number;
}

// `SceneCtx` 本身定義在 `core/sceneCtx.ts`（見檔頭說明第 2 點），這裡只
// re-export 給皮膚層的呼叫端用，不用知道它實際放在骨架那邊。
// 契約測試（`themes/__tests__/moduleContracts.test.ts`）用
// `createSceneCtx()` 建一個真的 ctx（指到一個空 `THREE.Scene`，不需要
// WebGL context），驗證「dispose 之後數量回到 0」。

export type LandmarkFactory = (ctx: SceneCtx, cell: CellInfo) => THREE.Object3D;
export type PortalFactory = (ctx: SceneCtx, target: PortalTargetInfo) => THREE.Object3D;

export interface ArchipelagoTheme {
  id: string;
  name: string;
  palette: {
    background: string;
    fog: string;
    accent: string;
    occupied: string;
    inProgress: string;
    unexplored: string;
  };
  lighting: {
    sunColor: string;
    sunIntensity: number;
    /** 半球光（環境光）天空／地面兩端的色票——跟 `ambient`（強度）分開存，
     *  骨架才不用寫死任何顏色常數（SKILL §3 契約測試④會掃骨架原始碼裡的
     *  hex 色碼，這兩個欄位本來沒在 SKILL 原文介面裡，是實作時發現少了
     *  它們骨架就得自己掰顏色，依規則「介面不合理就直接改」補上去的）。 */
    hemisphereSky: string;
    hemisphereGround: string;
    ambient: number;
    sunDirection: [number, number, number];
  };
  /** 底面：海面／深海／星空／雲海／大地。 */
  ground: (ctx: SceneCtx) => THREE.Object3D;
  /** 一座完整的課程島——含地基造型＋依類別地標＋依狀態的長相
   *  （旗子/發光/薄霧），`status` 由骨架呼叫 `statusLook` 疊加，這支只
   *  負責「島本身＋地標」。位置由呼叫端用 `cell.position` 自行
   *  `group.position.set(...)`，這支回傳的物件不需要自己定位。 */
  island: (ctx: SceneCtx, cell: CellInfo) => THREE.Object3D;
  /** 中央傳送門廣場（不含門本身，門由 `portal()` 個別建）。 */
  hub: (ctx: SceneCtx) => THREE.Object3D;
  portal: PortalFactory;
  connector: (ctx: SceneCtx, a: { x: number; z: number }, b: { x: number; z: number }) => THREE.Object3D | null;
  /** 依課程類別換地標——key 是 `normalizeCategory()` 的輸出
   *  （自然科學/寓言故事/歷史人文/生活/其他），`default` 一定要有
   *  （查不到類別時的 fail-closed 造型）。 */
  landmarks: Record<string, LandmarkFactory> & { default: LandmarkFactory };
  /** 已佔領/探索中/尚未探索怎麼改長相——疊加在 `island()` 回傳的物件上
   *  （插旗、發光、薄霧之類），三種狀態都要提供，沒有變化也要給一個
   *  no-op 函式（不能省略）。 */
  statusLook: Record<IslandStatus, (obj: THREE.Object3D, ctx: SceneCtx) => void>;
  particles?: (ctx: SceneCtx) => THREE.Object3D;
  transition: { color: string; durationMs: number };
  music?: string;
}
