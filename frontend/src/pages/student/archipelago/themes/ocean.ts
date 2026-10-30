/**
 * themes/ocean.ts — 海島主題（預設）。
 *
 * 美術指導書全面重做（`docs/design/island-v2/art-direction.md`，
 * 2026-10-31，遊戲化學院 G4+G7 交付）：根因三個——①沒有「地面以下」的
 * 存在感 ②沒有大氣 ③沒有生命感。這版逐條對：不規則海岸線＋三層側壁
 * （§3）、漸層天空球＋動態霧＋rim light＋後製（§1/§2，後製在骨架層接）、
 * 五種連接材料＋會飄的旗子＋hover 回饋＋小景裡的迷你人物（§4/§5/§6/§8）。
 */
import * as THREE from 'three';
import type { ArchipelagoTheme, SceneCtx, CellInfo, LandmarkFactory, ConnectorMaterial } from './types';
import { unionBoundary, jitterBoundary, scaleBoundaryToward, extrudeBoundary } from './islandShape';
import { buildGradientSkyDome } from './gradientSky';
import { buildRadialGradientTexture } from './proceduralTextures';
import { buildBoardwalk, buildSteppingStones, buildRopeBridge, buildShoal, buildFerry, type ConnectorPalette } from './connectors';
import { buildFlag } from './flags';
import { buildHoverOutline, buildGrassClusters, buildRock, buildPathStones, buildMascot } from './decorations';
import { buildRisingParticles } from './portalParticles';

const PLAZA_RADIUS = 2.1;
/** Hover 亮邊外殼的顏色（美術指導書 §8，沿用 accent 金色，跟「金色=完成/
 *  強調」的語言一致）——`buildHoverOutline` 吃 number 色碼，色票存的是
 *  CSS 字串，這裡轉一次常數，不用每次呼叫都重算。 */
const HOVER_OUTLINE_COLOR = 0xe7c88a;

const STATUS_COLOR: Record<CellInfo['status'], number> = {
  occupied: 0x5fa06a,
  in_progress: 0x8bab7e,
  not_started: 0xb9b9ad,
};

const CONNECTOR_PALETTE: ConnectorPalette = {
  deck: 0x80634d,
  seam: 0x5a4433,
  rail: 0x6b5a44,
  stone: 0x9a9488,
  rope: 0x4a3f30,
  shoal: 0xd9c397,
  dock: 0x80634d,
  hull: 0x80634d,
};

function roofMaterialKeyFor(category: string): string {
  switch (category) {
    case '自然科學': return 'ocean-roof-science';
    case '寓言故事': return 'ocean-roof-fable';
    case '歷史人文': return 'ocean-roof-history';
    case '生活': return 'ocean-roof-daily';
    default: return 'ocean-roof-other';
  }
}

function roofMaterial(ctx: SceneCtx, category: string): THREE.Material {
  const colorByCategory: Record<string, number> = {
    自然科學: 0x6fa8c9, 寓言故事: 0x6b8e4e, 歷史人文: 0xa66d52, 生活: 0xcf9a5d,
  };
  const color = colorByCategory[category] ?? 0x9a8fae;
  const key = roofMaterialKeyFor(category);
  const roughness = category === '自然科學' ? 0.4 : 0.75;
  const metalness = category === '自然科學' ? 0.2 : 0;
  return ctx.material(key, () => new THREE.MeshStandardMaterial({ color, roughness, metalness }));
}

const sandMaterial = (ctx: SceneCtx) => ctx.material('ocean-sand', () => new THREE.MeshStandardMaterial({ color: 0xd9c397, roughness: 0.85 }));
const creamMaterial = (ctx: SceneCtx) => ctx.material('ocean-cream', () => new THREE.MeshStandardMaterial({ color: 0xf1dfb6, roughness: 0.8 }));
const woodMaterial = (ctx: SceneCtx) => ctx.material('ocean-wood', () => new THREE.MeshStandardMaterial({ color: 0x80634d, roughness: 0.85 }));
const goldMaterial = (ctx: SceneCtx) => ctx.material('ocean-gold', () => new THREE.MeshStandardMaterial({ color: 0xe7bb6b, roughness: 0.5, metalness: 0.2 }));

/**
 * 小景構圖（美術指導書 §4）——每個類別都偏心擺放地標＋加點綴，朝連接物
 * 方向偏移讓剪影先被看到；`cell.cellOffsets` 的平均偏移量當「連接物大概
 * 在哪個方向」的簡化近似（島的格子分布偏哪一側，路/連接物通常也在那
 * 一側）。全部類別都加一個迷你人物站在地標旁。
 */
function offsetDirectionFor(cell: CellInfo): { x: number; z: number } {
  if (cell.cellOffsets.length <= 1) return { x: 0.15, z: 0 };
  let x = 0;
  let z = 0;
  for (const o of cell.cellOffsets) { x += o.x; z += o.z; }
  const len = Math.hypot(x, z) || 1;
  return { x: (x / len) * 0.15, z: (z / len) * 0.15 };
}

const scienceLandmark: LandmarkFactory = (ctx, cell) => {
  const group = new THREE.Group();
  const roof = roofMaterial(ctx, cell.category);
  const dome = new THREE.Mesh(ctx.geometry('ocean-dome', () => new THREE.SphereGeometry(0.42, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2)), roof);
  dome.position.set(0, 0.7, 0);
  group.add(dome);
  const tower = new THREE.Mesh(ctx.geometry('ocean-dome-tower', () => new THREE.CylinderGeometry(0.28, 0.32, 0.55, 8)), sandMaterial(ctx));
  tower.position.set(0, 0.42, 0);
  group.add(tower);
  // 美術指導書 §4：「加一顆小型浮動儀器球，遠距離也能靠有東西在發光/浮動
  // 辨識出科學類」（兩套主題統一都加）。
  const orb = new THREE.Mesh(
    ctx.geometry('ocean-science-orb-geo', () => new THREE.SphereGeometry(0.1, 8, 6)),
    ctx.material('ocean-science-orb-mat', () => new THREE.MeshStandardMaterial({ color: 0xcdeaff, roughness: 0.15, metalness: 0.3, emissive: 0x335577, emissiveIntensity: 0.3 })),
  );
  orb.position.set(0, 1.15, 0);
  group.add(orb);
  const dir = offsetDirectionFor(cell);
  group.position.set(dir.x, 0, dir.z);
  return group;
};

const fableLandmark: LandmarkFactory = (ctx, cell) => {
  const group = new THREE.Group();
  const roof = roofMaterial(ctx, cell.category);
  const trunk = new THREE.Mesh(ctx.geometry('ocean-tree-trunk', () => new THREE.CylinderGeometry(0.14, 0.18, 0.6, 6)), woodMaterial(ctx));
  trunk.position.set(0, 0.6, 0);
  group.add(trunk);
  const leaves = new THREE.Mesh(ctx.geometry('ocean-tree-leaves', () => new THREE.ConeGeometry(0.48, 0.7, 7)), roof);
  leaves.position.set(0, 1.1, 0);
  group.add(leaves);
  // 美術指導書 §4：「一棵孤樹→一小片林」，加 2 棵縮小樹苗圍繞。
  for (const [sx, sz, scale] of [[0.32, 0.18, 0.5], [-0.28, 0.26, 0.7]] as const) {
    const sapling = new THREE.Group();
    const sTrunk = new THREE.Mesh(ctx.geometry('ocean-sapling-trunk', () => new THREE.CylinderGeometry(0.06, 0.08, 0.3, 6)), woodMaterial(ctx));
    sTrunk.position.y = 0.15;
    sapling.add(sTrunk);
    const sLeaves = new THREE.Mesh(ctx.geometry('ocean-sapling-leaves', () => new THREE.ConeGeometry(0.22, 0.32, 6)), roof);
    sLeaves.position.y = 0.42;
    sapling.add(sLeaves);
    sapling.scale.setScalar(scale);
    sapling.position.set(sx, 0, sz);
    group.add(sapling);
  }
  const dir = offsetDirectionFor(cell);
  group.position.set(dir.x, 0, dir.z);
  return group;
};

const historyLandmark: LandmarkFactory = (ctx, cell) => {
  const group = new THREE.Group();
  const roof = roofMaterial(ctx, cell.category);
  const sand = sandMaterial(ctx);
  const wood = woodMaterial(ctx);
  const platform = new THREE.Mesh(ctx.geometry('ocean-pavilion-platform', () => new THREE.BoxGeometry(0.7, 0.14, 0.7)), sand);
  platform.position.set(0, 0.42, 0);
  group.add(platform);
  for (const [px, pz] of [[-0.28, -0.28], [0.28, -0.28], [-0.28, 0.28], [0.28, 0.28]] as const) {
    const pillar = new THREE.Mesh(ctx.geometry('ocean-pavilion-pillar', () => new THREE.CylinderGeometry(0.05, 0.05, 0.4, 6)), wood);
    pillar.position.set(px, 0.62, pz);
    group.add(pillar);
  }
  const roofMesh = new THREE.Mesh(ctx.geometry('ocean-pavilion-roof', () => new THREE.ConeGeometry(0.55, 0.3, 4)), roof);
  roofMesh.position.set(0, 0.95, 0);
  roofMesh.rotation.y = Math.PI / 4;
  group.add(roofMesh);
  // 美術指導書 §4：「面向連接物的一側加兩級石階，暗示這裡有正式的入口」。
  const dir = offsetDirectionFor(cell);
  for (let i = 0; i < 2; i++) {
    const step = new THREE.Mesh(ctx.geometry('ocean-pavilion-step', () => new THREE.BoxGeometry(0.3, 0.06, 0.12)), sand);
    step.position.set(dir.x * (3 + i), 0.35 - i * 0.06, dir.z * (3 + i) + 0.4 + i * 0.12);
    group.add(step);
  }
  group.position.set(dir.x, 0, dir.z);
  return group;
};

const defaultLandmark: LandmarkFactory = (ctx, cell) => {
  const group = new THREE.Group();
  const roof = roofMaterial(ctx, cell.category);
  // 美術指導書 §1.1：生活/預設（屋）牆色改用 cream（跟 `islandBuildingShapes.ts`
  // 既有的 `cream` 常數同色），不是繼續用沙色——沙色留給地面/沙灘。
  const house = new THREE.Mesh(ctx.geometry('ocean-house-body', () => new THREE.BoxGeometry(0.55, 0.42, 0.5)), creamMaterial(ctx));
  house.position.set(0, 0.5, 0);
  group.add(house);
  const roofMesh = new THREE.Mesh(ctx.geometry('ocean-house-roof', () => new THREE.ConeGeometry(0.46, 0.4, 4)), roof);
  roofMesh.position.set(0, 0.92, 0);
  roofMesh.rotation.y = Math.PI / 4;
  group.add(roofMesh);
  // 美術指導書 §4：「加一條簡易曬衣繩或小籬笆，暗示有人住在這裡」。
  const fenceMat = woodMaterial(ctx);
  for (const fx of [-0.35, -0.12, 0.12, 0.35]) {
    const post = new THREE.Mesh(ctx.geometry('ocean-fence-post', () => new THREE.CylinderGeometry(0.02, 0.02, 0.16, 5)), fenceMat);
    post.position.set(fx, 0.37, 0.32);
    group.add(post);
  }
  const dir = offsetDirectionFor(cell);
  group.position.set(dir.x, 0, dir.z);
  return group;
};

export const oceanTheme: ArchipelagoTheme = {
  id: 'ocean',
  name: '海島',
  palette: {
    background: '#f7ecd0',
    fog: '#f3ead0',
    accent: '#e7c88a',
    occupied: '#5fa06a',
    inProgress: '#8bab7e',
    unexplored: '#b9b9ad',
  },
  lighting: {
    hemisphereSky: '#fff7dc',
    hemisphereGround: '#7a6a52',
    sunColor: '#ffe9c2',
    sunIntensity: 2.8,
    ambient: 1.8,
    sunDirection: [-22, 18, 24],
    rimColor: '#bfe0e8',
    rimIntensity: 0.4,
  },
  nameplate: {
    background: '#fffaf0',
    border: '#e4d9bd',
    text: '#3a2f22',
  },
  ground: (ctx) => {
    const group = new THREE.Group();
    group.add(buildGradientSkyDome(ctx, 'ocean', '#cde8ea', '#eaf1df', '#f7ecd0'));
    const seaTexture = buildRadialGradientTexture('#6cc3c9', '#1d5068', 512);
    const sea = new THREE.Mesh(
      ctx.geometry('ocean-sea-plane', () => new THREE.PlaneGeometry(400, 400)),
      ctx.material('ocean-sea', () => new THREE.MeshStandardMaterial({ map: seaTexture, metalness: 0.2, roughness: 0.32 })),
    );
    sea.rotation.x = -Math.PI / 2;
    sea.position.y = -1.6;
    group.add(sea);
    return group;
  },
  island: (ctx, cell) => {
    const group = new THREE.Group();
    const cellCenters = cell.cellOffsets;
    const baseBoundary = unionBoundary(cellCenters, cell.cellRadius * 0.68); // 0.68：既有 ISLAND_RADIUS/HEX_SIZE 的比例（1.3/3.6≈0.36 是舊版留白，這裡吃掉一半留白讓多格島填得更滿，仍保留跟鄰島的水道）
    const boundary = jitterBoundary(baseBoundary, cell.seed);

    // 三層側壁（美術指導書 §3.2）：草/狀態色頂層、壤土層、岩石層（底部收窄）。
    const geoKey = `${cell.seed}:${cellCenters.length}`;
    const topLayer = new THREE.Mesh(
      ctx.geometry(`ocean-wall-top-${geoKey}`, () => extrudeBoundary(boundary, 0.12)),
      ctx.material(`ocean-wall-top-${cell.status}`, () => new THREE.MeshStandardMaterial({ color: STATUS_COLOR[cell.status], roughness: 0.85, side: THREE.DoubleSide })),
    );
    topLayer.position.y = 0.52;
    group.add(topLayer);
    const soilBoundary = scaleBoundaryToward(boundary, 0.95);
    const soilLayer = new THREE.Mesh(
      ctx.geometry(`ocean-wall-soil-${geoKey}`, () => extrudeBoundary(soilBoundary, 0.22)),
      ctx.material('ocean-wall-soil', () => new THREE.MeshStandardMaterial({ color: 0x8a7355, roughness: 0.95, side: THREE.DoubleSide })),
    );
    soilLayer.position.y = 0.3;
    group.add(soilLayer);
    const rockBoundary = scaleBoundaryToward(boundary, 0.85);
    const rockLayer = new THREE.Mesh(
      ctx.geometry(`ocean-wall-rock-${geoKey}`, () => extrudeBoundary(rockBoundary, 0.3)),
      ctx.material('ocean-wall-rock', () => new THREE.MeshStandardMaterial({ color: 0x6b6a63, roughness: 1, side: THREE.DoubleSide })),
    );
    group.add(rockLayer);

    // 沙灘環（美術指導書 §3.3：拉寬到 18-22%，每座島 ±20% 隨機微調寬度）。
    const sandWidthFactor = 1.12 + (((cell.seed.charCodeAt(0) * 7) % 20) / 100 - 0.1) * 2;
    const sandOuter = scaleBoundaryToward(boundary, sandWidthFactor);
    const sandRim = new THREE.Mesh(
      ctx.geometry(`ocean-sand-rim-${geoKey}`, () => extrudeBoundary(sandOuter, 0.1)),
      sandMaterial(ctx),
    );
    sandRim.position.y = 0.42;
    group.add(sandRim);

    // 表面細節（美術指導書 §3.4）：草叢、石頭、石板路。
    const approxRadius = cell.cellRadius * 0.68;
    group.add(buildGrassClusters(ctx, 'ocean', cell.seed, approxRadius, 0x6f9b74, 2 + (cellCenters.length - 1)));
    group.add(buildRock(ctx, 'ocean', approxRadius, 0x6b6a63));
    group.add(buildPathStones(ctx, 'ocean', approxRadius, 0xd9c397, 0xb9ae92));

    const landmark = (oceanTheme.landmarks[cell.category] ?? oceanTheme.landmarks.default)(ctx, cell);
    group.add(landmark);

    // 迷你人物（美術指導書 §4：全部類別都加，對齊 learn4c 參考圖最關鍵的
    // 一條——每座建築旁都站著一隻小角色）。
    const mascot = buildMascot(ctx, 'ocean', 0xe8c99a, 0xcf9a5d);
    mascot.position.set(-approxRadius * 0.4, 0.5, -approxRadius * 0.3);
    group.add(mascot);

    // Hover 亮邊外殼（美術指導書 §8）——骨架靠 `userData.isHoverOutline`
    // 認得它，皮膚只負責建好、不用知道 hover 狀態存在。
    group.add(buildHoverOutline(ctx, `ocean-${geoKey}`, boundary, HOVER_OUTLINE_COLOR, 0.64));

    return group;
  },
  hub: (ctx) => {
    const group = new THREE.Group();
    const base = new THREE.Mesh(
      ctx.geometry('ocean-plaza-base', () => new THREE.CylinderGeometry(PLAZA_RADIUS, PLAZA_RADIUS * 0.88, 0.5, 6)),
      ctx.material('ocean-plaza', () => new THREE.MeshStandardMaterial({ color: 0xe7c88a, roughness: 0.7, metalness: 0.1 })),
    );
    base.position.y = 0.25;
    base.castShadow = true;
    base.receiveShadow = true;
    group.add(base);
    // 美術指導書 §9：中央傳送門廣場要有垂直存在感——複用單課島港口燈塔
    // 的剪影語言（柱體+錐頂+光束），高度明顯高於任何建築島。
    const towerMat = sandMaterial(ctx);
    const tower = new THREE.Mesh(ctx.geometry('ocean-plaza-tower', () => new THREE.CylinderGeometry(0.32, 0.42, 3.2, 10)), towerMat);
    tower.position.y = 2.1;
    group.add(tower);
    const roofCone = new THREE.Mesh(ctx.geometry('ocean-plaza-tower-roof', () => new THREE.ConeGeometry(0.5, 0.7, 10)), goldMaterial(ctx));
    roofCone.position.y = 4.05;
    group.add(roofCone);
    const beamMat = ctx.material('ocean-plaza-beam', () => new THREE.MeshBasicMaterial({ color: 0xffd98a, transparent: true, opacity: 0.25, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
    const beam = new THREE.Mesh(ctx.geometry('ocean-plaza-beam-geo', () => new THREE.CylinderGeometry(0.2, 0.35, 10, 16, 1, true)), beamMat);
    beam.position.y = 8;
    group.add(beam);
    group.add(buildRisingParticles(ctx, 'ocean-plaza', 0xffe9b0));
    return group;
  },
  portal: (ctx, target) => {
    const group = new THREE.Group();
    const portalFrame = ctx.material('ocean-portal-frame', () => new THREE.MeshStandardMaterial({ color: 0x8c6a4a, roughness: 0.7 }));
    const frameLeft = new THREE.Mesh(ctx.geometry('ocean-portal-pillar', () => new THREE.CylinderGeometry(0.05, 0.05, 1.2, 6)), portalFrame);
    frameLeft.position.set(-0.4, 0.85, 0);
    group.add(frameLeft);
    const frameRight = frameLeft.clone();
    frameRight.position.x = 0.4;
    group.add(frameRight);
    const frameTop = new THREE.Mesh(ctx.geometry('ocean-portal-top', () => new THREE.BoxGeometry(0.9, 0.08, 0.08)), portalFrame);
    frameTop.position.set(0, 1.4, 0);
    group.add(frameTop);
    // 美術指導書 §9：每座門依目標群主題色調上色，不要全部統一色——用
    // target key 的字元碼做決定性色相偏移（不需要知道對方群真正用哪個
    // 主題，只要「看起來跟別的門不一樣、能大致分辨」）。
    const hueShift = (target.key.charCodeAt(0) % 12) / 12;
    const glowColor = new THREE.Color().setHSL((0.12 + hueShift * 0.5) % 1, 0.55, 0.78);
    const glowPlane = new THREE.Mesh(
      ctx.geometry('ocean-portal-glow', () => new THREE.PlaneGeometry(0.72, 1.1)),
      ctx.material(`ocean-portal-glow-mat-${target.key}`, () => new THREE.MeshBasicMaterial({ color: glowColor, transparent: true, opacity: 0.55 })),
    );
    glowPlane.position.set(0, 0.85, 0);
    group.add(glowPlane);
    return group;
  },
  connector: (ctx, a, b, material: ConnectorMaterial) => {
    switch (material) {
      case 'boardwalk': return buildBoardwalk(ctx, 'ocean', a, b, CONNECTOR_PALETTE);
      case 'stepping-stones': return buildSteppingStones(ctx, 'ocean', a, b, CONNECTOR_PALETTE);
      case 'rope-bridge': return buildRopeBridge(ctx, 'ocean', a, b, CONNECTOR_PALETTE);
      case 'shoal': return buildShoal(ctx, 'ocean', a, b, CONNECTOR_PALETTE, buildRadialGradientTexture('#ffffff', '#ffffff00', 64));
      case 'ferry': return buildFerry(ctx, 'ocean', a, b, CONNECTOR_PALETTE);
      default: return buildBoardwalk(ctx, 'ocean', a, b, CONNECTOR_PALETTE);
    }
  },
  landmarks: {
    自然科學: scienceLandmark,
    寓言故事: fableLandmark,
    歷史人文: historyLandmark,
    default: defaultLandmark,
  },
  statusLook: {
    occupied: (obj, ctx) => {
      const flag = buildFlag(ctx, 'ocean', { x: 0.55, y: 0.78, z: 0.3 }, {
        pole: 0x80634d,
        cloth: 0xd9524a,
        clothEmissive: 0xd9524a,
        clothEmissiveIntensity: 0.15,
        edge: 0xe7bb6b,
        glow: 0xffe9b0,
      });
      obj.add(flag);
    },
    // 美術指導書 §0：「探索中狀態是空函式，三態裡有一態視覺上等於不存在」
    // ——補一個進度環（淡色圓環貼在島面上），不是繼續留空。
    in_progress: (obj, ctx) => {
      const ring = new THREE.Mesh(
        ctx.geometry('ocean-progress-ring', () => new THREE.TorusGeometry(0.5, 0.04, 8, 20)),
        ctx.material('ocean-progress-ring-mat', () => new THREE.MeshStandardMaterial({ color: 0xe7bb6b, roughness: 0.5, metalness: 0.2 })),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.66;
      obj.add(ring);
    },
    not_started: (obj, ctx) => {
      const fog = new THREE.Mesh(
        ctx.geometry('ocean-fog', () => new THREE.CylinderGeometry(1.1, 1.1, 0.5, 6)),
        ctx.material('ocean-fog-mat', () => new THREE.MeshBasicMaterial({ color: 0xdfe6e6, transparent: true, opacity: 0.45 })),
      );
      fog.position.y = 0.7;
      obj.add(fog);
    },
  },
  transition: { color: '#ffffff', durationMs: 600 },
};
