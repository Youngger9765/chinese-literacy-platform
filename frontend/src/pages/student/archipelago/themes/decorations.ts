/**
 * themes/decorations.ts — 小景細節共用建構（美術指導書 §3.4 表面細節、
 * §4 小景構圖裡提到的「迷你人物/訪客造型」、§8 hover 亮邊外殼）。兩個
 * 主題共用造型邏輯，顏色各自決定。
 */
import * as THREE from 'three';
import type { SceneCtx } from '../core/sceneCtx';
import { seededValue } from './seededRandom';
import { boundaryToShape, type Point2D } from './islandShape';

/**
 * Hover 亮邊外殼（美術指導書 §8：「俗稱反殼描邊法，島底加一層背面朝外、
 * 放大 1.04 倍的同色外殼，opacity 0→0.6 淡入」）——`userData.isHoverOutline`
 * 是骨架（`createArchipelagoWorld.ts`）認得的標記，骨架在 hover 時把這顆
 * 物件的 opacity 往上調，皮膚只需要建好它、不用知道 hover 狀態存在。
 */
export function buildHoverOutline(ctx: SceneCtx, keyPrefix: string, boundary: readonly Point2D[], color: number, height: number): THREE.Mesh {
  const scaled = boundary.map((p) => ({ x: p.x * 1.04, z: p.z * 1.04 }));
  const shape = boundaryToShape(scaled);
  const geometry = ctx.geometry(`${keyPrefix}-hover-outline-geo`, () => {
    const g = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false, steps: 1 });
    g.rotateX(-Math.PI / 2);
    return g;
  });
  const material = ctx.material(`${keyPrefix}-hover-outline-mat`, () => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, side: THREE.BackSide, depthWrite: false }));
  const mesh = new THREE.Mesh(geometry, material);
  mesh.userData.isHoverOutline = true;
  return mesh;
}

/** 2~4 叢草——小型錐體，用種子散佈在島面上（美術指導書 §3.4）。 */
export function buildGrassClusters(ctx: SceneCtx, keyPrefix: string, seed: string, radius: number, color: number, count = 3): THREE.Group {
  const group = new THREE.Group();
  const mat = ctx.material(`${keyPrefix}-grass-cluster`, () => new THREE.MeshStandardMaterial({ color, roughness: 0.85 }));
  const geo = ctx.geometry(`${keyPrefix}-grass-cluster-geo`, () => new THREE.ConeGeometry(0.05, 0.16, 5));
  for (let i = 0; i < count; i++) {
    const angle = seededValue(`${seed}:grass:${i}:angle`) * Math.PI * 2;
    const dist = radius * (0.35 + seededValue(`${seed}:grass:${i}:dist`) * 0.4);
    const tuft = new THREE.Mesh(geo, mat);
    tuft.position.set(Math.cos(angle) * dist, 0.5, Math.sin(angle) * dist);
    tuft.rotation.y = angle;
    group.add(tuft);
  }
  return group;
}

/** 1 顆石頭——低多邊形二十面體，固定偏移在遠離地標的一側（美術指導書
 *  §3.4：「打破空盤子感」）。 */
export function buildRock(ctx: SceneCtx, keyPrefix: string, radius: number, color: number): THREE.Mesh {
  const mat = ctx.material(`${keyPrefix}-rock-detail`, () => new THREE.MeshStandardMaterial({ color, roughness: 0.9 }));
  const geo = ctx.geometry(`${keyPrefix}-rock-detail-geo`, () => new THREE.IcosahedronGeometry(0.14, 0));
  const rock = new THREE.Mesh(geo, mat);
  rock.position.set(-radius * 0.5, 0.52, radius * 0.3);
  rock.rotation.set(0.3, 0.6, 0.1);
  return rock;
}

/** 一小段石板路——2-3 個墊腳石圓片，從連接物接岸處朝地標延伸（美術指導書
 *  §3.4：「讓島讀起來是個有路可走的地方」）。 */
export function buildPathStones(ctx: SceneCtx, keyPrefix: string, radius: number, sandColor: number, darkColor: number, count = 3): THREE.Group {
  const group = new THREE.Group();
  for (let i = 0; i < count; i++) {
    const t = (i + 1) / (count + 1);
    const color = i % 2 === 0 ? sandColor : darkColor;
    const mat = ctx.material(`${keyPrefix}-path-stone-${i % 2}`, () => new THREE.MeshStandardMaterial({ color, roughness: 0.85 }));
    const geo = ctx.geometry(`${keyPrefix}-path-stone-geo`, () => new THREE.CylinderGeometry(0.1, 0.1, 0.04, 8));
    const stone = new THREE.Mesh(geo, mat);
    stone.position.set(radius * 0.75 * (1 - t), 0.51, radius * 0.4 * (1 - t));
    group.add(stone);
  }
  return group;
}

/** 迷你人物／訪客造型——複用單課島既有的角色低多邊形語言（美術指導書
 *  §4：「不要為群島另外發明一套新角色風格」）。這裡不是真的 import 單課島
 *  的 sprite（那是 2D 貼圖角色，群島是真 3D 場景，直接貼 2D sprite 在
 *  45°俯角鏡頭下會穿模），改用同樣「圓潤低多邊形、一眼可愛」的語言做一個
 *  極簡 3D 版本：橢球身體＋球形頭＋兩個小耳朵，尺寸跟單課島角色相近
 *  （約 0.25-0.3 單位高）。 */
export function buildMascot(ctx: SceneCtx, keyPrefix: string, bodyColor: number, accentColor: number): THREE.Group {
  const group = new THREE.Group();
  const bodyMat = ctx.material(`${keyPrefix}-mascot-body`, () => new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.6 }));
  const body = new THREE.Mesh(ctx.geometry(`${keyPrefix}-mascot-body-geo`, () => new THREE.SphereGeometry(0.1, 10, 8)), bodyMat);
  body.scale.set(1, 1.15, 1);
  body.position.y = 0.1;
  group.add(body);
  const head = new THREE.Mesh(ctx.geometry(`${keyPrefix}-mascot-head-geo`, () => new THREE.SphereGeometry(0.07, 10, 8)), bodyMat);
  head.position.y = 0.23;
  group.add(head);
  const accentMat = ctx.material(`${keyPrefix}-mascot-accent`, () => new THREE.MeshStandardMaterial({ color: accentColor, roughness: 0.5 }));
  for (const side of [-1, 1]) {
    const ear = new THREE.Mesh(ctx.geometry(`${keyPrefix}-mascot-ear-geo`, () => new THREE.ConeGeometry(0.025, 0.06, 6)), accentMat);
    ear.position.set(side * 0.05, 0.3, 0);
    group.add(ear);
  }
  return group;
}
