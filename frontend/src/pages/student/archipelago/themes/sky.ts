/**
 * themes/sky.ts — 天空島主題（PRD §8.5「本輪交付」第二個主題：
 * 「天空島最接近現有素材（浮空島＋雲海），用來證明『換皮不動骨架』真的
 * 成立」）。
 *
 * 跟 `ocean.ts` 共用同一套骨架介面（`ArchipelagoTheme`），視覺上刻意
 * 做出看得出差異的東西：雲海取代海面、浮空岩取代沙灘小島（不規則多面體
 * 而不是圓柱）、星門取代木框門、光束取代木棧橋——不是把海島換個顏色
 * 交差了事。
 */
import * as THREE from 'three';
import type { ArchipelagoTheme, SceneCtx, CellInfo, LandmarkFactory } from './types';

const ISLAND_RADIUS = 1.3;
const PLAZA_RADIUS = 2.1;

const STATUS_COLOR: Record<CellInfo['status'], number> = {
  occupied: 0xd9a8ea,
  in_progress: 0xaebde0,
  not_started: 0x8c92a8,
};

function roofColor(category: string): number {
  const byCategory: Record<string, number> = {
    自然科學: 0x7ec8e3, 寓言故事: 0x8fd6a0, 歷史人文: 0xc9a0dc, 生活: 0xe3c17e,
  };
  return byCategory[category] ?? 0xb0a8d6;
}

const rockMaterial = (ctx: SceneCtx) => ctx.material('sky-rock', () => new THREE.MeshStandardMaterial({ color: 0xb9aed1, roughness: 0.9 }));
const crystalMaterial = (ctx: SceneCtx) => ctx.material('sky-crystal', () => new THREE.MeshStandardMaterial({ color: 0xcdeaff, roughness: 0.15, metalness: 0.3, emissive: 0x335577, emissiveIntensity: 0.3 }));

/** 浮空岩上的依類別地標——跟海島主題同一組類別，造型換成天空意象
 *  （水晶觀測塔／漂浮書本與星塵／拱橋殘跡／木屋換成帳篷）。 */
const scienceLandmark: LandmarkFactory = (ctx, cell) => {
  const group = new THREE.Group();
  const spire = new THREE.Mesh(
    ctx.geometry('sky-spire', () => new THREE.ConeGeometry(0.22, 0.7, 6)),
    ctx.material('sky-roof-science', () => new THREE.MeshStandardMaterial({ color: roofColor(cell.category), roughness: 0.3, metalness: 0.2 })),
  );
  spire.position.set(0, 0.85, 0);
  group.add(spire);
  const orb = new THREE.Mesh(ctx.geometry('sky-orb', () => new THREE.SphereGeometry(0.16, 8, 6)), crystalMaterial(ctx));
  orb.position.set(0, 1.35, 0);
  group.add(orb);
  return group;
};

const fableLandmark: LandmarkFactory = (ctx, cell) => {
  const group = new THREE.Group();
  const trunk = new THREE.Mesh(
    ctx.geometry('sky-tree-trunk', () => new THREE.CylinderGeometry(0.12, 0.16, 0.55, 6)),
    rockMaterial(ctx),
  );
  trunk.position.set(0, 0.57, 0);
  group.add(trunk);
  const leaves = new THREE.Mesh(
    ctx.geometry('sky-tree-leaves', () => new THREE.IcosahedronGeometry(0.4, 0)),
    ctx.material('sky-roof-fable', () => new THREE.MeshStandardMaterial({ color: roofColor(cell.category), roughness: 0.6 })),
  );
  leaves.position.set(0, 1.05, 0);
  group.add(leaves);
  return group;
};

const historyLandmark: LandmarkFactory = (ctx, cell) => {
  const group = new THREE.Group();
  const rock = rockMaterial(ctx);
  const arch1 = new THREE.Mesh(ctx.geometry('sky-arch-pillar', () => new THREE.CylinderGeometry(0.06, 0.08, 0.6, 6)), rock);
  arch1.position.set(-0.26, 0.6, 0);
  group.add(arch1);
  const arch2 = arch1.clone();
  arch2.position.x = 0.26;
  group.add(arch2);
  const archTop = new THREE.Mesh(
    ctx.geometry('sky-arch-top', () => new THREE.TorusGeometry(0.3, 0.05, 6, 10, Math.PI)),
    ctx.material('sky-roof-history', () => new THREE.MeshStandardMaterial({ color: roofColor(cell.category), roughness: 0.5 })),
  );
  archTop.position.set(0, 0.9, 0);
  group.add(archTop);
  return group;
};

const defaultLandmark: LandmarkFactory = (ctx, cell) => {
  const group = new THREE.Group();
  const tent = new THREE.Mesh(
    ctx.geometry('sky-tent', () => new THREE.ConeGeometry(0.38, 0.6, 4)),
    ctx.material('sky-roof-other', () => new THREE.MeshStandardMaterial({ color: roofColor(cell.category), roughness: 0.6 })),
  );
  tent.position.set(0, 0.62, 0);
  tent.rotation.y = Math.PI / 4;
  group.add(tent);
  return group;
};

export const skyTheme: ArchipelagoTheme = {
  id: 'sky',
  name: '天空島',
  palette: {
    background: '#cfe3f7',
    fog: '#dfe9f9',
    accent: '#b9aed1',
    occupied: '#d9a8ea',
    inProgress: '#aebde0',
    unexplored: '#8c92a8',
  },
  lighting: {
    hemisphereSky: '#ffffff',
    hemisphereGround: '#8899bb',
    sunColor: '#fff6e0',
    sunIntensity: 2.4,
    ambient: 2.6,
    sunDirection: [10, 34, -16],
  },
  ground: (ctx) => {
    // 雲海——跟海島主題的海面同一個尺寸角色，換成淡紫白的半透明平面＋
    // 低多邊形雲朵點綴，不是重新打 API 或改分群結果（PRD §8.5「換主題時
    // 不重打 API」），純粹是視覺換皮。
    const group = new THREE.Group();
    const cloudSea = new THREE.Mesh(
      ctx.geometry('sky-cloudsea-plane', () => new THREE.PlaneGeometry(400, 400)),
      ctx.material('sky-cloudsea', () => new THREE.MeshStandardMaterial({ color: 0xeaf0fb, roughness: 0.95, transparent: true, opacity: 0.92 })),
    );
    cloudSea.rotation.x = -Math.PI / 2;
    cloudSea.position.y = -1.6;
    group.add(cloudSea);
    const puffMaterial = ctx.material('sky-cloud-puff', () => new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, transparent: true, opacity: 0.85 }));
    const puffGeometry = ctx.geometry('sky-cloud-puff-geo', () => new THREE.SphereGeometry(2.2, 8, 6));
    for (let i = 0; i < 10; i++) {
      const puff = new THREE.Mesh(puffGeometry, puffMaterial);
      const angle = (i / 10) * Math.PI * 2;
      puff.position.set(Math.cos(angle) * 36, -1, Math.sin(angle) * 36);
      puff.scale.set(1, 0.3, 1);
      group.add(puff);
    }
    return group;
  },
  island: (ctx, cell) => {
    const group = new THREE.Group();
    // 浮空岩——不規則多面體而不是圓柱，一眼跟海島的沙灘小島不一樣。
    const base = new THREE.Mesh(
      ctx.geometry('sky-island-base', () => new THREE.DodecahedronGeometry(ISLAND_RADIUS * 0.82, 0)),
      ctx.material(`sky-island-base-${cell.status}`, () => new THREE.MeshStandardMaterial({ color: STATUS_COLOR[cell.status], roughness: 0.8 })),
    );
    base.position.y = 0.3;
    base.scale.y = 0.55; // 壓扁成浮空岩塊而不是圓球
    group.add(base);
    const grassTop = new THREE.Mesh(
      ctx.geometry('sky-grass-top', () => new THREE.CylinderGeometry(ISLAND_RADIUS * 0.78, ISLAND_RADIUS * 0.7, 0.14, 7)),
      ctx.material('sky-grass', () => new THREE.MeshStandardMaterial({ color: 0x9fd6a8, roughness: 0.85 })),
    );
    grassTop.position.y = 0.5;
    group.add(grassTop);
    const landmark = (skyTheme.landmarks[cell.category] ?? skyTheme.landmarks.default)(ctx, cell);
    group.add(landmark);
    return group;
  },
  hub: (ctx) => {
    const base = new THREE.Mesh(
      ctx.geometry('sky-plaza-base', () => new THREE.CylinderGeometry(PLAZA_RADIUS, PLAZA_RADIUS * 0.9, 0.4, 8)),
      ctx.material('sky-plaza', () => new THREE.MeshStandardMaterial({ color: 0xd8cdf0, roughness: 0.5, metalness: 0.15 })),
    );
    base.position.y = 0.2;
    base.castShadow = true;
    base.receiveShadow = true;
    return base;
  },
  portal: (ctx) => {
    // 星門——發光圓環，不是海島的木框門。
    const group = new THREE.Group();
    const ring = new THREE.Mesh(
      ctx.geometry('sky-portal-ring', () => new THREE.TorusGeometry(0.55, 0.07, 8, 20)),
      ctx.material('sky-portal-ring-mat', () => new THREE.MeshStandardMaterial({ color: 0xe6d8ff, emissive: 0x8866cc, emissiveIntensity: 0.6, roughness: 0.3 })),
    );
    ring.position.y = 0.85;
    group.add(ring);
    const glowDisc = new THREE.Mesh(
      ctx.geometry('sky-portal-glow', () => new THREE.CircleGeometry(0.48, 20)),
      ctx.material('sky-portal-glow-mat', () => new THREE.MeshBasicMaterial({ color: 0xcfe0ff, transparent: true, opacity: 0.5 })),
    );
    glowDisc.position.y = 0.85;
    group.add(glowDisc);
    return group;
  },
  connector: (ctx, a, b) => {
    // 光束——取代海島的木棧橋，更輕盈、符合天空意象。
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const length = Math.hypot(dx, dz);
    const beam = new THREE.Mesh(
      ctx.geometry('sky-beam', () => new THREE.BoxGeometry(1, 0.04, 0.18)),
      ctx.material('sky-beam-mat', () => new THREE.MeshBasicMaterial({ color: 0xcfe0ff, transparent: true, opacity: 0.6 })),
    );
    beam.scale.x = length;
    beam.position.set((a.x + b.x) / 2, 0.35, (a.z + b.z) / 2);
    beam.rotation.y = -Math.atan2(dz, dx);
    return beam;
  },
  landmarks: {
    自然科學: scienceLandmark,
    寓言故事: fableLandmark,
    歷史人文: historyLandmark,
    default: defaultLandmark,
  },
  statusLook: {
    occupied: (obj, ctx) => {
      const sparkle = new THREE.PointLight(0xe6d8ff, 1, 2.4);
      sparkle.position.set(0, 1, 0);
      obj.add(sparkle);
      const banner = new THREE.Mesh(
        ctx.geometry('sky-banner', () => new THREE.PlaneGeometry(0.2, 0.3)),
        ctx.material('sky-banner-mat', () => new THREE.MeshStandardMaterial({ color: 0xd9a8ea, emissive: 0x6633aa, emissiveIntensity: 0.4 })),
      );
      banner.position.set(0.5, 1.0, 0.25);
      obj.add(banner);
    },
    in_progress: () => {},
    not_started: (obj, ctx) => {
      const mist = new THREE.Mesh(
        ctx.geometry('sky-mist', () => new THREE.CylinderGeometry(ISLAND_RADIUS * 1.1, ISLAND_RADIUS * 1.1, 0.5, 8)),
        ctx.material('sky-mist-mat', () => new THREE.MeshBasicMaterial({ color: 0xc9bfe0, transparent: true, opacity: 0.4 })),
      );
      mist.position.y = 0.6;
      obj.add(mist);
    },
  },
  transition: { color: '#e9e3ff', durationMs: 600 },
};
