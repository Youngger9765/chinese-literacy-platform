/**
 * 每一棟建築的幾何造型——#3780 P0-3 四度審查訂正（2026-10-27）抽出來的獨立
 * 模組，從 `createIslandWorld.ts` 的 `content.stops.forEach(...)` 搬過來，
 * 一個字元都沒改（同樣的 15 個 `step` 分支、同樣的座標/尺寸數字），只是
 * 讓它能在**不建立 renderer/container 的情況下**單獨呼叫——這樣才測得到
 * 「每種建築類型慶祝時至少有一塊網格的 emissive 真的被設定」這條規則，
 * 不用 mock 掉整個 three.js 世界。
 *
 * 真實 bug（team-lead/Young 2026-10-27 真瀏覽器截圖抓到）：原本慶祝時只
 * 加亮一個共用的 `windowMat`，但 15 種類型裡只有「港口燈塔」跟落到這裡
 * `else` 分支的「星空瞭望台」真的有網格引用它，其餘 13 種（幾乎全部
 * heavy tier）從頭到尾沒有任何一塊網格用到這個材質——不管把它的發光
 * 強度調多高，畫面上都沒有東西會變亮。這也是「已完成穩定發光」這個更早
 * 的功能對這 13 種類型一直沒有效果的同一個根因。
 *
 * 正解：`buildStationGroup()` 建好一棟建築之後，把它所有網格的材質都
 * **clone** 一份（不是沿用模組層級共用的 `cream`/`slate`/`copper`/`gold`
 * 參照——共用的話，調亮一棟會連帶調亮全島用同一份材質的其他建築）、
 * 蒐集成一個陣列回傳；呼叫端（`createIslandWorld.ts`）之後要「讓這一棟
 * 亮起來」，直接對這個陣列裡的每一塊材質設 emissive，不用管這棟建築內部
 * 實際用了哪些具名變數、也不用在乎它走的是哪個 `step` 分支。
 *
 * 每個材質槽額外記下建造當下的「原始 emissive」（`baseEmissiveHex`／
 * `baseEmissiveIntensity`）——不是每個材質原本都是暗的：`gold`／聚光閣
 * 的水晶材質本來就帶一點裝飾性的常態微光（跟「這一站有沒有完成」無關），
 * 不蒐集這個基準值的話，不發光狀態會把它們一併壓成全黑，裝飾光就丟了。
 * `applyBuildingGlow()` 沒有要發光時（`glow === null`）就是把每塊材質
 * 設回它自己這個基準，不是寫死成黑色。
 */
import * as THREE from 'three';

const material = (color: number, extra: Record<string, unknown> = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...extra });

export interface StationShapeStops {
  name: string;
  step: string;
}

export interface BuildingMaterialSlot {
  readonly material: THREE.MeshStandardMaterial;
  readonly baseEmissiveHex: number;
  readonly baseEmissiveIntensity: number;
}

export interface BuiltStationGroup {
  readonly root: THREE.Group;
  readonly halo: THREE.Mesh;
  readonly lighthouseBeam: THREE.Group | null;
  /** 這一棟真正用到的所有可發光材質（已 clone，不是共用參照）。 */
  readonly materials: BuildingMaterialSlot[];
}

/**
 * 把「要不要發光／多亮」套用到一棟建築蒐集到的所有材質上。`glow` 是
 * `islandCelebration.ts` 的 `resolveCelebrationGlow()` 算出來的結果——
 * 有值就是「這一刻要發光」，套用暖色＋算好的強度；`null` 代表「這一刻
 * 不該被完成/慶祝邏輯影響」，把每塊材質還原成它建造當下的基準值（見上面
 * `BuildingMaterialSlot` 的註解，這一步保住 `gold`／水晶材質自己的裝飾
 * 微光不被誤關掉）。純粹操作 three.js 材質物件，不含任何「該不該發光」
 * 的判斷——判斷邏輯全在 `islandCelebration.ts`，這裡只負責「寫進材質」，
 * 讓兩邊可以分開測試（判斷邏輯不碰 three.js，這裡不碰 three.js 以外的
 * 任何東西）。
 */
export function applyBuildingGlow(
  materials: readonly BuildingMaterialSlot[],
  glow: { emissiveHex: number; emissiveIntensity: number } | null,
): void {
  materials.forEach((slot) => {
    if (glow) {
      slot.material.emissive.setHex(glow.emissiveHex);
      slot.material.emissiveIntensity = glow.emissiveIntensity;
    } else {
      slot.material.emissive.setHex(slot.baseEmissiveHex);
      slot.material.emissiveIntensity = slot.baseEmissiveIntensity;
    }
  });
}

/**
 * 釋放一整棵 three.js 物件樹底下的 geometry／材質／sprite 貼圖——審查員
 * 2026-10-27 指出的缺口：整棟建築改成每塊網格各自 clone 材質之後，一個
 * 12-16 站的 session 會建立約 115-150 個獨立 `THREE.MeshStandardMaterial`，
 * `renderer.dispose()`（`createIslandWorld.ts` 的 `dispose()`）不會自動
 * 連帶釋放使用者自建的材質，不清掉就是每次離開/重進島頁累積一輪 GPU-side
 * shader program。
 *
 * 抽成純函式（不經過 renderer 也能呼叫）——原本這段邏輯直接寫在
 * `createIslandWorld.ts` 的 `scene.traverse(...)` 裡，要鎖「材質真的被
 * dispose」這件事，得先讓它能在測試裡對一棵用 `buildStationGroup()` 建出
 * 來的真實物件樹跑，不需要真的建立 WebGLRenderer。
 */
export function disposeObjectTree(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.geometry.dispose();
      if (Array.isArray(object.material)) object.material.forEach((mat) => mat.dispose());
      else object.material.dispose();
    }
    if (object instanceof THREE.Sprite) {
      object.material.map?.dispose();
      object.material.dispose();
    }
  });
}

/**
 * 建一棟建築——`sandBase`（地基沙色平台共用這個材質是刻意的，地基本來就
 * 不需要參與慶祝發光，跟 `createIslandWorld.ts` 的既有行為一致）之外，
 * 每次呼叫都會建立**全新**的 `cream`/`slate`/`copper`/`gold`/`wood`/
 * `grass` 材質實例，不跟其他建築共用。
 */
export function buildStationGroup(stop: StationShapeStops, sandBase: THREE.Material): BuiltStationGroup {
  const cream = material(0xf1dfb6);
  const slate = material(0x4b6173);
  const copper = material(0xa66d52);
  const gold = material(0xe7bb6b, { emissive: 0xc98626, emissiveIntensity: 0.12 });
  const wood = material(0x80634d);
  const grass = material(0x769b79);

  const root = new THREE.Group();

  const add = (parent: THREE.Object3D, geometry: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) => {
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };
  const box = (parent: THREE.Object3D, w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0) =>
    add(parent, new THREE.BoxGeometry(w, h, d), mat, x, y, z);
  const cylinder = (parent: THREE.Object3D, top: number, bottom: number, h: number, mat: THREE.Material, x = 0, y = 0, z = 0, sides = 10) =>
    add(parent, new THREE.CylinderGeometry(top, bottom, h, sides), mat, x, y, z);
  const cone = (parent: THREE.Object3D, r: number, h: number, mat: THREE.Material, x = 0, y = 0, z = 0) =>
    add(parent, new THREE.ConeGeometry(r, h, 7), mat, x, y, z);

  const halo = new THREE.Mesh(new THREE.TorusGeometry(2.1, 0.09, 8, 48), new THREE.MeshBasicMaterial({ color: 0xffe2a0, transparent: true, opacity: 0, depthWrite: false }));
  halo.rotation.x = Math.PI / 2;
  halo.position.y = 0.25;
  root.add(halo);
  cylinder(root, 1.65, 1.8, 0.2, sandBase, 0, 0.06);
  const windowMat = material(0x69858a, { emissive: 0xffd277, emissiveIntensity: 0 });

  let lighthouseBeam: THREE.Group | null = null;

  if (stop.step === 'lesson-intro') {
    cylinder(root, 0.72, 1.16, 4.9, cream, 0, 2.55);
    cylinder(root, 1.05, 1.05, 0.3, copper, 0, 5.05);
    cylinder(root, 0.95, 0.95, 1.05, windowMat, 0, 5.63);
    // 燈塔光束：錐尖在燈室、開口朝外，繞塔順時針轉（從上往下看）
    const beamPivot = new THREE.Group();
    beamPivot.position.set(0, 5.63, 0);
    beamPivot.userData.lighthouseBeam = true;
    root.add(beamPivot);
    const beamGeo = new THREE.ConeGeometry(0.9, 7, 20, 1, true);
    beamGeo.translate(0, -3.5, 0);
    beamGeo.rotateZ(Math.PI / 2);
    const beamMesh = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: 0xfff1c2, transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
    beamPivot.add(beamMesh);
    lighthouseBeam = beamPivot;
    cone(root, 1.18, 1.05, slate, 0, 6.7);
    for (let j = 0; j < 4; j++) box(root, 0.18, 1.65, 0.18, copper, Math.cos(j * Math.PI / 2) * 0.75, 5.64, Math.sin(j * Math.PI / 2) * 0.75);
  } else if (stop.step === 'full-text-annotate') {
    for (let j = -2; j <= 2; j++) {
      cylinder(root, 0.15, 0.18, 3.1, cream, j * 0.72, 1.65);
      const scroll = cylinder(root, 0.34, 0.34, 2.5, j % 2 ? copper : gold, j * 0.72, 2.18, -0.55, 12);
      scroll.rotation.z = Math.PI / 2;
    }
    box(root, 4.1, 0.35, 2.2, slate, 0, 3.3);
    for (let j = -2; j <= 2; j++) box(root, 0.45, 0.26, 2.5, gold, j * 0.72, 3.55);
  } else if (stop.step === 'key-passage-reading') {
    for (let row = 0; row < 4; row++) {
      const arc = add(root, new THREE.TorusGeometry(1.25 + row * 0.34, 0.12, 5, 24, Math.PI), row % 2 ? copper : cream, 0, 0.22 + row * 0.42, -row * 0.22);
      arc.rotation.x = Math.PI / 2;
    }
    box(root, 1.4, 2.2, 0.3, slate, 0, 1.2, -1.6);
    add(root, new THREE.TorusGeometry(0.47, 0.12, 8, 18), gold, 0, 2.3, -1.36);
  } else if (stop.step === 'vocab-definition') {
    cylinder(root, 1.4, 1.6, 2, cream, 0, 1.1, 0, 8);
    for (let j = 0; j < 8; j++) {
      const a = j * Math.PI / 4;
      box(root, 0.18, 2.9, 0.16, copper, Math.sin(a) * 1.24, 1.55, Math.cos(a) * 1.24).rotation.y = a;
    }
    cone(root, 1.8, 1.6, slate, 0, 2.9);
    add(root, new THREE.TorusGeometry(0.42, 0.11, 8, 20), gold, 0, 2.25, 1.45);
  } else if (stop.step === 'vocab-application') {
    box(root, 3.3, 1.9, 2.2, cream, 0, 1.05);
    const roof = box(root, 3.8, 0.28, 2.7, copper, 0, 2.2);
    roof.rotation.z = -0.15;
    cylinder(root, 0.35, 0.4, 3.2, slate, 0.9, 3.15, -0.4);
    add(root, new THREE.TorusGeometry(0.45, 0.13, 8, 18), gold, -0.85, 2.8, 0.9);
    box(root, 1.1, 0.12, 0.65, wood, -0.6, 0.95, 1.5);
  } else if (stop.step === 'keypoints-table') {
    cylinder(root, 1.2, 1.6, 3.6, cream, 0, 1.9, 0, 6);
    cone(root, 1.5, 1.5, slate, 0, 4.45);
    for (let j = 0; j < 4; j++) box(root, 0.8, 0.12, 0.95, gold, Math.cos(j * Math.PI / 2) * 1.1, 2.35 + j * 0.25, Math.sin(j * Math.PI / 2) * 1.1).rotation.y = j * Math.PI / 2;
  } else if (stop.step === 'comprehension') {
    for (let j = -2; j <= 2; j++) cylinder(root, 0.17, 0.2, 3.2, cream, j * 0.7, 1.65, -0.5);
    box(root, 4, 0.35, 2.6, slate, 0, 3.38, -0.5);
    cone(root, 1.3, 1.9, gold, 0, 4.3, -0.5);
    for (let j = 0; j < 4; j++) cylinder(root, 0.23, 0.3, 0.7 + j * 0.15, copper, -1.2 + j * 0.8, 0.4, 1.25);
  } else if (stop.step === 'vocab-review') {
    for (let j = -2; j <= 2; j++) {
      cylinder(root, 0.09, 0.11, 1.4, wood, j * 0.73, 0.7);
      add(root, new THREE.IcosahedronGeometry(0.48, 1), j % 2 ? gold : material(0x9bbaa1), j * 0.73, 1.65);
    }
    add(root, new THREE.TorusGeometry(1.6, 0.1, 7, 18, Math.PI), cream, 0, 0.65, -0.9).rotation.x = Math.PI / 2;
  } else if (stop.step === 'knowledge-station') {
    cylinder(root, 0.5, 0.7, 3.5, wood, 0, 1.8);
    for (let j = 0; j < 3; j++) add(root, new THREE.IcosahedronGeometry(1.25, 1), grass, (j - 1) * 0.6, 3.4 + (j % 2) * 0.5);
    box(root, 2.5, 1.3, 1.8, cream, 0, 4.1);
    cone(root, 1.7, 1.2, copper, 0, 5.35);
    box(root, 0.22, 3.5, 0.22, wood, 1.25, 2.2, 0.9);
  } else if (stop.step === 'spotlight') {
    // 聚光閣：一座石塔，頂端是會發光的水晶燈籠（呼應「閱讀聚光燈」這個 step 的名字）
    cylinder(root, 0.55, 0.85, 3.6, slate, 0, 1.9, 0, 8);
    cylinder(root, 0.7, 0.7, 0.9, copper, 0, 3.85);
    add(root, new THREE.IcosahedronGeometry(0.62, 1), material(0x8fd9c4, { emissive: 0x3fae92, emissiveIntensity: 0.4 }), 0, 4.6);
    cone(root, 0.95, 0.9, gold, 0, 5.25);
  } else if (stop.step === 'classical-text') {
    // 原文閣：雙層攢尖頂的小閣樓，讀文言文原文的地方
    cylinder(root, 1.3, 1.6, 3, cream, 0, 1.6, 0, 8);
    cone(root, 1.9, 1.3, copper, 0, 3.6);
    cylinder(root, 0.45, 0.6, 1.4, slate, 0, 4.4, 0, 8);
    cone(root, 0.9, 1.0, gold, 0, 5.3);
  } else if (stop.step === 'classical-sentence-matching') {
    // 對句碑林：五座高低不一的石碑排成一列，找句子對應用的
    for (let j = -2; j <= 2; j++) {
      box(root, 0.5, 2.2 + Math.abs(j) * 0.3, 0.22, slate, j * 0.85, 1.1 + Math.abs(j) * 0.15);
      box(root, 0.58, 0.22, 0.3, cream, j * 0.85, 0.11);
    }
    add(root, new THREE.TorusGeometry(0.4, 0.1, 8, 16), gold, 0, 2.6, 0);
  } else if (stop.step === 'classical-word-matching') {
    // 字牌亭：四根柱子撐起一片平頂，前後各掛一塊牌匾
    box(root, 2.6, 0.18, 2.6, copper, 0, 2.6);
    [[-1.1, -1.1], [1.1, -1.1], [-1.1, 1.1], [1.1, 1.1]].forEach(([dx, dz]) => cylinder(root, 0.13, 0.15, 2.5, wood, dx, 1.3, dz));
    box(root, 0.5, 0.9, 0.08, gold, 0, 1.6, 1.3);
    box(root, 0.5, 0.9, 0.08, gold, 0, 1.6, -1.3);
  } else if (stop.step === 'classical-self-challenge') {
    // 挑戰擂台：圓形高台加四支旗桿，自我挑戰題用的
    cylinder(root, 2.1, 2.3, 0.6, slate, 0, 0.42, 0, 16);
    for (let j = 0; j < 4; j++) {
      const a = j * Math.PI / 2;
      cylinder(root, 0.08, 0.1, 2.6, wood, Math.sin(a) * 1.9, 1.5, Math.cos(a) * 1.9);
      box(root, 0.5, 0.7, 0.04, gold, Math.sin(a) * 1.9, 2.6, Math.cos(a) * 1.9).rotation.y = a;
    }
  } else {
    cylinder(root, 0.9, 1.25, 4.4, slate, 0, 2.3, 0, 8);
    cylinder(root, 1.75, 1.75, 0.22, cream, 0, 4.55);
    for (let j = 0; j < 8; j++) {
      const a = j * Math.PI / 4;
      cylinder(root, 0.1, 0.1, 0.85, gold, Math.sin(a) * 1.35, 5.05, Math.cos(a) * 1.35);
    }
    add(root, new THREE.IcosahedronGeometry(0.48, 1), windowMat, 0, 5.45);
  }

  const materials: BuildingMaterialSlot[] = [];
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    const applyClone = (mat: THREE.Material): THREE.Material => {
      if (!(mat instanceof THREE.MeshStandardMaterial)) return mat; // halo/光束用的材質沒有 emissive，跳過
      const cloned = mat.clone();
      materials.push({
        material: cloned,
        baseEmissiveHex: cloned.emissive.getHex(),
        baseEmissiveIntensity: cloned.emissiveIntensity,
      });
      return cloned;
    };
    obj.material = Array.isArray(obj.material) ? obj.material.map(applyClone) : applyClone(obj.material);
  });

  return { root, halo, lighthouseBeam, materials };
}

/** 全平台用過的 15 種 step type——跟 `islandTemplate.ts` 的
 * `STEP_BUILDING_META` 同一份清單，測試用這份跑過全部類型。 */
export const ALL_STATION_STEP_TYPES: readonly string[] = [
  'lesson-intro',
  'full-text-annotate',
  'key-passage-reading',
  'vocab-definition',
  'vocab-application',
  'keypoints-table',
  'comprehension',
  'vocab-review',
  'knowledge-station',
  'spotlight',
  'classical-text',
  'classical-sentence-matching',
  'classical-word-matching',
  'classical-self-challenge',
  'report',
];
