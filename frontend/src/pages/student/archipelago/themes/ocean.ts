/**
 * themes/ocean.ts — 海島主題（預設）。從 #3780 第一版
 * `createArchipelagoWorld.ts`（審查通過、已上線）的視覺原封不動搬過來，
 * 只是換個地方放——這是「拆完之後骨架真的長得跟拆之前一模一樣」的
 * 對照組，換主題不改體驗的保證就是靠這個基準。
 */
import * as THREE from 'three';
import type { ArchipelagoTheme, SceneCtx, CellInfo, LandmarkFactory } from './types';

const ISLAND_RADIUS = 1.3;
const PLAZA_RADIUS = 2.1;

const STATUS_COLOR: Record<CellInfo['status'], number> = {
  occupied: 0x5fa06a,
  in_progress: 0x8bab7e,
  not_started: 0xb9b9ad,
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
const woodMaterial = (ctx: SceneCtx) => ctx.material('ocean-wood', () => new THREE.MeshStandardMaterial({ color: 0x80634d, roughness: 0.85 }));

/** 依類別的小景——跟審查通過的第一版邏輯一致，低多邊形、求「一眼跟別類
 *  不一樣」，不追求寫實。 */
const scienceLandmark: LandmarkFactory = (ctx, cell) => {
  const group = new THREE.Group();
  const roof = roofMaterial(ctx, cell.category);
  const dome = new THREE.Mesh(ctx.geometry('ocean-dome', () => new THREE.SphereGeometry(0.42, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2)), roof);
  dome.position.set(0, 0.7, 0);
  group.add(dome);
  const tower = new THREE.Mesh(ctx.geometry('ocean-dome-tower', () => new THREE.CylinderGeometry(0.28, 0.32, 0.55, 8)), sandMaterial(ctx));
  tower.position.set(0, 0.42, 0);
  group.add(tower);
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
  return group;
};

const defaultLandmark: LandmarkFactory = (ctx, cell) => {
  const group = new THREE.Group();
  const roof = roofMaterial(ctx, cell.category);
  const sand = sandMaterial(ctx);
  const house = new THREE.Mesh(ctx.geometry('ocean-house-body', () => new THREE.BoxGeometry(0.55, 0.42, 0.5)), sand);
  house.position.set(0, 0.5, 0);
  group.add(house);
  const roofMesh = new THREE.Mesh(ctx.geometry('ocean-house-roof', () => new THREE.ConeGeometry(0.46, 0.4, 4)), roof);
  roofMesh.position.set(0, 0.92, 0);
  roofMesh.rotation.y = Math.PI / 4;
  group.add(roofMesh);
  return group;
};

export const oceanTheme: ArchipelagoTheme = {
  id: 'ocean',
  name: '海島',
  palette: {
    background: '#bbd6dc',
    fog: '#bbd6dc',
    accent: '#e7c88a',
    occupied: '#5fa06a',
    inProgress: '#8bab7e',
    unexplored: '#b9b9ad',
  },
  lighting: {
    hemisphereSky: '#fff7dc',
    hemisphereGround: '#60726e',
    sunColor: '#ffe7b9',
    sunIntensity: 2.6,
    ambient: 2.2,
    sunDirection: [-18, 30, 20],
  },
  ground: (ctx) => {
    const sea = new THREE.Mesh(
      ctx.geometry('ocean-sea-plane', () => new THREE.PlaneGeometry(400, 400)),
      ctx.material('ocean-sea', () => new THREE.MeshStandardMaterial({ color: 0x4596ac, metalness: 0.2, roughness: 0.32 })),
    );
    sea.rotation.x = -Math.PI / 2;
    sea.position.y = -1.6;
    return sea;
  },
  island: (ctx, cell) => {
    const group = new THREE.Group();
    const base = new THREE.Mesh(
      ctx.geometry('ocean-island-base', () => new THREE.CylinderGeometry(ISLAND_RADIUS, ISLAND_RADIUS * 0.82, 0.6, 6)),
      ctx.material(`ocean-island-base-${cell.status}`, () => new THREE.MeshStandardMaterial({ color: STATUS_COLOR[cell.status], roughness: 0.85 })),
    );
    base.position.y = 0.3;
    group.add(base);
    const sandRim = new THREE.Mesh(
      ctx.geometry('ocean-sand-rim', () => new THREE.CylinderGeometry(ISLAND_RADIUS * 1.04, ISLAND_RADIUS * 0.9, 0.18, 6)),
      sandMaterial(ctx),
    );
    sandRim.position.y = 0.05;
    group.add(sandRim);
    const landmark = (oceanTheme.landmarks[cell.category] ?? oceanTheme.landmarks.default)(ctx, cell);
    group.add(landmark);
    return group;
  },
  hub: (ctx) => {
    const base = new THREE.Mesh(
      ctx.geometry('ocean-plaza-base', () => new THREE.CylinderGeometry(PLAZA_RADIUS, PLAZA_RADIUS * 0.88, 0.5, 6)),
      ctx.material('ocean-plaza', () => new THREE.MeshStandardMaterial({ color: 0xe7c88a, roughness: 0.7, metalness: 0.1 })),
    );
    base.position.y = 0.25;
    base.castShadow = true;
    base.receiveShadow = true;
    return base;
  },
  portal: (ctx) => {
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
    const glowPlane = new THREE.Mesh(
      ctx.geometry('ocean-portal-glow', () => new THREE.PlaneGeometry(0.72, 1.1)),
      ctx.material('ocean-portal-glow-mat', () => new THREE.MeshBasicMaterial({ color: 0xfff3c4, transparent: true, opacity: 0.55 })),
    );
    glowPlane.position.set(0, 0.85, 0);
    group.add(glowPlane);
    return group;
  },
  connector: (ctx, a, b) => {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const length = Math.hypot(dx, dz);
    const bridge = new THREE.Mesh(ctx.geometry('ocean-bridge', () => new THREE.BoxGeometry(1, 0.08, 0.5)), woodMaterial(ctx));
    bridge.scale.x = length;
    bridge.position.set((a.x + b.x) / 2, 0.32, (a.z + b.z) / 2);
    bridge.rotation.y = -Math.atan2(dz, dx);
    return bridge;
  },
  landmarks: {
    自然科學: scienceLandmark,
    寓言故事: fableLandmark,
    歷史人文: historyLandmark,
    default: defaultLandmark,
  },
  statusLook: {
    occupied: (obj, ctx) => {
      const pole = new THREE.Mesh(ctx.geometry('ocean-flag-pole', () => new THREE.CylinderGeometry(0.02, 0.02, 0.7, 6)), woodMaterial(ctx));
      pole.position.set(0.55, 0.85, 0.3);
      obj.add(pole);
      const flag = new THREE.Mesh(
        ctx.geometry('ocean-flag', () => new THREE.PlaneGeometry(0.22, 0.14)),
        ctx.material('ocean-flag-mat', () => new THREE.MeshStandardMaterial({ color: 0xe0564c, roughness: 0.6 })),
      );
      flag.position.set(0.66, 1.12, 0.3);
      obj.add(flag);
      const glow = new THREE.PointLight(0xffe9b0, 0.8, 2.2);
      glow.position.set(0, 0.9, 0);
      obj.add(glow);
    },
    in_progress: () => {}, // 跟審查通過的第一版一致：探索中沒有額外長相變化
    not_started: (obj, ctx) => {
      const fog = new THREE.Mesh(
        ctx.geometry('ocean-fog', () => new THREE.CylinderGeometry(ISLAND_RADIUS * 1.1, ISLAND_RADIUS * 1.1, 0.5, 6)),
        ctx.material('ocean-fog-mat', () => new THREE.MeshBasicMaterial({ color: 0xdfe6e6, transparent: true, opacity: 0.45 })),
      );
      fog.position.y = 0.6;
      obj.add(fog);
    },
  },
  transition: { color: '#ffffff', durationMs: 600 },
};
