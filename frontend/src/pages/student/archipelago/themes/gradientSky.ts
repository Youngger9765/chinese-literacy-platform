/**
 * themes/gradientSky.ts — 三段漸層天空球（美術指導書 §1：「改成漸層天空球
 * （三段色）」），取代單一平塗 `scene.background`。兩個主題共用同一個建構
 * 函式，只是色票不同——這是視覺工具，不是骨架邏輯，所以放皮膚層而不是
 * `core/`，但兩個主題都要用，所以獨立成檔案而不是各寫一次。
 */
import * as THREE from 'three';
import type { SceneCtx } from '../core/sceneCtx';

/** 建一顆半球內壁（`BackSide`，從內部看）、垂直方向三段漸層的天空穹頂。
 *  用頂點色而非貼圖——零貼圖記憶體成本，漸層平滑度對這個尺度的場景
 *  已經足夠（不需要高解析度貼圖才能呈現三色漸層）。
 *
 * 幾何/材質都走 `ctx.geometry`/`ctx.material` 登記（跟這個 repo 所有皮膚
 * 物件一樣）——不這樣做的話契約測試①（走訪整棵物件樹比對 ctx 登記
 * 清單）會抓到「未登記資源」，這支函式本身不需要 WebGL 就能在契約測試
 * 的假 `SceneCtx` 上跑。 */
export function buildGradientSkyDome(ctx: SceneCtx, keyPrefix: string, topColor: string, midColor: string, horizonColor: string, radius = 150): THREE.Mesh {
  const geometry = ctx.geometry(`${keyPrefix}-sky-dome-geo`, () => {
    const g = new THREE.SphereGeometry(radius, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2);
    const top = new THREE.Color(topColor);
    const mid = new THREE.Color(midColor);
    const horizon = new THREE.Color(horizonColor);
    const position = g.attributes.position;
    const colors = new Float32Array(position.count * 3);
    for (let i = 0; i < position.count; i++) {
      const y = position.getY(i) / radius; // 0（地平線）~1（頂點）
      const color = y > 0.5
        ? mid.clone().lerp(top, (y - 0.5) * 2)
        : horizon.clone().lerp(mid, y * 2);
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return g;
  });
  const material = ctx.material(`${keyPrefix}-sky-dome-mat`, () => new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  const dome = new THREE.Mesh(geometry, material);
  dome.renderOrder = -1; // 永遠先畫，當作背景——不靠深度測試贏過其他物件
  return dome;
}
