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
import type { ConnectorMaterial } from '../core/archipelagoLayout';

export type { SceneCtx };
export type { ConnectorMaterial };

/** 一座課程島在不規則群島佈局裡的身分與位置——皮膚畫「這座島」要知道的
 *  最小子集，不含 three.js 物件本身（那是皮膚自己建的）。
 *
 * `cellOffsets`／`seed`（美術指導書 §3.1 二度訂正，2026-10-31）：不規則
 * 群島的島是 1~3 格六角格黏成的 polyhex（`core/archipelagoLayout.ts`），
 * 每座島的外框不再是單一正六邊形——皮膚要知道「這座島由哪幾格組成」才
 * 畫得出真正的不規則海岸線，不是繼續畫一個正六邊形假裝不規則。
 * `cellOffsets` 是每一格中心相對 `position`（island 群的中心）的世界座標
 * 偏移；`seed` 給皮膚做「同一群重開一樣」的海岸線頂點擾動（固定種子，
 * 直接用 `storySlug` 即可，不需要另外傳一個隨機數）。 */
export interface CellInfo {
  storySlug: string;
  title: string;
  /** 已正規化（自然科學/寓言故事/歷史人文/生活/其他）。 */
  category: string;
  status: IslandStatus;
  stationsDone: number;
  stationsTotal: number;
  position: { x: number; z: number };
  /** 這座島由幾格六角格組成（1~3），皮膚可以依格數決定小景豐富度（格數
   *  越多，島越大，能放的樹／小人越多）。 */
  cellCount: number;
  /** 每一格六角格中心，相對 `position` 的世界座標偏移——用來算不規則
   *  海岸線的聯集外框（`themes/islandShape.ts`）。單一格的島這裡只有
   *  一個元素 `{x:0,z:0}`。 */
  cellOffsets: ReadonlyArray<{ x: number; z: number }>;
  /** 每一格六角格的「中心到角」半徑——傳這個而不是讓皮膚自己 import
   *  `createArchipelagoWorld.ts` 的 `HEX_SIZE`：骨架常數只能透過函式參數
   *  流向皮膚（既有慣例，`cell.position`／`cell.cellOffsets` 都是這樣），
   *  不能反過來讓皮膚 import 骨架的檔案。數值上等於 `HEX_SIZE`，這樣用
   *  `cellOffsets` 算出來的多格外框才會剛好緊貼、不留縫。 */
  cellRadius: number;
  seed: string;
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
    /** 天空穹頂拿掉後（team-lead 2026-10-31 三次訂正：renderer 透明清除＋
     *  CSS 漸層接手背景），這兩個色碼是 CSS 漸層唯二的輸入——`skyTop` 是
     *  3D 容器背景漸層的最上緣（淺天色），`horizon` 是漸層最下緣（近岸海色
     *  ／雲海色）。`horizon` 同時也是 `scene.fog` 的顏色（骨架會直接讀這
     *  個欄位，不再讀 `fog`），讓遠處的島視覺上融進地平線本身的顏色，而
     *  不是融進一塊跟背景無關的灰色。 */
    skyTop: string;
    horizon: string;
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
    /** 背光／輪廓光（美術指導書 §2.1，2026-10-31 新增）——現況只有一顆
     *  主光＋半球光，建築輪廓跟天空背景融在一起分不開。跟 `sunDirection`
     *  相對方向的一顆冷/暖色補光，純粹是「有沒有第三顆燈」的差異，不是
     *  色票常數，所以骨架可以直接 `new THREE.DirectionalLight(theme.lighting.rimColor, theme.lighting.rimIntensity)`
     *  不用知道這顆燈該是什麼顏色。 */
    rimColor: string;
    rimIntensity: number;
  };
  /** 名牌卡片配色（美術指導書 §7）——CSS2D 白底／暖白底小卡，兩個主題目前
   *  用非常接近的配色（都走「暖白底＋暖黑字」），但做成主題欄位而不是骨架
   *  常數，是因為配色屬於「長什麼樣子」，不該讓骨架自己決定（SKILL §1
   *  鐵律）；以後某個主題想要完全不同的名牌風格（例如星際主題用深色卡）
   *  不需要改骨架介面。 */
  nameplate: {
    background: string;
    border: string;
    text: string;
  };
  /** 底面：海面／深海／星空／雲海／大地。`maxRadius` 是這一群的外接圓半徑
   *  （`computeClusterBoundingCircle` 算出來的，骨架在建 ground 之前就先
   *  算好——team-lead 2026-10-31 退回重做：「把群的半徑透過 ctx 傳給
   *  theme.ground，海面或雲海平面的半徑縮成 4×maxRadius」，固定 400×400
   *  平面在大群時遠端被霧吃成一片死白，縮小平面讓「平面外側交給天空球」
   *  接手，不靠霧硬撐整個視野）。 */
  ground: (ctx: SceneCtx, maxRadius: number) => THREE.Object3D;
  /** 一座完整的課程島——含地基造型＋依類別地標＋依狀態的長相
   *  （旗子/發光/薄霧），`status` 由骨架呼叫 `statusLook` 疊加，這支只
   *  負責「島本身＋地標」。位置由呼叫端用 `cell.position` 自行
   *  `group.position.set(...)`，這支回傳的物件不需要自己定位。 */
  island: (ctx: SceneCtx, cell: CellInfo) => THREE.Object3D;
  /** 中央傳送門廣場（不含門本身，門由 `portal()` 個別建）。 */
  hub: (ctx: SceneCtx) => THREE.Object3D;
  portal: PortalFactory;
  /** `material`（美術指導書 §5，2026-10-31 新增）：PRD §3.2 二次訂正「連接
   *  材料隨意，五選一」——`core/archipelagoLayout.ts` 的 `layoutArchipelago()`
   *  已經決定好每一對相鄰島該用哪一種材料（固定種子，不是渲染端自己選），
   *  皮膚只管「這個材料字串該畫成什麼樣子」。 */
  connector: (ctx: SceneCtx, a: { x: number; z: number }, b: { x: number; z: number }, material: ConnectorMaterial) => THREE.Object3D | null;
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
