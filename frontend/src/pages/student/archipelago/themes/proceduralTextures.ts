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
