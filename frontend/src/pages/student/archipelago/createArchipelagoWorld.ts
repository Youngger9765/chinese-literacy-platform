import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { SSAOPass } from 'three/examples/jsm/postprocessing/SSAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { disposeObjectTree } from '../../lab/island/islandBuildingShapes';
import { axialToCartesian, type ClusterMode } from './core/archipelagoClusters';
import { layoutArchipelago, type IslandBlob, type HexCell } from './core/archipelagoLayout';
import { createSceneCtx } from './core/sceneCtx';
import type { IslandStatus } from './core/islandStatus';
import type { ArchipelagoTheme, CellInfo } from './themes/types';

/**
 * createArchipelagoWorld.ts — 群島模式 3D 場景骨架（#3780，
 * docs/prd/2026-10-30-archipelago-clusters-prd.md §3/§4/§7/§8.5；
 * `.claude/skills/archipelago-module/SKILL.md`）。
 *
 * 模組重構（2026-10-30）：這支不再寫死任何視覺（底面、顏色常數）——長
 * 什麼樣子一律向傳進來的 `theme: ArchipelagoTheme` 要（`themes/` 底下的
 * 各份皮膚設定檔）。這支只管：鏡頭、互動（拖曳/縮放/點擊/hover）、佈局
 * 座標換算、換群時的資源釋放、resize/render loop——SKILL §1「骨架層
 * 不知道長什麼樣子」。
 *
 * **不規則群島佈局**（PRD §3.2 二次訂正，2026-10-31）：位置／哪些島相鄰／
 * 連接材料全部由 `core/archipelagoLayout.ts` 的 `layoutArchipelago()`
 * 決定（純函式，已獨立測試＋mutation-tested）——取代舊版蜂巢螺旋＋逐一
 * 連成一條鍊。種子直接用「這一群的課程 id 依序接起來」，保證「同一群
 * 每次打開長一樣」不需要額外傳參數。
 *
 * 跟 `lab/island/createIslandWorld.ts`（單課島、第一人稱走動）是兩種場景：
 * 這支是「一張地圖看一整群課程島＋中央傳送門廣場」的俯瞰場景，互動是拖曳
 * 旋轉／縮放＋點擊選取，不是第一人稱移動。
 *
 * 效能取捨（team-lead 2026-10-30 授權「介面不合理就直接改」）：用
 * `island(ctx, cell): THREE.Object3D` 介面整座島（含地基）交給主題建——
 * 代價是拿掉了地基的 InstancedMesh。在目前的規模（單群最多 71 座島，
 * `genre`/`category` 模式最大群）這不是效能問題——InstancedMesh 是給數百
 * 上千個實例才真的重要；拿掉它換來的是「換主題真的只改一份設定檔，
 * 骨架一行都不用動」，這是 SKILL 的核心訴求。
 */

export interface ArchipelagoWorldIsland {
  storySlug: string;
  title: string;
  /** 已正規化（自然科學/寓言故事/歷史人文/生活/其他）——呼叫端必須先用
   *  `core/archipelagoClusters.ts` 的 `normalizeCategory()` 轉過一次再傳
   *  進來（code review 2026-10-30 blocker：之前呼叫端直接傳
   *  `/api/stories` 的原始類別碼，這裡／現在主題的 `landmarks` 比對的是
   *  中文標籤，兩邊對不上，全部島都掉進 default 造型）。 */
  category: string;
  status: IslandStatus;
  stationsDone: number;
  stationsTotal: number;
}

export interface ArchipelagoWorldPortal {
  key: string;
  label: string;
  occupiedCount: number;
  total: number;
}

export interface ArchipelagoWorldEvents {
  onSelectIsland: (storySlug: string) => void;
  onSelectPortal: (clusterKey: string) => void;
  onHoverIsland?: (storySlug: string | null) => void;
}

/** 相鄰六角格中心距離——決定「島跟島隔多遠」的骨架常數，不是主題設定，
 *  換皮不該改變佈局間距。同時也是 `unionBoundary()` 的 `cellRadius`
 *  （透過 `CellInfo.cellRadius` 傳給皮膚），讓同一座島裡黏在一起的格子
 *  剛好緊貼、不留縫——見 `themes/types.ts` `CellInfo.cellRadius` 的說明。 */
export const HEX_SIZE = 3.6;

/** 傳送門離廣場中心多遠——骨架常數（跟 `HEX_SIZE` 一樣，換皮不該改變
 *  佈局間距）。 */
const PORTAL_DISTANCE_FROM_HUB = 3.0;

/** 名牌重疊偵測／遮擋 raycast 節流（美術指導書 §7：「每幀投影所有名牌的
 *  螢幕座標…節流到每 3 幀一次」）——不是效能擔心的猜測，是指導書明寫的
 *  頻率，照做。 */
const NAMEPLATE_THROTTLE_FRAMES = 3;

/**
 * 霧密度（美術指導書 §2.2 白屏事故訂正，2026-10-31，team-lead 算出根因）：
 * 原本的 `density = 2.2 / maxRadius` 是「先決定密度，再看它產生出來的
 * 霧化係數」，小群時密度太高，讓整片場景的霧化係數趨近 1，全部變成霧色
 * （霧色是淺色系，於是畫面整片洗白）。
 *
 * 反過來想：先決定「最遠那座島該有多少霧化係數」（`targetFogFactor`，
 * 預設 0.35——看得到島、有空氣感，但不是完全看不見也不是幾乎沒有霧），
 * 再用 `FogExp2` 的公式 `factor = 1 - exp(-(density×distance)²)` 反推
 * 密度：`density = sqrt(-ln(1-factor)) / distance`。
 *
 * `FARTHEST_DISTANCE_MULTIPLIER`：這裡的「最遠距離」指的是**鏡頭到場景
 * 最遠點**的距離，不是群自己的半徑（`maxDist`）——鏡頭本身就在
 * `orbitRadius = maxDist × 1.7` 外（見 `loadCluster()` 的鏡頭自動縮放），
 * 場景最遠的點又可能在鏡頭對側再加上一個 `maxDist`，所以用
 * `(1.7 + 1) × maxDist = 2.7 × maxDist` 當「最遠距離」的估計值。
 */
export const FARTHEST_DISTANCE_MULTIPLIER = 2.7;

/** `FogExp2` 本身的霧化係數公式，獨立拆出來是因為「反推密度」跟「驗證
 *  反推對不對」要用同一個公式，不要兩邊各寫一次、公式打錯一邊測試也測
 *  不出來。 */
export function archipelagoFogFactorAt(density: number, distance: number): number {
  return 1 - Math.exp(-((density * distance) ** 2));
}

export function archipelagoFogDensity(maxDist: number, targetFogFactor = 0.35): number {
  const farthestDistance = Math.max(1, maxDist) * FARTHEST_DISTANCE_MULTIPLIER;
  return Math.sqrt(-Math.log(1 - targetFogFactor)) / farthestDistance;
}

/**
 * 畫質分級（PRD 效能要求：iPad／390 手機都要 ≥30fps，2026-10-31 補）。
 * SSAO 是新加的後製 pass 裡最貴的一個（每像素都要額外取樣深度/法線緩衝
 * 做環境光遮蔽），窄螢幕（手機）預設關掉，只留 bloom／暈影；pixelRatio
 * 上限也跟著降，減少 fill-rate 負擔。門檻直接沿用 PRD §6 既有的「手機
 * （< 640 寬）」門檻（右側面板在這個寬度改成底部抽屜），不是另外發明一個
 * 跟畫面其他地方不一致的數字。
 *
 * iPad（常見寬度 768/1024）落在寬螢幕分級——團隊長特別點名 iPad 也要
 * ≥30fps，但 iPad 的 GPU 效能足夠負擔 SSAO，不需要跟手機一起降級；真的
 * 量到 iPad 上 SSAO 導致掉幀的話，再把門檻或判斷式改成也看
 * `navigator.hardwareConcurrency`/UA 之類的裝置能力訊號，不是這裡先猜。
 */
export const NARROW_WIDTH_THRESHOLD = 640;

export interface ArchipelagoQualityTier {
  ssaoEnabled: boolean;
  pixelRatioCap: number;
}

export function qualityTierForWidth(width: number): ArchipelagoQualityTier {
  if (width < NARROW_WIDTH_THRESHOLD) return { ssaoEnabled: false, pixelRatioCap: 1.25 };
  return { ssaoEnabled: true, pixelRatioCap: 1.7 };
}

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export interface OccluderBox {
  /** 這個包圍盒屬於哪座島——跟名牌自己的 `ownSlug` 相同時不算遮擋（島不會
   *  擋自己的名牌）。 */
  slug: string;
  min: Vec3Like;
  max: Vec3Like;
}

/**
 * 名牌遮擋判斷（美術指導書 §7 + team-lead 2026-10-31 訂正）——抽成純函式，
 * 參數只吃「相機位置、名牌錨點、可遮擋物的包圍盒清單」，不碰 three.js
 * 的 Raycaster/Scene，可以直接餵合成資料寫測試，不必在真實佈局裡旋轉
 * 鏡頭碰運氣找一個剛好被擋住的案例（2026-10-31 實測：在一個 20 島群裡
 * 試了 10 種角度都沒能逼出真實案例，但不代表機制沒用——只是沒測到）。
 *
 * 做法：相機到名牌錨點視為一條線段（不是無限長的射線，錨點背後的東西
 * 不該算遮擋），對每個「不屬於這座島自己」的包圍盒做 ray-vs-AABB 相交
 * 測試；交點若比名牌本身更靠近相機（扣掉 `marginBeforeLabel` 的容忍值，
 * 避免名牌所在島自己的地面/建築邊緣誤判成遮擋自己），就算被擋住。
 */
export function isNameplateOccluded(
  cameraPos: Vec3Like,
  labelAnchor: Vec3Like,
  ownSlug: string,
  occluders: OccluderBox[],
  marginBeforeLabel = 0.3,
): boolean {
  const origin = new THREE.Vector3(cameraPos.x, cameraPos.y, cameraPos.z);
  const target = new THREE.Vector3(labelAnchor.x, labelAnchor.y, labelAnchor.z);
  const toLabel = target.clone().sub(origin);
  const distToLabel = toLabel.length();
  if (distToLabel < 1e-6) return false; // 名牌就在相機位置——不可能被擋住
  const direction = toLabel.clone().normalize();
  const ray = new THREE.Ray(origin, direction);
  const hitPoint = new THREE.Vector3();
  for (const occluder of occluders) {
    if (occluder.slug === ownSlug) continue;
    const box = new THREE.Box3(
      new THREE.Vector3(occluder.min.x, occluder.min.y, occluder.min.z),
      new THREE.Vector3(occluder.max.x, occluder.max.y, occluder.max.z),
    );
    const hit = ray.intersectBox(box, hitPoint);
    if (!hit) continue;
    const hitDistance = hit.distanceTo(origin);
    if (hitDistance < distToLabel - marginBeforeLabel) return true;
  }
  return false;
}

export interface ClusterBoundingCircle {
  center: Vec3Like;
  radius: number;
}

/**
 * 開場鏡頭構圖（team-lead 2026-10-31 明令：「開場鏡頭要能框住整群，傳送門
 * 廣場放在畫面正中央，不要像現在只截到一角」）——根因查到：鏡頭一直固定
 * `lookAt (0,0,0)`（世界原點），但傳送門廣場的實際質心**不是**世界原點
 * （`layoutArchipelago()` 的廣場格子是從 (0,0) 往外長 3 格，長出來的形狀
 * 不對稱時質心會偏離原點——實測一個 20 島群廣場中心量到 `(-1,0)`，不是
 * `(0,0)`），鏡頭看著一個錯的點，整群當然會歪向畫面一角。
 *
 * 改成：先算出「所有島（含廣場）的外接圓」（用 bounding-box 中心當圓心，
 * 不是質心——質心會被密度不均的一側拉偏，bbox 中心在視覺上比較貼近「真正
 * 置中」，算法也更簡單、更穩定），鏡頭 `lookAt` 這個圓心，`orbitRadius`
 * 依這個圓的半徑縮放（取代原本「距離原點最遠的島」那個算法，語意從
 * 「離原點多遠」換成「離整群真正的中心多遠」，更正確）。
 *
 * 純函式，只吃一組 2D 位置，不碰 three.js 場景——可以直接餵合成座標測試。
 */
/**
 * @param forceCenter 強制指定圓心（不計算 bbox 中心）——團隊長的兩個要求
 *   其實是同一個點比較好同時滿足：「傳送門廣場距畫面中心 ≤10%」最穩妥的
 *   做法是鏡頭直接看著廣場本身（距離恆為 0%，不是算出來剛好很小），
 *   「框住整群」則用「以廣場為圓心、到最遠島的距離」當半徑——廣場不剛好
 *   在整群的幾何中心也沒關係，只要半徑算對，整群一樣會被框住。不傳這個
 *   參數時退回 bbox 中心（給沒有特定基準點的泛用呼叫端，也是既有測試
 *   覆蓋的預設行為）。
 */
export function computeClusterBoundingCircle(
  positions: readonly { x: number; z: number }[],
  forceCenter?: { x: number; z: number },
): ClusterBoundingCircle {
  if (positions.length === 0) return { center: { x: 0, y: 0, z: 0 }, radius: 1 };
  let center: { x: number; z: number };
  if (forceCenter) {
    center = forceCenter;
  } else {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const p of positions) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
    center = { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 };
  }
  let radius = 0;
  for (const p of positions) {
    radius = Math.max(radius, Math.hypot(p.x - center.x, p.z - center.z));
  }
  return { center: { x: center.x, y: 0, z: center.z }, radius: Math.max(1, radius) };
}

/** WebGL 無法建立時回傳 `null`（PRD §6：自動降級到清單模式，不是顯示錯誤
 *  頁），呼叫端用這個判斷要不要 render 3D 容器。
 *
 * @param theme 要哪個皮膚——`themes/index.ts` 的 `THEMES[id]`，呼叫端負責
 *   選（HUD 切換、localStorage 偏好都在呼叫端，這支不管）。
 */
export function createArchipelagoWorld(
  container: HTMLElement,
  events: ArchipelagoWorldEvents,
  theme: ArchipelagoTheme,
): ArchipelagoWorld | null {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  } catch {
    return null;
  }
  if (!renderer.getContext()) return null;

  // 畫質分級（PRD 效能要求：iPad／390 手機都要 ≥30fps）——窄螢幕關 SSAO、
  // 降 pixelRatio 上限，純函式見 `qualityTierForWidth()` 的說明。容器這時
  // 可能還沒掛載完成、量到 0，退回桌機尺寸（寬螢幕分級，不會誤判成手機
  // 關掉 SSAO）；真正的尺寸在 `resize()` 第一次呼叫時就會量到。
  const qualityTier = qualityTierForWidth(container.clientWidth || 1280);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, qualityTier.pixelRatioCap));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.35;
  container.appendChild(renderer.domElement);

  // ---------------------------------------------------------------------
  // 名牌 CSS2D 疊層（美術指導書 §7）——獨立於 WebGL canvas 的 DOM 疊層，
  // 用絕對定位蓋滿同一個容器。`pointer-events: none`：名牌只是資訊，不是
  // 互動目標（點擊走既有的 3D raycast，見下面 `onClickUp`），不能擋住底下
  // canvas 的滑鼠事件。
  // ---------------------------------------------------------------------
  const labelRenderer = new CSS2DRenderer();
  labelRenderer.domElement.style.position = 'absolute';
  labelRenderer.domElement.style.top = '0';
  labelRenderer.domElement.style.left = '0';
  labelRenderer.domElement.style.pointerEvents = 'none';
  container.appendChild(labelRenderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(theme.palette.background);
  scene.fog = new THREE.FogExp2(theme.palette.fog, 0.01); // loadCluster() 會依群大小覆寫密度（§2.2）
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 300);

  const ambient = new THREE.HemisphereLight(theme.lighting.hemisphereSky, theme.lighting.hemisphereGround, theme.lighting.ambient);
  scene.add(ambient);
  const sun = new THREE.DirectionalLight(theme.lighting.sunColor, theme.lighting.sunIntensity);
  sun.position.set(...theme.lighting.sunDirection);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  scene.add(sun);
  // 背光／輪廓光（美術指導書 §2.1：「目前完全沒有 rim，建築輪廓跟天空
  // 背景融在一起分不開」）——方向跟主光相對，顏色/強度向主題要，骨架
  // 不決定這顆燈該是什麼顏色。
  const rim = new THREE.DirectionalLight(theme.lighting.rimColor, theme.lighting.rimIntensity);
  rim.position.set(-theme.lighting.sunDirection[0], theme.lighting.sunDirection[1] * 0.6, -theme.lighting.sunDirection[2]);
  scene.add(rim);

  // ---------------------------------------------------------------------
  // 後製鏈（美術指導書 §2.4）——bloom 只讓金色飾條/水晶/占領光暈發光，
  // SSAO 補建築與島面的接觸陰影，OutputPass 一定要在最後（否則 tone
  // mapping 不生效，`threejs-postprocessing` 反模式第一條）。參數是數字
  // 不是顏色常數，不違反契約測試④（只擋 hex 色碼跟主題字眼）。
  // ---------------------------------------------------------------------
  // `UnrealBloomPass`／`SSAOPass` 都吃「目前畫面的實際像素尺寸」去配置內部
  // render target——不是什麼都能先丟一個佔位值之後再說。這裡先用容器掛載
  // 當下量得到的尺寸（還沒掛上 DOM 前可能是 0，退回一個合理預設），下面
  // `resize()` 每次呼叫都會用真正的尺寸呼叫兩者的 `setSize()` 校正一次。
  const initialWidth = container.clientWidth || 1280;
  const initialHeight = container.clientHeight || 900;
  const composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);
  // 螢幕截圖驗收抓到：修完 1×1 解析度 bug 之後畫面還是整片洗白——根因是
  // §1 色票的天空穹頂（`gradientSky.ts`）本身是淺色系暖白/粉彩（`MeshBasicMaterial`
  // 不受光照，亮度就是色票本身），這些顏色的線性亮度本來就逼近或超過
  // 0.82 這個 threshold（算過：`#f7ecd0` 線性亮度約 0.84），於是**整片天空
  // 都被判定成「夠亮該發光」**，疊加 bloom 之後進一步被推向全白——threshold
  // 調高到 0.95（只留真正接近純白／高強度 emissive 的東西才發光）、
  // strength 腰斬到 0.15（指導書要的是「只讓金色飾條/水晶/占領光暈發光」，
  // 不是整場景發光，見下面原本保留的註解）。
  const bloomPass = new UnrealBloomPass(new THREE.Vector2(initialWidth, initialHeight), 0.15, 0.4, 0.95);
  composer.addPass(bloomPass);
  const ssaoPass = new SSAOPass(scene, camera, initialWidth, initialHeight);
  ssaoPass.kernelRadius = 10;
  ssaoPass.minDistance = 0.003;
  ssaoPass.maxDistance = 0.05;
  // 窄螢幕／低階裝置預設關掉 SSAO（`qualityTier`，PRD 效能要求），保留
  // bloom＋暈影（暈影是 CSS 疊層，不在這條 composer 鏈裡，見呼叫端的 DOM
  // class）——SSAO 是這條鏈裡最貴的 pass（每像素額外取樣深度/法線緩衝）。
  if (qualityTier.ssaoEnabled) composer.addPass(ssaoPass);
  const outputPass = new OutputPass();
  composer.addPass(outputPass);

  // ---------------------------------------------------------------------
  // 拖曳旋轉／滾輪縮放的簡易軌道鏡頭——不是第一人稱，PRD §3.4：「拖曳旋轉、
  // 滾輪／雙指縮放、自動限制在群的範圍內」。
  // ---------------------------------------------------------------------
  let orbitRadius = 22;
  let orbitYaw = 0.5;
  let orbitPitch = 0.65; // 俯角，0=水平 PI/2=正上方
  let orbitTarget = new THREE.Vector3(0, 0, 0);
  let minRadius = 10;
  let maxRadius = 60;

  function syncCamera() {
    const clampedPitch = Math.max(0.2, Math.min(1.4, orbitPitch));
    const clampedRadius = Math.max(minRadius, Math.min(maxRadius, orbitRadius));
    const horizontal = clampedRadius * Math.cos(clampedPitch);
    const y = clampedRadius * Math.sin(clampedPitch);
    camera.position.set(
      orbitTarget.x + horizontal * Math.sin(orbitYaw),
      orbitTarget.y + y,
      orbitTarget.z + horizontal * Math.cos(orbitYaw),
    );
    camera.lookAt(orbitTarget);
  }
  syncCamera();

  let dragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  const onPointerDown = (e: PointerEvent) => { dragging = true; dragStartX = e.clientX; dragStartY = e.clientY; renderer.domElement.setPointerCapture(e.pointerId); };
  const onPointerMove = (e: PointerEvent) => {
    if (!dragging) return;
    orbitYaw -= (e.clientX - dragStartX) * 0.006;
    orbitPitch = Math.max(0.2, Math.min(1.4, orbitPitch - (e.clientY - dragStartY) * 0.004));
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    syncCamera();
  };
  const onPointerUp = () => { dragging = false; };
  const onWheel = (e: WheelEvent) => { e.preventDefault(); orbitRadius = Math.max(minRadius, Math.min(maxRadius, orbitRadius + e.deltaY * 0.03)); syncCamera(); };
  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  renderer.domElement.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  renderer.domElement.addEventListener('wheel', onWheel, { passive: false });

  // ---------------------------------------------------------------------
  // 點擊選取（raycasting）——島跟門都是獨立物件，raycast 打
  // `pickableIslands`/`pickablePortals` 兩個陣列，靠 `userData.storySlug`/
  // `userData.portalKey` 往上找。
  // ---------------------------------------------------------------------
  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();
  let pickableIslands: THREE.Object3D[] = [];
  let pickablePortals: THREE.Object3D[] = [];
  let islandPositions = new Map<string, THREE.Vector3>();
  // 名牌遮擋用的包圍盒快取（`isNameplateOccluded`）——每座島世界座標
  // bounding box，換群時重算一次，不是每幀重算。
  let occluderBoxes: OccluderBox[] = [];
  let downAt = { x: 0, y: 0 };

  function resolveIslandSlugFromPointer(clientX: number, clientY: number): string | null {
    const rect = renderer.domElement.getBoundingClientRect();
    pointerNdc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointerNdc, camera);
    const hit = raycaster.intersectObjects(pickableIslands, true)[0];
    if (!hit) return null;
    let o: THREE.Object3D | null = hit.object;
    while (o && !o.userData.storySlug) o = o.parent;
    return (o?.userData.storySlug as string) ?? null;
  }

  // #3799 美術指導書 §8（2026-10-31）：觸控裝置沒有 hover——第一次點只做
  // 「上浮＋亮邊＋名牌強調」，第二次點（或點卡片「登島」按鈕）才真的導航。
  // 用 `matchMedia` 在裝置層級先判斷，不要用「使用者有沒有點過」這種運行期
  // 猜測（`threejs-camera-interaction-pitfalls` 坑 4）。
  const isCoarsePointer = typeof window.matchMedia === 'function' && window.matchMedia('(any-pointer: coarse)').matches;
  let touchArmedSlug: string | null = null;
  let hoveredSlug: string | null = null;

  const onClickDown = (e: PointerEvent) => { downAt = { x: e.clientX, y: e.clientY }; };
  const onClickUp = (e: PointerEvent) => {
    if (Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 6) return; // 拖曳不算點擊
    const islandSlug = resolveIslandSlugFromPointer(e.clientX, e.clientY);
    if (islandSlug) {
      if (isCoarsePointer && touchArmedSlug !== islandSlug) {
        // 第一次點：只「準備」這座島（上浮/亮邊由下面 hover 動畫段落統一
        // 處理，這裡只負責記住「準備好了」跟觸發名牌強調／onHoverIsland）。
        touchArmedSlug = islandSlug;
        hoveredSlug = islandSlug;
        events.onHoverIsland?.(islandSlug);
        return;
      }
      events.onSelectIsland(islandSlug);
      return;
    }

    const rect = renderer.domElement.getBoundingClientRect();
    pointerNdc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointerNdc, camera);
    const portalHit = raycaster.intersectObjects(pickablePortals, true)[0];
    if (portalHit) {
      let o: THREE.Object3D | null = portalHit.object;
      while (o && !o.userData.portalKey) o = o.parent;
      if (o?.userData.portalKey) events.onSelectPortal(o.userData.portalKey as string);
    }
  };
  renderer.domElement.addEventListener('pointerdown', onClickDown);
  renderer.domElement.addEventListener('pointerup', onClickUp);

  const onHoverMove = (e: PointerEvent) => {
    if (isCoarsePointer) return; // 觸控裝置沒有 hover，狀態由點擊事件自己管
    if (!events.onHoverIsland) return;
    const slug = resolveIslandSlugFromPointer(e.clientX, e.clientY);
    if (slug !== hoveredSlug) { hoveredSlug = slug; events.onHoverIsland(slug); }
  };
  renderer.domElement.addEventListener('pointermove', onHoverMove);

  let clusterGroup: THREE.Group | null = null;
  // 每座島的「目前上浮高度」平滑趨近值（美術指導書 §8：
  // `t = 1 - exp(-rate*dt)` 跨幀率安全的指數平滑，不是固定 lerp 係數）。
  const hoverLift = new Map<string, number>();
  // 每座島的名牌（CSS2DObject）與它對應的 DOM 元素，換群時一併清掉。
  const nameplates = new Map<string, { object: CSS2DObject; el: HTMLDivElement; worldPos: THREE.Vector3 }>();
  let nameplateFrameCounter = 0;

  /**
   * 骨架層統一打開陰影收發——美術指導書第 84 行只點名「陰影相機 frustum
   * 要對齊群的範圍」，但 frustum 調對之後仍量不到對比改善（見 git log
   * 2026-10-31 的訂正紀錄），一路查下去才發現每個主題的每一棟建築／每座
   * 島都沒有 `castShadow`/`receiveShadow`——只有 `hub` 的地基一個物件有設
   * （兩個主題各自在 `theme.hub()` 裡手動設了一次，島本身跟島上的地標完全
   * 沒有）。這不是某個主題個別漏設，是骨架從一開始就沒有統一打開——所以
   * 放在骨架這層一次打開，不要每個主題各自記得設一次。
   */
  /**
   * `receiveShadow` 幾乎零成本（只是主渲染通道裡多取樣一張陰影貼圖），但
   * `castShadow` 會讓那個物件多進一次陰影貼圖的繪製通道——每座島的草叢／
   * 石頭／踏腳石／吉祥物／hover 外框全部打開 `castShadow` 一次量了 390 寬
   * 的 fps：30.48 → 23.7（2026-10-31 實測，-22%），20 島的群一次多出上百個
   * 投影物件。骨架不該知道哪個物件是「草叢」哪個是「地標建築」（§3.2 契約
   * 測試①禁止骨架認得主題字眼），但骨架可以用**幾何本身的高度**當代理：
   * 地標建築／城牆岩層明顯比草叢／踏腳石／薄環高，用 bounding box 的
   * Y 範圍決定要不要投影，而不必知道那個物件實際是什麼。
   */
  const CAST_SHADOW_MIN_HEIGHT = 0.6; // 世界單位——蓋過地標/岩層，篩掉草叢/踏腳石/hover 外框
  function enableShadows(object: THREE.Object3D): void {
    object.traverse((child) => {
      if (!(child as THREE.Mesh).isMesh) return;
      const mesh = child as THREE.Mesh;
      mesh.receiveShadow = true; // 幾乎零成本，全部打開
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      const box = mesh.geometry.boundingBox;
      const height = box ? (box.max.y - box.min.y) * mesh.scale.y : 0;
      mesh.castShadow = height >= CAST_SHADOW_MIN_HEIGHT;
    });
  }

  /**
   * 載入一群——換群時先釋放上一群（`disposeObjectTree`），位置由
   * `layoutArchipelago()`（純函式，已獨立測試）決定，這裡只負責把純座標轉成
   * 真的 three.js 物件，長相全部向 `theme` 要。
   *
   * `createSceneCtx()` 每次呼叫都重新建（不是模組層級共用常數）——理由
   * 跟拿掉 InstancedMesh 共用幾何/材質一樣：`disposeObjectTree`
   * 換群時會把上一群 `clusterGroup` 底下所有幾何/材質一起 dispose。
   */
  function loadCluster(islands: ArchipelagoWorldIsland[], portals: ArchipelagoWorldPortal[]): void {
    if (clusterGroup) {
      scene.remove(clusterGroup);
      disposeObjectTree(clusterGroup);
    }
    for (const { object } of nameplates.values()) object.element.remove();
    nameplates.clear();
    hoverLift.clear();
    pickableIslands = [];
    pickablePortals = [];
    islandPositions = new Map();
    occluderBoxes = [];

    const { ctx } = createSceneCtx(scene);
    const group = new THREE.Group();
    scene.add(group);

    const groundObj = theme.ground(ctx);
    group.add(groundObj);

    // #3799 PRD §3.2 二次訂正：不規則群島佈局——位置／相鄰互通／連接材料
    // 全部由 layoutArchipelago() 決定。種子＝這一群的課程 id 依序接起來，
    // 保證「同一群每次打開長一樣」。
    const seed = islands.map((i) => i.storySlug).join(',');
    const layout = layoutArchipelago(islands.map((i) => i.storySlug), seed, HEX_SIZE);

    function cellOffsetsForBlob(blob: IslandBlob): { x: number; z: number }[] {
      return blob.cells.map((cell) => {
        const world = axialToCartesian(cell, HEX_SIZE);
        return { x: world.x - blob.center.x, z: world.z - blob.center.z };
      });
    }

    const plazaPos = layout.plaza.center;
    const hub = theme.hub(ctx);
    hub.position.set(plazaPos.x, 0, plazaPos.z);
    enableShadows(hub);
    group.add(hub);

    const angleStep = (Math.PI * 2) / Math.max(1, portals.length);
    portals.forEach((portal, i) => {
      const angle = i * angleStep;
      const portalInfo = { key: portal.key, label: portal.label, occupiedCount: portal.occupiedCount, total: portal.total };
      const portalObj = theme.portal(ctx, portalInfo);
      const px = plazaPos.x + Math.cos(angle) * PORTAL_DISTANCE_FROM_HUB;
      const pz = plazaPos.z + Math.sin(angle) * PORTAL_DISTANCE_FROM_HUB;
      portalObj.position.set(px, 0, pz);
      portalObj.lookAt(plazaPos.x, 0, plazaPos.z);
      portalObj.userData.portalKey = portal.key;
      group.add(portalObj);
      pickablePortals.push(portalObj);
    });

    const idToPos = new Map<string, { x: number; z: number }>([['plaza', plazaPos]]);
    for (const blob of layout.islands) idToPos.set(blob.id, blob.center);

    const positions: { x: number; z: number }[] = [plazaPos];
    islands.forEach((island, i) => {
      const blob = layout.islands[i];
      const pos = blob.center;
      positions.push(pos);

      const cell: CellInfo = {
        storySlug: island.storySlug,
        title: island.title,
        category: island.category,
        status: island.status,
        stationsDone: island.stationsDone,
        stationsTotal: island.stationsTotal,
        position: pos,
        cellCount: blob.cells.length,
        cellOffsets: cellOffsetsForBlob(blob),
        cellRadius: HEX_SIZE,
        seed: island.storySlug,
      };
      const islandObj = theme.island(ctx, cell);
      theme.statusLook[island.status](islandObj, ctx);
      islandObj.position.set(pos.x, 0, pos.z);
      islandObj.userData.storySlug = island.storySlug;
      enableShadows(islandObj);
      group.add(islandObj);
      pickableIslands.push(islandObj);
      islandPositions.set(island.storySlug, new THREE.Vector3(pos.x, 0, pos.z));
      hoverLift.set(island.storySlug, 0);
      islandObj.updateMatrixWorld(true); // box 要世界座標，換群時算一次不是每幀
      const worldBox = new THREE.Box3().setFromObject(islandObj);
      occluderBoxes.push({ slug: island.storySlug, min: worldBox.min.clone(), max: worldBox.max.clone() });

      // 名牌（美術指導書 §7）：常駐顯示，不是只有 hover 才出現——
      // 「PRD §3.2 明寫不能整群看不到名字」。樣式向 `theme.nameplate` 要。
      const el = document.createElement('div');
      el.textContent = island.title;
      el.style.background = theme.nameplate.background;
      el.style.border = `1px solid ${theme.nameplate.border}`;
      el.style.color = theme.nameplate.text;
      el.style.borderRadius = '10px';
      el.style.padding = '4px 8px';
      el.style.fontSize = '13px';
      el.style.fontWeight = '600';
      el.style.whiteSpace = 'nowrap';
      el.style.boxShadow = '0 2px 6px rgba(0,0,0,0.15)';
      el.style.transition = 'opacity 150ms, transform 150ms';
      if (island.status === 'occupied') el.textContent = `✓ ${island.title}`;
      else if (island.status === 'in_progress') el.textContent = `${island.title}（${island.stationsDone}/${island.stationsTotal}）`;
      const labelObject = new CSS2DObject(el);
      // 固定偏移在島基準點上方（美術指導書 §7：取現有地標類別裡最高的那個
      // 高度再加餘裕，群島只有 4 種地標形狀，用固定值即可，省掉逐類別查表）。
      labelObject.position.set(0, 1.6, 0);
      islandObj.add(labelObject);
      nameplates.set(island.storySlug, { object: labelObject, el, worldPos: new THREE.Vector3() });

      // 連接物（PRD §3.2：相鄰互通，材料隨機）——下面統一跑 `layout.connections`
      // 建立，這裡不逐一連前一座，見下方迴圈。
    });

    for (const conn of layout.connections) {
      const a = idToPos.get(conn.a);
      const b = idToPos.get(conn.b);
      if (!a || !b) continue;
      const connector = theme.connector(ctx, a, b, conn.material);
      if (connector) group.add(connector);
    }

    clusterGroup = group;

    // 鏡頭自動縮放涵蓋整群範圍（§3.4「自動限制在群的範圍內」；team-lead
    // 2026-10-31 訂正：原本鏡頭永遠看著世界原點，但廣場質心常常不在原點
    // 上（見 `computeClusterBoundingCircle` 的說明），鏡頭看錯點、整群就
    // 會歪向畫面一角——改成看「廣場為圓心的外接圓」，不是寫死的原點）。
    //
    // 倍率 2.9 是量出來的，不是猜的——團隊長要求「非海背景像素 ≥65%」，
    // 一開始直覺是「鏡頭拉近一點」，結果完全相反：1280 寬本機截圖實測
    // M=1.0 只有 43.2%、M=1.35 有 52.1%、M=1.7（原值）61.9%、M=2.2 有
    // 66.8%、M=2.8 有 71.7%——**拉遠才會填滿畫面，不是拉近**。原因是俯角
    // 偏斜視（0.65 rad≈37°）時鏡頭太近只框得到少數幾座島，島跟島之間的
    // 水道本身就佔不小比例，島太少時畫面大半還是水；拉遠才能讓「整群島
    // 散落在海面上」這個圖案本身填滿畫面。
    //
    // 2.3 在 1280 寬可以過門檻（67.6%），但 390 窄螢幕用同一個倍率只有
    // 60.0%——窄螢幕的水平 FOV 本來就比寬螢幕小，同樣的世界距離在窄螢幕
    // 上涵蓋到的畫面比例更少。挑一個兩種寬度都過門檻的單一倍率（不分寬窄
    // 兩套常數，維持簡單）：M=2.9 時 390 寬 67.6%、1280 寬 72.9%，都有
    // 安全邊際，不是卡在門檻上。（海島主題數字；天空島因為整套色票本來就
    // 刻意貼近背景色，像素色彩分類器量不出有意義的數字——跟 contrast 那題
    // 是同一個已知限制，不是這次構圖沒套用到天空島。）
    const boundingCircle = computeClusterBoundingCircle(positions, plazaPos);
    const maxDist = boundingCircle.radius;
    orbitRadius = Math.max(14, maxDist * 2.9);
    minRadius = Math.max(8, maxDist * 0.5);
    maxRadius = maxDist * 3.2;
    orbitTarget = new THREE.Vector3(boundingCircle.center.x, 0, boundingCircle.center.z);
    orbitPitch = 0.65; // 換群重設回預設俯角，不留著玩家上一群拖曳過的角度
    syncCamera();

    // 動態霧密度（美術指導書 §2.2：`density ≈ 2.2 / maxRadius`，群越大霧
    // 越淡，固定密度在小群太濃、大群幾乎看不見——這是量過的公式，不是
    // 改成「看起來還行」的數字）。
    // 動態霧密度（美術指導書 §2.2 白屏事故訂正，2026-10-31）——見
    // `archipelagoFogDensity()` 的說明：反推密度讓「鏡頭到最遠點」的霧化
    // 係數落在 0.35 附近，不是直接套一個固定公式產生出不受控的密度。
    (scene.fog as THREE.FogExp2).density = archipelagoFogDensity(maxDist);

    // SSAO pass 的取樣範圍要對齊這次場景的尺度，不然小群太濃、大群太淡。
    ssaoPass.kernelRadius = Math.max(4, Math.min(16, maxDist * 0.3));

    // 陰影相機 frustum 要對齊這次群的範圍（美術指導書第 84 行：「固定 2048
    // 貼圖，未依群大小調整範圍……frustum 沒對齊場景範圍，陰影要嘛太鬆要嘛
    // 被裁掉」）。DirectionalLight 的陰影相機預設是 ±5 單位的正交投影框——
    // 一個 20 島群的 maxDist 常常是幾十個單位，等於絕大多數島落在這個框
    // 外面，連陰影都不會畫出來。這是 luminance.contrast 量測長期偏低（天空
    // 島 54-58，低於 visual-scorecard.md 門檻 60）的根因：沒有接觸陰影，
    // 畫面就沒有暗部，整片只剩下材質本色在壓光後的亮部，怎麼調材質顏色
    // 都補不回這段暗部。
    // 半徑抓 maxDist 的 1.3 倍（涵蓋整群半徑 + 島本身的實體範圍），不是只
    // 貼齊群的幾何中心點，否則邊緣島的島面本身仍可能被裁到框外。
    const shadowHalfExtent = maxDist * 1.3;
    sun.shadow.camera.left = -shadowHalfExtent;
    sun.shadow.camera.right = shadowHalfExtent;
    sun.shadow.camera.top = shadowHalfExtent;
    sun.shadow.camera.bottom = -shadowHalfExtent;
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = shadowHalfExtent * 4; // 留足太陽方向上的深度範圍
    sun.shadow.camera.updateProjectionMatrix(); // 手動改 left/right/top/bottom 後必須呼叫，否則矩陣不會重算

    // 效能診斷（美術指導書 §10：「跑過 renderer 診斷，不是看起來還行」）——
    // 換群渲染一幀之後印出 draw call/三角面/幾何數，QA 時從瀏覽器 console
    // 讀，不是另外架一套量測工具。
    //
    // `renderer.info.autoReset` 預設 true 時每次 `render()` 呼叫**都會自動
    // 重置計數器**（`threejs-performance` skill 明寫的坑）——`composer.render()`
    // 內部是好幾個 pass 各自呼叫一次 `renderer.render()`（RenderPass 畫
    // 場景、Bloom 內部多個 pass、SSAO、最後 OutputPass 畫一個全螢幕四邊形），
    // 不關掉 autoReset 的話，讀到的數字只會是**最後一個 pass**（OutputPass，
    // 固定 1 個 draw call、2 個三角形）的數字，不是整個場景真正的渲染量，
    // 不管 island 多少、`triangles`／`drawCalls` 永遠接近 1——這正是第一版
    // 在真預覽站量到「1 個 draw call」這個明顯錯誤數字的根因。
    requestAnimationFrame(() => {
      renderer.info.autoReset = false;
      renderer.info.reset();
      composer.render();
      console.log('[archipelago perf]', {
        islands: islands.length,
        drawCalls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        geometries: renderer.info.memory.geometries,
        textures: renderer.info.memory.textures,
      });
      renderer.info.autoReset = true;
    });
  }

  // ---------------------------------------------------------------------
  // resize + render loop
  // ---------------------------------------------------------------------
  function resize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h);
    composer.setSize(w, h);
    labelRenderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);

  const clock = new THREE.Clock();
  let frameId = 0;
  function animate() {
    frameId = requestAnimationFrame(animate);
    const dt = Math.min(0.1, clock.getDelta());

    // Hover 上浮（美術指導書 §8）：指數平滑趨近目標高度，跨幀率安全，不是
    // 固定 lerp 係數（`t = 1 - exp(-rate*dt)`）。亮邊外殼（`userData.isHoverOutline`
    // 標記的子物件）的透明度用同一個進度值淡入淡出——皮膚只需要建一顆
    // 標記好的物件，骨架負責讓它「隨 hover 狀態改變」，皮膚不需要知道
    // hover 狀態存在。
    const rate = 18;
    const liftT = 1 - Math.exp(-rate * dt);
    for (const obj of pickableIslands) {
      const slug = obj.userData.storySlug as string;
      const isHovered = slug === hoveredSlug;
      const current = hoverLift.get(slug) ?? 0;
      const next = current + (isHovered ? 1 - current : 0 - current) * liftT;
      hoverLift.set(slug, next);
      obj.position.y = next * 0.08;
      obj.scale.setScalar(1 + next * 0.04);
      obj.traverse((child) => {
        if (child.userData.isHoverOutline && (child as THREE.Mesh).material) {
          const mat = (child as THREE.Mesh).material as THREE.Material & { opacity: number };
          mat.opacity = next * 0.6;
          mat.transparent = true;
        }
      });
    }

    // 旗子飄動／粒子自己動畫——用 three.js 的 `onBeforeRender` 自繪鉤子
    // （皮膚在建物件時掛上去，骨架完全不用知道「旗子」這個概念存在），
    // `composer.render()` 內部仍然會呼叫每個物件的 `onBeforeRender`。

    // 名牌：位置跟著 3D 物件（CSS2DRenderer 自動處理），遮擋跟重疊判斷都
    // 節流到每 3 幀一次（美術指導書 §7）。
    nameplateFrameCounter = (nameplateFrameCounter + 1) % NAMEPLATE_THROTTLE_FRAMES;
    if (nameplateFrameCounter === 0) {
      const rect = renderer.domElement.getBoundingClientRect();
      const halfW = rect.width / 2 || 1;
      const halfH = rect.height / 2 || 1;
      // 第一輪：算遮擋（被別棟建築擋住）＋順便投影出每個名牌的螢幕座標跟
      // 到鏡頭的距離，給第二輪的重疊判斷用，不用再重算一次世界座標。
      // 2026-10-31 訂正：遮擋判斷改呼叫 `isNameplateOccluded`（純函式，吃
      // 包圍盒不吃 Raycaster/Scene）——不再對每座島的完整三角網格做
      // raycast，換成對換群時就算好的 `occluderBoxes` 做 ray-vs-AABB，
      // 同時這支函式本身可以用合成資料直接測、不必在真實佈局裡碰運氣
      // 找一個剛好被擋住的角度（見 `isNameplateOccluded` 的 test）。
      const projected: { slug: string; x: number; y: number; distance: number; occluded: boolean }[] = [];
      for (const [slug, { object, worldPos }] of nameplates) {
        object.getWorldPosition(worldPos);
        const distToLabel = worldPos.distanceTo(camera.position);
        const occluded = isNameplateOccluded(camera.position, worldPos, slug, occluderBoxes);
        const ndc = worldPos.clone().project(camera);
        projected.push({ slug, x: ndc.x * halfW, y: -ndc.y * halfH, distance: distToLabel, occluded });
      }
      // 第二輪：重疊判斷（美術指導書 §7：「離鏡頭較近那個維持不透明，較遠
      // 那個淡化到 35% 透明度——不是完全隱藏」）。用名牌 DOM 卡片真實的
      // `getBoundingClientRect()` 做矩形相交判斷，不是猜一個固定半徑的圓
      // ——課名長短差很多（「這是什麼」四個字 vs 一整句標題），固定半徑在
      // 短標題會誤判重疊、在長標題又抓不到真的重疊，兩種都錯過。節流已經
      // 壓到每 3 幀一次，這裡多一次 reflow 讀取不是效能熱點。
      const overlapped = new Set<string>();
      const rects = new Map<string, DOMRect>();
      for (const p of projected) rects.set(p.slug, nameplates.get(p.slug)!.el.getBoundingClientRect());
      for (let i = 0; i < projected.length; i++) {
        for (let j = i + 1; j < projected.length; j++) {
          const a = projected[i];
          const b = projected[j];
          const ra = rects.get(a.slug)!;
          const rb = rects.get(b.slug)!;
          const intersects = ra.left < rb.right && ra.right > rb.left && ra.top < rb.bottom && ra.bottom > rb.top;
          if (intersects) {
            const farther = a.distance > b.distance ? a : b;
            overlapped.add(farther.slug);
          }
        }
      }
      for (const p of projected) {
        const { object } = nameplates.get(p.slug)!;
        // 遮擋跟重疊是兩種不同程度的淡出（美術指導書 §7 原文分別寫
        // 「隱藏」跟「淡化到 35%——不是完全隱藏」，不是同一個數字）：被
        // 建築整個擋住要接近完全隱藏；只是跟別的名牌重疊、較遠那個仍要
        // 維持淡淡的可讀性，不能跟遮擋用同一個值。遮擋優先於重疊——已經
        // 完全隱藏的名牌不該又被重疊規則拉回 35% 變成半透明穿模。
        object.element.style.opacity = p.occluded ? '0.05' : overlapped.has(p.slug) ? '0.35' : '1';
      }
    }

    syncCamera();
    composer.render();
    labelRenderer.render(scene, camera);
  }
  animate();

  function dispose(): void {
    cancelAnimationFrame(frameId);
    resizeObserver.disconnect();
    renderer.domElement.removeEventListener('pointerdown', onPointerDown);
    renderer.domElement.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    renderer.domElement.removeEventListener('wheel', onWheel);
    renderer.domElement.removeEventListener('pointerdown', onClickDown);
    renderer.domElement.removeEventListener('pointerup', onClickUp);
    renderer.domElement.removeEventListener('pointermove', onHoverMove);
    for (const { object } of nameplates.values()) object.element.remove();
    nameplates.clear();
    if (clusterGroup) {
      scene.remove(clusterGroup);
      disposeObjectTree(clusterGroup);
      clusterGroup = null;
    }
    disposeObjectTree(scene);
    composer.dispose();
    renderer.dispose();
    if (renderer.domElement.parentElement === container) container.removeChild(renderer.domElement);
    if (labelRenderer.domElement.parentElement === container) container.removeChild(labelRenderer.domElement);
  }

  return { loadCluster, dispose, focusOnIsland: (storySlug: string) => focusOnIsland(storySlug) };

  function focusOnIsland(storySlug: string): void {
    const position = islandPositions.get(storySlug);
    if (!position) return;
    orbitTarget = position;
    syncCamera();
  }
}

export interface ArchipelagoWorld {
  loadCluster: (islands: ArchipelagoWorldIsland[], portals: ArchipelagoWorldPortal[]) => void;
  dispose: () => void;
  focusOnIsland: (storySlug: string) => void;
}

/** 這群用哪種分群方式載入，純粹是個標記型別給呼叫端用，這支檔案本身不
 *  需要知道 mode 是什麼（已經是正規化好的 islands/portals 陣列）。 */
export type { ClusterMode };
