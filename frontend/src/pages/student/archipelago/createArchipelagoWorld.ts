import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { SSAOPass } from 'three/examples/jsm/postprocessing/SSAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { disposeObjectTree } from '../../lab/island/islandBuildingShapes';
import { axialToCartesian, type ClusterMode } from './core/archipelagoClusters';
import { layoutArchipelago, type IslandBlob, type HexCell } from './core/archipelagoLayout';
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
 * 各份皮膚設定檔）。這支只管：鏡頭、互動（拖曳/縮放/點擊/hover）、佈局
 * 座標換算、換群時的資源釋放、resize/render loop——SKILL §1「骨架層
 * 不知道長什麼樣子」。
 *
 * **不規則群島佈局**（PRD §3.2 二次訂正，2026-10-31）：位置／哪些島相鄰／
 * 連接材料全部由 `core/archipelagoLayout.ts` 的 `layoutArchipelago()`
 * 決定（純函式，已獨立測試＋mutation-tested）——取代舊版蜂巢螺旋＋逐一
 * 連成一條鍊。種子直接用「這一群的課程 id 依序接起來」，保證「同一群
 * 每次打開長一樣」不需要額外傳參數。
 *
 * 跟 `lab/island/createIslandWorld.ts`（單課島、第一人稱走動）是兩種場景：
 * 這支是「一張地圖看一整群課程島＋中央傳送門廣場」的俯瞰場景，互動是拖曳
 * 旋轉／縮放＋點擊選取，不是第一人稱移動。
 *
 * 效能取捨（team-lead 2026-10-30 授權「介面不合理就直接改」）：用
 * `island(ctx, cell): THREE.Object3D` 介面整座島（含地基）交給主題建——
 * 代價是拿掉了地基的 InstancedMesh。在目前的規模（單群最多 71 座島，
 * `genre`/`category` 模式最大群）這不是效能問題——InstancedMesh 是給數百
 * 上千個實例才真的重要；拿掉它換來的是「換主題真的只改一份設定檔，
 * 骨架一行都不用動」，這是 SKILL 的核心訴求。
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

/** 相鄰六角格中心距離——決定「島跟島隔多遠」的骨架常數，不是主題設定，
 *  換皮不該改變佈局間距。同時也是 `unionBoundary()` 的 `cellRadius`
 *  （透過 `CellInfo.cellRadius` 傳給皮膚），讓同一座島裡黏在一起的格子
 *  剛好緊貼、不留縫——見 `themes/types.ts` `CellInfo.cellRadius` 的說明。 */
export const HEX_SIZE = 3.6;

/** 傳送門離廣場中心多遠——骨架常數（跟 `HEX_SIZE` 一樣，換皮不該改變
 *  佈局間距）。 */
const PORTAL_DISTANCE_FROM_HUB = 3.0;

/** 名牌重疊偵測／遮擋 raycast 節流（美術指導書 §7：「每幀投影所有名牌的
 *  螢幕座標…節流到每 3 幀一次」）——不是效能擔心的猜測，是指導書明寫的
 *  頻率，照做。 */
const NAMEPLATE_THROTTLE_FRAMES = 3;

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

  // ---------------------------------------------------------------------
  // 名牌 CSS2D 疊層（美術指導書 §7）——獨立於 WebGL canvas 的 DOM 疊層，
  // 用絕對定位蓋滿同一個容器。`pointer-events: none`：名牌只是資訊，不是
  // 互動目標（點擊走既有的 3D raycast，見下面 `onClickUp`），不能擋住底下
  // canvas 的滑鼠事件。
  // ---------------------------------------------------------------------
  const labelRenderer = new CSS2DRenderer();
  labelRenderer.domElement.style.position = 'absolute';
  labelRenderer.domElement.style.top = '0';
  labelRenderer.domElement.style.left = '0';
  labelRenderer.domElement.style.pointerEvents = 'none';
  container.appendChild(labelRenderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(theme.palette.background);
  scene.fog = new THREE.FogExp2(theme.palette.fog, 0.01); // loadCluster() 會依群大小覆寫密度（§2.2）
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 300);

  const ambient = new THREE.HemisphereLight(theme.lighting.hemisphereSky, theme.lighting.hemisphereGround, theme.lighting.ambient);
  scene.add(ambient);
  const sun = new THREE.DirectionalLight(theme.lighting.sunColor, theme.lighting.sunIntensity);
  sun.position.set(...theme.lighting.sunDirection);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  scene.add(sun);
  // 背光／輪廓光（美術指導書 §2.1：「目前完全沒有 rim，建築輪廓跟天空
  // 背景融在一起分不開」）——方向跟主光相對，顏色/強度向主題要，骨架
  // 不決定這顆燈該是什麼顏色。
  const rim = new THREE.DirectionalLight(theme.lighting.rimColor, theme.lighting.rimIntensity);
  rim.position.set(-theme.lighting.sunDirection[0], theme.lighting.sunDirection[1] * 0.6, -theme.lighting.sunDirection[2]);
  scene.add(rim);

  // ---------------------------------------------------------------------
  // 後製鏈（美術指導書 §2.4）——bloom 只讓金色飾條/水晶/占領光暈發光，
  // SSAO 補建築與島面的接觸陰影，OutputPass 一定要在最後（否則 tone
  // mapping 不生效，`threejs-postprocessing` 反模式第一條）。參數是數字
  // 不是顏色常數，不違反契約測試④（只擋 hex 色碼跟主題字眼）。
  // ---------------------------------------------------------------------
  const composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);
  const bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.35, 0.4, 0.82);
  composer.addPass(bloomPass);
  const ssaoPass = new SSAOPass(scene, camera, 1, 1);
  ssaoPass.kernelRadius = 10;
  ssaoPass.minDistance = 0.003;
  ssaoPass.maxDistance = 0.05;
  composer.addPass(ssaoPass);
  const outputPass = new OutputPass();
  composer.addPass(outputPass);

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
  // 點擊選取（raycasting）——島跟門都是獨立物件，raycast 打
  // `pickableIslands`/`pickablePortals` 兩個陣列，靠 `userData.storySlug`/
  // `userData.portalKey` 往上找。
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

  // #3799 美術指導書 §8（2026-10-31）：觸控裝置沒有 hover——第一次點只做
  // 「上浮＋亮邊＋名牌強調」，第二次點（或點卡片「登島」按鈕）才真的導航。
  // 用 `matchMedia` 在裝置層級先判斷，不要用「使用者有沒有點過」這種運行期
  // 猜測（`threejs-camera-interaction-pitfalls` 坑 4）。
  const isCoarsePointer = typeof window.matchMedia === 'function' && window.matchMedia('(any-pointer: coarse)').matches;
  let touchArmedSlug: string | null = null;
  let hoveredSlug: string | null = null;

  const onClickDown = (e: PointerEvent) => { downAt = { x: e.clientX, y: e.clientY }; };
  const onClickUp = (e: PointerEvent) => {
    if (Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 6) return; // 拖曳不算點擊
    const islandSlug = resolveIslandSlugFromPointer(e.clientX, e.clientY);
    if (islandSlug) {
      if (isCoarsePointer && touchArmedSlug !== islandSlug) {
        // 第一次點：只「準備」這座島（上浮/亮邊由下面 hover 動畫段落統一
        // 處理，這裡只負責記住「準備好了」跟觸發名牌強調／onHoverIsland）。
        touchArmedSlug = islandSlug;
        hoveredSlug = islandSlug;
        events.onHoverIsland?.(islandSlug);
        return;
      }
      events.onSelectIsland(islandSlug);
      return;
    }

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

  const onHoverMove = (e: PointerEvent) => {
    if (isCoarsePointer) return; // 觸控裝置沒有 hover，狀態由點擊事件自己管
    if (!events.onHoverIsland) return;
    const slug = resolveIslandSlugFromPointer(e.clientX, e.clientY);
    if (slug !== hoveredSlug) { hoveredSlug = slug; events.onHoverIsland(slug); }
  };
  renderer.domElement.addEventListener('pointermove', onHoverMove);

  let clusterGroup: THREE.Group | null = null;
  // 每座島的「目前上浮高度」平滑趨近值（美術指導書 §8：
  // `t = 1 - exp(-rate*dt)` 跨幀率安全的指數平滑，不是固定 lerp 係數）。
  const hoverLift = new Map<string, number>();
  // 每座島的名牌（CSS2DObject）與它對應的 DOM 元素，換群時一併清掉。
  const nameplates = new Map<string, { object: CSS2DObject; el: HTMLDivElement; worldPos: THREE.Vector3 }>();
  let nameplateFrameCounter = 0;

  /**
   * 載入一群——換群時先釋放上一群（`disposeObjectTree`），位置由
   * `layoutArchipelago()`（純函式，已獨立測試）決定，這裡只負責把純座標轉成
   * 真的 three.js 物件，長相全部向 `theme` 要。
   *
   * `createSceneCtx()` 每次呼叫都重新建（不是模組層級共用常數）——理由
   * 跟拿掉 InstancedMesh 共用幾何/材質一樣：`disposeObjectTree`
   * 換群時會把上一群 `clusterGroup` 底下所有幾何/材質一起 dispose。
   */
  function loadCluster(islands: ArchipelagoWorldIsland[], portals: ArchipelagoWorldPortal[]): void {
    if (clusterGroup) {
      scene.remove(clusterGroup);
      disposeObjectTree(clusterGroup);
    }
    for (const { object } of nameplates.values()) object.element.remove();
    nameplates.clear();
    hoverLift.clear();
    pickableIslands = [];
    pickablePortals = [];
    islandPositions = new Map();

    const { ctx } = createSceneCtx(scene);
    const group = new THREE.Group();
    scene.add(group);

    const groundObj = theme.ground(ctx);
    group.add(groundObj);

    // #3799 PRD §3.2 二次訂正：不規則群島佈局——位置／相鄰互通／連接材料
    // 全部由 layoutArchipelago() 決定。種子＝這一群的課程 id 依序接起來，
    // 保證「同一群每次打開長一樣」。
    const seed = islands.map((i) => i.storySlug).join(',');
    const layout = layoutArchipelago(islands.map((i) => i.storySlug), seed, HEX_SIZE);

    function cellOffsetsForBlob(blob: IslandBlob): { x: number; z: number }[] {
      return blob.cells.map((cell) => {
        const world = axialToCartesian(cell, HEX_SIZE);
        return { x: world.x - blob.center.x, z: world.z - blob.center.z };
      });
    }

    const plazaPos = layout.plaza.center;
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

    const idToPos = new Map<string, { x: number; z: number }>([['plaza', plazaPos]]);
    for (const blob of layout.islands) idToPos.set(blob.id, blob.center);

    const positions: { x: number; z: number }[] = [plazaPos];
    islands.forEach((island, i) => {
      const blob = layout.islands[i];
      const pos = blob.center;
      positions.push(pos);

      const cell: CellInfo = {
        storySlug: island.storySlug,
        title: island.title,
        category: island.category,
        status: island.status,
        stationsDone: island.stationsDone,
        stationsTotal: island.stationsTotal,
        position: pos,
        cellCount: blob.cells.length,
        cellOffsets: cellOffsetsForBlob(blob),
        cellRadius: HEX_SIZE,
        seed: island.storySlug,
      };
      const islandObj = theme.island(ctx, cell);
      theme.statusLook[island.status](islandObj, ctx);
      islandObj.position.set(pos.x, 0, pos.z);
      islandObj.userData.storySlug = island.storySlug;
      group.add(islandObj);
      pickableIslands.push(islandObj);
      islandPositions.set(island.storySlug, new THREE.Vector3(pos.x, 0, pos.z));
      hoverLift.set(island.storySlug, 0);

      // 名牌（美術指導書 §7）：常駐顯示，不是只有 hover 才出現——
      // 「PRD §3.2 明寫不能整群看不到名字」。樣式向 `theme.nameplate` 要。
      const el = document.createElement('div');
      el.textContent = island.title;
      el.style.background = theme.nameplate.background;
      el.style.border = `1px solid ${theme.nameplate.border}`;
      el.style.color = theme.nameplate.text;
      el.style.borderRadius = '10px';
      el.style.padding = '4px 8px';
      el.style.fontSize = '13px';
      el.style.fontWeight = '600';
      el.style.whiteSpace = 'nowrap';
      el.style.boxShadow = '0 2px 6px rgba(0,0,0,0.15)';
      el.style.transition = 'opacity 150ms, transform 150ms';
      if (island.status === 'occupied') el.textContent = `✓ ${island.title}`;
      else if (island.status === 'in_progress') el.textContent = `${island.title}（${island.stationsDone}/${island.stationsTotal}）`;
      const labelObject = new CSS2DObject(el);
      // 固定偏移在島基準點上方（美術指導書 §7：取現有地標類別裡最高的那個
      // 高度再加餘裕，群島只有 4 種地標形狀，用固定值即可，省掉逐類別查表）。
      labelObject.position.set(0, 1.6, 0);
      islandObj.add(labelObject);
      nameplates.set(island.storySlug, { object: labelObject, el, worldPos: new THREE.Vector3() });

      // 連接物（PRD §3.2：相鄰互通，材料隨機）——下面統一跑 `layout.connections`
      // 建立，這裡不逐一連前一座，見下方迴圈。
    });

    for (const conn of layout.connections) {
      const a = idToPos.get(conn.a);
      const b = idToPos.get(conn.b);
      if (!a || !b) continue;
      const connector = theme.connector(ctx, a, b, conn.material);
      if (connector) group.add(connector);
    }

    clusterGroup = group;

    // 鏡頭自動縮放涵蓋整群範圍（§3.4「自動限制在群的範圍內」）——島越多、
    // 佈局範圍越大，固定鏡頭距離在大群會看不到外圈、在小群又拉太遠。
    const maxDist = positions.reduce((m, p) => Math.max(m, Math.hypot(p.x, p.z)), 1);
    orbitRadius = Math.max(14, maxDist * 1.7);
    minRadius = Math.max(8, maxDist * 0.5);
    maxRadius = maxDist * 3.2;
    orbitTarget = new THREE.Vector3(0, 0, 0);
    syncCamera();

    // 動態霧密度（美術指導書 §2.2：`density ≈ 2.2 / maxRadius`，群越大霧
    // 越淡，固定密度在小群太濃、大群幾乎看不見——這是量過的公式，不是
    // 改成「看起來還行」的數字）。
    (scene.fog as THREE.FogExp2).density = Math.min(0.04, 2.2 / Math.max(6, maxDist));

    // SSAO pass 的取樣範圍要對齊這次場景的尺度，不然小群太濃、大群太淡。
    ssaoPass.kernelRadius = Math.max(4, Math.min(16, maxDist * 0.3));

    // 效能診斷（美術指導書 §10：「跑過 renderer 診斷，不是看起來還行」）——
    // 換群渲染一幀之後印出 draw call/三角面/幾何數，QA 時從瀏覽器 console
    // 讀，不是另外架一套量測工具。
    requestAnimationFrame(() => {
      renderer.info.reset();
      composer.render();
      console.log('[archipelago perf]', {
        islands: islands.length,
        drawCalls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        geometries: renderer.info.memory.geometries,
        textures: renderer.info.memory.textures,
      });
    });
  }

  // ---------------------------------------------------------------------
  // resize + render loop
  // ---------------------------------------------------------------------
  function resize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h);
    composer.setSize(w, h);
    labelRenderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);

  const clock = new THREE.Clock();
  let frameId = 0;
  function animate() {
    frameId = requestAnimationFrame(animate);
    const dt = Math.min(0.1, clock.getDelta());

    // Hover 上浮（美術指導書 §8）：指數平滑趨近目標高度，跨幀率安全，不是
    // 固定 lerp 係數（`t = 1 - exp(-rate*dt)`）。亮邊外殼（`userData.isHoverOutline`
    // 標記的子物件）的透明度用同一個進度值淡入淡出——皮膚只需要建一顆
    // 標記好的物件，骨架負責讓它「隨 hover 狀態改變」，皮膚不需要知道
    // hover 狀態存在。
    const rate = 18;
    const liftT = 1 - Math.exp(-rate * dt);
    for (const obj of pickableIslands) {
      const slug = obj.userData.storySlug as string;
      const isHovered = slug === hoveredSlug;
      const current = hoverLift.get(slug) ?? 0;
      const next = current + (isHovered ? 1 - current : 0 - current) * liftT;
      hoverLift.set(slug, next);
      obj.position.y = next * 0.08;
      obj.scale.setScalar(1 + next * 0.04);
      obj.traverse((child) => {
        if (child.userData.isHoverOutline && (child as THREE.Mesh).material) {
          const mat = (child as THREE.Mesh).material as THREE.Material & { opacity: number };
          mat.opacity = next * 0.6;
          mat.transparent = true;
        }
      });
    }

    // 旗子飄動／粒子自己動畫——用 three.js 的 `onBeforeRender` 自繪鉤子
    // （皮膚在建物件時掛上去，骨架完全不用知道「旗子」這個概念存在），
    // `composer.render()` 內部仍然會呼叫每個物件的 `onBeforeRender`。

    // 名牌：位置跟著 3D 物件（CSS2DRenderer 自動處理），遮擋判斷節流到
    // 每 3 幀一次（美術指導書 §7）。
    nameplateFrameCounter = (nameplateFrameCounter + 1) % NAMEPLATE_THROTTLE_FRAMES;
    if (nameplateFrameCounter === 0) {
      for (const [slug, { object, worldPos }] of nameplates) {
        object.getWorldPosition(worldPos);
        const dir = worldPos.clone().sub(camera.position);
        const distToLabel = dir.length();
        raycaster.set(camera.position, dir.normalize());
        const hits = raycaster.intersectObjects(pickableIslands, true);
        const blocked = hits.length > 0 && hits[0].distance < distToLabel - 0.3 && (() => {
          let o: THREE.Object3D | null = hits[0].object;
          while (o && !o.userData.storySlug) o = o.parent;
          return o?.userData.storySlug !== slug;
        })();
        object.element.style.opacity = blocked ? '0.35' : '1';
      }
    }

    syncCamera();
    composer.render();
    labelRenderer.render(scene, camera);
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
    for (const { object } of nameplates.values()) object.element.remove();
    nameplates.clear();
    if (clusterGroup) {
      scene.remove(clusterGroup);
      disposeObjectTree(clusterGroup);
      clusterGroup = null;
    }
    disposeObjectTree(scene);
    composer.dispose();
    renderer.dispose();
    if (renderer.domElement.parentElement === container) container.removeChild(renderer.domElement);
    if (labelRenderer.domElement.parentElement === container) container.removeChild(labelRenderer.domElement);
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
