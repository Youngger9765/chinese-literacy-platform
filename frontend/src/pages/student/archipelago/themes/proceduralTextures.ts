/**
 * themes/proceduralTextures.ts — 程序化 Canvas 貼圖（美術指導書 §1：海面
 * 近岸到遠處的徑向漸層、§2.3「用 roughnessMap/map 貼上程序化漸層 Canvas
 * 貼圖，而不是加新的材質類型」）。零額外網路請求、零外部檔案，在記憶體
 * 裡畫出來當貼圖用。
 */
import * as THREE from 'three';

/** 徑向漸層（中心到邊緣）——海面用「近岸淺色→遠處深色」，雲海可以用同一個
 *  函式畫「中心亮→邊緣暗」。記得呼叫端要設
 *  `texture.colorSpace = THREE.SRGBColorSpace`（`threejs-materials`：
 *  colour data texture 不標色彩空間，漸層色會偏淡發白）。 */
export function buildRadialGradientTexture(innerColor: string, outerColor: string, size = 512): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, innerColor);
    gradient.addColorStop(1, outerColor);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}

/**
 * 徑向透明淡出貼圖（team-lead 2026-10-31 三次訂正：「海面改用
 * CircleGeometry，外圈 30% 做徑向透明淡出……邊緣要融進背景，畫面上不能
 * 看到任何直線邊緣」）——當 `material.alphaMap` 用：three.js 吃 alphaMap
 * 的紅色channel當透明度，白＝完全不透明、黑＝完全透明，所以畫灰階（不是
 * 顏色）的徑向漸層：中心到 `fadeStartFraction` 之前全白（完全不透明），
 * 從那裡開始線性淡到邊緣全黑（完全透明）。**不設定 `colorSpace`**——
 * alphaMap 讀的是灰階數值本身，不是要顯示的顏色，套用 sRGB 轉換反而會讓
 * 淡出曲線不是線性的。
 */
export function buildRadialFadeAlphaTexture(fadeStartFraction = 0.7, size = 512): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, '#ffffff');
    gradient.addColorStop(Math.min(0.999, Math.max(0, fadeStartFraction)), '#ffffff');
    gradient.addColorStop(1, '#000000');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}
