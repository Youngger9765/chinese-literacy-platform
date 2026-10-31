/**
 * themes/sky.ts — 天空島主題（PRD §8.5「本輪交付」第二個主題）。
 *
 * 美術指導書全面重做（`docs/design/island-v2/art-direction.md`，
 * 2026-10-31）——跟 `ocean.ts` 共用同一套骨架介面與共用視覺工具
 * （`islandShape.ts`/`connectors.ts`/`flags.ts`/`decorations.ts`/
 * `gradientSky.ts`/`portalParticles.ts`），色票與造型語言維持「浮空岩／
 * 水晶／星門／光束」跟海島刻意不同，證明「換皮不動骨架」真的成立。
 */
import * as THREE from 'three';
import type { ArchipelagoTheme, SceneCtx, CellInfo, LandmarkFactory, ConnectorMaterial } from './types';
import { unionBoundary, jitterBoundary, scaleBoundaryToward, extrudeBoundary } from './islandShape';
import { buildRadialGradientTexture, buildRadialFadeAlphaTexture } from './proceduralTextures';
import { requiredGroundRadius } from '../core/groundRadius';
import { buildBoardwalk, buildSteppingStones, buildRopeBridge, buildShoal, buildFerry, type ConnectorPalette } from './connectors';
import { buildFlag } from './flags';
import { buildHoverOutline, buildGrassClusters, buildRock, buildPathStones, buildMascot } from './decorations';
import { buildRisingParticles } from './portalParticles';
import { buildLandmarkFromStationShape } from './landmarkBuildings';

const PLAZA_RADIUS = 2.1;
const HOVER_OUTLINE_COLOR = 0xb9aed1;

const STATUS_COLOR: Record<CellInfo['status'], number> = {
  occupied: 0xd9a8ea,
  in_progress: 0xaebde0,
  not_started: 0x8c92a8,
};

const CONNECTOR_PALETTE: ConnectorPalette = {
  deck: 0xb9aed1,
  seam: 0x8f84ab,
  rail: 0xcdeaff,
  stone: 0xc5bbdf,
  rope: 0x8f84ab,
  shoal: 0xdfe9f9,
  dock: 0xb9aed1,
  hull: 0xb9aed1,
};

// 2026-10-31：roofColor 原本只給四個「柱子＋小物件」簡化版地標用——換成
// `buildLandmarkFromStationShape` 之後沒有任何呼叫端了，拿掉。

const rockMaterial = (ctx: SceneCtx) => ctx.material('sky-rock', () => new THREE.MeshStandardMaterial({ color: 0xb9aed1, roughness: 0.9 }));
const crystalMaterial = (ctx: SceneCtx) => ctx.material('sky-crystal', () => new THREE.MeshStandardMaterial({ color: 0xcdeaff, roughness: 0.15, metalness: 0.3, emissive: 0x335577, emissiveIntensity: 0.3 }));

function offsetDirectionFor(cell: CellInfo): { x: number; z: number } {
  const approxRadius = cell.cellRadius * 0.68;
  const offsetMagnitude = approxRadius * 0.15;
  if (cell.cellOffsets.length <= 1) return { x: offsetMagnitude, z: 0 };
  let x = 0;
  let z = 0;
  for (const o of cell.cellOffsets) { x += o.x; z += o.z; }
  const len = Math.hypot(x, z) || 1;
  return { x: (x / len) * offsetMagnitude, z: (z / len) * offsetMagnitude };
}

// 2026-10-31 team-lead 明令（跟 `ocean.ts` 同一輪訂正，兩個主題共用同一組
// 造型——`buildStationGroup` 本身的材質是寫死的，沒有分主題，天空島跟
// 海島的地標暫時會長一樣，但剪影/比例問題先解決，色調差異留給下一輪）：
// 「改成直接用單課島的 15 種建築造型，不要再用『柱子＋小物件』的簡化版」。
const STATION_SHAPE_BY_CATEGORY: Record<string, string> = {
  自然科學: 'spotlight',
  寓言故事: 'vocab-review',
  歷史人文: 'classical-text',
  default: 'vocab-application',
};

function buildCategoryLandmark(ctx: SceneCtx, cell: CellInfo): THREE.Group {
  const group = new THREE.Group();
  const approxRadius = cell.cellRadius * 0.68;
  const stepType = STATION_SHAPE_BY_CATEGORY[cell.category] ?? STATION_SHAPE_BY_CATEGORY.default;
  const building = buildLandmarkFromStationShape(ctx, stepType, approxRadius * 0.9, 'sky');
  group.add(building);
  if (cell.category !== '歷史人文') {
    const dir = offsetDirectionFor(cell);
    group.position.set(dir.x, 0, dir.z);
  }
  return group;
}

const scienceLandmark: LandmarkFactory = (ctx, cell) => buildCategoryLandmark(ctx, cell);
const fableLandmark: LandmarkFactory = (ctx, cell) => buildCategoryLandmark(ctx, cell);
const historyLandmark: LandmarkFactory = (ctx, cell) => buildCategoryLandmark(ctx, cell);
const defaultLandmark: LandmarkFactory = (ctx, cell) => buildCategoryLandmark(ctx, cell);

export const skyTheme: ArchipelagoTheme = {
  id: 'sky',
  name: '天空島',
  palette: {
    background: '#ffe9d6',
    fog: '#eef2fb',
    accent: '#b9aed1',
    occupied: '#d9a8ea',
    inProgress: '#aebde0',
    unexplored: '#8c92a8',
    // team-lead 2026-10-31 三次訂正：拿掉天空穹頂，CSS 漸層接手——頂色沿用
    // 原本穹頂最上緣的淺天藍（`#eaf2ff`），底色＝雲海色（跟下面雲海材質
    // `0xeaf0fb` 同一色，雲海跟地平線本該是同一個顏色）。
    skyTop: '#eaf2ff',
    horizon: '#eaf0fb',
  },
  lighting: {
    // 2026-10-31 team-lead：天空島暗部壓低以達 contrast≥60——通透夢幻的
    // 顏色保留在島面跟天空，暗部拉到側壁跟底層（半球光 2.2→1.6，主光強度
    // 維持不變）。這是 team-lead 直接定案的數值，不是我這邊再查依據推的。
    hemisphereSky: '#ffffff',
    hemisphereGround: '#a893a0',
    sunColor: '#fff6e0',
    sunIntensity: 2.4,
    ambient: 1.6,
    sunDirection: [14, 20, -18],
    rimColor: '#ffd9b0',
    rimIntensity: 0.5,
  },
  nameplate: {
    background: '#fffaf0',
    border: '#e4d9bd',
    text: '#3a2f22',
  },
  ground: (ctx, maxRadius) => {
    const group = new THREE.Group();
    // team-lead 2026-10-31 三次訂正：拿掉天空穹頂＋方形平面改圓形徑向
    // 淡出（跟 `ocean.ts` 同一輪、同一組理由——方形在背景看得到很硬的
    // 直線邊緣）。半徑放大到 6×maxRadius，外圈 30% 用
    // `buildRadialFadeAlphaTexture` 淡到全透明，融進 CSS 漸層背景，不再
    // 靠霧或穹頂硬撐。半徑改用 `requiredGroundRadius()`（2026-10-31 二次
    // 退回重做：固定 6×maxRadius 卡在理論門檻上，見 `ocean.ts` 同一處的
    // 完整說明，天空島同一個根因同一個修法）。
    const cloudSeaRadius = requiredGroundRadius(maxRadius);
    const cloudSea = new THREE.Mesh(
      ctx.geometry('sky-cloudsea-plane', () => new THREE.CircleGeometry(cloudSeaRadius, 96)),
      ctx.material('sky-cloudsea', () => new THREE.MeshStandardMaterial({
        color: 0xeaf0fb,
        roughness: 0.95,
        alphaMap: buildRadialFadeAlphaTexture(0.7, 512),
        transparent: true,
        opacity: 0.92,
      })),
    );
    cloudSea.rotation.x = -Math.PI / 2;
    cloudSea.position.y = -1.6;
    group.add(cloudSea);
    const brightMat = ctx.material('sky-cloud-puff-bright', () => new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, transparent: true, opacity: 0.85 }));
    const darkMat = ctx.material('sky-cloud-puff-dark', () => new THREE.MeshStandardMaterial({ color: 0xc7d3ea, roughness: 1, transparent: true, opacity: 0.85 }));
    const puffGeometry = ctx.geometry('sky-cloud-puff-geo', () => new THREE.SphereGeometry(2.2, 8, 6));
    const puffRingRadius = Math.max(10, maxRadius * 1.8);
    for (let i = 0; i < 10; i++) {
      // 美術指導書 §1.2：雲朵改兩階（亮面/暗面），不是純白球——半數用暗面
      // 材質疊在亮面下方，做出「有受光面」的感覺，零額外幾何成本。
      const angle = (i / 10) * Math.PI * 2;
      const bright = new THREE.Mesh(puffGeometry, brightMat);
      bright.position.set(Math.cos(angle) * puffRingRadius, -0.8, Math.sin(angle) * puffRingRadius);
      bright.scale.set(1, 0.3, 1);
      group.add(bright);
      const dark = new THREE.Mesh(puffGeometry, darkMat);
      dark.position.set(Math.cos(angle) * puffRingRadius, -1.3, Math.sin(angle) * puffRingRadius);
      dark.scale.set(0.9, 0.22, 0.9);
      group.add(dark);
    }
    return group;
  },
  island: (ctx, cell) => {
    const group = new THREE.Group();
    const cellCenters = cell.cellOffsets;
    const baseBoundary = unionBoundary(cellCenters, cell.cellRadius * 0.68);
    const boundary = jitterBoundary(baseBoundary, cell.seed);
    const geoKey = `${cell.seed}:${cellCenters.length}`;

    // 三層：草層換成浮空岩頂層（狀態色），中層／底層換「岩石斷層」語言
    // （美術指導書 §3.2：「天空島換成岩石斷層語言」）。
    const topLayer = new THREE.Mesh(
      ctx.geometry(`sky-wall-top-${geoKey}`, () => extrudeBoundary(boundary, 0.12)),
      ctx.material(`sky-wall-top-${cell.status}`, () => new THREE.MeshStandardMaterial({ color: STATUS_COLOR[cell.status], roughness: 0.8, side: THREE.DoubleSide })),
    );
    topLayer.position.y = 0.52;
    group.add(topLayer);
    // 2026-10-31 team-lead 定案：側壁兩層壓暗（土層 #8d7fb0、岩層 #5f5580，
    // 原本 #c5bbdf／#8f84ab）——通透夢幻感留在島面頂層跟天空，暗部收進側壁
    // 底層，目標是把 luminance.contrast 推過 60（見 skyTheme.lighting.ambient
    // 同一輪調整的註解）。
    const upperRockBoundary = scaleBoundaryToward(boundary, 0.95);
    const upperRock = new THREE.Mesh(
      ctx.geometry(`sky-wall-upper-rock-${geoKey}`, () => extrudeBoundary(upperRockBoundary, 0.22)),
      ctx.material('sky-wall-upper-rock', () => new THREE.MeshStandardMaterial({ color: 0x8d7fb0, roughness: 0.9, side: THREE.DoubleSide })),
    );
    upperRock.position.y = 0.3;
    group.add(upperRock);
    const lowerRockBoundary = scaleBoundaryToward(boundary, 0.85);
    const lowerRock = new THREE.Mesh(
      ctx.geometry(`sky-wall-lower-rock-${geoKey}`, () => extrudeBoundary(lowerRockBoundary, 0.3)),
      ctx.material('sky-wall-lower-rock', () => new THREE.MeshStandardMaterial({ color: 0x5f5580, roughness: 1, side: THREE.DoubleSide })),
    );
    group.add(lowerRock);

    const approxRadius = cell.cellRadius * 0.68;
    group.add(buildGrassClusters(ctx, 'sky', cell.seed, approxRadius, 0x9fd6a8, 2 + (cellCenters.length - 1)));
    group.add(buildRock(ctx, 'sky', approxRadius, 0xb9aed1));
    group.add(buildPathStones(ctx, 'sky', approxRadius, 0xdfe9f9, 0xc5bbdf));

    const landmark = (skyTheme.landmarks[cell.category] ?? skyTheme.landmarks.default)(ctx, cell);
    group.add(landmark);

    const mascot = buildMascot(ctx, 'sky', 0xd9c7ea, 0xaebde0);
    mascot.position.set(-approxRadius * 0.4, 0.5, -approxRadius * 0.3);
    group.add(mascot);

    group.add(buildHoverOutline(ctx, `sky-${geoKey}`, boundary, HOVER_OUTLINE_COLOR, 0.64));

    return group;
  },
  hub: (ctx) => {
    const group = new THREE.Group();
    const base = new THREE.Mesh(
      ctx.geometry('sky-plaza-base', () => new THREE.CylinderGeometry(PLAZA_RADIUS, PLAZA_RADIUS * 0.9, 0.4, 8)),
      ctx.material('sky-plaza', () => new THREE.MeshStandardMaterial({ color: 0xd8cdf0, roughness: 0.5, metalness: 0.15 })),
    );
    base.position.y = 0.2;
    base.castShadow = true;
    base.receiveShadow = true;
    group.add(base);
    const tower = new THREE.Mesh(ctx.geometry('sky-plaza-tower', () => new THREE.CylinderGeometry(0.3, 0.4, 3.2, 10)), rockMaterial(ctx));
    tower.position.y = 2;
    group.add(tower);
    const crystalTop = new THREE.Mesh(ctx.geometry('sky-plaza-tower-crystal', () => new THREE.OctahedronGeometry(0.5, 0)), crystalMaterial(ctx));
    crystalTop.position.y = 3.95;
    group.add(crystalTop);
    group.add(buildRisingParticles(ctx, 'sky-plaza', 0xcdeaff));
    return group;
  },
  portal: (ctx, target) => {
    const group = new THREE.Group();
    const hueShift = (target.key.charCodeAt(0) % 12) / 12;
    const ringColor = new THREE.Color().setHSL((0.7 + hueShift * 0.3) % 1, 0.4, 0.75);
    const ring = new THREE.Mesh(
      ctx.geometry('sky-portal-ring', () => new THREE.TorusGeometry(0.55, 0.07, 8, 20)),
      ctx.material(`sky-portal-ring-mat-${target.key}`, () => new THREE.MeshStandardMaterial({ color: ringColor, emissive: 0x8866cc, emissiveIntensity: 0.6, roughness: 0.3 })),
    );
    ring.position.y = 0.85;
    group.add(ring);
    const glowDisc = new THREE.Mesh(
      ctx.geometry('sky-portal-glow', () => new THREE.CircleGeometry(0.48, 20)),
      ctx.material(`sky-portal-glow-mat-${target.key}`, () => new THREE.MeshBasicMaterial({ color: ringColor, transparent: true, opacity: 0.5 })),
    );
    glowDisc.position.y = 0.85;
    group.add(glowDisc);
    return group;
  },
  connector: (ctx, a, b, material: ConnectorMaterial) => {
    switch (material) {
      case 'boardwalk': return buildBoardwalk(ctx, 'sky', a, b, CONNECTOR_PALETTE);
      case 'stepping-stones': return buildSteppingStones(ctx, 'sky', a, b, CONNECTOR_PALETTE);
      case 'rope-bridge': return buildRopeBridge(ctx, 'sky', a, b, CONNECTOR_PALETTE);
      case 'shoal': return buildShoal(ctx, 'sky', a, b, CONNECTOR_PALETTE, buildRadialGradientTexture('#ffffff', '#ffffff00', 64));
      case 'ferry': return buildFerry(ctx, 'sky', a, b, CONNECTOR_PALETTE);
      default: {
        // 天空島預設連接物維持既有的光束語言（不是棧橋）——輕盈、符合天空
        // 意象；五種材料字串裡只有 boardwalk 在這裡被光束取代，其餘四種
        // （跳石/吊橋/淺灘/渡口）天空島跟海島共用同一套造型（石頭/繩索/
        // 沙洲/船這些物件本身沒有「海島限定」的意義）。
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
      }
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
      const flag = buildFlag(ctx, 'sky', { x: 0.5, y: 0.7, z: 0.25 }, {
        pole: 0xb9aed1,
        cloth: 0xd9a8ea,
        clothEmissive: 0x6633aa,
        clothEmissiveIntensity: 0.4,
        edge: 0xcdeaff,
        glow: 0xe6d8ff,
      });
      obj.add(flag);
    },
    in_progress: (obj, ctx) => {
      const ring = new THREE.Mesh(
        ctx.geometry('sky-progress-ring', () => new THREE.TorusGeometry(0.5, 0.04, 8, 20)),
        ctx.material('sky-progress-ring-mat', () => new THREE.MeshStandardMaterial({ color: 0xcdeaff, emissive: 0x335577, emissiveIntensity: 0.3, roughness: 0.4 })),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.66;
      obj.add(ring);
    },
    not_started: (obj, ctx) => {
      const mist = new THREE.Mesh(
        ctx.geometry('sky-mist', () => new THREE.CylinderGeometry(1.1, 1.1, 0.5, 8)),
        ctx.material('sky-mist-mat', () => new THREE.MeshBasicMaterial({ color: 0xc9bfe0, transparent: true, opacity: 0.4 })),
      );
      mist.position.y = 0.7;
      obj.add(mist);
    },
  },
  transition: { color: '#e9e3ff', durationMs: 600 },
};
