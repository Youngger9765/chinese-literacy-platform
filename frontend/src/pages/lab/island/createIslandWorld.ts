import * as THREE from 'three';
import { introProgress, characterPose } from './islandMotion';
import type { IslandBaby, IslandStop } from './islandTemplate';
import { isSceneryExcluded } from './islandTemplate';
import { MIN_CAMERA_BUILDING_DISTANCE, BUILDING_BASE_RADIUS, computeSpawnFacingLighthouse, selectNearestStation, findCelebrationViewpoint, findTravelToDestination, arcFlightPosition, arcFlightArrivalYaw, walkAlongPathPosition, walkDurationSeconds, godCameraDesiredPosition, godCameraLookTarget, tapToleranceForAspect, spriteScaleForAspect, GOD_CAMERA_FOV_DEG, GOD_VIEW_FOG_DENSITY, isMovementLocked, isManualControlEnabled, cardStationFor, isLabelOccluded, type CelebrationViewpoint, type LabelOcclusionObstacle } from './spawnPoint';
import { startCelebration, advanceOnTurnConverged, isHoldComplete, diffProgress, resolveCelebrationTrigger, celebrationGlowBoost, steadyCompletedGlow, resolveCelebrationGlow, INITIAL_PROGRESS_DIFF_STATE, type CelebrationState, type ProgressDiffState } from './islandCelebration';
import { buildStationGroup, applyBuildingGlow, disposeObjectTree, buildingTopY, type BuildingMaterialSlot } from './islandBuildingShapes';

interface WorldEvents {
  onNear: (index: number | null) => void;
  onFogEdge: () => void;
  onMove: (x: number, z: number) => void;
  onHover?: (index: number | null) => void;
  onPick?: (index: number) => void;
  onWantFirstPerson?: () => void;
  onArrive?: (index: number) => void;
  /**
   * #3780 P0-3：剛完成一站，鏡頭正要轉過去面向它——這時播鐘聲最準
   * （跟「畫面上燈正在亮起來」同一刻，不是等轉到下一站才響）。
   */
  onCelebrate?: (index: number) => void;
  /**
   * #3780 P0-3：面向剛完成站的停留時間結束，該顯示「下一站」導引了。
   * `nextStop` 是 null 代表這是最後一站（全部完成），呼叫端自己決定
   * 要不要接著播結尾慶祝——這支事件只負責「停留期結束」這件事本身。
   */
  onCelebrationEnd?: (index: number, nextStop: number | null) => void;
}


export const zoneCenters = [
  { x: -2, z: 5, radius: 14 },
  { x: 11, z: -9, radius: 13 },
  { x: 13, z: -23, radius: 14 },
];

/**
 * 山丘的碰撞位置／半徑，跟底下畫山丘用的地形生成是同一份資料——原本只在
 * `createIslandWorld()` 內部當閉包變數，#3780 P0-2 退件 Q3（審查員
 * 2026-10-26）需要在純 node 環境對全部 179 課的出生點跑「不在山丘碰撞圈
 * 裡」的回歸測試，所以拉到模組層級 export，跟 `walkable()` 用的
 * `zoneCenters` 同一個道理：單一資料來源，不要在測試裡另外複製一份數字
 * （複製了之後改地形容易漏改測試那邊）。
 */
export const hillPositions: ReadonlyArray<readonly [number, number, number]> = [
  [-8, -1, 3.5], [-1, -6, 4], [10, -15, 4.8], [19, -27, 4], [0, -28, 3.3],
];

export type ViewMode = 'first' | 'god';
const zoneOf = (x: number, z: number) => {
  let best = 0; let dist = Infinity;
  zoneCenters.forEach((zone, index) => { const d = Math.hypot(x - zone.x, z - zone.z) / zone.radius; if (d < dist) { dist = d; best = index; } });
  return best;
};

export function createIslandWorld(
  container: HTMLElement,
  events: WorldEvents,
  content: { stops: IslandStop[]; babies: IslandBaby[] },
) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.7));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.35;
  container.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#bbd6dc');
  scene.fog = new THREE.FogExp2('#bbd6dc', 0.012);
  const camera = new THREE.PerspectiveCamera(57, 1, 0.1, 130);
  const ambient = new THREE.HemisphereLight(0xfff7dc, 0x60726e, 2.2);
  scene.add(ambient);
  const sun = new THREE.DirectionalLight(0xffe7b9, 3);
  sun.position.set(-12, 24, 18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -46;
  sun.shadow.camera.right = 46;
  sun.shadow.camera.top = 46;
  sun.shadow.camera.bottom = -46;
  scene.add(sun);

  const material = (color: number, extra: Record<string, unknown> = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...extra });
  const sand = material(0xd9c397);
  const grass = material(0x769b79);
  const cliff = material(0x69706b);
  const wood = material(0x80634d);
  const copper = material(0xa66d52);
  // #3799 美術指導書追加需求（2026-10-31）：已完成的站頂上插旗，跟發光
  // 是兩件不同的回饋（發光留著，旗子額外加）。
  const flagCloth = material(0xe0564c, { emissive: 0xe0564c, emissiveIntensity: 0.12 });
  const water = material(0x4596ac, { metalness: 0.2, roughness: 0.32 });
  const add = (parent: THREE.Object3D, geometry: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) => {
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };
  const box = (parent: THREE.Object3D, w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0) => add(parent, new THREE.BoxGeometry(w, h, d), mat, x, y, z);
  const cylinder = (parent: THREE.Object3D, top: number, bottom: number, h: number, mat: THREE.Material, x = 0, y = 0, z = 0, sides = 10) => add(parent, new THREE.CylinderGeometry(top, bottom, h, sides), mat, x, y, z);
  const cone = (parent: THREE.Object3D, r: number, h: number, mat: THREE.Material, x = 0, y = 0, z = 0) => add(parent, new THREE.ConeGeometry(r, h, 7), mat, x, y, z);

  const sea = add(scene, new THREE.PlaneGeometry(200, 200), water, 0, -2.8, 0);
  sea.rotation.x = -Math.PI / 2;
  sea.castShadow = false;
  const island = new THREE.Group();
  scene.add(island);
  zoneCenters.forEach(({ x, z, radius }, zone) => {
    const vertexCount = 42;
    const positions: number[] = [x, 0.35 + zone * 0.07, z];
    const indexes: number[] = [];
    for (let i = 0; i <= vertexCount; i++) {
      const angle = (i / vertexCount) * Math.PI * 2;
      const r = radius * (0.92 + 0.04 * Math.sin(i * 2.1) + 0.035 * Math.cos(i * 4.3));
      positions.push(x + Math.cos(angle) * r, 0.19 + 0.1 * Math.sin(i * 1.7), z + Math.sin(angle) * r);
      if (i > 0) indexes.push(0, i + 1, i);
    }
    const topGeometry = new THREE.BufferGeometry();
    topGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    topGeometry.setIndex(indexes);
    topGeometry.computeVertexNormals();
    add(island, new THREE.CylinderGeometry(radius * 0.89, radius * 0.7, 2.8, 16), cliff, x, -1.3, z);
    add(island, new THREE.CylinderGeometry(radius * 0.98, radius * 0.9, 0.25, 18), sand, x, 0.03, z);
    add(island, topGeometry, grass);
  });

  const paths = [
    [[-3, 12], [-5, 9], [-9, 5], [-5, 1], [0, 0], [3, 2]],
    [[3, 2], [4, -2], [7, -3], [12, -4], [8, -7], [5, -10], [10, -13], [17, -12]],
    [[17, -12], [20, -16], [23, -20], [18, -22], [14, -24], [9, -23], [2, -22], [12, -29], [22, -32]],
  ];
  paths.forEach((points, group) => {
    const curve = new THREE.CatmullRomCurve3(points.map(([x, z]) => new THREE.Vector3(x, 0.42, z)));
    const count = group === 0 ? 85 : 135;
    for (let i = 0; i < count; i++) {
      const p = curve.getPoint(i / count);
      const pathStone = cylinder(island, 0.42 + (i % 3) * 0.1, 0.46, 0.035, i % 5 === 0 ? sand : material(0xb9ae92), p.x, 0.43, p.z, 6);
      pathStone.rotation.y = i * 2.4;
    }
  });
  for (const [x, z, length, angle] of [[5, -2, 4.2, 0.48], [19, -15, 5, -0.55]] as const) {
    const bridge = new THREE.Group();
    bridge.position.set(x, 0.7, z);
    bridge.rotation.y = angle;
    scene.add(bridge);
    for (let i = -4; i <= 4; i++) box(bridge, 0.48, 0.1, 1.7, wood, (i * length) / 9, 0.08 + 0.13 * Math.cos(i / 4), 0);
    for (const side of [-1, 1]) {
      box(bridge, length + 0.6, 0.09, 0.1, copper, 0, 0.72, side * 0.85);
      for (const px of [-length / 2, 0, length / 2]) box(bridge, 0.1, 0.75, 0.1, wood, px, 0.38, side * 0.85);
    }
  }
  const streamCurve = new THREE.CatmullRomCurve3([new THREE.Vector3(-2, 0.43, -3), new THREE.Vector3(3, 0.43, -1), new THREE.Vector3(5, 0.43, -4), new THREE.Vector3(9, 0.43, -5)]);
  add(scene, new THREE.TubeGeometry(streamCurve, 60, 0.38, 8), water);

  hillPositions.forEach(([x, z, r], i) => {
    const hill = add(scene, new THREE.ConeGeometry(r, 2.3 + i % 3, 10), i % 2 ? grass : cliff, x, 1.25, z);
    hill.rotation.y = i * 0.9;
    if (i === 2) {
      const cave = add(scene, new THREE.TorusGeometry(1.15, 0.3, 8, 10, Math.PI), cliff, x + 1, 0.8, z + 2);
      cave.rotation.z = Math.PI;
    }
  });
  // #3780 P0-2：出生點改成「面向港口燈塔（lesson-intro 站）、落在觸發半徑內」
  // ——不再是寫死的座標，算式見 spawnPoint.ts 的理由。找不到 lesson-intro
  // （理論上不該發生，step_sequence 幾乎都以它開頭）就退回 stops[0]，
  // 真的一站都沒有才退回原本的寫死座標，不讓整座島在這裡直接炸掉。
  // #3780 P0-3 九度審查訂正：傳真實的容器寬高比進去——手機直式畫面很窄，
  // 固定距離 7 會讓塔身佔掉太多畫面寬度，`computeSpawnFacingLighthouse`
  // 會依寬高比自動把距離拉遠到塔身寬度不超過六成（見 spawnPoint.ts）。
  // `clientHeight` 理論上這時候已經是真實版面（container 在呼叫這個函式
  // 之前就已經掛進 DOM），萬一量到 0（極端情況，例如還沒 layout）就退回
  // 桌機常見寬高比，不要讓距離算式除以 0。
  const containerAspect = container.clientHeight > 0 ? container.clientWidth / container.clientHeight : 16 / 9;
  const lighthouseStop = content.stops.find((stop) => stop.step === 'lesson-intro') ?? content.stops[0];
  const spawnPoint = lighthouseStop
    ? computeSpawnFacingLighthouse(lighthouseStop, undefined, containerAspect)
    : { x: -2, z: 16.5, yaw: 0, pitch: 0 };

  const zonedThings: THREE.Object3D[] = [];
  for (let i = 0; i < 105; i++) {
    const zone = zoneCenters[i % 3];
    const angle = i * 2.399;
    const radius = 5 + (i % 13) * 0.65;
    const x = zone.x + Math.sin(angle) * radius;
    const z = zone.z + Math.cos(angle) * radius;
    // G7 2026-10-26：出生點附近的樹沒被排除過，近到擋住進島第一眼該看清楚的
    // 港口燈塔跟路（真實座標驗過，21 號樹離出生點只有 1.79 單位）。
    if (isSceneryExcluded(x, z, content.stops, spawnPoint)) continue;
    const tree = new THREE.Group();
    tree.position.set(x, 0.42, z);
    tree.userData.zone = zoneOf(x, z);
    zonedThings.push(tree);
    scene.add(tree);
    const height = 1.2 + (i % 5) * 0.18;
    cylinder(tree, 0.12, 0.18, height, wood, 0, height / 2);
    const leaves = material(i % 4 ? 0x517f68 : 0x71966b);
    cone(tree, 0.72, 1.5, leaves, 0, height + 0.35);
    cone(tree, 0.54, 1.2, leaves, 0, height + 0.9);
  }

  const buildingGroups: THREE.Group[] = [];
  const halos: THREE.Mesh[] = [];
  const lighthouseBeams: THREE.Group[] = [];
  // #3780 P0-3 四度審查訂正（2026-10-27）：慶祝時「整棟建築」要有可見的
  // 點亮變化，不能只靠單一個 `windowMat`——15 種建築類型裡，只有港口燈塔
  // 跟星空瞭望台（走最後這個 `else` 分支）的幾何真的有用到 `windowMat`，
  // 其餘 13 種（包含 heavy tier 幾乎全部）從來沒有任何一塊網格引用它，
  // 不管把它的發光強度調多高，畫面上都沒有東西會變亮——這也是「已完成
  // 穩定發光」這個舊功能對這 13 種類型一直沒有效果的同一個根因。
  //
  // 正解：建築的幾何＋材質蒐集抽到 `islandBuildingShapes.ts` 的
  // `buildStationGroup()`（純函式，不經過這個 three.js renderer 閉包也能
  // 單獨呼叫）——每棟建築的每一塊網格材質都 clone 一份（不共用模組層級
  // 的 `cream`/`slate`/`copper`/`gold`，否則調亮一棟會連帶調亮全島同色系
  // 的其他建築），`perBuildingMaterials[index]` 存著「這一棟真正在用的
  // 所有材質」，之後要加亮／復原直接對這個陣列呼叫 `applyBuildingGlow`，
  // 不管這一棟內部用了哪些具名變數、走哪個 `step` 分支。
  const perBuildingMaterials: BuildingMaterialSlot[][] = [];
  // #3780 P0-3 八度審查訂正：3D 站牌（下面的 `sign`）要存起來，per-frame
  // 迴圈才能逐一對每棟建築算「鏡頭→這塊牌子的視線有沒有被別棟建築擋住」
  // ，見 animate() 裡的 `signs.forEach(...)`。
  const signs: THREE.Sprite[] = [];
  // #3799 美術指導書追加需求（team-lead 2026-10-31：「單課島：已完成的站
  // 頂上也要插旗，名牌上加勾勾，不能只靠現有的整棟發光」）——名牌文字要
  // 在「變成已完成」那一刻重畫加勾勾，存一份 canvas 參考才能事後重畫
  // （`CanvasTexture` 改 canvas 內容後要 `texture.needsUpdate = true`）。
  const signCanvases: HTMLCanvasElement[] = [];
  function drawSignCanvas(canvas: HTMLCanvasElement, name: string, checked: boolean): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, 512, 100);
    ctx.fillStyle = '#304a4e';
    ctx.fillRect(0, 0, 512, 100);
    ctx.strokeStyle = '#e7c783';
    ctx.lineWidth = 8;
    ctx.strokeRect(8, 8, 496, 84);
    ctx.fillStyle = '#fff3d2';
    ctx.font = 'bold 51px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(checked ? `✓ ${name}` : name, 256, 53);
  }
  content.stops.forEach((stop, i) => {
    const built = buildStationGroup(stop, sand);
    const root = built.root;
    root.position.set(stop.x, 0.42, stop.z);
    root.userData.zone = stop.zone;
    root.userData.index = i;
    scene.add(root);
    buildingGroups.push(root);
    zonedThings.push(root);
    halos.push(built.halo);
    if (built.lighthouseBeam) lighthouseBeams.push(built.lighthouseBeam);
    perBuildingMaterials.push(built.materials);

    const signCanvas = document.createElement('canvas');
    signCanvas.width = 512;
    signCanvas.height = 100;
    drawSignCanvas(signCanvas, stop.name, false);
    signCanvases.push(signCanvas);
    const texture = new THREE.CanvasTexture(signCanvas);
    // `transparent: true`：原本沒加，opacity 的漸變在這個材質上不會有
    // 任何視覺效果（遮擋判斷靠淡出，不是硬切 visible，需要真的能混合）。
    // `fog: false`（team-lead 2026-10-30 真機截圖抓到：名牌文字糊成淡灰
    // 藍色，讀不出來）——`SpriteMaterial` 預設 `fog: true`，鏡頭在上帝
    // 視角拉得很遠時（窄螢幕甚至更遠），名牌會跟著場景霧氣被洗向霧色，
    // 深色底＋奶油字的對比就這樣被吃掉。文字牌是給人讀的資訊，不是遠景
    // 氣氛元素，關掉霧讓它永遠維持設計時的原色，不因為距離而褪色。
    const sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true, fog: false }));
    sign.scale.set(3.3, 0.65, 1);
    sign.position.set(0, stop.step === 'lesson-intro' ? 7.8 : stop.step === 'report' ? 6.2 : 4.5, 0);
    root.add(sign);
    signs.push(sign);
  });

  // #3799 美術指導書追加需求（2026-10-31）：已完成的站插旗＋名牌打勾，
  // 只需要做一次（不是每幀），`flaggedIndexes` 記住哪些站已經插過，
  // `setProgress()` 每次呼叫時只處理「新完成、還沒插旗」的那幾個。
  const flaggedIndexes = new Set<number>();
  function flagCompletedStation(index: number): void {
    if (flaggedIndexes.has(index)) return;
    flaggedIndexes.add(index);
    const stop = content.stops[index];
    const topY = buildingTopY(stop.step);
    const pole = cylinder(buildingGroups[index], 0.025, 0.025, 0.5, wood, 0.4, topY + 0.25, 0.25, 6);
    pole.castShadow = false;
    const flag = box(buildingGroups[index], 0.24, 0.16, 0.02, flagCloth, 0.52, topY + 0.42, 0.25);
    flag.castShadow = false;
    drawSignCanvas(signCanvases[index], stop.name, true);
    (signs[index].material as THREE.SpriteMaterial).map!.needsUpdate = true;
  }

  // #3780 P0-3 四度審查訂正：底部光暈環在慶祝時除了既有的脈動（見下面
  // animate() 裡的 pulseAmp），底座本身也要放大，當「整棟建築發光」之外
  // 的第二層回饋——原本脈動是繞著 1 倍振幅擺動，放大感很弱。這裡另外存一條
  // 「目前的底座縮放」陣列，每幀平滑地往目標值靠近（跟 `mat.opacity` 的
  // 平滑手法一樣），不是慶祝一開始就瞬間跳到放大後的尺寸。
  const haloBaseScale = halos.map(() => 1);

  const textureLoader = new THREE.TextureLoader();
  const sprite = (url: string, width: number, height: number) => {
    const texture = textureLoader.load(url);
    texture.colorSpace = THREE.SRGBColorSpace;
    const item = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
    item.scale.set(width, height, 1);
    scene.add(item);
    return item;
  };
  const player = sprite('/lab-island/sprites/adventurer.png', 1.8, 2.3);
  player.position.set(spawnPoint.x, 1.5, spawnPoint.z);
  const xiaoling = sprite('/lab-island/sprites/xiaoling.png', 0.9, 1.1);
  const XL_FIRST = new THREE.Vector3(0.45, 0.55, 1);
  const babies = content.babies.map((baby) => {
    const item = sprite(`/lab-island/sprites/${baby.art}`, 1.5, 1.5);
    item.userData.zone = zoneOf(baby.x, baby.z);
    zonedThings.push(item);
    return item;
  });
  // 過關引導：下一關的光柱＋地上的光點
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.6, 26, 20, 1, true), new THREE.MeshBasicMaterial({ color: 0xffd98a, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
  beam.visible = false;
  scene.add(beam);
  const trailDots = Array.from({ length: 26 }, () => {
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffe7a8, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    dot.visible = false;
    scene.add(dot);
    return dot;
  });
  // #3780 P0-3：剛完成一站的慶祝粒子——跟上面 `trailDots`（指向下一站的
  // 引導光點）分開成獨立的一池，兩者職責不同時可能同時需要顯示（剛點亮
  // 的站還在慶祝，同時已經知道下一站在哪），不能共用同一組物件互搶。
  // 數量取 heavy tier 的上限（見 islandCelebration.ts），light tier 時
  // 多出來的那些維持 invisible。
  const celebrationParticles = Array.from({ length: 18 }, () => {
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), new THREE.MeshBasicMaterial({ color: 0xfff1c2, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    dot.visible = false;
    scene.add(dot);
    return dot;
  });
  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2(0, 0);
  // #3794（Young 硬規定，PRD §2）：上帝視角是唯一模式，預設值從 'first'
  // 改成 'god'——`playIntro()` 呼叫時會暫時切到 'first' 播開場鏡頭飛行
  // （見該函式與 `introStart = -1` 處的說明），播完自動切回來；'first'
  // 的程式碼保留，只是沒有任何使用者可觸發的路徑會把 `mode` 停留在那裡。
  let mode: ViewMode = 'god';
  // #3780 P0-2：出生時仰角不再是寫死的 -0.05（往下看一點）——燈塔太高，
  // 不仰頭的話塔尖本來就不可能進視野（見 spawnPoint.test.ts 那條「不加
  // 仰角塞不進視野」的對照）。`spawnPoint.pitch` 用燈塔的真實高度／相機
  // FOV 算出來，見 spawnPoint.ts。
  let pitch = spawnPoint.pitch;
  let dragY = 0;
  let hovered: number | null = null;
  let nextStop: number | null = 0;
  let guideUntil = 0;
  let turnTo: number | null = null;
  // #3780 P0-3 五度/六度審查訂正：travelTo（清單模式／點擊建築「前往」）
  // 不再是「沿地面走到固定距離」——那個做法完全沒檢查路徑，真瀏覽器截圖
  // +179 課 fixture 實算：33.8% 的路徑中途穿過別的建築、36.6% 穿過山丘，
  // 而且抵達時鏡頭朝向沒處理（平均差 32°，10.5% 背對超過 90°）。改成拱形
  // 飛行：鏡頭沿一條路線從玩家目前位置飛到驗證過的終點，中段墊高到比
  // 全島最高建築還高（見 spawnPoint.ts 的 `arcFlightPosition`／
  // `ARC_FLIGHT_PEAK_HEIGHT`），整段飛行途中的高度都不可能撞進任何建築／
  // 山丘；落地朝向直接設成面向目標建築（`arcFlightArrivalYaw`），不是沿
  // 飛行方向推算的角度——那兩個經常不一樣，終點是繞著建築找的合法立足
  // 點，不一定落在「出發點→建築」那條線的延伸方向上。
  interface TravelFlight {
    readonly index: number;
    readonly start: { x: number; z: number };
    readonly end: { x: number; z: number };
    readonly target: { x: number; z: number };
    readonly startedAt: number;
    readonly duration: number;
  }
  // #3794 三次訂正（team-lead 2026-10-30 退件）：`travelTo()` 不再設定
  // `travelFlight`（上面這組型別/狀態保留給已經沒有入口的第一人稱拱形
  // 飛行，見下面 per-frame 迴圈裡 `mode === 'first'` 那段的說明），改設
  // 這組同形狀但走既有石板路的新狀態——跟 `TravelFlight` 刻意同構，差別
  // 只在沒有 `extraHeight` 這個墊高概念（全程貼地）。
  let travelFlight: TravelFlight | null = null;
  interface PathWalk {
    readonly index: number;
    readonly start: { x: number; z: number };
    readonly end: { x: number; z: number };
    readonly target: { x: number; z: number };
    readonly startedAt: number;
    readonly duration: number;
  }
  let pathWalk: PathWalk | null = null;
  let godWalkArrival: number | null = null;
  // #3780 P0-3：回島先面向剛完成的站，停留夠了才轉向下一站。三段式狀態
  // 機（'turning' 轉去剛完成的站 → 'turnTo 收斂' → 'holding' 才開始算
  // 停留秒數）本身是不碰 three.js/WebGL 的純函式，見 islandCelebration.ts
  // 檔頭註解（二次審查訂正：第一版把這三個狀態攤開寫在這個閉包裡，沒有
  // 任何測試能跑到真正的 state machine，退回舊 bug 寫法 1528 條照樣全綠）。
  // `celebration` 為 null 代表現在沒有慶祝在進行。
  let celebration: CelebrationState | null = null;
  // #3780 P0-3 三度審查訂正：慶祝期間鏡頭要推近到看得清楚那棟建築，但
  // 玩家可能是從島上任何角落用清單模式直接開站，沒有真的走過去，直接
  // 沿「玩家→建築」直線推鏡頭有 17.5% 機率穿進別的建築、9.4% 穿進山丘
  // （真瀏覽器截圖審查抓到）。改成 `setProgress()` 剛開始慶祝那一刻，用
  // `findCelebrationViewpoint()` 算一次合法的觀景點存起來，之後整段慶祝
  // 都用這個固定點；找不到合法點就是 null，這時鏡頭只轉頭、不移動
  // （見下面 `eye` 的計算）。
  let celebrationViewpoint: CelebrationViewpoint | null = null;
  // 沿途景色：每一區有自己的天色與霧色（港口海藍 → 山谷翠綠 → 高地金黃）
  const zoneSky = [new THREE.Color('#bcdde6'), new THREE.Color('#cfe6c8'), new THREE.Color('#f1ddb0')];
  const skyNow = new THREE.Color('#bcdde6');
  const fogs = zoneCenters.slice(1).map((zone, index) => {
    const group = new THREE.Group();
    group.position.set(zone.x, 2.2, zone.z);
    scene.add(group);
    const fogMat = new THREE.MeshBasicMaterial({ color: 0xc7d5d9, transparent: true, opacity: 0.97, depthWrite: false, side: THREE.DoubleSide });
    add(group, new THREE.SphereGeometry(zone.radius * 1.05, 24, 12), fogMat).scale.y = 0.55;
    for (let i = 0; i < 35; i++) {
      const a = i * 2.4;
      const r = zone.radius * Math.sqrt((i + 0.5) / 35);
      const cloudMat = new THREE.MeshBasicMaterial({ color: 0xe2e9e9, transparent: true, opacity: 0.8, depthWrite: false });
      add(group, new THREE.IcosahedronGeometry(1.2 + i % 3, 1), cloudMat, Math.sin(a) * r, -0.1 + i % 4, Math.cos(a) * r);
    }
    group.userData.zone = index + 1;
    return group;
  });

  let unlockedZone = 0;
  let progressState: ProgressDiffState = INITIAL_PROGRESS_DIFF_STATE;
  let keyDirection = { x: 0, z: 0 };
  let stickDirection = { x: 0, z: 0 };
  let yaw = spawnPoint.yaw; // #3780 P0-2：一上岸就面向燈塔，不用自己轉頭找
  let dragX = 0;
  let jumping = 0;
  let verticalSpeed = 0;
  let elapsed = 0;
  let landedAt = -9;
  // 開場鏡頭：從海上空推近到主角眼前（-1 = 沒在播）
  let introStart = -1;
  const INTRO_SECONDS = 3.2;
  // #3794（PRD 2026-10-30-island-v2-rpg-pets-story-prd.md §2）：上帝視角
  // 是唯一模式的固定斜俯視鏡頭參數——角度依
  // docs/design/island-v2/design.md §1.2（查過任天堂官方 Iwata Asks 對
  // 經典薩爾達「俯視＋斜角」鏡頭的說明），距離/方向是這裡新定的，不是
  // 文件裡的數字（文件寫的是給「新增第三種視角」的草案，那個架構已經被
  // Young 否決，但角度本身的查證依據仍然成立，沿用）。固定、不可拖曳
  // 旋轉——跟隨玩家位置但不跟隨玩家朝向，這樣「鏡頭不能自由旋轉」才是
  // 真的不能旋轉，不會因為角色轉向而跟著轉。
  // #3794 二次訂正（`.claude/skills/archipelago-module/SKILL.md` §6.5，
  // Young 要求「找專門論述寫進 skill」後補的查證）：角度跟 FOV 改用那份
  // 查證結果，不是第一版自己估的 55°/沿用第一人稱 57° FOV——窄 FOV（透視
  // 變形小，接近 dimetric 的觀看方式）+ 較淺的俯角才是查到的依據（見
  // SKILL §6.5-A：Radek Koncewicz／Wikipedia isometric video game
  // graphics，FOV 建議 25–35°、俯角 30–40°）。距離跟著拉遠到 30，抵銷
  // FOV 變窄造成的構圖變化（FOV 越窄，同樣距離看起來越像用望遠鏡頭貼近
  // 拍，必須退遠一點才會得到接近原本的取景範圍）。
  //
  // #3794 三次訂正（team-lead 2026-10-30 退件）：常數本體跟「鏡頭該在
  // 哪」的算式一起搬去 `spawnPoint.ts`（`GOD_CAMERA_*`／
  // `godCameraDesiredPosition`）——抽成純函式才鎖得住「角色走路時鏡頭的
  // 俯角與高度不變」這個不變量，這裡只剩 `GOD_CAMERA_FOV_DEG` 還會被直接
  // 引用（切 `camera.fov` 用），從 import 拿。
  let last = performance.now();
  let frame = 0;
  let near: number | null = null;
  let fogMessageAt = 0;
  let paused = false;
  const keys = new Set<string>();
  const keydown = (event: KeyboardEvent) => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'w', 'a', 's', 'd'].includes(event.key)) event.preventDefault();
    keys.add(event.key.toLowerCase());
    // #3794（Young 硬規定）：空白鍵跳躍只在第一人稱模式有意義——上帝視角
    // 是唯一模式、永遠不會是 'first'，這裡加上判斷讓空白鍵真的不做任何事
    // （`keys.add` 本身無害，真正會移動角色的是下面被 `mode === 'first'`
    // 擋住的那段，但跳躍是獨立的 `verticalSpeed` 機制，要分開擋）。
    if (event.key === ' ' && jumping === 0 && isManualControlEnabled(mode)) verticalSpeed = 5.5;
  };
  const keyup = (event: KeyboardEvent) => keys.delete(event.key.toLowerCase());
  let downAt = { x: 0, y: 0 };
  const pointerdown = (event: PointerEvent) => { dragX = event.clientX; dragY = event.clientY; downAt = { x: event.clientX, y: event.clientY }; renderer.domElement.setPointerCapture(event.pointerId); };
  // #3799 批次 2（team-lead 2026-10-30：「390 寬把建築的可點範圍加大」）：
  // 窄螢幕下，raycast 精準沒命中時，退而找「螢幕上投影位置離點擊點最近、
  // 而且在容許誤差內」的可見建築——容許誤差依寬高比放大（見
  // `tapToleranceForAspect`），小朋友的手指比滑鼠游標粗很多，精準 raycast
  // 對觸控不公平。只在這個 fallback 用得到，不影響桌機既有的精準點擊。
  const nearestVisibleBuildingWithinTolerance = (ndc: THREE.Vector2): number | null => {
    const tolerance = tapToleranceForAspect(camera.aspect);
    let best: number | null = null;
    let bestDist = Infinity;
    for (const group of buildingGroups) {
      if (!group.visible) continue;
      const projected = group.position.clone().project(camera);
      const dist = Math.hypot(projected.x - ndc.x, projected.y - ndc.y);
      if (dist < tolerance && dist < bestDist) {
        bestDist = dist;
        best = group.userData.index as number;
      }
    }
    return best;
  };
  const pointerup = (event: PointerEvent) => {
    if (mode !== 'god' || Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y) > 6) return;
    // 放開滑鼠當下就判斷點到哪棟，不等下一個畫面（否則快點時會落空）
    const rect = renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hitNow = raycaster.intersectObjects(buildingGroups.filter((group) => group.visible), true)[0];
    let picked: number | null = null;
    if (hitNow) { let o: THREE.Object3D | null = hitNow.object; while (o && o.userData.index === undefined) o = o.parent; picked = (o?.userData.index as number | undefined) ?? null; }
    if (picked === null) picked = nearestVisibleBuildingWithinTolerance(ndc);
    if (picked !== null) events.onPick?.(picked);
  };
  const pointermove = (event: PointerEvent) => {
    const rect = renderer.domElement.getBoundingClientRect();
    pointerNdc.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    if (!renderer.domElement.hasPointerCapture(event.pointerId)) return;
    // #3794：上帝視角鏡頭角度固定、不能自由旋轉（Young 硬規定）——拖曳
    // 改變 `yaw`／`pitch` 只在第一人稱模式有意義（現在已經切不進去了，
    // 這段保留但不會被呼叫到的理由跟其他 `mode === 'first'` 分支一樣：
    // 程式碼留著、介面上沒有入口）。
    if (isManualControlEnabled(mode)) {
      yaw -= (event.clientX - dragX) * 0.005;
      pitch = Math.max(-0.9, Math.min(0.7, pitch - (event.clientY - dragY) * 0.004));
    }
    dragX = event.clientX;
    dragY = event.clientY;
    turnTo = null;
  };
  const resize = () => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('keydown', keydown);
  window.addEventListener('keyup', keyup);
  renderer.domElement.addEventListener('pointerdown', pointerdown);
  renderer.domElement.addEventListener('pointermove', pointermove);
  renderer.domElement.addEventListener('pointerup', pointerup);
  window.addEventListener('resize', resize);
  resize();

  const walkable = (x: number, z: number) =>
    zoneCenters.some((zone, index) => index <= unlockedZone && Math.hypot(x - zone.x, z - zone.z) < zone.radius - 1)
    && !zoneCenters.some((zone, index) => index > unlockedZone && Math.hypot(x - zone.x, z - zone.z) < zone.radius);
  const animate = (now: number) => {
    frame = requestAnimationFrame(animate);
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    elapsed += dt;
    if (!paused) {
      // #3780 P0-3：停留期結束才轉向下一站——這段要在 turnTo 的轉頭邏輯
      // 之前跑，這樣同一幀內 turnTo 改指到新目標時，下面的轉頭插值立刻
      // 就會用新值，不會晚一幀才反應。`isHoldComplete` 是不碰 three.js 的
      // 純函式（見 islandCelebration.ts），'turning' 階段永遠回傳 false。
      if (celebration && isHoldComplete(celebration, elapsed)) {
        const finishedIndex = celebration.index;
        const goTo = celebration.pendingNextStop;
        celebration = null;
        celebrationViewpoint = null;
        nextStop = goTo;
        turnTo = goTo;
        // #3780 P0-3 九度審查訂正：慶祝期間鏡頭推到觀景點、拖曳過上下
        // 視角的話，結束後 pitch 會停在那個殘留值，不是回到正常遊玩時的
        // 角度。慶祝一結束就重設回出生時的仰角（跟 playIntro() 用同一個
        // 基準），不要讓拖曳的痕跡一直帶著走。
        pitch = spawnPoint.pitch;
        events.onCelebrationEnd?.(finishedIndex, goTo);
      }
      keyDirection = { x: Number(keys.has('d') || keys.has('arrowright')) - Number(keys.has('a') || keys.has('arrowleft')), z: Number(keys.has('s') || keys.has('arrowdown')) - Number(keys.has('w') || keys.has('arrowup')) };
      const dx = keyDirection.x + stickDirection.x;
      const dz = keyDirection.z + stickDirection.z;
      // 開場鏡頭還在飛的時候鎖住移動，免得學生在鏡頭外走到別站
      const introPlaying = introStart >= 0;
      // #3780 P0-3 七度審查訂正：飛行途中鎖住輸入，跟 introPlaying 同一個
      // 做法——原本只有 `length > 0.08` 才會打斷飛行，但那代表玩家按
      // WASD／拖搖桿的那一幀，`length` 會蓋掉下面飛行區塊算出來的值、
      // `travelFlight` 被設成 null，高度瞬間歸零，鏡頭直接掉在飛到一半的
      // 半空中——真瀏覽器+ 179 課實算約三成會落在建築或山丘裡。現在飛行中
      // `length` 一律視為 0（跟 introPlaying 一樣鎖住），不會進到下面手動
      // 移動的分支，飛行本身也不會被打斷，必須飛完才交還控制。
      const flying = travelFlight !== null;
      let length = isMovementLocked(introPlaying, flying) ? 0 : Math.hypot(dx, dz);
      if (introPlaying) { travelFlight = null; pathWalk = null; }
      // #3794（PRD 2026-10-30-island-v2-rpg-pets-story-prd.md §2，Young
      // 2026-10-30 硬規定）：上帝視角是唯一視角，WASD/搖桿不准做任何事，
      // 當然也不准切回第一人稱——原本這裡 `mode === 'god'` 時按方向鍵會
      // 呼叫 `onWantFirstPerson` 切回第一人稱，那條路徑整個拿掉。
      //
      // 這一刻算出來的墊高值會在下面的 `eye` 計算裡用到（只有第一人稱的
      // 拱形飛行會用到，上帝視角的 `pathWalk` 全程貼地，沒有墊高概念）。
      let flightExtraHeight = 0;
      // #3794 二次訂正（team-lead 2026-10-30 退件）：第一版在這裡拿掉了
      // `mode === 'first'` 這個條件，讓拱形飛行（鏡頭沿一條墊高到比全島
      // 最高建築還高的弧線飛過去）直接套用在上帝視角——結果變成「鏡頭在
      // 飛、畫面上完全沒有看得到的人在走路」，跟 PRD §2「看得到人在移動」
      // 「沿著路徑從一棟建築走到另一棟」的規格相反。拱形飛行本來就是為了
      // 第一人稱（你看不到自己的身體，鏡頭本身就是「你」）設計的效果，現在
      // 把條件改回來、讓它繼續只服務第一人稱——跟其他 `mode === 'first'`
      // 分支一樣，程式碼留著、沒有入口切得進去，永遠不會真的執行。
      if (travelFlight && mode === 'first') {
        const progress = (elapsed - travelFlight.startedAt) / travelFlight.duration;
        if (progress >= 1) {
          player.position.x = travelFlight.end.x;
          player.position.z = travelFlight.end.z;
          yaw = arcFlightArrivalYaw(travelFlight.end, travelFlight.target);
          // #3780 P0-3 九度審查訂正：跟慶祝結束同一個做法——落地後把 pitch
          // 重設回出生仰角，不要讓飛行前殘留的拖曳上下視角一直帶著走。
          pitch = spawnPoint.pitch;
          const arrived = travelFlight.index;
          travelFlight = null;
          events.onMove(player.position.x, player.position.z);
          events.onArrive?.(arrived);
        } else {
          const pos = arcFlightPosition(travelFlight.start, travelFlight.end, progress);
          player.position.x = pos.x;
          player.position.z = pos.z;
          flightExtraHeight = pos.extraHeight;
          yaw = arcFlightArrivalYaw({ x: pos.x, z: pos.z }, travelFlight.target);
          events.onMove(player.position.x, player.position.z);
          length = 1;
        }
      }
      // #3794 二次訂正：取代上面那段（現在已經是沒有入口的死碼）——點建築
      // 之後角色沿既有石板路走到門口，不是鏡頭飛過去。全程貼地（不墊高、
      // 不用 `flightExtraHeight`），`player.position` 的 x/z 用
      // `walkAlongPathPosition` 逐步推進，鏡頭（上帝視角分支的
      // `godCameraDesiredPosition`）只讀 `player.position`、不讀這裡的任何
      // 狀態，所以鏡頭俯角/高度在整段行走過程中保持不變，只有水平位置
      // lerp 跟著角色走。
      if (pathWalk) {
        const progress = (elapsed - pathWalk.startedAt) / pathWalk.duration;
        if (progress >= 1) {
          player.position.x = pathWalk.end.x;
          player.position.z = pathWalk.end.z;
          yaw = arcFlightArrivalYaw(pathWalk.end, pathWalk.target);
          pitch = spawnPoint.pitch;
          const arrived = pathWalk.index;
          pathWalk = null;
          godWalkArrival = arrived;
          events.onMove(player.position.x, player.position.z);
          events.onArrive?.(arrived);
        } else {
          const pos = walkAlongPathPosition(pathWalk.start, pathWalk.end, progress);
          player.position.x = pos.x;
          player.position.z = pos.z;
          yaw = arcFlightArrivalYaw({ x: pos.x, z: pos.z }, pathWalk.target);
          events.onMove(player.position.x, player.position.z);
          length = 1; // 走路動畫（擺動/彈跳）要播起來，跟舊拱形飛行同一招
        }
      }
      // #3794（Young 硬規定，PRD §2 第一條）：WASD／搖桿不准移動角色——
      // 角色只能靠點建築自動走過去。`mode === 'first'` 現在永遠是 false
      // （沒有任何入口切得進去），這個條件讓手動移動整塊變成不會執行的
      // 死碼，不是刪掉整段邏輯（第一人稱的程式碼保留，只是介面上沒有
      // 入口——跟其他 `mode === 'first'` 分支同一個做法）。
      if (length > 0.08 && travelFlight === null && pathWalk === null && isManualControlEnabled(mode)) {
        const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
        const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
        const moveX = (right.x * dx + forward.x * -dz) / Math.max(1, length) * dt * 5.2;
        const moveZ = (right.z * dx + forward.z * -dz) / Math.max(1, length) * dt * 5.2;
        const nextX = player.position.x + moveX;
        const nextZ = player.position.z + moveZ;
        // #3780 P0-2：原本寫死 1.55，比建築地基半徑 1.65 還小，玩家／鏡頭會被
        // 放行到建築實體內部，近平面貼著材質，整片畫面變成建築的顏色。
        const buildingCollision = content.stops.some((stop) => Math.hypot(nextX - stop.x, nextZ - stop.z) < MIN_CAMERA_BUILDING_DISTANCE);
        const hillCollision = hillPositions.some(([x, z, r]) => Math.hypot(nextX - x, nextZ - z) < r * 0.7);
        if (walkable(nextX, nextZ) && !buildingCollision && !hillCollision) {
          player.position.x = nextX;
          player.position.z = nextZ;
          events.onMove(nextX, nextZ);
        } else if (now - fogMessageAt > 1700 && zoneCenters.some((zone, index) => index > unlockedZone && Math.hypot(nextX - zone.x, nextZ - zone.z) < zone.radius)) {
          fogMessageAt = now;
          events.onFogEdge();
        }
      }
      if (verticalSpeed !== 0 || jumping > 0) {
        jumping = Math.max(0, jumping + verticalSpeed * dt);
        verticalSpeed -= 15 * dt;
        if (jumping === 0) { verticalSpeed = 0; landedAt = elapsed; }
      }
      player.position.y = 1.55 + jumping + (length > 0.08 ? Math.sin(elapsed * 13) * 0.07 : 0);
      // 人物微動作：站著呼吸、走路擺動、落地壓扁
      const pose = characterPose({ elapsed, moving: length > 0.08 && jumping === 0, sinceLanded: elapsed - landedAt });
      // #3799 批次 2（team-lead：「角色...太小」）：窄螢幕鏡頭被迫拉遠時，
      // 角色的世界座標縮放在螢幕上會跟著透視縮小——見 spriteScaleForAspect
      // 的說明。桌機倍率是 1，不影響既有已驗證的構圖。
      const charScale = spriteScaleForAspect(camera.aspect);
      player.scale.set(1.8 * charScale * pose.scaleX, 2.3 * charScale * pose.scaleY, 1);
      player.material.rotation = pose.tilt;
      xiaoling.material.rotation = Math.sin(elapsed * 2.2) * 0.07;
      xiaoling.position.set(player.position.x + 0.67, player.position.y + 0.85 + Math.sin(elapsed * 3) * 0.14, player.position.z + 0.12);
      // #3780 P0-2：原本全島共用一個寫死的 3.25——燈塔是全島唯一的地標級
      // 高塔，出生距離要拉開才看得到整座塔，所以它需要自己的觸發半徑
      // （比其他矮站大很多）。第一版用「距離 ÷ 自己的半徑」這個比例值比
      // 大小——審查員真瀏覽器＋全平台 179 課實算抓到：燈塔半徑大超過兩倍
      // 時，玩家站在旁邊小站的門口（對那一站已經近到不能再近），比例值
      // 卻可能是「燈塔比較近」，9.9% 的燈塔—其他站配對會被搶走。正確做法
      // 抽成 `selectNearestStation`（見 spawnPoint.ts）：先用各站自己的
      // 半徑獨立判斷「有沒有進範圍」，有進範圍的候選裡才比真正的距離。
      // #3780 P0-3 十度審查訂正：傳 `containerAspect` 進去——燈塔的觸發
      // 半徑現在跟出生距離用同一套公式算，直式手機拉開的出生距離才會讓
      // 觸發半徑自動跟著變寬，不會脫鉤（見 spawnPoint.ts
      // `nearTriggerRadiusForStep` 的註解）。
      let closest = selectNearestStation(content.stops, player.position, unlockedZone, containerAspect);
      if (introPlaying) closest = null;
      // #3794 四次訂正（Young 2026-10-30 PRD §2「點下去 → 走到門口 → 才顯示說明卡」，
      // 取代 #3780「出生點必定落在燈塔觸發半徑內、一上岸就跳卡」的舊設計）：
      // 上帝視角下說明卡只認「點建築、走到門口」這一條路，不靠靠近自動跳；
      // 剛上岸、還沒點過任何建築時 godWalkArrival 是 null，不跳卡。
      closest = cardStationFor(mode, godWalkArrival, closest);
      if (closest !== near) { near = closest; events.onNear(closest); }
      babies.forEach((baby, index) => {
        const data = content.babies[index];
        baby.position.set(data.x + Math.sin(elapsed + index) * 0.32, 1.65 + Math.sin(elapsed * 2 + index) * 0.14, data.z + Math.cos(elapsed + index) * 0.3);
        baby.material.rotation = Math.hypot(player.position.x - data.x, player.position.z - data.z) < 3 ? Math.sin(elapsed * 2) * 0.16 : 0;
      });
      if (turnTo !== null) {
        const target = content.stops[turnTo];
        const want = Math.atan2(-(target.x - player.position.x), -(target.z - player.position.z));
        let diff = want - yaw;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        yaw += diff * Math.min(1, dt * 2.2);
        if (Math.abs(diff) < 0.02) turnTo = null;
      }
      // 轉到剛完成的站了（turnTo 剛被收斂成 null），這時候才真正開始算
      // 停留秒數——不管玩家離那棟建築多遠、要轉多大的角度，分級秒數保證
      // 從「鏡頭已經正對著它」那一刻才起算。`advanceOnTurnConverged` 在
      // 已經是 'holding' 時是 no-op，重複呼叫（每一幀 turnTo 收斂後都會
      // 符合這個條件）不會把停留時間往後挪。
      if (celebration && celebration.phase === 'turning' && turnTo === null) {
        celebration = advanceOnTurnConverged(celebration, elapsed);
      }
      if (mode === 'first') {
        // #3794 二次訂正：FOV 跟著模式走——第一人稱／開場鏡頭沿用原本已
        // 審過的 57°，不因為上帝視角要改用窄 FOV 而被牽動。比較用字面值
        // 而非常數，是因為 57 從建立 camera（第 72 行）那一刻就是這個模式
        // 的既定值，這裡只是「確保沒被上帝視角改動過」的自我修正，不是
        // 另外定義一個新常數。
        if (camera.fov !== 57) {
          camera.fov = 57;
          camera.updateProjectionMatrix();
        }
        (scene.fog as THREE.FogExp2).density = 0.012;
        player.visible = false;
        // 慶祝期間、找得到合法觀景點時，鏡頭用那個點（不是 player.position）
        // ——`celebrationViewpoint` 在 setProgress() 開始慶祝那一刻就算好、
        // 保證不穿牆；找不到合法點（celebrationViewpoint 是 null）就照舊用
        // player.position，等於這次只轉頭、不移動鏡頭。這不影響
        // `player.position` 本身，碰撞/遊戲狀態完全不受影響，只影響鏡頭
        // 實際渲染的位置。
        const usingViewpoint = celebration !== null && celebrationViewpoint !== null;
        const eyeX = usingViewpoint ? celebrationViewpoint!.x : player.position.x;
        const eyeZ = usingViewpoint ? celebrationViewpoint!.z : player.position.z;
        // 慶祝觀景點跟拱形飛行是兩種不同情境互斥的墊高來源（不會同時發生
        // ——慶祝時 travelFlight 必定是 null，飛行途中也不會進入慶祝），
        // 直接相加即可，不用另外判斷優先序。
        const eyeExtraHeight = (usingViewpoint ? celebrationViewpoint!.extraHeight : 0) + flightExtraHeight;
        const eye = new THREE.Vector3(eyeX, 1.75 + eyeExtraHeight + jumping + (length > 0.08 ? Math.sin(elapsed * 11) * 0.05 : 0), eyeZ);
        const look = new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
        const intro = introStart >= 0 ? introProgress(elapsed - introStart, INTRO_SECONDS) : 1;
        if (intro < 1) {
          // 從高空、主角背後遠處推近，視線從整座島慢慢收到主角前方
          const from = new THREE.Vector3(player.position.x + Math.sin(yaw) * 46, 34, player.position.z + Math.cos(yaw) * 46);
          camera.position.copy(from.lerp(eye, intro));
          const target = new THREE.Vector3(player.position.x, 0, player.position.z - 8).lerp(eye.clone().add(look), intro);
          camera.lookAt(target);
        } else {
          introStart = -1;
          // #3794：開場鏡頭飛行播完，交還控制權——這裡切回 'god'（唯一的
          // 互動模式），下一幀就會走新的上帝視角跟隨鏡頭公式，不會卡在
          // 第一人稱視角裡沒有任何入口切出去。
          mode = 'god';
          camera.position.lerp(eye, Math.min(1, dt * 14));
          camera.lookAt(camera.position.clone().add(look));
        }
        xiaoling.scale.copy(XL_FIRST);
        // 慶祝期間讓小翎移到畫面側邊、拉遠一點，不要擋在正中央（team-lead
        // 2026-10-27 退件：她剛好擋在剛完成建築的正中下方）。
        const xiaolingLateral = celebration ? 2.4 : 1.25;
        const xiaolingForward = celebration ? 3.1 : 2.4;
        xiaoling.position.copy(camera.position).add(new THREE.Vector3(Math.cos(yaw) * xiaolingLateral - Math.sin(yaw) * xiaolingForward, -0.55 + Math.sin(elapsed * 3) * 0.08, -Math.sin(yaw) * xiaolingLateral - Math.cos(yaw) * xiaolingForward));
      } else {
        // #3794 二次訂正（`.claude/skills/archipelago-module/SKILL.md`
        // §6.5 查證）：上帝視角用自己專屬的窄 FOV，不沿用第一人稱的
        // 57°——窄 FOV 透視變形小，才做得出「斜俯視帶一點透視、像
        // dimetric 但非正交」的效果；跟 GOD_CAMERA_PITCH／DISTANCE 一樣
        // 用同一個判斷點切換，不是常駐設定在建立 camera 那一行（那一行
        // 要留給第一人稱／開場鏡頭沿用）。
        if (camera.fov !== GOD_CAMERA_FOV_DEG) {
          camera.fov = GOD_CAMERA_FOV_DEG;
          camera.updateProjectionMatrix();
        }
        (scene.fog as THREE.FogExp2).density = GOD_VIEW_FOG_DENSITY;
        player.visible = true;
        xiaoling.scale.set(0.9, 1.1, 1);
        // #3794 三次訂正：取代舊的「以已解鎖區域平均中心為準、可拖曳旋轉」
        // 上帝視角——新設計跟隨玩家實際位置（看得到人沿既有石板路走，見
        // 上面 `pathWalk` 那段），角度/方向固定（純函式
        // `godCameraDesiredPosition` 只讀 `player.position`，不讀 yaw／
        // pitch／飛行狀態任何輸入），滿足「鏡頭不能自由旋轉」，也保證角色
        // 移動時鏡頭俯角與高度不會跟著變，只有水平 lerp 跟隨。
        // #3794 三次訂正補充：直式手機寬高比窄，固定距離會把鄰近建築切到
        // 畫面外（見 godCameraDistanceForAspect 的說明）——傳真實的
        // `camera.aspect`（resize() 已經即時維護），讓窄螢幕自動拉遠一點。
        const target = godCameraDesiredPosition(player.position, camera.aspect);
        camera.position.lerp(new THREE.Vector3(target.x, target.y, target.z), Math.min(1, dt * 3));
        // #3799 批次 2：窄螢幕下看的點往島內部偏一點（見 godCameraLookTarget
        // 的說明），減少畫面下緣的外海留白；寬螢幕維持原本「直接看著玩家
        // 腳下」的構圖，已經用真瀏覽器截圖驗過不需要這個補償。
        const lookTarget = godCameraLookTarget(player.position, camera.aspect);
        camera.lookAt(lookTarget.x, lookTarget.y, lookTarget.z);
      }
    }
    zonedThings.forEach((thing) => { thing.visible = (thing.userData.zone as number) <= unlockedZone; });
    skyNow.lerp(zoneSky[zoneOf(player.position.x, player.position.z)], Math.min(1, dt * 0.8));
    (scene.background as THREE.Color).copy(skyNow);
    (scene.fog as THREE.FogExp2).color.copy(skyNow);
    lighthouseBeams.forEach((pivot) => { pivot.visible = mode === 'first'; pivot.rotation.y -= dt * 0.9; });
    // 對準建築：第一人稱看畫面中央，上帝視角看滑鼠
    raycaster.setFromCamera(mode === 'first' ? new THREE.Vector2(0, 0) : pointerNdc, camera);
    const hit = raycaster.intersectObjects(buildingGroups.filter((group) => group.visible), true)[0];
    let found: number | null = null;
    if (hit) { let o: THREE.Object3D | null = hit.object; while (o && o.userData.index === undefined) o = o.parent; found = (o?.userData.index as number | undefined) ?? null; }
    if (found !== hovered) { hovered = found; events.onHover?.(found); }
    halos.forEach((halo, index) => {
      const mat = halo.material as THREE.MeshBasicMaterial;
      // #3780 P0-3：正在慶祝的站優先於 hover/near/nextStop 的一般規則——
      // 回應強度跟花的力氣成正比，heavy tier 比 light tier 亮、脈動幅度
      // 也更大（「燈亮」那部分）。
      if (celebration && index === celebration.index) {
        const targetOpacity = celebration.profile.tier === 'heavy' ? 1 : 0.75;
        mat.opacity += (targetOpacity - mat.opacity) * Math.min(1, dt * 10);
        const pulseAmp = celebration.profile.tier === 'heavy' ? 0.3 : 0.16;
        // 底座放大（跟整棟建築發光是分開的第二層回饋）：heavy 放大到 1.6
        // 倍、light 到 1.3 倍，平滑靠近而不是瞬間跳變。
        const targetBaseScale = celebration.profile.tier === 'heavy' ? 1.6 : 1.3;
        haloBaseScale[index] += (targetBaseScale - haloBaseScale[index]) * Math.min(1, dt * 8);
        halo.scale.setScalar(haloBaseScale[index] + pulseAmp * Math.sin(elapsed * 7));
      } else {
        const on = index === hovered || index === near;
        mat.opacity += ((on ? 0.95 : index === nextStop ? 0.45 : 0) - mat.opacity) * Math.min(1, dt * 8);
        haloBaseScale[index] += (1 - haloBaseScale[index]) * Math.min(1, dt * 8);
        halo.scale.setScalar(haloBaseScale[index] + (on ? 0.12 * Math.sin(elapsed * 6) : 0.04 * Math.sin(elapsed * 2)));
      }
      buildingGroups[index].scale.setScalar(1 + (index === hovered ? 0.035 : 0));
    });
    // #3780 P0-3 八度審查訂正：3D 站牌是 `depthTest: false`，永遠畫在
    // 最上層——即使物理上被別棟建築擋住，字牌還是會穿模浮在前景建築上
    // （team-lead 2026-10-27 截圖抓到：「回音劇場」浮在港口燈塔前面）。
    // `isLabelOccluded`（spawnPoint.ts）判斷鏡頭→這塊牌子的視線有沒有被
    // 「別棟」建築擋住（只排除自己，不排除任何東西都不排除），用淡出
    // （opacity 平滑趨近 0/1）取代硬切 visible，不要瞬間消失/出現。
    const buildingObstacles: LabelOcclusionObstacle[] = content.stops.map((stop) => ({
      x: stop.x,
      z: stop.z,
      radius: BUILDING_BASE_RADIUS,
      baseY: 0.42,
      topY: buildingTopY(stop.step),
    }));
    // #3799 批次 2（team-lead：「建築名牌太小」）：名牌是固定世界座標縮放的
    // 3D 精靈貼圖，窄螢幕鏡頭被迫拉遠時會跟著透視縮小——見
    // spriteScaleForAspect 的說明。桌機倍率是 1，不影響既有構圖。
    const signScale = spriteScaleForAspect(camera.aspect);
    signs.forEach((sign, index) => {
      const stop = content.stops[index];
      const labelWorld = { x: stop.x, y: 0.42 + sign.position.y, z: stop.z };
      const occluded = isLabelOccluded(
        { x: camera.position.x, y: camera.position.y, z: camera.position.z },
        labelWorld,
        buildingObstacles.filter((_, i) => i !== index),
      );
      const mat = sign.material as THREE.SpriteMaterial;
      mat.opacity += ((occluded ? 0 : 1) - mat.opacity) * Math.min(1, dt * 10);
      sign.scale.set(3.3 * signScale, 0.65 * signScale, 1);
    });
    // #3780 P0-3：慶祝粒子——從剛完成那一站的地基往上、往外飄散，停留期
    // 結束前淡出；數量跟擴散範圍依 tier 而定（heavy 比 light 多更大）。
    if (celebration) {
      // 捕進區塊內的 const——`celebration` 是外層 `let`，forEach 的 callback
      // 是另一個函式邊界，TS 不會幫忙把外層的 null 檢查窄化帶進去。
      const cel = celebration;
      const stop = content.stops[cel.index];
      const progress = cel.phase === 'holding'
        ? 1 - Math.max(0, cel.holdUntil - elapsed) / cel.profile.holdSeconds
        : 0;
      celebrationParticles.forEach((dot, k) => {
        const isActive = k < cel.profile.particleCount;
        dot.visible = isActive;
        if (!isActive) return;
        const angle = (k / cel.profile.particleCount) * Math.PI * 2 + elapsed * 1.6;
        const radius = 1.1 + progress * 2.3;
        dot.position.set(
          stop.x + Math.cos(angle) * radius,
          1.7 + progress * 2.6 + Math.sin(elapsed * 3 + k) * 0.1,
          stop.z + Math.sin(angle) * radius,
        );
        (dot.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - progress) * 0.9;
        dot.scale.setScalar(0.5 + (1 - progress) * 0.5);
      });
    } else {
      celebrationParticles.forEach((dot) => { dot.visible = false; });
    }
    // 下一關的引導光柱與光點
    if (nextStop !== null && content.stops[nextStop].zone <= unlockedZone) {
      const target = content.stops[nextStop];
      const closeToTarget = Math.hypot(player.position.x - target.x, player.position.z - target.z) < 6;
      beam.visible = !closeToTarget || mode === 'god';
      beam.position.set(target.x, 14, target.z);
      (beam.material as THREE.MeshBasicMaterial).opacity = 0.12 + 0.06 * Math.sin(elapsed * 2.5) + (elapsed < guideUntil ? 0.15 : 0);
      const from = new THREE.Vector3(player.position.x, 0.6, player.position.z);
      const to = new THREE.Vector3(target.x, 0.6, target.z);
      const gap = from.distanceTo(to);
      const showTrail = gap > 8;
      const t0 = Math.min(0.9, 3 / Math.max(gap, 0.001)); // 光點離主角至少 3 公尺
      trailDots.forEach((dot, k) => {
        // 光點從腳前 2 公尺開始，不擠在鏡頭前
        const t = t0 + (((k / trailDots.length) + elapsed * 0.18) % 1) * (1 - t0);
        dot.visible = showTrail;
        dot.position.lerpVectors(from, to, t);
        dot.position.y = 0.6 + Math.sin(t * Math.PI) * 1.2 + Math.sin(elapsed * 4 + k) * 0.06;
        dot.scale.setScalar(0.6 + Math.sin(t * Math.PI) * 0.8);
      });
    } else {
      beam.visible = false;
      trailDots.forEach((dot) => { dot.visible = false; });
    }
    fogs.forEach((fog, index) => {
      const open = index + 1 <= unlockedZone;
      const target = open ? 0.001 : 1;
      const scale = fog.scale.x + (target - fog.scale.x) * Math.min(1, dt * 0.55);
      fog.scale.setScalar(Math.max(0.001, scale));
      fog.visible = scale > 0.03;
      fog.rotation.y += dt * 0.015;
    });
    // 四度審查訂正：對「這一棟真正在用的所有材質」套用，不是單一個
    // windowMat——`resolveCelebrationGlow`（islandCelebration.ts）是不碰
    // three.js 的純函式，吃一個 intensity 數字，判斷這一刻該不該發光／
    // 多亮；`applyBuildingGlow`（islandBuildingShapes.ts）才是真的把結果
    // 寫進材質那一步，兩邊都各自可以離線測試。
    perBuildingMaterials.forEach((mats, index) => {
      const baseGlow = progressState.completed.includes(index) ? steadyCompletedGlow(elapsed) : 0;
      const celebratingThis = celebration && index === celebration.index;
      const intensity = celebratingThis ? celebrationGlowBoost(celebration.profile, elapsed) : baseGlow;
      applyBuildingGlow(mats, resolveCelebrationGlow(intensity));
    });
    renderer.render(scene, camera);
  };
  frame = requestAnimationFrame(animate);
  return {
    setProgress(nextZone: number, done: number[]) {
      // #3799 美術指導書追加需求（2026-10-31）：已完成的站插旗＋名牌打勾
      // ——不能只靠整棟發光，發光留著，這是額外加的視覺回饋。
      for (const index of done) flagCompletedStation(index);
      // #3780 P0-3：原本「有新完成就直接轉向下一站」——鏡頭轉走的那一刻，
      // 剛點亮的站已經不在畫面裡了。改成先轉過去面向剛完成的那一站，停留
      // `celebrationProfileForStep()` 算出來的秒數（依這一站的份量分輕重），
      // 停留期一到才真的轉去下一站（見 animate() 開頭的停留期結束檢查）。
      //
      // 三次審查訂正：`diffProgress` 把第一次呼叫（不管內容）當既有基準
      // 接受，不產生 newlyDoneIndices——避免世界剛建立時把學生之前就做完
      // 的站誤判成「剛完成」，安靜播一次玩家沒看到的假慶祝、把 turnTo 轉
      // 掉，害真正的慶祝看起來像沒有轉向（見 islandCelebration.ts 的
      // `diffProgress` 註解）。
      const { nextState, newlyDoneIndices } = diffProgress(progressState, done);
      progressState = nextState;
      unlockedZone = nextZone;
      const next = content.stops.findIndex((_, index) => !done.includes(index));
      const resolvedNextStop = next < 0 ? null : next;
      // #3780 P0-3：全部完成（resolvedNextStop === null）是最後一站——這裡
      // 沒有「下一站」好轉過去，原本的 bug（鏡頭轉去下一站、剛點亮的站
      // 不在畫面裡）本來就不會發生在這一格。全螢幕結尾慶祝層另有一條
      // 已經很小心去重過的 effect 在管（ReadingIslandLab.tsx 的
      // justCompletedWithinSession／justMountedAlreadyDone 判斷），自己
      // 會播 chime／開全螢幕 burst；這裡如果也跟著觸發 onCelebrate 播一次
      // chime，會在同一刻重複響兩次。所以只有「還有下一站」時才進入慶祝
      // 流程，最後一站維持原本直接呼叫 `nextStop = null` 的寫法。
      const trigger = resolveCelebrationTrigger(newlyDoneIndices, resolvedNextStop);
      if (trigger) {
        const { justCompleted } = trigger;
        // `startCelebration` 不看前一個 `celebration` 是什麼——如果這個時候
        // 已經有一個還沒播完（慶祝中又完成另一站），這裡會直接覆蓋掉它，
        // 前一個永遠不會走到 `isHoldComplete`、也就不會觸發它的
        // `onCelebrationEnd`。這是刻意的規則，細節見 islandCelebration.ts
        // `startCelebration` 的註解。
        celebration = startCelebration(justCompleted, content.stops[justCompleted].step, resolvedNextStop);
        // 慶祝一開始就算好這次要用的觀景點（固定下來，不是每一幀重算）——
        // 找不到合法點時是 null，animate() 裡的 eye 計算會因此退回「只轉頭、
        // 不移動鏡頭」，不會硬用一個可能穿牆的位置。
        const celebratingStop = content.stops[justCompleted];
        celebrationViewpoint = findCelebrationViewpoint({
          target: { x: celebratingStop.x, z: celebratingStop.z },
          player: { x: player.position.x, z: player.position.z },
          otherBuildings: content.stops
            .filter((_, index) => index !== justCompleted)
            .map((stop) => ({ x: stop.x, z: stop.z })),
          hills: hillPositions,
          zoneCenter: zoneCenters[celebratingStop.zone],
        });
        guideUntil = elapsed + 12;
        turnTo = justCompleted;
        events.onCelebrate?.(justCompleted);
      } else {
        nextStop = resolvedNextStop;
      }
    },
    setMode(next: ViewMode) { mode = next; if (next === 'first') pitch = -0.05; },
    // #3780 P0-3 六度審查訂正：終點驗證過合法（跟慶祝鏡頭同一套檢查，見
    // findTravelToDestination）。
    //
    // #3794 三次訂正（team-lead 2026-10-30 退件）：原本這裡接著設
    // `travelFlight`，讓鏡頭沿拱形飛行（墊高到比全島最高建築還高）飛過去
    // ——那是只服務第一人稱（你看不到自己的身體，鏡頭本身就是「你」）的
    // 設計，套用在上帝視角會變成「鏡頭在飛、看不到人在走」，跟 PRD §2
    // 規格相反。改成設 `pathWalk`：全程貼地，沿既有石板路走到門口（見
    // animate() 迴圈裡 `pathWalk` 那段用 `walkAlongPathPosition` 算當下
    // 該在哪），總秒數跟既有 WASD 行走同一個速度常數換算
    // （`walkDurationSeconds`），不是固定 0.8–1.5 秒區間——這樣走一段短路
    // 跟走一段長路的速度感覺一致，不會因為距離夾在同一個秒數區間裡忽快
    // 忽慢。
    travelTo(index: number) {
      const target = content.stops[index];
      const destination = findTravelToDestination({
        target: { x: target.x, z: target.z },
        player: { x: player.position.x, z: player.position.z },
        otherBuildings: content.stops.filter((_, i) => i !== index).map((s) => ({ x: s.x, z: s.z })),
        hills: hillPositions,
        zoneCenter: zoneCenters[target.zone],
      });
      const start = { x: player.position.x, z: player.position.z };
      const end = destination ?? { x: target.x, z: target.z };
      godWalkArrival = null;
      pathWalk = { index, start, end, target: { x: target.x, z: target.z }, startedAt: elapsed, duration: walkDurationSeconds(start, end) };
    },
    setStick(x: number, z: number) { stickDirection = { x, z }; },
    setPaused(value: boolean) { paused = value; },
    // #3794：跳躍是純第一人稱的機制，上帝視角模式下是 no-op（防呆——介面
    // 上已經拿掉跳躍按鈕，這裡是第二層保護，不靠單一地方沒漏接）。
    jump() { if (jumping === 0 && isManualControlEnabled(mode)) verticalSpeed = 5.5; },
    // #3780 P0-2：playIntro 是「一上岸、開場鏡頭飛到主角面前」那一刻——跟
    // 出生時同一個仰角（spawnPoint.pitch），不是寫死的 -0.05。
    // #3794：開場這段鏡頭飛行本身借用第一人稱的運鏡公式（見 animate() 裡
    // `mode === 'first'` 分支的 `intro < 1` 那段），玩家這時完全沒有輸入
    // 控制權（`introPlaying` 鎖住所有移動），用完即丟——真正會动的只有
    // 鏡頭本身，不是角色位置，所以沿用第一人稱分支的程式碼安全；動畫播完
    // 那一刻（`introStart = -1` 處）會切回 'god'，交還控制權時已經是正確
    // 的上帝視角鏡頭，不會卡在第一人稱公式裡。
    playIntro() { introStart = elapsed; mode = 'first'; pitch = spawnPoint.pitch; },
    getPosition() { return { x: player.position.x, z: player.position.z }; },
    dispose() {
      cancelAnimationFrame(frame);
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('keyup', keyup);
      window.removeEventListener('resize', resize);
      renderer.domElement.removeEventListener('pointerdown', pointerdown);
      renderer.domElement.removeEventListener('pointermove', pointermove);
      renderer.domElement.removeEventListener('pointerup', pointerup);
      // 整棟建築改成每塊網格各自 clone 材質之後（見 islandBuildingShapes.ts
      // 的 buildStationGroup），一個 session 建立的 THREE.Material 實例從
      // 「全島共用約 10 個」變成「每棟建築各自 9.5 個，一個 12-16 站的
      // session 約 115-150 個」——`renderer.dispose()` 不會自動釋放使用者
      // 自建的材質（它只清掉自己內部的 program cache/render list），這些
      // clone 不逐一 `.dispose()` 就會在每次離開/重進島頁時持續累積
      // GPU-side 的 shader program 資源。`disposeObjectTree`（純函式，見
      // islandBuildingShapes.ts）抽出來鎖測試，不是只憑眼睛看。
      disposeObjectTree(scene);
      renderer.dispose();
      container.removeChild(renderer.domElement);
    },
  };
}
