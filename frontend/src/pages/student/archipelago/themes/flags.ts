/**
 * themes/flags.ts — 已佔領旗子（美術指導書 §6）：比現況大（0.22×0.14 →
 * 0.26×0.18）、加 emissive 微光（PointLight 預設平方衰減，遠距離時顏色比
 * 照度更早消失，emissive 保底）、會飄動（`rotation.z` 簡易正弦擺動）。
 *
 * 飄動用 three.js 的 `onBeforeRender` 自繪鉤子——物件自己在每次被渲染前
 * 更新自己的 transform，骨架完全不需要知道「旗子」這個概念存在、不需要
 * 額外的「flags 清單」讓骨架逐一驅動（SKILL §1：骨架不知道長什麼樣子）。
 * 兩個主題共用同一支建構函式，只是顏色不同——造型差異（天空島可以換成
 * 飄帶/光旗）留給主題自己在呼叫端決定要不要用這支。
 */
import * as THREE from 'three';
import type { SceneCtx } from '../core/sceneCtx';

export interface FlagPalette {
  pole: number;
  cloth: number;
  clothEmissive: number;
  clothEmissiveIntensity: number;
  edge: number;
  glow: number;
}

/** 建一支插在 `(x,y,z)` 的旗子（含旗桿），回傳的 Group 已經掛好
 *  `onBeforeRender` 讓旗布自己飄動——呼叫端只要 `obj.add(flag)`，不需要
 *  額外註冊到任何動畫清單。 */
export function buildFlag(ctx: SceneCtx, keyPrefix: string, position: { x: number; y: number; z: number }, palette: FlagPalette): THREE.Group {
  const group = new THREE.Group();
  group.position.set(position.x, position.y, position.z);

  const poleMat = ctx.material(`${keyPrefix}-flag-pole`, () => new THREE.MeshStandardMaterial({ color: palette.pole, roughness: 0.8 }));
  const pole = new THREE.Mesh(ctx.geometry(`${keyPrefix}-flag-pole-geo`, () => new THREE.CylinderGeometry(0.02, 0.02, 0.7, 6)), poleMat);
  pole.position.y = 0.35;
  group.add(pole);

  const clothMat = ctx.material(`${keyPrefix}-flag-cloth`, () => new THREE.MeshStandardMaterial({
    color: palette.cloth,
    roughness: 0.6,
    emissive: palette.clothEmissive,
    emissiveIntensity: palette.clothEmissiveIntensity,
    side: THREE.DoubleSide,
  }));
  const cloth = new THREE.Mesh(ctx.geometry(`${keyPrefix}-flag-cloth-geo`, () => new THREE.PlaneGeometry(0.26, 0.18)), clothMat);
  cloth.position.set(0.14, 0.62, 0);
  // 美術指導書 §6：`rotation.z = sin(t*2 + seed) * 0.08` 的簡易正弦擺動，
  // 不需要自訂 shader，CPU 動畫即可——`onBeforeRender` 讓這個 Mesh 每次
  // 被畫之前自己算一次，不依賴外部有沒有人呼叫動畫函式。
  const swaySeed = (position.x * 13.7 + position.z * 7.3) % (Math.PI * 2); // 決定性、不同位置的旗子不會同步擺動
  cloth.onBeforeRender = () => {
    cloth.rotation.z = Math.sin(performance.now() * 0.002 + swaySeed) * 0.08;
  };
  group.add(cloth);

  const glow = new THREE.PointLight(palette.glow, 0.8, 2.2);
  glow.position.set(0, 0.9, 0);
  group.add(glow);

  return group;
}
