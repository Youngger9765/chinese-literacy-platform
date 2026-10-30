/**
 * themes/portalParticles.ts — 傳送門廣場的「正在運作」感（美術指導書 §9：
 * 「複用單課島燈塔光束旁已經做好的粒子點技巧，在廣場中央加 4-6 個緩慢
 * 上升、漸隱的光點」）。用 `onBeforeRender` 自繪鉤子讓每個光點自己動，
 * 骨架不需要額外驅動（跟 `themes/flags.ts` 同一個模式）。
 */
import * as THREE from 'three';
import type { SceneCtx } from '../core/sceneCtx';

export function buildRisingParticles(ctx: SceneCtx, keyPrefix: string, color: number, count = 5): THREE.Group {
  const group = new THREE.Group();
  const geo = ctx.geometry(`${keyPrefix}-portal-particle-geo`, () => new THREE.SphereGeometry(0.05, 6, 6));
  for (let i = 0; i < count; i++) {
    // 每個光點各自一把材質 key——不能共用一個材質實例再 `.clone()`：
    // clone 出來的材質不會登記在 `ctx` 裡，會被契約測試①（走訪整棵物件樹
    // 比對 ctx 登記清單）抓到「未登記的 material」。每個光點本來就要各自
    // 獨立的 opacity 動畫，用各自的 key 讓它們天生就是不同的材質實例。
    const dotMat = ctx.material(`${keyPrefix}-portal-particle-${i}`, () => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false }));
    const dot = new THREE.Mesh(geo, dotMat);
    const angle = (i / count) * Math.PI * 2;
    const radiusOffset = 0.3 + (i % 3) * 0.15;
    const phaseOffset = (i / count) * 3; // 錯開上升週期，不會同時冒出同時消失
    dot.position.set(Math.cos(angle) * radiusOffset, 0, Math.sin(angle) * radiusOffset);
    const baseX = dot.position.x;
    const baseZ = dot.position.z;
    const cycleSeconds = 3;
    dot.onBeforeRender = () => {
      const t = ((performance.now() / 1000 + phaseOffset) % cycleSeconds) / cycleSeconds;
      dot.position.set(baseX, t * 2.4, baseZ);
      (dot.material as THREE.Material & { opacity: number }).opacity = Math.sin(t * Math.PI) * 0.9;
    };
    group.add(dot);
  }
  return group;
}
