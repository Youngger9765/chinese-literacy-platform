import * as THREE from 'three';
import { disposeObjectTree } from '../../lab/island/islandBuildingShapes';
import { hexSpiralCoord, axialToCartesian, type ClusterMode } from './core/archipelagoClusters';
import { createSceneCtx } from './core/sceneCtx';
import type { IslandStatus } from './core/islandStatus';
import type { ArchipelagoTheme, CellInfo } from './themes/types';

/**
 * createArchipelagoWorld.ts — 群島模式 3D 場景骨架（#3780，
 * docs/prd/2026-10-30-archipelago-clusters-prd.md §3/§4/§7/§8.5；
 * `.claude/skills/archipelago-module/SKILL.md`）。
 *
 * 模組重構（2026-10-30）：這支不再寫死任何視覺（底面、顏色常數）——長
 * 什麼樣子一律向傳進來的 `theme: ArchipelagoTheme` 要（`themes/` 底下的
 * 各份皮膚設定檔）。這支只管：鏡頭、互動（拖曳/縮放/點擊/hover）、蜂巢
 * 座標換算、換群時的資源釋放、resize/render loop——SKILL §1「骨架層
 * 不知道長什麼樣子」。
 *
 * 跟 `lab/island/createIslandWorld.ts`（單課島、第一人稱走動）是兩種場景：
 * 這支是「一張地圖看一整群課程島＋中央傳送門廣場」的俯瞰場景，互動是拖曳
 * 旋轉／縮放＋點擊選取，不是第一人稱移動。
 *
 * 效能取捨（team-lead 2026-10-30 授權「介面不合理就直接改」）：第一版
 * 用 InstancedMesh 共用課程島地基，這版照 SKILL §2.1 的
 * `island(ctx, cell): THREE.Object3D` 介面整座島（含地基）交給主題建——
 * 代價是拿掉了地基的 InstancedMesh。在目前的規模（單群最多 71 座島，
 * `genre`/`category` 模式最大群）這不是效能問題——InstancedMesh 是給數百
 * 上千個實例才真的重要；拿掉它換來的是「換主題真的只改一份設定檔，
 * 骨架一行都不用動」，這是 SKILL 的核心訴求。如果以後島數量級上升到真的
 * 需要 instance 化，要另外設計（例如讓主題提供「地基幾何」而不是整座島）。
 */

export interface ArchipelagoWorldIsland {
  storySlug: string;
  title: string;
  /** 已正規化（自然科學/寓言故事/歷史人文/生活/其他）——呼叫端必須先用
   *  `core/archipelagoClusters.ts` 的 `normalizeCategory()` 轉過一次再傳
   *  進來（code review 2026-10-30 blocker：之前呼叫端直接傳
   *  `/api/stories` 的原始類別碼，這裡／現在主題的 `landmarks` 比對的是
   *  中文標籤，兩邊對不上，全部島都掉進 default 造型）。 */
  category: string;
  status: IslandStatus;
  stationsDone: number;
  stationsTotal: number;
}

export interface ArchipelagoWorldPortal {
  key: string;
  label: string;
  occupiedCount: number;
  total: number;
}

export interface ArchipelagoWorldEvents {
  onSelectIsland: (storySlug: string) => void;
  onSelectPortal: (clusterKey: string) => void;
  onHoverIsland?: (storySlug: string | null) => void;
}

/** 相鄰六角格中心距離——跟 `archipelagoClusters.ts` 的 `axialToCartesian`
 *  共用同一個 `size` 概念，這裡決定「島跟島隔多遠」。這是骨架常數，不是
 *  主題設定——換皮不該改變佈局間距。 */
export const HEX_SIZE = 3.6;

/** 傳送門離廣場中心多遠——骨架常數（跟 `HEX_SIZE` 一樣，換皮不該改變
 *  佈局間距）。第一版主題的廣場半徑是 2.1，門離中心 3.0 相當於離廣場
 *  邊緣 0.9，這裡沿用同樣的視覺間距，但骨架本身不知道任何主題的廣場
 *  實際半徑是多少——這正是拆分之後必然的取捨：骨架用固定常數抓一個
 *  「大部分主題的廣場應該長這麼大」的距離，不會因為某個主題改了廣場
 *  半徑就自動跟著調整（SKILL §5 允許的範圍內，這不是 `if (theme.id)`
 *  那種分支，是骨架對「廣場大概多大」的合理假設）。 */
const PORTAL_DISTANCE_FROM_HUB = 3.0;

/** WebGL 無法建立時回傳 `null`（PRD §6：自動降級到清單模式，不是顯示錯誤
 *  頁），呼叫端用這個判斷要不要 render 3D 容器。
 *
 * @param theme 要哪個皮膚——`themes/index.ts` 的 `THEMES[id]`，呼叫端負責
 *   選（HUD 切換、localStorage 偏好都在呼叫端，這支不管）。
 */
export function createArchipelagoWorld(
  container: HTMLElement,
  events: ArchipelagoWorldEvents,
  theme: ArchipelagoTheme,
): ArchipelagoWorld | null {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  } catch {
    return null;
  }
  if (!renderer.getContext()) return null;

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.7));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.35;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(theme.palette.background);
  scene.fog = new THREE.FogExp2(theme.palette.fog, 0.01);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 300);

  const ambient = new THREE.HemisphereLight(theme.lighting.hemisphereSky, theme.lighting.hemisphereGround, theme.lighting.ambient);
  scene.add(ambient);
  const sun = new THREE.DirectionalLight(theme.lighting.sunColor, theme.lighting.sunIntensity);
  sun.position.set(...theme.lighting.sunDirection);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  scene.add(sun);

  // ---------------------------------------------------------------------
  // 拖曳旋轉／滾輪縮放的簡易軌道鏡頭——不是第一人稱，PRD §3.4：「拖曳旋轉、
  // 滾輪／雙指縮放、自動限制在群的範圍內」。
  // ---------------------------------------------------------------------
  let orbitRadius = 22;
  let orbitYaw = 0.5;
  let orbitPitch = 0.65; // 俯角，0=水平 PI/2=正上方
  let orbitTarget = new THREE.Vector3(0, 0, 0);
  let minRadius = 10;
  let maxRadius = 60;

  function syncCamera() {
    const clampedPitch = Math.max(0.2, Math.min(1.4, orbitPitch));
    const clampedRadius = Math.max(minRadius, Math.min(maxRadius, orbitRadius));
    const horizontal = clampedRadius * Math.cos(clampedPitch);
    const y = clampedRadius * Math.sin(clampedPitch);
    camera.position.set(
      orbitTarget.x + horizontal * Math.sin(orbitYaw),
      orbitTarget.y + y,
      orbitTarget.z + horizontal * Math.cos(orbitYaw),
    );
    camera.lookAt(orbitTarget);
  }
  syncCamera();

  let dragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  const onPointerDown = (e: PointerEvent) => { dragging = true; dragStartX = e.clientX; dragStartY = e.clientY; renderer.domElement.setPointerCapture(e.pointerId); };
  const onPointerMove = (e: PointerEvent) => {
    if (!dragging) return;
    orbitYaw -= (e.clientX - dragStartX) * 0.006;
    orbitPitch = Math.max(0.2, Math.min(1.4, orbitPitch - (e.clientY - dragStartY) * 0.004));
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    syncCamera();
  };
  const onPointerUp = () => { dragging = false; };
  const onWheel = (e: WheelEvent) => { e.preventDefault(); orbitRadius = Math.max(minRadius, Math.min(maxRadius, orbitRadius + e.deltaY * 0.03)); syncCamera(); };
  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  renderer.domElement.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  renderer.domElement.addEventListener('wheel', onWheel, { passive: false });

  // ---------------------------------------------------------------------
  // 點擊選取（raycasting）——島跟門都是獨立物件（拿掉 InstancedMesh 之後
  // 地基不再共用，見檔頭「效能取捨」），raycast 打 `pickableIslands`/
  // `pickablePortals` 兩個陣列，靠 `userData.storySlug`/`userData.portalKey`
  // 往上找。
  // ---------------------------------------------------------------------
  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();
  let pickableIslands: THREE.Object3D[] = [];
  let pickablePortals: THREE.Object3D[] = [];
  let islandPositions = new Map<string, THREE.Vector3>();
  let downAt = { x: 0, y: 0 };

  function resolveIslandSlugFromPointer(clientX: number, clientY: number): string | null {
    const rect = renderer.domElement.getBoundingClientRect();
    pointerNdc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointerNdc, camera);
    const hit = raycaster.intersectObjects(pickableIslands, true)[0];
    if (!hit) return null;
    let o: THREE.Object3D | null = hit.object;
    while (o && !o.userData.storySlug) o = o.parent;
    return (o?.userData.storySlug as string) ?? null;
  }

  const onClickDown = (e: PointerEvent) => { downAt = { x: e.clientX, y: e.clientY }; };
  const onClickUp = (e: PointerEvent) => {
    if (Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 6) return; // 拖曳不算點擊
    const islandSlug = resolveIslandSlugFromPointer(e.clientX, e.clientY);
    if (islandSlug) { events.onSelectIsland(islandSlug); return; }

    const rect = renderer.domElement.getBoundingClientRect();
    pointerNdc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointerNdc, camera);
    const portalHit = raycaster.intersectObjects(pickablePortals, true)[0];
    if (portalHit) {
      let o: THREE.Object3D | null = portalHit.object;
      while (o && !o.userData.portalKey) o = o.parent;
      if (o?.userData.portalKey) events.onSelectPortal(o.userData.portalKey as string);
    }
  };
  renderer.domElement.addEventListener('pointerdown', onClickDown);
  renderer.domElement.addEventListener('pointerup', onClickUp);

  let hoveredSlug: string | null = null;
  const onHoverMove = (e: PointerEvent) => {
    if (!events.onHoverIsland) return;
    const slug = resolveIslandSlugFromPointer(e.clientX, e.clientY);
    if (slug !== hoveredSlug) { hoveredSlug = slug; events.onHoverIsland(slug); }
  };
  renderer.domElement.addEventListener('pointermove', onHoverMove);

  let clusterGroup: THREE.Group | null = null;

  /**
   * 載入一群——換群時先釋放上一群（`disposeObjectTree`），位置由
   * `hexSpiralCoord`（純函式，已獨立測試）決定，這裡只負責把純座標轉成
   * 真的 three.js 物件，長相全部向 `theme` 要。
   *
   * `createSceneCtx()` 每次呼叫都重新建（不是模組層級共用常數）——理由
   * 跟第一版拿掉 InstancedMesh 共用幾何/材質一樣：`disposeObjectTree`
   * 換群時會把上一群 `clusterGroup` 底下所有幾何/材質一起 dispose，模組
   * 層級共用的快取會在第一次換群後就被清掉，下一群重用同一個快取物件
   * 會是「已經 dispose 過的材質」，造成不必要的著色器重編譯甚至視覺異常
   * （code review 2026-10-30 非 blocker 項：materials 共用被清掉重編譯——
   * 這個設計一併解掉了那個問題，不是另外修）。
   */
  function loadCluster(islands: ArchipelagoWorldIsland[], portals: ArchipelagoWorldPortal[]): void {
    if (clusterGroup) {
      scene.remove(clusterGroup);
      disposeObjectTree(clusterGroup);
    }
    pickableIslands = [];
    pickablePortals = [];
    islandPositions = new Map();

    const { ctx } = createSceneCtx(scene);
    const group = new THREE.Group();
    scene.add(group);

    const groundObj = theme.ground(ctx);
    group.add(groundObj);

    const plazaPos = axialToCartesian(hexSpiralCoord(0), HEX_SIZE);
    const hub = theme.hub(ctx);
    hub.position.set(plazaPos.x, 0, plazaPos.z);
    group.add(hub);

    const angleStep = (Math.PI * 2) / Math.max(1, portals.length);
    portals.forEach((portal, i) => {
      const angle = i * angleStep;
      const portalInfo = { key: portal.key, label: portal.label, occupiedCount: portal.occupiedCount, total: portal.total };
      const portalObj = theme.portal(ctx, portalInfo);
      const px = plazaPos.x + Math.cos(angle) * PORTAL_DISTANCE_FROM_HUB;
      const pz = plazaPos.z + Math.sin(angle) * PORTAL_DISTANCE_FROM_HUB;
      portalObj.position.set(px, 0, pz);
      portalObj.lookAt(plazaPos.x, 0, plazaPos.z);
      portalObj.userData.portalKey = portal.key;
      group.add(portalObj);
      pickablePortals.push(portalObj);
    });

    const positions: { x: number; z: number }[] = [plazaPos];
    islands.forEach((island, i) => {
      const coord = hexSpiralCoord(i + 1);
      const pos = axialToCartesian(coord, HEX_SIZE);
      positions.push(pos);

      const cell: CellInfo = {
        storySlug: island.storySlug,
        title: island.title,
        category: island.category,
        status: island.status,
        stationsDone: island.stationsDone,
        stationsTotal: island.stationsTotal,
        position: pos,
      };
      const islandObj = theme.island(ctx, cell);
      theme.statusLook[island.status](islandObj, ctx);
      islandObj.position.set(pos.x, 0, pos.z);
      islandObj.userData.storySlug = island.storySlug;
      group.add(islandObj);
      pickableIslands.push(islandObj);
      islandPositions.set(island.storySlug, new THREE.Vector3(pos.x, 0, pos.z));

      // 連回螺旋順序的前一座（index 0 = 廣場本身），讓整群連成一條路徑。
      const connector = theme.connector(ctx, positions[i], pos);
      if (connector) group.add(connector);
    });

    clusterGroup = group;

    // 鏡頭自動縮放涵蓋整群範圍（§3.4「自動限制在群的範圍內」）——島越多、
    // 螺旋半徑越大，固定鏡頭距離在大群會看不到外圈、在小群又拉太遠。
    const maxDist = positions.reduce((m, p) => Math.max(m, Math.hypot(p.x, p.z)), 1);
    orbitRadius = Math.max(14, maxDist * 1.7);
    minRadius = Math.max(8, maxDist * 0.5);
    maxRadius = maxDist * 3.2;
    orbitTarget = new THREE.Vector3(0, 0, 0);
    syncCamera();
  }

  // ---------------------------------------------------------------------
  // resize + render loop
  // ---------------------------------------------------------------------
  function resize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);

  let frameId = 0;
  function animate() {
    frameId = requestAnimationFrame(animate);
    renderer.render(scene, camera);
  }
  animate();

  function dispose(): void {
    cancelAnimationFrame(frameId);
    resizeObserver.disconnect();
    renderer.domElement.removeEventListener('pointerdown', onPointerDown);
    renderer.domElement.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    renderer.domElement.removeEventListener('wheel', onWheel);
    renderer.domElement.removeEventListener('pointerdown', onClickDown);
    renderer.domElement.removeEventListener('pointerup', onClickUp);
    renderer.domElement.removeEventListener('pointermove', onHoverMove);
    // code review 2026-10-30 非 blocker：原本這裡只呼叫
    // `disposeObjectTree(scene)`，但 `clusterGroup` 還掛在 `scene` 底下
    // （從沒被 `scene.remove()` 過，只有換群時才會），於是上一行
    // `disposeObjectTree(clusterGroup)` 跟這行各 dispose 了一次同一批
    // 物件。先 `scene.remove(clusterGroup)` 讓它脫離 scene 的子樹，下面
    // 的 `disposeObjectTree(scene)` 就不會再碰到它。
    if (clusterGroup) {
      scene.remove(clusterGroup);
      disposeObjectTree(clusterGroup);
      clusterGroup = null;
    }
    disposeObjectTree(scene);
    renderer.dispose();
    if (renderer.domElement.parentElement === container) container.removeChild(renderer.domElement);
  }

  return { loadCluster, dispose, focusOnIsland: (storySlug: string) => focusOnIsland(storySlug) };

  function focusOnIsland(storySlug: string): void {
    const position = islandPositions.get(storySlug);
    if (!position) return;
    orbitTarget = position;
    syncCamera();
  }
}

export interface ArchipelagoWorld {
  loadCluster: (islands: ArchipelagoWorldIsland[], portals: ArchipelagoWorldPortal[]) => void;
  dispose: () => void;
  focusOnIsland: (storySlug: string) => void;
}

/** 這群用哪種分群方式載入，純粹是個標記型別給呼叫端用，這支檔案本身不
 *  需要知道 mode 是什麼（已經是正規化好的 islands/portals 陣列）。 */
export type { ClusterMode };
