import * as THREE from 'three';
import { disposeObjectTree } from '../../lab/island/islandBuildingShapes';
import { hexSpiralCoord, axialToCartesian, type ClusterMode } from './archipelagoClusters';

/**
 * createArchipelagoWorld.ts — 群島模式 3D 場景（#3780，
 * docs/prd/2026-10-30-archipelago-clusters-prd.md §3/§4/§7）。
 *
 * 跟 `lab/island/createIslandWorld.ts`（單課島、第一人稱走動）是兩種場景：
 * 這支是「一張地圖看一整群課程島＋中央傳送門廣場」的俯瞰場景，互動是拖曳
 * 旋轉／縮放＋點擊選取，不是第一人稱移動。視覺風格（配色、tone mapping、
 * 霧、陰影）刻意跟單課島對齊（§3.1「風格對齊單課島」），渲染器初始化那段
 * 直接沿用同一組參數。
 *
 * §7 效能要求：同類造型（每座島共用的六角地基）用 InstancedMesh；換群時
 * 用既有 `disposeObjectTree` 釋放上一群的幾何與材質。
 */

export type ArchipelagoIslandStatus = 'occupied' | 'in_progress' | 'not_started';

export interface ArchipelagoWorldIsland {
  storySlug: string;
  title: string;
  /** 已正規化（自然科學/寓言故事/歷史人文/生活/其他），決定小景造型——
   *  呼叫端必須先用 `archipelagoClusters.ts` 的 `normalizeCategory()` 轉過
   *  一次再傳進來（code review 2026-10-30 blocker：之前呼叫端直接傳
   *  `/api/stories` 的原始類別碼 Science/Fable/History/Daily，這裡比對的
   *  是中文標籤，兩邊對不上，全部島都掉進 default 造型）。 */
  category: string;
  status: ArchipelagoIslandStatus;
  stationsDone: number;
  stationsTotal: number;
  /** 蜂巢螺旋位置用——群內已排序過，呼叫端傳進來的陣列順序即蜂巢順序。 */
}

/** 類別→造型的判斷本身抽成純函式（code review 2026-10-30 blocker）：
 *  跟「怎麼蓋那個造型」（three.js 幾何/材質）分開，才能不碰 three.js 就
 *  測「這個類別對到哪種小景」。吃的是已正規化的中文標籤，查不到的（含
 *  空字串／undefined 轉成的 `''`）fail-closed 落在 `'default'`，不是拋錯——
 *  跟 `normalizeCategory()` 本身「查不到就歸其他」的精神一致。 */
export type LandmarkShape = 'science' | 'fable' | 'history' | 'daily' | 'default';

export function landmarkShapeFor(normalizedCategory: string): LandmarkShape {
  switch (normalizedCategory) {
    case '自然科學': return 'science';
    case '寓言故事': return 'fable';
    case '歷史人文': return 'history';
    case '生活': return 'daily';
    default: return 'default';
  }
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
 *  共用同一個 `size` 概念，這裡決定「島跟島隔多遠」。 */
export const HEX_SIZE = 3.6;
const ISLAND_RADIUS = 1.3;
const PLAZA_RADIUS = 2.1;

/** WebGL 無法建立時回傳 `null`（PRD §6：自動降級到清單模式，不是顯示錯誤
 *  頁），呼叫端用這個判斷要不要 render 3D 容器。 */
export function createArchipelagoWorld(
  container: HTMLElement,
  events: ArchipelagoWorldEvents,
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
  scene.background = new THREE.Color('#bbd6dc');
  scene.fog = new THREE.FogExp2('#bbd6dc', 0.01);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 300);

  const ambient = new THREE.HemisphereLight(0xfff7dc, 0x60726e, 2.2);
  scene.add(ambient);
  const sun = new THREE.DirectionalLight(0xffe7b9, 2.6);
  sun.position.set(-18, 30, 20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  scene.add(sun);

  const sea = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: 0x4596ac, metalness: 0.2, roughness: 0.32 }));
  sea.rotation.x = -Math.PI / 2;
  sea.position.y = -1.6;
  scene.add(sea);

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
  // 點擊選取（raycasting）
  // ---------------------------------------------------------------------
  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();
  // 課程島地基是 InstancedMesh（§7：同類造型用 InstancedMesh）——raycasting
  // 命中它時 `intersection.instanceId` 是「第幾個實例」，不是哪一課，要靠
  // `instanceIndexToSlug` 查表轉回 storySlug。門（每群最多 7 座，數量小、
  // 造型含文字/發光，不適合、也沒必要instance化）維持個別 mesh + userData。
  let islandBaseMesh: THREE.InstancedMesh | null = null;
  let instanceIndexToSlug: string[] = [];
  let pickablePortals: THREE.Object3D[] = [];
  let downAt = { x: 0, y: 0 };

  function resolveIslandSlugFromPointer(clientX: number, clientY: number): string | null {
    if (!islandBaseMesh) return null;
    const rect = renderer.domElement.getBoundingClientRect();
    pointerNdc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointerNdc, camera);
    const hit = raycaster.intersectObject(islandBaseMesh, false)[0];
    if (!hit || hit.instanceId === undefined) return null;
    return instanceIndexToSlug[hit.instanceId] ?? null;
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

  // ---------------------------------------------------------------------
  // 造型素材——依類別給不同小景（§3.1：「科學＝圓頂／天文台、寓言＝樹屋／
  // 動物、歷史＝亭台、生活＝房舍」），低多邊形、跟單課島同一種溫暖配色。
  // ---------------------------------------------------------------------
  // 三種狀態的顏色，給 InstancedMesh 的 `setColorAt` 用（不是材質——地基
  // 全部課程島共用「同一個」材質實例，顏色差異靠逐一實例的顏色緩衝區，
  // 材質本身必須開 `vertexColors` 否則緩衝區會被忽略、全部島看起來同色）。
  const STATUS_COLOR: Record<ArchipelagoIslandStatus, THREE.Color> = {
    occupied: new THREE.Color(0x5fa06a),
    in_progress: new THREE.Color(0x8bab7e),
    not_started: new THREE.Color(0xb9b9ad),
  };
  const materials = {
    sand: new THREE.MeshStandardMaterial({ color: 0xd9c397, roughness: 0.85 }),
    plaza: new THREE.MeshStandardMaterial({ color: 0xe7c88a, roughness: 0.7, metalness: 0.1 }),
    wood: new THREE.MeshStandardMaterial({ color: 0x80634d, roughness: 0.85 }),
    roofScience: new THREE.MeshStandardMaterial({ color: 0x6fa8c9, roughness: 0.4, metalness: 0.2 }),
    roofFable: new THREE.MeshStandardMaterial({ color: 0x6b8e4e, roughness: 0.85 }),
    roofHistory: new THREE.MeshStandardMaterial({ color: 0xa66d52, roughness: 0.75 }),
    roofDaily: new THREE.MeshStandardMaterial({ color: 0xcf9a5d, roughness: 0.75 }),
    roofOther: new THREE.MeshStandardMaterial({ color: 0x9a8fae, roughness: 0.75 }),
    flag: new THREE.MeshStandardMaterial({ color: 0xe0564c, roughness: 0.6 }),
    portalFrame: new THREE.MeshStandardMaterial({ color: 0x8c6a4a, roughness: 0.7 }),
    portalGlow: new THREE.MeshBasicMaterial({ color: 0xfff3c4, transparent: true, opacity: 0.55 }),
  };

  function roofMaterialFor(shape: LandmarkShape): THREE.Material {
    switch (shape) {
      case 'science': return materials.roofScience;
      case 'fable': return materials.roofFable;
      case 'history': return materials.roofHistory;
      case 'daily': return materials.roofDaily;
      default: return materials.roofOther;
    }
  }

  /** 一座課程島的裝飾（地基本身是共用的 InstancedMesh，見 `loadCluster`）
   *  ——依類別的小景＋依狀態的旗子/發光/薄霧。這個 group 本身不參與
   *  raycasting 挑選（挑選只打地基的 InstancedMesh，見上面
   *  `resolveIslandSlugFromPointer`），`userData.storySlug` 留著純粹方便
   *  除錯，不是撿選邏輯依賴的東西。 */
  function buildLessonIsland(island: ArchipelagoWorldIsland, position: { x: number; z: number }): THREE.Group {
    const group = new THREE.Group();
    group.position.set(position.x, 0, position.z);
    group.userData.storySlug = island.storySlug;

    const sandRim = new THREE.Mesh(new THREE.CylinderGeometry(ISLAND_RADIUS * 1.04, ISLAND_RADIUS * 0.9, 0.18, 6), materials.sand);
    sandRim.position.y = 0.05;
    group.add(sandRim);

    // 依類別的小景——低多邊形幾何組合，不追求寫實，求「一眼跟別類不一樣」。
    const shape = landmarkShapeFor(island.category);
    const roof = roofMaterialFor(shape);
    if (shape === 'science') {
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), roof);
      dome.position.set(0, 0.7, 0);
      group.add(dome);
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 0.55, 8), materials.sand);
      tower.position.set(0, 0.42, 0);
      group.add(tower);
    } else if (shape === 'fable') {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 0.6, 6), materials.wood);
      trunk.position.set(0, 0.6, 0);
      group.add(trunk);
      const leaves = new THREE.Mesh(new THREE.ConeGeometry(0.48, 0.7, 7), roof);
      leaves.position.set(0, 1.1, 0);
      group.add(leaves);
    } else if (shape === 'history') {
      const platform = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.14, 0.7), materials.sand);
      platform.position.set(0, 0.42, 0);
      group.add(platform);
      for (const [px, pz] of [[-0.28, -0.28], [0.28, -0.28], [-0.28, 0.28], [0.28, 0.28]] as const) {
        const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.4, 6), materials.wood);
        pillar.position.set(px, 0.62, pz);
        group.add(pillar);
      }
      const roofMesh = new THREE.Mesh(new THREE.ConeGeometry(0.55, 0.3, 4), roof);
      roofMesh.position.set(0, 0.95, 0);
      roofMesh.rotation.y = Math.PI / 4;
      group.add(roofMesh);
    } else {
      const house = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.42, 0.5), materials.sand);
      house.position.set(0, 0.5, 0);
      group.add(house);
      const roofMesh = new THREE.Mesh(new THREE.ConeGeometry(0.46, 0.4, 4), roof);
      roofMesh.position.set(0, 0.92, 0);
      roofMesh.rotation.y = Math.PI / 4;
      group.add(roofMesh);
    }

    if (island.status === 'occupied') {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.7, 6), materials.wood);
      pole.position.set(0.55, 0.85, 0.3);
      group.add(pole);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.14), materials.flag);
      flag.position.set(0.66, 1.12, 0.3);
      group.add(flag);
      const glow = new THREE.PointLight(0xffe9b0, 0.8, 2.2);
      glow.position.set(0, 0.9, 0);
      group.add(glow);
    } else if (island.status === 'not_started') {
      const fog = new THREE.Mesh(
        new THREE.CylinderGeometry(ISLAND_RADIUS * 1.1, ISLAND_RADIUS * 1.1, 0.5, 6),
        new THREE.MeshBasicMaterial({ color: 0xdfe6e6, transparent: true, opacity: 0.45 }),
      );
      fog.position.y = 0.6;
      group.add(fog);
    }

    return group;
  }

  /** 中央傳送門廣場——比課程島大，週邊掛其他每一群各一座門（PRD §4）。 */
  function buildPlaza(portals: ArchipelagoWorldPortal[]): THREE.Group {
    const group = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(PLAZA_RADIUS, PLAZA_RADIUS * 0.88, 0.5, 6), materials.plaza);
    base.position.y = 0.25;
    base.castShadow = true;
    base.receiveShadow = true;
    group.add(base);

    const angleStep = (Math.PI * 2) / Math.max(1, portals.length);
    portals.forEach((portal, i) => {
      const angle = i * angleStep;
      const px = Math.cos(angle) * (PLAZA_RADIUS + 0.9);
      const pz = Math.sin(angle) * (PLAZA_RADIUS + 0.9);
      const portalGroup = new THREE.Group();
      portalGroup.position.set(px, 0, pz);
      portalGroup.lookAt(0, 0, 0);
      portalGroup.userData.portalKey = portal.key;

      const frameLeft = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.2, 6), materials.portalFrame);
      frameLeft.position.set(-0.4, 0.85, 0);
      portalGroup.add(frameLeft);
      const frameRight = frameLeft.clone();
      frameRight.position.x = 0.4;
      portalGroup.add(frameRight);
      const frameTop = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.08, 0.08), materials.portalFrame);
      frameTop.position.set(0, 1.4, 0);
      portalGroup.add(frameTop);
      const glowPlane = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 1.1), materials.portalGlow);
      glowPlane.position.set(0, 0.85, 0);
      portalGroup.add(glowPlane);

      group.add(portalGroup);
      pickablePortals.push(portalGroup);
    });

    return group;
  }

  /** 群內小島之間的簡易木棧橋——每座島連到螺旋順序前一座（index-1），這樣
   *  整群會連成一條由中心向外展開的路徑，不是雜亂無章的連線；第 1 座
   *  （螺旋 index 1）直接連回廣場。幾何上只是一條細長的木板，不追求跟
   *  單課島同樣精緻的欄杆。 */
  function buildBridge(a: { x: number; z: number }, b: { x: number; z: number }): THREE.Mesh {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const length = Math.hypot(dx, dz);
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(length, 0.08, 0.5), materials.wood);
    bridge.position.set((a.x + b.x) / 2, 0.32, (a.z + b.z) / 2);
    bridge.rotation.y = -Math.atan2(dz, dx);
    return bridge;
  }

  let clusterGroup: THREE.Group | null = null;

  /**
   * 載入一群——換群時先釋放上一群的幾何/材質（`disposeObjectTree`），
   * 位置由 `hexSpiralCoord`（純函式，已獨立測試）決定，這裡只負責把純
   * 座標轉成真的 three.js 物件。
   */
  function loadCluster(islands: ArchipelagoWorldIsland[], portals: ArchipelagoWorldPortal[]): void {
    if (clusterGroup) {
      scene.remove(clusterGroup);
      disposeObjectTree(clusterGroup);
    }
    pickablePortals = [];
    instanceIndexToSlug = [];

    const group = new THREE.Group();
    scene.add(group);

    const plazaPos = axialToCartesian(hexSpiralCoord(0), HEX_SIZE);
    const plaza = buildPlaza(portals);
    plaza.position.set(plazaPos.x, 0, plazaPos.z);
    group.add(plaza);

    // 課程島地基：全部共用一個 InstancedMesh（§7），逐一實例設定位置矩陣＋
    // 狀態顏色。raycasting 打這一個物件，`instanceId` 對回
    // `instanceIndexToSlug[instanceId]` 就知道點到哪一課（見
    // `resolveIslandSlugFromPointer`）。
    // 幾何/材質刻意不跟模組層級共用——`disposeObjectTree(clusterGroup)` 換群
    // 時會把這個 group 底下每個 mesh 的幾何/材質一起 dispose。如果這兩個
    // 是模組層級共用的常數，第一次換群就會把下一群要繼續用的幾何/材質也
    // 清掉，造成「換群後島嶼全部消失或炸掉」的真實 bug（不是假設）。
    // CylinderGeometry 這麼簡單的幾何，換群時重建的成本可以忽略。
    const baseGeometry = new THREE.CylinderGeometry(ISLAND_RADIUS, ISLAND_RADIUS * 0.82, 0.6, 6);
    const baseMaterial = new THREE.MeshStandardMaterial({ roughness: 0.85, vertexColors: true });
    const baseMesh = new THREE.InstancedMesh(baseGeometry, baseMaterial, Math.max(1, islands.length));
    baseMesh.castShadow = true;
    baseMesh.receiveShadow = true;
    const instanceMatrix = new THREE.Matrix4();

    const positions: { x: number; z: number }[] = [plazaPos];
    islands.forEach((island, i) => {
      const coord = hexSpiralCoord(i + 1);
      const pos = axialToCartesian(coord, HEX_SIZE);
      positions.push(pos);

      instanceMatrix.makeTranslation(pos.x, 0.3, pos.z);
      baseMesh.setMatrixAt(i, instanceMatrix);
      baseMesh.setColorAt(i, STATUS_COLOR[island.status]);
      instanceIndexToSlug[i] = island.storySlug;

      const islandGroup = buildLessonIsland(island, pos);
      group.add(islandGroup);
      // 連回螺旋順序的前一座（index 0 = 廣場本身），讓整群連成一條路徑。
      group.add(buildBridge(positions[i], pos));
    });
    baseMesh.instanceMatrix.needsUpdate = true;
    if (baseMesh.instanceColor) baseMesh.instanceColor.needsUpdate = true;
    baseMesh.computeBoundingSphere();
    group.add(baseMesh);
    islandBaseMesh = baseMesh;

    clusterGroup = group;

    // 鏡頭自動縮放涵蓋整群範圍（§3.4「自動限制在群的範圍內」）——島越多、
    // 螺旋半徑越大，固定鏡頭距離在大群會看不到外圈、在小群又拉太遠。
    const maxDist = positions.reduce((m, p) => Math.max(m, Math.hypot(p.x, p.z)), PLAZA_RADIUS);
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
    if (clusterGroup) disposeObjectTree(clusterGroup);
    disposeObjectTree(scene);
    renderer.dispose();
    if (renderer.domElement.parentElement === container) container.removeChild(renderer.domElement);
  }

  return { loadCluster, dispose, focusOnIsland: (storySlug: string) => focusOnIsland(storySlug) };

  function focusOnIsland(storySlug: string): void {
    const index = instanceIndexToSlug.indexOf(storySlug);
    if (index === -1 || !islandBaseMesh) return;
    const matrix = new THREE.Matrix4();
    islandBaseMesh.getMatrixAt(index, matrix);
    const position = new THREE.Vector3().setFromMatrixPosition(matrix);
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
