/**
 * themes/seededRandom.ts — 皮膚層共用的決定性亂數（美術指導書多處要求
 * 「用固定種子，同一群每次打開長一樣」：§3.1 海岸線頂點擾動、§3.3 沙灘
 * 環寬度、§3.4 表面細節散佈、§5 連接材料選材）。
 *
 * 跟 `core/archipelagoLayout.ts` 用同一套演算法（mulberry32 + FNV-1a 雜湊
 * 字串種子），但這裡是**皮膚層自己的一份**，不 import 骨架那份——這兩層
 * 各自決定性地選東西（骨架選「哪些格子組成島、哪些島相鄰」，皮膚選「這個
 * 頂點要往外推多少、這叢草種在哪」），職責不同，沒有互相依賴的理由，
 * 複製一份十行的通用數學比跨層 import 更乾淨（SKILL §1：皮膚不知道骨架的
 * 規則細節，骨架也不該被皮膚的視覺需求牽著改）。
 */

function hashSeed(seed: string): number {
  let h = 2166136261 >>> 0; // FNV-1a offset basis
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 回傳一個決定性的 [0,1) 亂數產生器，同一個 seed 字串永遠產生同一個
 *  數列。`seed` 建議把「島的 slug」跟「用途」接在一起（例如
 *  `${cell.seed}:coastline:${cornerIndex}`），避免同一座島的海岸線擾動跟
 *  草叢散佈意外用到同一段數列而產生視覺上的巧合關聯。 */
export function seededRandom(seed: string): () => number {
  let a = hashSeed(seed) >>> 0;
  return function rand(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 單次取用的便利函式——給定種子字串直接拿一個 [0,1) 的值，不需要自己管
 *  產生器實例（用於「這個特定頂點該擾動多少」這種一次性查詢）。 */
export function seededValue(seed: string): number {
  return seededRandom(seed)();
}
