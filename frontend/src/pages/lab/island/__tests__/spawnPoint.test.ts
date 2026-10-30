/**
 * #3780 P0-2：鎖住「出生點貼著燈塔、鏡頭穿進牆裡」這個 bug 不會再發生。
 *
 * 兩個獨立的不變量，分開鎖：
 * ① 碰撞——鏡頭最小距離必須大於建築地基半徑（原本 1.55 < 1.65，鏡頭會被
 *    放行到建築實體內部）
 * ② 構圖（team-lead 2026-10-26 真瀏覽器截圖抓到①修好之後仍然整片米色
 *    牆才發現的根因）——燈塔有 7 個單位高，出生距離單靠「不穿牆」完全
 *    不夠，要另外驗證「塔底到塔尖都落在垂直視野內」且「觸發半徑蓋得到
 *    出生距離」。這支測試用 `isHeightFullyInView`／`isBaseInLowerHalf`
 *    這兩個共用函式重新驗證，不是只信常數檔裡的註解。
 */
import { describe, it, expect } from 'vitest';
import {
  BUILDING_BASE_RADIUS,
  MIN_CAMERA_BUILDING_DISTANCE,
  NEAR_TRIGGER_RADIUS,
  LIGHTHOUSE_NEAR_TRIGGER_RADIUS,
  LIGHTHOUSE_TOWER_BASE_Y,
  LIGHTHOUSE_ROOF_TOP_Y,
  LIGHTHOUSE_TOWER_RADIUS,
  CAMERA_VERTICAL_FOV_DEG,
  MAX_TOWER_WIDTH_FRACTION,
  SPAWN_DISTANCE_FROM_LIGHTHOUSE,
  SPAWN_PITCH,
  EYE_HEIGHT,
  TOWER_TOP_SAFE_MARGIN_FRACTION,
  computeSpawnFacingLighthouse,
  requiredDistanceForTowerWidthInView,
  requiredDistanceForTowerTopMargin,
  isHeightFullyInView,
  isBaseInLowerHalf,
  nearTriggerRadiusForStep,
  findCelebrationViewpoint,
  CELEBRATION_VIEW_DISTANCE,
  CELEBRATION_EXTRA_HEIGHT,
  isMovementLocked,
  isManualControlEnabled,
  isLabelOccluded,
  type LabelOcclusionObstacle,
  FULL_ISLAND_PATH,
  projectOntoPath,
  pointAtPathDistance,
  walkAlongPathPosition,
  walkDurationSeconds,
  GOD_CAMERA_PITCH,
  GOD_CAMERA_DISTANCE,
  godCameraDesiredPosition,
} from '../spawnPoint';

describe('碰撞不變量（不穿牆）', () => {
  it('鏡頭最小距離必須大於建築地基半徑（原本的 bug：1.55 < 1.65）', () => {
    expect(MIN_CAMERA_BUILDING_DISTANCE).toBeGreaterThan(BUILDING_BASE_RADIUS);
  });
});

describe('構圖不變量（看得到整座燈塔，不是一面牆）', () => {
  it('出生距離／仰角底下，燈塔底到頂整個落在垂直視野內', () => {
    expect(isHeightFullyInView({
      distance: SPAWN_DISTANCE_FROM_LIGHTHOUSE,
      pitchRad: SPAWN_PITCH,
      topY: LIGHTHOUSE_ROOF_TOP_Y,
      baseY: LIGHTHOUSE_TOWER_BASE_Y,
    })).toBe(true);
  });

  it('塔底（入口代理）落在視野中心以下，不是先看到屋頂', () => {
    expect(isBaseInLowerHalf({
      distance: SPAWN_DISTANCE_FROM_LIGHTHOUSE,
      pitchRad: SPAWN_PITCH,
      baseY: LIGHTHOUSE_TOWER_BASE_Y,
    })).toBe(true);
  });

  it('出生距離要落在鏡頭最小距離（不穿牆）跟燈塔自己的觸發半徑中間，兩邊都留餘裕', () => {
    expect(SPAWN_DISTANCE_FROM_LIGHTHOUSE).toBeGreaterThan(MIN_CAMERA_BUILDING_DISTANCE);
    expect(SPAWN_DISTANCE_FROM_LIGHTHOUSE).toBeLessThan(LIGHTHOUSE_NEAR_TRIGGER_RADIUS);
  });

  it('燈塔的觸發半徑比一般建築大很多（它本來就比一般建築高很多）', () => {
    expect(LIGHTHOUSE_NEAR_TRIGGER_RADIUS).toBeGreaterThan(NEAR_TRIGGER_RADIUS);
  });
});

describe('nearTriggerRadiusForStep — 依建築分級，不是全島共用一個數字', () => {
  it('lesson-intro（燈塔）用專屬的較大半徑', () => {
    expect(nearTriggerRadiusForStep('lesson-intro')).toBe(LIGHTHOUSE_NEAR_TRIGGER_RADIUS);
  });

  it('帶 #slug 的 step id 也查得到（多篇課文）', () => {
    expect(nearTriggerRadiusForStep('lesson-intro#anything')).toBe(LIGHTHOUSE_NEAR_TRIGGER_RADIUS);
  });

  it('其他建築維持原本共用的 NEAR_TRIGGER_RADIUS，沒有被這次改動動到', () => {
    for (const step of ['full-text-annotate', 'key-passage-reading', 'vocab-definition', 'report', 'comprehension']) {
      expect(nearTriggerRadiusForStep(step), `${step} 的觸發半徑不該變`).toBe(NEAR_TRIGGER_RADIUS);
    }
  });

  /**
   * #3780 P0-3 十度審查真實複審發現：塔尖安全邊把直式手機的出生距離拉到
   * 10.13，但 `LIGHTHOUSE_NEAR_TRIGGER_RADIUS` 是固定常數 7.5（只對應桌機
   * 的基準距離 7），兩者沒有連動——直式手機一上岸會落在觸發半徑**外**，
   * 「進入」卡不會跳出來，必須走近才會觸發，跟桌機版的「一上岸直接進入」
   * 體驗不一致。`nearTriggerRadiusForStep` 必須接受同一個 `aspect`，算出
   * 跟 `computeSpawnFacingLighthouse` 同一套有效距離，觸發半徑才會自動跟著
   * 出生距離變寬，不會脫鉤。
   */
  it('🔒 直式手機寬高比下，燈塔觸發半徑要自動跟著拉開的出生距離變寬——不然一上岸會落在觸發半徑外，進入卡不會跳出來', () => {
    const aspect = 390 / 844;
    const lighthouse = { x: 0, z: 0 };
    const spawn = computeSpawnFacingLighthouse(lighthouse, undefined, aspect);
    const distanceToLighthouse = Math.hypot(spawn.x - lighthouse.x, spawn.z - lighthouse.z);
    expect(
      distanceToLighthouse,
      '出生距離要落在（同一寬高比算出來的）燈塔觸發半徑內，一上岸才會直接跳出進入卡',
    ).toBeLessThan(nearTriggerRadiusForStep('lesson-intro', aspect));
  });

  it('不傳 aspect 時維持原本桌機行為（LIGHTHOUSE_NEAR_TRIGGER_RADIUS=7.5），既有呼叫端不會被這次改動影響', () => {
    expect(nearTriggerRadiusForStep('lesson-intro')).toBe(LIGHTHOUSE_NEAR_TRIGGER_RADIUS);
  });
});

describe('isHeightFullyInView / isBaseInLowerHalf — 純函式本身的邊界行為', () => {
  it('距離太近時（例如原本的 bug，2.75）塔底到頂塞不進視野', () => {
    expect(isHeightFullyInView({
      distance: 2.75,
      pitchRad: 0,
      topY: LIGHTHOUSE_ROOF_TOP_Y,
      baseY: LIGHTHOUSE_TOWER_BASE_Y,
    })).toBe(false);
  });

  it('距離夠遠、不仰頭（pitch=0）也裝得下的話，底部當然也在視野中心以下', () => {
    expect(isBaseInLowerHalf({ distance: 30, pitchRad: 0, baseY: LIGHTHOUSE_TOWER_BASE_Y })).toBe(true);
  });

  it('同樣是出生距離 7，不加仰角（pitch=0）塔尖還是塞不進視野——證明「仰角」這個修法本身有必要，不是順手加的', () => {
    expect(isHeightFullyInView({
      distance: SPAWN_DISTANCE_FROM_LIGHTHOUSE,
      pitchRad: 0,
      topY: LIGHTHOUSE_ROOF_TOP_Y,
      baseY: LIGHTHOUSE_TOWER_BASE_Y,
    })).toBe(false);
  });
});

describe('computeSpawnFacingLighthouse', () => {
  it('20011 的燈塔座標 {x:-3,z:11} → 出生點落在燈塔觸發半徑內、鏡頭最小距離外', () => {
    const lighthouse = { x: -3, z: 11 };
    const spawn = computeSpawnFacingLighthouse(lighthouse);
    const dist = Math.hypot(spawn.x - lighthouse.x, spawn.z - lighthouse.z);
    expect(dist).toBeGreaterThan(MIN_CAMERA_BUILDING_DISTANCE);
    expect(dist).toBeLessThan(LIGHTHOUSE_NEAR_TRIGGER_RADIUS);
  });

  it('回傳的 pitch 就是 SPAWN_PITCH，不是 0', () => {
    const spawn = computeSpawnFacingLighthouse({ x: -3, z: 11 });
    expect(spawn.pitch).toBe(SPAWN_PITCH);
  });

  it('不是寫死 20011 的座標——換一個燈塔位置，距離關係一樣成立', () => {
    const lighthouse = { x: 40, z: -17 };
    const spawn = computeSpawnFacingLighthouse(lighthouse);
    const dist = Math.hypot(spawn.x - lighthouse.x, spawn.z - lighthouse.z);
    expect(dist).toBeCloseTo(SPAWN_DISTANCE_FROM_LIGHTHOUSE, 5);
  });

  it('yaw=0 的 forward 方向（-sin(yaw), -cos(yaw)）要真的指向燈塔，不是隨便一個角度', () => {
    const lighthouse = { x: 5, z: 2 };
    const spawn = computeSpawnFacingLighthouse(lighthouse);
    const forward = { x: -Math.sin(spawn.yaw), z: -Math.cos(spawn.yaw) };
    const toLighthouse = { x: lighthouse.x - spawn.x, z: lighthouse.z - spawn.z };
    const toLighthouseLen = Math.hypot(toLighthouse.x, toLighthouse.z);
    // forward 跟「指向燈塔」的單位向量應該幾乎重合（點積接近 1）
    const dot = (forward.x * toLighthouse.x + forward.z * toLighthouse.z) / toLighthouseLen;
    expect(dot).toBeCloseTo(1, 5);
  });

  it('可以傳自訂距離（供測試/未來調整用），不是只認預設值', () => {
    const lighthouse = { x: 0, z: 0 };
    const spawn = computeSpawnFacingLighthouse(lighthouse, 10);
    expect(Math.hypot(spawn.x - lighthouse.x, spawn.z - lighthouse.z)).toBeCloseTo(10, 5);
  });

  it('不傳寬高比（舊呼叫端）要維持固定 7 的距離，不能因為加了寬高比補償就悄悄改變預設行為', () => {
    const lighthouse = { x: 0, z: 0 };
    const spawn = computeSpawnFacingLighthouse(lighthouse);
    expect(Math.hypot(spawn.x - lighthouse.x, spawn.z - lighthouse.z)).toBeCloseTo(SPAWN_DISTANCE_FROM_LIGHTHOUSE, 5);
  });

  it('🔒 直式手機寬高比（390/844）要把距離拉遠到超過原本固定的 7——這是這次退件在修的真實 bug（塔身佔了直式畫面 66% 寬）', () => {
    const lighthouse = { x: 0, z: 0 };
    const spawn = computeSpawnFacingLighthouse(lighthouse, undefined, 390 / 844);
    const dist = Math.hypot(spawn.x - lighthouse.x, spawn.z - lighthouse.z);
    expect(dist).toBeGreaterThan(SPAWN_DISTANCE_FROM_LIGHTHOUSE);
  });

  it('寬螢幕（桌機常見 16:9）寬高比不該觸發補償——距離維持原本的 7', () => {
    const lighthouse = { x: 0, z: 0 };
    const spawn = computeSpawnFacingLighthouse(lighthouse, undefined, 16 / 9);
    const dist = Math.hypot(spawn.x - lighthouse.x, spawn.z - lighthouse.z);
    expect(dist).toBeCloseTo(SPAWN_DISTANCE_FROM_LIGHTHOUSE, 5);
  });
});

describe('requiredDistanceForTowerWidthInView', () => {
  it('寬高比越窄，需要的距離越遠——水平 FOV 跟著寬高比變窄，同樣距離下塔身佔比會變大', () => {
    const narrow = requiredDistanceForTowerWidthInView(390 / 844);
    const wide = requiredDistanceForTowerWidthInView(16 / 9);
    expect(narrow).toBeGreaterThan(wide);
  });

  it('🔒 390×844 算出來的距離，套回去驗證塔身寬度確實不超過 MAX_TOWER_WIDTH_FRACTION——不是只看距離變大了，要驗證它真的達到目的', () => {
    const aspect = 390 / 844;
    const distance = requiredDistanceForTowerWidthInView(aspect);
    const vFovRad = (CAMERA_VERTICAL_FOV_DEG * Math.PI) / 180;
    const hFovRad = 2 * Math.atan(Math.tan(vFovRad / 2) * aspect);
    const frameWidth = 2 * distance * Math.tan(hFovRad / 2);
    const towerWidthFraction = (LIGHTHOUSE_TOWER_RADIUS * 2) / frameWidth;
    expect(towerWidthFraction).toBeCloseTo(MAX_TOWER_WIDTH_FRACTION, 5);
  });
});

/**
 * #3780 P0-3 十度審查訂正：真瀏覽器 390×844 實測（headless+swiftshader，
 * 走真實登入/進島流程）發現垂直框架本身是過關的（`isHeightFullyInView`
 * 回 true），但 HUD 標題卡在手機版走正常文件流（不像桌機版
 * `md:absolute` 固定在角落），量到實際佔掉畫面頂端 17.18%
 * （`header.getBoundingClientRect()` 量出 bottom=145px/844px）——塔尖
 * 技術上在視野內，但視覺上被蓋在標題卡底下。
 */
describe('requiredDistanceForTowerTopMargin', () => {
  it('留的安全邊越大，需要的距離越遠', () => {
    const smallMargin = requiredDistanceForTowerTopMargin(SPAWN_PITCH, 0.1);
    const largeMargin = requiredDistanceForTowerTopMargin(SPAWN_PITCH, 0.3);
    expect(largeMargin).toBeGreaterThan(smallMargin);
  });

  it('🔒 算出來的距離，套回去獨立驗證塔尖的畫面位置確實落在安全邊以下——不是只看距離變大，要驗證它真的達到目的', () => {
    const marginFraction = 0.25;
    const distance = requiredDistanceForTowerTopMargin(SPAWN_PITCH, marginFraction);
    const vFovRad = (CAMERA_VERTICAL_FOV_DEG * Math.PI) / 180;
    const halfFovRad = vFovRad / 2;
    const angleToTop = Math.atan2(LIGHTHOUSE_ROOF_TOP_Y - EYE_HEIGHT, distance) - SPAWN_PITCH;
    const screenYFractionFromTop = (1 - Math.tan(angleToTop) / Math.tan(halfFovRad)) / 2;
    expect(screenYFractionFromTop).toBeCloseTo(marginFraction, 5);
  });

  it('🔒 真機量到的標題卡佔比（17.18%，390×844 實測）要落在這個安全邊（25%）以內，不然這個常數訂得不夠——這是這次退件在修的真實 bug', () => {
    const MEASURED_HEADER_BOTTOM_FRACTION = 145 / 844; // header.getBoundingClientRect() 實測
    expect(TOWER_TOP_SAFE_MARGIN_FRACTION, '安全邊必須大於真機量到的標題卡佔比，不然塔尖還是會被蓋住').toBeGreaterThan(MEASURED_HEADER_BOTTOM_FRACTION);
  });
});

describe('computeSpawnFacingLighthouse — 塔尖安全邊只在手機直式比例生效', () => {
  it('🔒 直式手機寬高比（390/844）算出來的距離要能讓塔尖落在安全邊以下——這是這次退件在修的真實 bug（HUD 標題卡蓋住塔尖）', () => {
    const lighthouse = { x: 0, z: 0 };
    const spawn = computeSpawnFacingLighthouse(lighthouse, undefined, 390 / 844);
    const distance = Math.hypot(spawn.x - lighthouse.x, spawn.z - lighthouse.z);
    const vFovRad = (CAMERA_VERTICAL_FOV_DEG * Math.PI) / 180;
    const halfFovRad = vFovRad / 2;
    const angleToTop = Math.atan2(LIGHTHOUSE_ROOF_TOP_Y - EYE_HEIGHT, distance) - spawn.pitch;
    const screenYFractionFromTop = (1 - Math.tan(angleToTop) / Math.tan(halfFovRad)) / 2;
    expect(screenYFractionFromTop, `塔尖落在畫面頂端 ${(screenYFractionFromTop * 100).toFixed(1)}%，應該 >= 安全邊 ${(TOWER_TOP_SAFE_MARGIN_FRACTION * 100).toFixed(1)}%`).toBeGreaterThanOrEqual(TOWER_TOP_SAFE_MARGIN_FRACTION - 1e-9);
  });

  it('寬螢幕（16:9）不該套用塔尖安全邊——桌機版標題卡固定在角落，不會擋到塔尖，距離維持原本的補償結果', () => {
    const lighthouse = { x: 0, z: 0 };
    const withoutTopMargin = computeSpawnFacingLighthouse(lighthouse, undefined, 16 / 9);
    const dist = Math.hypot(withoutTopMargin.x - lighthouse.x, withoutTopMargin.z - lighthouse.z);
    // 16:9 的寬度補償距離本來就 <= SPAWN_DISTANCE_FROM_LIGHTHOUSE，不該因為
    // 塔尖安全邊又被拉遠。
    expect(dist).toBeCloseTo(SPAWN_DISTANCE_FROM_LIGHTHOUSE, 5);
  });
});

/**
 * findCelebrationViewpoint 回歸鎖——#3780 P0-3 三度審查訂正（2026-10-27）。
 *
 * 真實 bug：第一版直接沿「玩家→建築」直線把鏡頭推近（`celebrationEyeOffset`，
 * 已移除），179 課全量掃過，17.5% 的位置落在別的建築碰撞圈裡、9.4% 落在
 * 山丘碰撞圈裡——玩家可能從島上任何角落用清單模式直接開站，沒有真的走
 * 過去，那條直線完全可能穿過別的東西。下面這組測試直接還原那個情境：
 * 把玩家放在「跟建築之間夾著另一棟建築」的位置，驗證這次的做法不會
 * 像舊寫法一樣直接穿過去。
 */
describe('findCelebrationViewpoint（慶祝期間找一個不穿牆的觀景點）', () => {
  const zoneCenter = { x: 0, z: 0, radius: 30 };

  it('四周完全淨空時，選到跟玩家同一側、距離剛好等於 CELEBRATION_VIEW_DISTANCE 的點', () => {
    const target = { x: 0, z: 0 };
    const player = { x: 0, z: 10 }; // 玩家在建築正北邊
    const viewpoint = findCelebrationViewpoint({
      target,
      player,
      otherBuildings: [],
      hills: [],
      zoneCenter,
    });
    expect(viewpoint).not.toBeNull();
    expect(Math.hypot(viewpoint!.x - target.x, viewpoint!.z - target.z)).toBeCloseTo(CELEBRATION_VIEW_DISTANCE, 5);
    expect(viewpoint!.extraHeight).toBe(CELEBRATION_EXTRA_HEIGHT);
    // 挑的點應該跟玩家同一側（z 應該是正的，不是躲去建築另一邊）
    expect(viewpoint!.z).toBeGreaterThan(0);
  });

  it('🔒 回歸鎖：玩家正前方那一側被另一棟建築擋住時，不能選到那個方向（舊寫法會直接穿過去）', () => {
    const target = { x: 0, z: 0 };
    const player = { x: 0, z: 20 }; // 玩家在正北邊，很遠
    const blockingBuilding = { x: 0, z: CELEBRATION_VIEW_DISTANCE }; // 剛好卡在「沿直線推」會到的那個位置
    const viewpoint = findCelebrationViewpoint({
      target,
      player,
      otherBuildings: [blockingBuilding],
      hills: [],
      zoneCenter,
    });
    expect(viewpoint).not.toBeNull();
    // 不能跟那棟擋路的建築距離太近（不能是同一個位置，也不能穿過去）
    const distToBlocker = Math.hypot(viewpoint!.x - blockingBuilding.x, viewpoint!.z - blockingBuilding.z);
    expect(distToBlocker).toBeGreaterThanOrEqual(MIN_CAMERA_BUILDING_DISTANCE);
  });

  it('山丘擋在玩家那一側時，改選別的角度，不會落在山丘碰撞圈裡', () => {
    const target = { x: 0, z: 0 };
    const player = { x: 0, z: 20 };
    const blockingHill: readonly [number, number, number] = [0, CELEBRATION_VIEW_DISTANCE, 3];
    const viewpoint = findCelebrationViewpoint({
      target,
      player,
      otherBuildings: [],
      hills: [blockingHill],
      zoneCenter,
    });
    expect(viewpoint).not.toBeNull();
    const [hx, hz, hr] = blockingHill;
    expect(Math.hypot(viewpoint!.x - hx, viewpoint!.z - hz)).toBeGreaterThanOrEqual(hr * 0.7);
  });

  it('候選點看向建築的視線被第三棟建築擋住時要跳過這個候選', () => {
    const target = { x: 10, z: 0 };
    const player = { x: 10, z: 20 };
    // 這棟建築不在候選點本身的位置，而是卡在「玩家那一側候選點→建築」的連線中間
    const sightBlocker = { x: 10, z: CELEBRATION_VIEW_DISTANCE / 2 };
    const viewpoint = findCelebrationViewpoint({
      target,
      player,
      otherBuildings: [sightBlocker],
      hills: [],
      zoneCenter,
    });
    expect(viewpoint).not.toBeNull();
    // 驗證選到的點不是玩家正前方那個被擋住的角度（z 應該不會非常接近
    // player 方向的候選，因為那個候選的視線被擋了）
    const playerSideCandidate = { x: target.x, z: target.z + CELEBRATION_VIEW_DISTANCE };
    const isPlayerSideCandidate = Math.hypot(viewpoint!.x - playerSideCandidate.x, viewpoint!.z - playerSideCandidate.z) < 0.01;
    expect(isPlayerSideCandidate).toBe(false);
  });

  it('完全被其他建築團團圍住、找不到任何合法候選時回傳 null（呼叫端的規則：這時只轉頭不移動鏡頭）', () => {
    const target = { x: 0, z: 0 };
    const player = { x: 0, z: 20 };
    // 用密集的一圈建築把目標整個包住，12 個候選角度全部命中
    const otherBuildings = Array.from({ length: 24 }, (_, i) => {
      const angle = (i * 15 * Math.PI) / 180;
      return { x: Math.sin(angle) * CELEBRATION_VIEW_DISTANCE, z: Math.cos(angle) * CELEBRATION_VIEW_DISTANCE };
    });
    const viewpoint = findCelebrationViewpoint({ target, player, otherBuildings, hills: [], zoneCenter });
    expect(viewpoint).toBeNull();
  });

  it('候選點超出島嶼範圍（太靠近海岸線外）時要跳過', () => {
    const smallZone = { x: 0, z: 0, radius: 6 }; // 半徑只比 CELEBRATION_VIEW_DISTANCE(5.5) 大一點點
    const target = { x: 0, z: 0 };
    const player = { x: 0, z: 1 };
    const viewpoint = findCelebrationViewpoint({ target, player, otherBuildings: [], hills: [], zoneCenter: smallZone });
    // island radius - 1 = 5，比 CELEBRATION_VIEW_DISTANCE(5.5) 還小，
    // 理論上所有候選都會超出島嶼範圍
    expect(viewpoint).toBeNull();
  });
});

/**
 * #3780 P0-3 七度審查訂正：飛行途中鎖住輸入——真瀏覽器+179 課實算抓到，
 * 原本「手動移動打斷飛行」會讓高度在按下方向鍵那一幀瞬間歸零，約三成
 * 落在建築或山丘裡。`createIslandWorld.ts` 的 per-frame 迴圈接的就是這支
 * 函式的回傳值（`let length = isMovementLocked(introPlaying, flying) ? 0
 * : Math.hypot(dx, dz)`），鎖住的不只是「移動」，連帶鎖住下面判斷
 * `travelFlight = null` 的那個分支（已經拿掉，現在移動完全不會打斷飛行）。
 */
describe('isMovementLocked — 飛行/開場鏡頭期間鎖住輸入', () => {
  it('🔒 正在飛行時（即使沒有播開場鏡頭）要鎖住輸入——這是這次退件的真實 bug', () => {
    expect(isMovementLocked(false, true)).toBe(true);
  });

  it('開場鏡頭播放中（即使沒有在飛行）要鎖住輸入——既有行為，不能因為這次改動被拆掉', () => {
    expect(isMovementLocked(true, false)).toBe(true);
  });

  it('兩者都不成立時不該鎖住輸入，否則玩家永遠不能動', () => {
    expect(isMovementLocked(false, false)).toBe(false);
  });
});

/**
 * #3794（PRD 2026-10-30-island-v2-rpg-pets-story-prd.md §9 2b，Young 硬
 * 規定）：「按 WASD、空白鍵、Shift，角色位置不變」。上帝視角是唯一模式，
 * 這支鎖的是 `createIslandWorld.ts` 裡三個會被按鍵/拖曳觸碰到的地方
 * （鍵盤移動、空白鍵跳躍、拖曳旋轉視角）實際呼叫的同一條判斷式。
 */
describe('isManualControlEnabled — #3794 上帝視角是唯一模式，WASD/空白鍵/拖曳都不該生效', () => {
  it('god 模式（唯一可從介面進入的模式）→ 手動控制不啟用', () => {
    expect(isManualControlEnabled('god')).toBe(false);
  });

  it('first 模式（程式碼留著但沒有任何入口切得進去）→ 手動控制啟用，不是整個功能被刪掉', () => {
    expect(isManualControlEnabled('first')).toBe(true);
  });
});

/**
 * #3780 P0-3 八度審查訂正：3D 站牌是 `depthTest: false`，永遠畫在最
 * 上層——即使物理上被別棟建築擋住，字牌還是會穿模浮在前景建築上
 * （team-lead 2026-10-27 截圖抓到：「回音劇場」浮在港口燈塔前面）。
 */
describe('isLabelOccluded — 鏡頭→名牌視線被別棟建築擋住', () => {
  const tallObstacle: LabelOcclusionObstacle = { x: 0, z: 5, radius: 2, baseY: 0, topY: 5 };

  it('🔒 障礙物剛好卡在鏡頭跟名牌中間、高度也夠高——要判定被擋住（這次退件的真實 bug）', () => {
    const camera = { x: 0, y: 2, z: 0 };
    const label = { x: 0, y: 2, z: 10 };
    expect(isLabelOccluded(camera, label, [tallObstacle])).toBe(true);
  });

  it('障礙物在視線旁邊（水平距離遠超過半徑）——不該被判定擋住', () => {
    const camera = { x: 0, y: 2, z: 0 };
    const label = { x: 0, y: 2, z: 10 };
    const sideObstacle: LabelOcclusionObstacle = { x: 10, z: 5, radius: 2, baseY: 0, topY: 5 };
    expect(isLabelOccluded(camera, label, [sideObstacle])).toBe(false);
  });

  it('障礙物水平位置卡在視線上，但矮到視線其實是從它上空通過——不該被判定擋住', () => {
    const camera = { x: 0, y: 2, z: 0 };
    const label = { x: 0, y: 2, z: 10 };
    const shortObstacle: LabelOcclusionObstacle = { x: 0, z: 5, radius: 2, baseY: 0, topY: 1 };
    expect(isLabelOccluded(camera, label, [shortObstacle])).toBe(false);
  });

  it('多個障礙物裡只要有一個真的擋住，整體就要判定被擋住，不是全部都要擋到才算', () => {
    const camera = { x: 0, y: 2, z: 0 };
    const label = { x: 0, y: 2, z: 10 };
    const sideObstacle: LabelOcclusionObstacle = { x: 10, z: 5, radius: 2, baseY: 0, topY: 5 };
    expect(isLabelOccluded(camera, label, [sideObstacle, tallObstacle])).toBe(true);
  });

  it('沒有任何障礙物時一定不被擋住', () => {
    const camera = { x: 0, y: 2, z: 0 };
    const label = { x: 0, y: 2, z: 10 };
    expect(isLabelOccluded(camera, label, [])).toBe(false);
  });
});

/**
 * #3794 三次訂正（team-lead 2026-10-30 退件）：點建築之後，看得見的角色
 * 要沿著既有石板路走到門口，不是鏡頭沿拱形飛過去。用一條簡單的合成直線
 * 路徑（不用真實 `FULL_ISLAND_PATH`，座標好手算、斷言好驗）測 `project
 * OntoPath`／`pointAtPathDistance`，`FULL_ISLAND_PATH` 本身只驗證「三段
 * 真的接起來、首尾去重」。
 */
describe('projectOntoPath / pointAtPathDistance — 把世界座標投影到路網上、互逆', () => {
  const straightPath: ReadonlyArray<readonly [number, number]> = [[0, 0], [10, 0]];

  it('點剛好在路上 → 距離就是它在那條線上的位置，座標不變', () => {
    expect(projectOntoPath({ x: 4, z: 0 }, straightPath)).toEqual({ distance: 4, x: 4, z: 0 });
  });

  it('點偏離路徑 → 投影到最近的垂直落點，距離是沿路走到那個落點的弧長', () => {
    expect(projectOntoPath({ x: 5, z: 3 }, straightPath)).toEqual({ distance: 5, x: 5, z: 0 });
  });

  it('點落在路徑起點之前 → 夾在起點，距離 0（不會算出負距離）', () => {
    expect(projectOntoPath({ x: -5, z: 0 }, straightPath)).toEqual({ distance: 0, x: 0, z: 0 });
  });

  it('點落在路徑終點之後 → 夾在終點，距離等於整條路的長度', () => {
    expect(projectOntoPath({ x: 15, z: 0 }, straightPath)).toEqual({ distance: 10, x: 10, z: 0 });
  });

  it('多段折線（L 形）：投影到第二段要把第一段的長度算進累計距離裡', () => {
    const lShape: ReadonlyArray<readonly [number, number]> = [[0, 0], [10, 0], [10, 10]];
    expect(projectOntoPath({ x: 10, z: 4 }, lShape)).toEqual({ distance: 14, x: 10, z: 4 });
  });

  it('pointAtPathDistance 是 projectOntoPath 的反函式：路上任一點投影回去再查距離，要拿回同一個點', () => {
    const p = pointAtPathDistance(7, straightPath);
    expect(p).toEqual({ x: 7, z: 0 });
    expect(projectOntoPath(p, straightPath)).toEqual({ distance: 7, x: 7, z: 0 });
  });

  it('距離超出路徑總長或是負的 → 夾在兩端，不會算出路徑外的點', () => {
    expect(pointAtPathDistance(-5, straightPath)).toEqual({ x: 0, z: 0 });
    expect(pointAtPathDistance(999, straightPath)).toEqual({ x: 10, z: 0 });
  });
});

describe('FULL_ISLAND_PATH — 三段 ZONE_PATHS 接成一條連續路網', () => {
  it('首尾相連的交界點只出現一次（去重），不是三段直接串接留著重複點', () => {
    // 三段 ZONE_PATHS 各自的點數分別是 6/8/9；交界處重複兩次，去重後應該
    // 是 6 + (8-1) + (9-1) = 21，不是 6+8+9=23。
    expect(FULL_ISLAND_PATH.length).toBe(21);
  });

  it('第一個點是第一段的起點，最後一個點是最後一段的終點', () => {
    expect(FULL_ISLAND_PATH[0]).toEqual([-3, 12]);
    expect(FULL_ISLAND_PATH[FULL_ISLAND_PATH.length - 1]).toEqual([22, -32]);
  });
});

/**
 * `walkAlongPathPosition` 三段式（上路／沿路／下路）——跟 `arcFlightPosition`
 * 的三段式飛行同一個精神，差別是這裡全程貼地、沒有墊高。
 */
describe('walkAlongPathPosition — 角色沿路走到門口（取代拱形飛行）', () => {
  const straightPath: ReadonlyArray<readonly [number, number]> = [[0, 0], [10, 0]];
  // start 偏離路徑 3 個單位、end 偏離 4 個單位：legOn=3, legAlong=10, legOff=4, total=17
  const start = { x: 0, z: -3 };
  const end = { x: 10, z: 4 };

  it('progress=0 → 完全等於出發點（還沒開始走）', () => {
    const pos = walkAlongPathPosition(start, end, 0, straightPath);
    expect(pos.x).toBeCloseTo(start.x, 5);
    expect(pos.z).toBeCloseTo(start.z, 5);
    expect(pos.phase).toBe('onto-path');
  });

  it('progress=1 → 完全等於終點（走到門口了）', () => {
    const pos = walkAlongPathPosition(start, end, 1, straightPath);
    expect(pos.x).toBeCloseTo(end.x, 5);
    expect(pos.z).toBeCloseTo(end.z, 5);
    expect(pos.phase).toBe('to-door');
  });

  it('走到一半（progress=0.5）→ 人在路網上，z 座標等於路徑本身的 z（0），不是在空中飛的墊高軌跡', () => {
    // total=17, 一半=8.5；legOn(3) 之後進入 along-path 段（legOn+legAlong=13），
    // 8.5 落在這段裡，應該穩穩站在 z=0 的路徑上。
    const pos = walkAlongPathPosition(start, end, 0.5, straightPath);
    expect(pos.phase).toBe('along-path');
    expect(pos.z).toBeCloseTo(0, 5);
    expect(pos.x).toBeGreaterThan(0);
    expect(pos.x).toBeLessThan(10);
  });

  it('逐步前進（0→1 取 6 個樣本）：x 座標必須單調不減——不會中途跳回去或瞬移', () => {
    const samples = [0, 0.2, 0.4, 0.6, 0.8, 1].map((p) => walkAlongPathPosition(start, end, p, straightPath));
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i].x).toBeGreaterThanOrEqual(samples[i - 1].x - 1e-9);
    }
  });

  it('start 跟 end 投影到路網上同一點（legAlong=0）時，直接從上路切到下路，不會除以 0 或卡住', () => {
    const samePoint = { x: 5, z: -2 };
    const nearby = { x: 5, z: 3 };
    const pos = walkAlongPathPosition(samePoint, nearby, 0.5, straightPath);
    expect(Number.isFinite(pos.x)).toBe(true);
    expect(Number.isFinite(pos.z)).toBe(true);
  });
});

describe('walkDurationSeconds — 跟既有 WASD 行走同一個速度常數換算', () => {
  const straightPath: ReadonlyArray<readonly [number, number]> = [[0, 0], [10, 0]];

  it('路程越長，秒數越長（不是固定區間，長短路要有感覺上的速度差）', () => {
    const near = walkDurationSeconds({ x: 0, z: -1 }, { x: 2, z: 1 }, straightPath);
    const far = walkDurationSeconds({ x: 0, z: -1 }, { x: 9, z: 1 }, straightPath);
    expect(far).toBeGreaterThan(near);
  });

  it('距離很短時有最小秒數下限，不會瞬移成 0 秒', () => {
    const tiny = walkDurationSeconds({ x: 5, z: -0.01 }, { x: 5, z: 0.01 }, straightPath);
    expect(tiny).toBeGreaterThanOrEqual(0.9);
  });
});

/**
 * #3794 三次訂正：鏡頭「俯角與高度保持不變」這個硬規定，直接鎖在純函式
 * 層——不管玩家走到路徑上的哪個點，`godCameraDesiredPosition` 算出來的
 * y 分量必須是同一個數字；x/z 只能跟著玩家水平位移，不能有別的輸入
 * （yaw／pitch／飛行墊高）混進來。
 */
describe('godCameraDesiredPosition — 上帝視角鏡頭只跟水平位置走，俯角/高度恆定', () => {
  it('兩個不同的玩家位置，算出來的鏡頭高度（y）必須完全相同', () => {
    const a = godCameraDesiredPosition({ x: 0, z: 0 });
    const b = godCameraDesiredPosition({ x: 37, z: -12 });
    expect(a.y).toBe(b.y);
    expect(a.y).toBe(GOD_CAMERA_DISTANCE * Math.sin(GOD_CAMERA_PITCH));
  });

  it('玩家水平位移多少，鏡頭的目標位置就跟著位移同樣的量（x/z 是平移，不是重新計算角度）', () => {
    const a = godCameraDesiredPosition({ x: 0, z: 0 });
    const b = godCameraDesiredPosition({ x: 5, z: -3 });
    expect(b.x - a.x).toBeCloseTo(5, 5);
    expect(b.z - a.z).toBeCloseTo(-3, 5);
  });

  it('整段模擬角色沿路走（0→1 取 5 個樣本）：鏡頭高度在整段移動過程中恆定——這是退件要求鎖的那個不變量', () => {
    const straightPath: ReadonlyArray<readonly [number, number]> = [[0, 0], [10, 0]];
    const start = { x: 0, z: -3 };
    const end = { x: 10, z: 4 };
    const heights = [0, 0.25, 0.5, 0.75, 1].map((p) => {
      const pos = walkAlongPathPosition(start, end, p, straightPath);
      return godCameraDesiredPosition(pos).y;
    });
    const [first, ...rest] = heights;
    for (const h of rest) expect(h).toBe(first);
  });
});
