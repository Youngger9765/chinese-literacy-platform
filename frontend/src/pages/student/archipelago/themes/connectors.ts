/**
 * themes/connectors.ts — 五種連接材料的共用幾何建構（美術指導書 §5：
 * 「木棧橋／石板跳石／吊橋／淺灘沙洲／小船渡口」）。兩個主題
 * （ocean/sky）共用同一套造型邏輯，只是顏色不同——造型是「這個材料字串
 * 該長什麼樣子」這個通用問題的答案，不是哪個主題特有的視覺語言，獨立
 * 成檔案讓兩邊都呼叫，不必各寫一次 TubeGeometry／CatmullRom 曲線數學。
 *
 * 統一走道寬度基準 0.4-0.5 單位（美術指導書 §5：「差異只在造型/材質，
 * 不在尺度，避免有的連接物看起來比別的更重要」）。
 */
import * as THREE from 'three';
import type { SceneCtx } from '../core/sceneCtx';

export interface ConnectorPalette {
  deck: number;
  seam: number;
  rail: number;
  stone: number;
  rope: number;
  shoal: number;
  dock: number;
  hull: number;
}

type Point = { x: number; z: number };

function lengthAndAngle(a: Point, b: Point): { length: number; angle: number; mid: Point } {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  return { length: Math.hypot(dx, dz), angle: -Math.atan2(dz, dx), mid: { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 } };
}

/** 木棧橋——既有預設，加接縫線＋矮欄杆柱（美術指導書：「現況是單一無接縫
 *  色塊，加接縫線是零幾何成本的最大改善」）。接縫用細長暗色窄條模擬，不是
 *  貼圖 decal（貼圖要多一張材質，窄條只多幾個小 mesh，在棧橋數量級下更
 *  便宜也更簡單）。 */
export function buildBoardwalk(ctx: SceneCtx, keyPrefix: string, a: Point, b: Point, palette: ConnectorPalette): THREE.Object3D {
  const { length, angle, mid } = lengthAndAngle(a, b);
  const group = new THREE.Group();
  const deckMat = ctx.material(`${keyPrefix}-boardwalk-deck`, () => new THREE.MeshStandardMaterial({ color: palette.deck, roughness: 0.85 }));
  const deck = new THREE.Mesh(ctx.geometry(`${keyPrefix}-boardwalk-deck-geo`, () => new THREE.BoxGeometry(1, 0.08, 0.46)), deckMat);
  deck.scale.x = length;
  group.add(deck);
  const seamMat = ctx.material(`${keyPrefix}-boardwalk-seam`, () => new THREE.MeshStandardMaterial({ color: palette.seam, roughness: 0.9 }));
  const seamCount = Math.max(2, Math.round(length));
  for (let i = 0; i < seamCount; i++) {
    const seam = new THREE.Mesh(ctx.geometry(`${keyPrefix}-boardwalk-seam-geo`, () => new THREE.BoxGeometry(0.02, 0.085, 0.46)), seamMat);
    seam.position.x = -length / 2 + ((i + 0.5) / seamCount) * length;
    group.add(seam);
  }
  const railMat = ctx.material(`${keyPrefix}-boardwalk-rail`, () => new THREE.MeshStandardMaterial({ color: palette.rail, roughness: 0.8 }));
  for (const side of [-1, 1]) {
    const rail = new THREE.Mesh(ctx.geometry(`${keyPrefix}-boardwalk-rail-geo`, () => new THREE.CylinderGeometry(0.025, 0.025, 0.3, 6)), railMat);
    rail.position.set(-length / 2 + 0.1, 0.19, side * 0.2);
    group.add(rail);
    const rail2 = rail.clone();
    rail2.position.x = length / 2 - 0.1;
    group.add(rail2);
  }
  group.position.set(mid.x, 0.32, mid.z);
  group.rotation.y = angle;
  return group;
}

/** 石板跳石——3-5 片不規則扁石，片與片間留間隙暗示「跳著走」，Y 軸抖動
 *  避免過於工整（美術指導書 §5）。 */
export function buildSteppingStones(ctx: SceneCtx, keyPrefix: string, a: Point, b: Point, palette: ConnectorPalette): THREE.Object3D {
  const { length, angle, mid } = lengthAndAngle(a, b);
  const group = new THREE.Group();
  const stoneMat = ctx.material(`${keyPrefix}-stone`, () => new THREE.MeshStandardMaterial({ color: palette.stone, roughness: 0.95 }));
  const count = Math.max(3, Math.min(5, Math.round(length / 0.7)));
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    const radius = 0.12 + ((i * 37) % 7) / 7 * 0.06; // 0.12~0.18，決定性偽隨機（不需要外部種子，位置本身已足夠不重複）
    const stone = new THREE.Mesh(ctx.geometry(`${keyPrefix}-stone-geo-${Math.round(radius * 100)}`, () => new THREE.CylinderGeometry(radius, radius * 0.9, 0.08, 7)), stoneMat);
    stone.position.set(-length / 2 + t * length, 0.05 + (((i * 53) % 5) / 5 - 0.5) * 0.04, 0);
    group.add(stone);
  }
  group.position.set(mid.x, 0, mid.z);
  group.rotation.y = angle;
  return group;
}

/** 吊橋——木板中段下垂＋兩條繩索扶手（`TubeGeometry` 沿 `CatmullRomCurve3`
 *  畫出中點下垂的弧線）＋支撐柱（美術指導書 §5）。 */
export function buildRopeBridge(ctx: SceneCtx, keyPrefix: string, a: Point, b: Point, palette: ConnectorPalette): THREE.Object3D {
  const { length, angle, mid } = lengthAndAngle(a, b);
  const group = new THREE.Group();
  const deckMat = ctx.material(`${keyPrefix}-rope-deck`, () => new THREE.MeshStandardMaterial({ color: palette.deck, roughness: 0.85 }));
  const deck = new THREE.Mesh(ctx.geometry(`${keyPrefix}-rope-deck-geo`, () => new THREE.BoxGeometry(1, 0.05, 0.34)), deckMat);
  deck.scale.x = length;
  deck.position.y = -0.08; // 中段下垂的視覺近似：整片板子壓低一點，不做逐段下垂（效能/複雜度取捨）
  group.add(deck);
  const ropeMat = ctx.material(`${keyPrefix}-rope`, () => new THREE.MeshStandardMaterial({ color: palette.rope, roughness: 0.9 }));
  for (const side of [-0.17, 0.17]) {
    // TubeGeometry 的曲線跟著這對端點的長度變，天生就是「每個連接物實例
    // 各自一個幾何」——key 帶位置＋邊，不是為了共用快取（這種幾何本來就
    // 不太可能被另一對端點重用），是為了登記進 ctx（契約測試①要求整棵
    // 物件樹裡每個 geometry 都要走 ctx，不能直接 `new` 繞過去）。
    const tubeKey = `${keyPrefix}-rope-tube-${a.x.toFixed(2)},${a.z.toFixed(2)}-${b.x.toFixed(2)},${b.z.toFixed(2)}-${side}`;
    const tubeGeo = ctx.geometry(tubeKey, () => {
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(-length / 2, 0.25, side),
        new THREE.Vector3(0, 0.25 - 0.15, side),
        new THREE.Vector3(length / 2, 0.25, side),
      ]);
      return new THREE.TubeGeometry(curve, Math.max(8, Math.round(length * 4)), 0.025, 6, false);
    });
    const tube = new THREE.Mesh(tubeGeo, ropeMat);
    group.add(tube);
  }
  const postMat = ctx.material(`${keyPrefix}-rope-post`, () => new THREE.MeshStandardMaterial({ color: palette.dock, roughness: 0.8 }));
  const postCount = Math.max(2, Math.round(length / 1.2));
  for (let i = 0; i < postCount; i++) {
    const t = postCount === 1 ? 0.5 : i / (postCount - 1);
    const post = new THREE.Mesh(ctx.geometry(`${keyPrefix}-rope-post-geo`, () => new THREE.CylinderGeometry(0.03, 0.03, 0.4, 6)), postMat);
    post.position.set(-length / 2 + t * length, -0.08, 0);
    group.add(post);
  }
  group.position.set(mid.x, 0.3, mid.z);
  group.rotation.y = angle;
  return group;
}

/** 淺灘沙洲——貼著海面的扁平沙地，比一般連接物更寬，邊緣用透明度漸淡
 *  融入海面（美術指導書 §5：alpha 由中心到邊緣遞減）。 */
export function buildShoal(ctx: SceneCtx, keyPrefix: string, a: Point, b: Point, palette: ConnectorPalette, fadeTexture: THREE.Texture): THREE.Object3D {
  const { length, angle, mid } = lengthAndAngle(a, b);
  const mat = ctx.material(`${keyPrefix}-shoal`, () => new THREE.MeshStandardMaterial({ color: palette.shoal, roughness: 0.9, transparent: true, alphaMap: fadeTexture, opacity: 0.85 }));
  const shoal = new THREE.Mesh(ctx.geometry(`${keyPrefix}-shoal-geo`, () => new THREE.BoxGeometry(1, 0.03, 0.8)), mat);
  shoal.scale.x = length;
  shoal.position.set(mid.x, 0.02, mid.z);
  shoal.rotation.y = angle;
  return shoal;
}

/** 小船渡口——兩端各一個小碼頭樁＋中點一艘停泊的小船（不需要真的連一條
 *  完整路橋，美術指導書 §5：「一艘停泊的船本身就足以暗示這裡要坐船
 *  過去」）。 */
export function buildFerry(ctx: SceneCtx, keyPrefix: string, a: Point, b: Point, palette: ConnectorPalette): THREE.Object3D {
  const { length, angle, mid } = lengthAndAngle(a, b);
  const group = new THREE.Group();
  const dockMat = ctx.material(`${keyPrefix}-ferry-dock`, () => new THREE.MeshStandardMaterial({ color: palette.dock, roughness: 0.85 }));
  for (const side of [-1, 1]) {
    const dock = new THREE.Mesh(ctx.geometry(`${keyPrefix}-ferry-dock-geo`, () => new THREE.CylinderGeometry(0.06, 0.06, 0.5, 6)), dockMat);
    dock.position.set(side * (length / 2 - 0.2), 0.1, 0);
    group.add(dock);
  }
  const hullMat = ctx.material(`${keyPrefix}-ferry-hull`, () => new THREE.MeshStandardMaterial({ color: palette.hull, roughness: 0.7 }));
  const hull = new THREE.Mesh(ctx.geometry(`${keyPrefix}-ferry-hull-geo`, () => new THREE.BoxGeometry(0.5, 0.14, 0.24)), hullMat);
  hull.position.set(0, 0.02, 0);
  group.add(hull);
  const deckMat = ctx.material(`${keyPrefix}-ferry-deck`, () => new THREE.MeshStandardMaterial({ color: palette.deck, roughness: 0.8 }));
  const deck = new THREE.Mesh(ctx.geometry(`${keyPrefix}-ferry-deck-geo`, () => new THREE.BoxGeometry(0.4, 0.04, 0.2)), deckMat);
  deck.position.set(0, 0.1, 0);
  group.add(deck);
  group.position.set(mid.x, 0, mid.z);
  group.rotation.y = angle;
  return group;
}
