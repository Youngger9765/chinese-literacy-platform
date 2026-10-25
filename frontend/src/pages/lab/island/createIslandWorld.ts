import * as THREE from 'three';
import { introProgress, characterPose } from './islandMotion';
import { BABIES, STOPS } from './islandData';

interface WorldEvents {
  onNear: (index: number | null) => void;
  onFogEdge: () => void;
  onMove: (x: number, z: number) => void;
  onHover?: (index: number | null) => void;
  onPick?: (index: number) => void;
  onWantFirstPerson?: () => void;
  onArrive?: (index: number) => void;
}


const zoneCenters = [
  { x: -2, z: 5, radius: 14 },
  { x: 11, z: -9, radius: 13 },
  { x: 13, z: -23, radius: 14 },
];

export type ViewMode = 'first' | 'god';
const zoneOf = (x: number, z: number) => {
  let best = 0; let dist = Infinity;
  zoneCenters.forEach((zone, index) => { const d = Math.hypot(x - zone.x, z - zone.z) / zone.radius; if (d < dist) { dist = d; best = index; } });
  return best;
};

export function createIslandWorld(container: HTMLElement, events: WorldEvents) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.7));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.35;
  container.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#bbd6dc');
  scene.fog = new THREE.FogExp2('#bbd6dc', 0.012);
  const camera = new THREE.PerspectiveCamera(57, 1, 0.1, 130);
  const ambient = new THREE.HemisphereLight(0xfff7dc, 0x60726e, 2.2);
  scene.add(ambient);
  const sun = new THREE.DirectionalLight(0xffe7b9, 3);
  sun.position.set(-12, 24, 18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -46;
  sun.shadow.camera.right = 46;
  sun.shadow.camera.top = 46;
  sun.shadow.camera.bottom = -46;
  scene.add(sun);

  const material = (color: number, extra: Record<string, unknown> = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...extra });
  const sand = material(0xd9c397);
  const grass = material(0x769b79);
  const cliff = material(0x69706b);
  const wood = material(0x80634d);
  const cream = material(0xf1dfb6);
  const slate = material(0x4b6173);
  const copper = material(0xa66d52);
  const gold = material(0xe7bb6b, { emissive: 0xc98626, emissiveIntensity: 0.12 });
  const water = material(0x4596ac, { metalness: 0.2, roughness: 0.32 });
  const glowMaterials: THREE.MeshStandardMaterial[] = [];
  const add = (parent: THREE.Object3D, geometry: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) => {
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };
  const box = (parent: THREE.Object3D, w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0) => add(parent, new THREE.BoxGeometry(w, h, d), mat, x, y, z);
  const cylinder = (parent: THREE.Object3D, top: number, bottom: number, h: number, mat: THREE.Material, x = 0, y = 0, z = 0, sides = 10) => add(parent, new THREE.CylinderGeometry(top, bottom, h, sides), mat, x, y, z);
  const cone = (parent: THREE.Object3D, r: number, h: number, mat: THREE.Material, x = 0, y = 0, z = 0) => add(parent, new THREE.ConeGeometry(r, h, 7), mat, x, y, z);

  const sea = add(scene, new THREE.PlaneGeometry(200, 200), water, 0, -2.8, 0);
  sea.rotation.x = -Math.PI / 2;
  sea.castShadow = false;
  const island = new THREE.Group();
  scene.add(island);
  zoneCenters.forEach(({ x, z, radius }, zone) => {
    const vertexCount = 42;
    const positions: number[] = [x, 0.35 + zone * 0.07, z];
    const indexes: number[] = [];
    for (let i = 0; i <= vertexCount; i++) {
      const angle = (i / vertexCount) * Math.PI * 2;
      const r = radius * (0.92 + 0.04 * Math.sin(i * 2.1) + 0.035 * Math.cos(i * 4.3));
      positions.push(x + Math.cos(angle) * r, 0.19 + 0.1 * Math.sin(i * 1.7), z + Math.sin(angle) * r);
      if (i > 0) indexes.push(0, i + 1, i);
    }
    const topGeometry = new THREE.BufferGeometry();
    topGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    topGeometry.setIndex(indexes);
    topGeometry.computeVertexNormals();
    add(island, new THREE.CylinderGeometry(radius * 0.89, radius * 0.7, 2.8, 16), cliff, x, -1.3, z);
    add(island, new THREE.CylinderGeometry(radius * 0.98, radius * 0.9, 0.25, 18), sand, x, 0.03, z);
    add(island, topGeometry, grass);
  });

  const paths = [
    [[-3, 12], [-5, 9], [-9, 5], [-5, 1], [0, 0], [3, 2]],
    [[3, 2], [4, -2], [7, -3], [12, -4], [8, -7], [5, -10], [10, -13], [17, -12]],
    [[17, -12], [20, -16], [23, -20], [18, -22], [14, -24], [9, -23], [2, -22], [12, -29], [22, -32]],
  ];
  paths.forEach((points, group) => {
    const curve = new THREE.CatmullRomCurve3(points.map(([x, z]) => new THREE.Vector3(x, 0.42, z)));
    const count = group === 0 ? 85 : 135;
    for (let i = 0; i < count; i++) {
      const p = curve.getPoint(i / count);
      const pathStone = cylinder(island, 0.42 + (i % 3) * 0.1, 0.46, 0.035, i % 5 === 0 ? sand : material(0xb9ae92), p.x, 0.43, p.z, 6);
      pathStone.rotation.y = i * 2.4;
    }
  });
  for (const [x, z, length, angle] of [[5, -2, 4.2, 0.48], [19, -15, 5, -0.55]] as const) {
    const bridge = new THREE.Group();
    bridge.position.set(x, 0.7, z);
    bridge.rotation.y = angle;
    scene.add(bridge);
    for (let i = -4; i <= 4; i++) box(bridge, 0.48, 0.1, 1.7, wood, (i * length) / 9, 0.08 + 0.13 * Math.cos(i / 4), 0);
    for (const side of [-1, 1]) {
      box(bridge, length + 0.6, 0.09, 0.1, copper, 0, 0.72, side * 0.85);
      for (const px of [-length / 2, 0, length / 2]) box(bridge, 0.1, 0.75, 0.1, wood, px, 0.38, side * 0.85);
    }
  }
  const streamCurve = new THREE.CatmullRomCurve3([new THREE.Vector3(-2, 0.43, -3), new THREE.Vector3(3, 0.43, -1), new THREE.Vector3(5, 0.43, -4), new THREE.Vector3(9, 0.43, -5)]);
  add(scene, new THREE.TubeGeometry(streamCurve, 60, 0.38, 8), water);

  const hillPositions = [[-8, -1, 3.5], [-1, -6, 4], [10, -15, 4.8], [19, -27, 4], [0, -28, 3.3]];
  hillPositions.forEach(([x, z, r], i) => {
    const hill = add(scene, new THREE.ConeGeometry(r, 2.3 + i % 3, 10), i % 2 ? grass : cliff, x, 1.25, z);
    hill.rotation.y = i * 0.9;
    if (i === 2) {
      const cave = add(scene, new THREE.TorusGeometry(1.15, 0.3, 8, 10, Math.PI), cliff, x + 1, 0.8, z + 2);
      cave.rotation.z = Math.PI;
    }
  });
  const zonedThings: THREE.Object3D[] = [];
  for (let i = 0; i < 105; i++) {
    const zone = zoneCenters[i % 3];
    const angle = i * 2.399;
    const radius = 5 + (i % 13) * 0.65;
    const x = zone.x + Math.sin(angle) * radius;
    const z = zone.z + Math.cos(angle) * radius;
    if (STOPS.some((stop) => Math.hypot(stop.x - x, stop.z - z) < 2.7)) continue;
    const tree = new THREE.Group();
    tree.position.set(x, 0.42, z);
    tree.userData.zone = zoneOf(x, z);
    zonedThings.push(tree);
    scene.add(tree);
    const height = 1.2 + (i % 5) * 0.18;
    cylinder(tree, 0.12, 0.18, height, wood, 0, height / 2);
    const leaves = material(i % 4 ? 0x517f68 : 0x71966b);
    cone(tree, 0.72, 1.5, leaves, 0, height + 0.35);
    cone(tree, 0.54, 1.2, leaves, 0, height + 0.9);
  }

  const buildingGroups: THREE.Group[] = [];
  const halos: THREE.Mesh[] = [];
  const lighthouseBeams: THREE.Group[] = [];
  STOPS.forEach((stop, i) => {
    const root = new THREE.Group();
    root.position.set(stop.x, 0.42, stop.z);
    root.userData.zone = stop.zone;
    root.userData.index = i;
    scene.add(root);
    buildingGroups.push(root);
    zonedThings.push(root);
    const halo = new THREE.Mesh(new THREE.TorusGeometry(2.1, 0.09, 8, 48), new THREE.MeshBasicMaterial({ color: 0xffe2a0, transparent: true, opacity: 0, depthWrite: false }));
    halo.rotation.x = Math.PI / 2;
    halo.position.y = 0.25;
    root.add(halo);
    halos.push(halo);
    cylinder(root, 1.65, 1.8, 0.2, sand, 0, 0.06);
    const windowMat = material(0x69858a, { emissive: 0xffd277, emissiveIntensity: 0 });
    glowMaterials.push(windowMat);
    if (i === 0) {
      cylinder(root, 0.72, 1.16, 4.9, cream, 0, 2.55);
      cylinder(root, 1.05, 1.05, 0.3, copper, 0, 5.05);
      cylinder(root, 0.95, 0.95, 1.05, windowMat, 0, 5.63);
      // 燈塔光束：錐尖在燈室、開口朝外，繞塔順時針轉（從上往下看）
      const beamPivot = new THREE.Group();
      beamPivot.position.set(0, 5.63, 0);
      beamPivot.userData.lighthouseBeam = true;
      root.add(beamPivot);
      const beamGeo = new THREE.ConeGeometry(0.9, 7, 20, 1, true);
      beamGeo.translate(0, -3.5, 0);
      beamGeo.rotateZ(Math.PI / 2);
      const beamMesh = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: 0xfff1c2, transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
      beamPivot.add(beamMesh);
      lighthouseBeams.push(beamPivot);
      cone(root, 1.18, 1.05, slate, 0, 6.7);
      for (let j = 0; j < 4; j++) box(root, 0.18, 1.65, 0.18, copper, Math.cos(j * Math.PI / 2) * 0.75, 5.64, Math.sin(j * Math.PI / 2) * 0.75);
    } else if (i === 1) {
      for (let j = -2; j <= 2; j++) {
        cylinder(root, 0.15, 0.18, 3.1, cream, j * 0.72, 1.65);
        const scroll = cylinder(root, 0.34, 0.34, 2.5, j % 2 ? copper : gold, j * 0.72, 2.18, -0.55, 12);
        scroll.rotation.z = Math.PI / 2;
      }
      box(root, 4.1, 0.35, 2.2, slate, 0, 3.3);
      for (let j = -2; j <= 2; j++) box(root, 0.45, 0.26, 2.5, gold, j * 0.72, 3.55);
    } else if (i === 2) {
      for (let row = 0; row < 4; row++) {
        const arc = add(root, new THREE.TorusGeometry(1.25 + row * 0.34, 0.12, 5, 24, Math.PI), row % 2 ? copper : cream, 0, 0.22 + row * 0.42, -row * 0.22);
        arc.rotation.x = Math.PI / 2;
      }
      box(root, 1.4, 2.2, 0.3, slate, 0, 1.2, -1.6);
      add(root, new THREE.TorusGeometry(0.47, 0.12, 8, 18), gold, 0, 2.3, -1.36);
    } else if (i === 3) {
      cylinder(root, 1.4, 1.6, 2, cream, 0, 1.1, 0, 8);
      for (let j = 0; j < 8; j++) {
        const a = j * Math.PI / 4;
        box(root, 0.18, 2.9, 0.16, copper, Math.sin(a) * 1.24, 1.55, Math.cos(a) * 1.24).rotation.y = a;
      }
      cone(root, 1.8, 1.6, slate, 0, 2.9);
      add(root, new THREE.TorusGeometry(0.42, 0.11, 8, 20), gold, 0, 2.25, 1.45);
    } else if (i === 4) {
      box(root, 3.3, 1.9, 2.2, cream, 0, 1.05);
      const roof = box(root, 3.8, 0.28, 2.7, copper, 0, 2.2);
      roof.rotation.z = -0.15;
      cylinder(root, 0.35, 0.4, 3.2, slate, 0.9, 3.15, -0.4);
      add(root, new THREE.TorusGeometry(0.45, 0.13, 8, 18), gold, -0.85, 2.8, 0.9);
      box(root, 1.1, 0.12, 0.65, wood, -0.6, 0.95, 1.5);
    } else if (i === 5) {
      cylinder(root, 1.2, 1.6, 3.6, cream, 0, 1.9, 0, 6);
      cone(root, 1.5, 1.5, slate, 0, 4.45);
      for (let j = 0; j < 4; j++) box(root, 0.8, 0.12, 0.95, gold, Math.cos(j * Math.PI / 2) * 1.1, 2.35 + j * 0.25, Math.sin(j * Math.PI / 2) * 1.1).rotation.y = j * Math.PI / 2;
    } else if (i === 6) {
      for (let j = -2; j <= 2; j++) cylinder(root, 0.17, 0.2, 3.2, cream, j * 0.7, 1.65, -0.5);
      box(root, 4, 0.35, 2.6, slate, 0, 3.38, -0.5);
      cone(root, 1.3, 1.9, gold, 0, 4.3, -0.5);
      for (let j = 0; j < 4; j++) cylinder(root, 0.23, 0.3, 0.7 + j * 0.15, copper, -1.2 + j * 0.8, 0.4, 1.25);
    } else if (i === 7) {
      for (let j = -2; j <= 2; j++) {
        cylinder(root, 0.09, 0.11, 1.4, wood, j * 0.73, 0.7);
        add(root, new THREE.IcosahedronGeometry(0.48, 1), j % 2 ? gold : material(0x9bbaa1), j * 0.73, 1.65);
      }
      add(root, new THREE.TorusGeometry(1.6, 0.1, 7, 18, Math.PI), cream, 0, 0.65, -0.9).rotation.x = Math.PI / 2;
    } else if (i === 8) {
      cylinder(root, 0.5, 0.7, 3.5, wood, 0, 1.8);
      for (let j = 0; j < 3; j++) add(root, new THREE.IcosahedronGeometry(1.25, 1), grass, (j - 1) * 0.6, 3.4 + (j % 2) * 0.5);
      box(root, 2.5, 1.3, 1.8, cream, 0, 4.1);
      cone(root, 1.7, 1.2, copper, 0, 5.35);
      box(root, 0.22, 3.5, 0.22, wood, 1.25, 2.2, 0.9);
    } else {
      cylinder(root, 0.9, 1.25, 4.4, slate, 0, 2.3, 0, 8);
      cylinder(root, 1.75, 1.75, 0.22, cream, 0, 4.55);
      for (let j = 0; j < 8; j++) {
        const a = j * Math.PI / 4;
        cylinder(root, 0.1, 0.1, 0.85, gold, Math.sin(a) * 1.35, 5.05, Math.cos(a) * 1.35);
      }
      add(root, new THREE.IcosahedronGeometry(0.48, 1), windowMat, 0, 5.45);
    }
    const signCanvas = document.createElement('canvas');
    signCanvas.width = 512;
    signCanvas.height = 100;
    const ctx = signCanvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#304a4e';
      ctx.fillRect(0, 0, 512, 100);
      ctx.strokeStyle = '#e7c783';
      ctx.lineWidth = 8;
      ctx.strokeRect(8, 8, 496, 84);
      ctx.fillStyle = '#fff3d2';
      ctx.font = 'bold 51px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(stop.name, 256, 53);
    }
    const texture = new THREE.CanvasTexture(signCanvas);
    const sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false }));
    sign.scale.set(3.3, 0.65, 1);
    sign.position.set(0, i === 0 ? 7.8 : i === 9 ? 6.2 : 4.5, 0);
    root.add(sign);
  });

  const textureLoader = new THREE.TextureLoader();
  const sprite = (url: string, width: number, height: number) => {
    const texture = textureLoader.load(url);
    texture.colorSpace = THREE.SRGBColorSpace;
    const item = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
    item.scale.set(width, height, 1);
    scene.add(item);
    return item;
  };
  const player = sprite('/lab-island/sprites/adventurer.png', 1.8, 2.3);
  player.position.set(-2, 1.5, 16.5);
  const xiaoling = sprite('/lab-island/sprites/xiaoling.png', 0.9, 1.1);
  const XL_FIRST = new THREE.Vector3(0.45, 0.55, 1);
  const babies = BABIES.map((baby) => {
    const item = sprite(`/lab-island/sprites/${baby.art}`, 1.5, 1.5);
    item.userData.zone = zoneOf(baby.x, baby.z);
    zonedThings.push(item);
    return item;
  });
  // 過關引導：下一關的光柱＋地上的光點
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.6, 26, 20, 1, true), new THREE.MeshBasicMaterial({ color: 0xffd98a, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
  beam.visible = false;
  scene.add(beam);
  const trailDots = Array.from({ length: 26 }, () => {
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffe7a8, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    dot.visible = false;
    scene.add(dot);
    return dot;
  });
  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2(0, 0);
  let mode: ViewMode = 'first';
  let pitch = -0.05;
  let dragY = 0;
  let hovered: number | null = null;
  let nextStop: number | null = 0;
  let guideUntil = 0;
  let turnTo: number | null = null;
  let travelTarget: number | null = null;
  // 沿途景色：每一區有自己的天色與霧色（港口海藍 → 山谷翠綠 → 高地金黃）
  const zoneSky = [new THREE.Color('#bcdde6'), new THREE.Color('#cfe6c8'), new THREE.Color('#f1ddb0')];
  const skyNow = new THREE.Color('#bcdde6');
  const fogs = zoneCenters.slice(1).map((zone, index) => {
    const group = new THREE.Group();
    group.position.set(zone.x, 2.2, zone.z);
    scene.add(group);
    const fogMat = new THREE.MeshBasicMaterial({ color: 0xc7d5d9, transparent: true, opacity: 0.97, depthWrite: false, side: THREE.DoubleSide });
    add(group, new THREE.SphereGeometry(zone.radius * 1.05, 24, 12), fogMat).scale.y = 0.55;
    for (let i = 0; i < 35; i++) {
      const a = i * 2.4;
      const r = zone.radius * Math.sqrt((i + 0.5) / 35);
      const cloudMat = new THREE.MeshBasicMaterial({ color: 0xe2e9e9, transparent: true, opacity: 0.8, depthWrite: false });
      add(group, new THREE.IcosahedronGeometry(1.2 + i % 3, 1), cloudMat, Math.sin(a) * r, -0.1 + i % 4, Math.cos(a) * r);
    }
    group.userData.zone = index + 1;
    return group;
  });

  let unlockedZone = 0;
  let completed: number[] = [];
  let keyDirection = { x: 0, z: 0 };
  let stickDirection = { x: 0, z: 0 };
  let yaw = 0;
  let dragX = 0;
  let jumping = 0;
  let verticalSpeed = 0;
  let elapsed = 0;
  let landedAt = -9;
  // 開場鏡頭：從海上空推近到主角眼前（-1 = 沒在播）
  let introStart = -1;
  const INTRO_SECONDS = 3.2;
  let last = performance.now();
  let frame = 0;
  let near: number | null = null;
  let fogMessageAt = 0;
  let paused = false;
  const keys = new Set<string>();
  const keydown = (event: KeyboardEvent) => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'w', 'a', 's', 'd'].includes(event.key)) event.preventDefault();
    keys.add(event.key.toLowerCase());
    if (event.key === ' ' && jumping === 0) verticalSpeed = 5.5;
  };
  const keyup = (event: KeyboardEvent) => keys.delete(event.key.toLowerCase());
  let downAt = { x: 0, y: 0 };
  const pointerdown = (event: PointerEvent) => { dragX = event.clientX; dragY = event.clientY; downAt = { x: event.clientX, y: event.clientY }; renderer.domElement.setPointerCapture(event.pointerId); };
  const pointerup = (event: PointerEvent) => {
    if (mode !== 'god' || Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y) > 6) return;
    // 放開滑鼠當下就判斷點到哪棟，不等下一個畫面（否則快點時會落空）
    const rect = renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hitNow = raycaster.intersectObjects(buildingGroups.filter((group) => group.visible), true)[0];
    let picked: number | null = null;
    if (hitNow) { let o: THREE.Object3D | null = hitNow.object; while (o && o.userData.index === undefined) o = o.parent; picked = (o?.userData.index as number | undefined) ?? null; }
    if (picked !== null) events.onPick?.(picked);
  };
  const pointermove = (event: PointerEvent) => {
    const rect = renderer.domElement.getBoundingClientRect();
    pointerNdc.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    if (!renderer.domElement.hasPointerCapture(event.pointerId)) return;
    yaw -= (event.clientX - dragX) * 0.005;
    if (mode === 'first') pitch = Math.max(-0.9, Math.min(0.7, pitch - (event.clientY - dragY) * 0.004));
    dragX = event.clientX;
    dragY = event.clientY;
    turnTo = null;
  };
  const resize = () => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('keydown', keydown);
  window.addEventListener('keyup', keyup);
  renderer.domElement.addEventListener('pointerdown', pointerdown);
  renderer.domElement.addEventListener('pointermove', pointermove);
  renderer.domElement.addEventListener('pointerup', pointerup);
  window.addEventListener('resize', resize);
  resize();

  const walkable = (x: number, z: number) =>
    zoneCenters.some((zone, index) => index <= unlockedZone && Math.hypot(x - zone.x, z - zone.z) < zone.radius - 1)
    && !zoneCenters.some((zone, index) => index > unlockedZone && Math.hypot(x - zone.x, z - zone.z) < zone.radius);
  const animate = (now: number) => {
    frame = requestAnimationFrame(animate);
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    elapsed += dt;
    if (!paused) {
      keyDirection = { x: Number(keys.has('d') || keys.has('arrowright')) - Number(keys.has('a') || keys.has('arrowleft')), z: Number(keys.has('s') || keys.has('arrowdown')) - Number(keys.has('w') || keys.has('arrowup')) };
      const dx = keyDirection.x + stickDirection.x;
      const dz = keyDirection.z + stickDirection.z;
      // 開場鏡頭還在飛的時候鎖住移動，免得學生在鏡頭外走到別站
      const introPlaying = introStart >= 0;
      let length = introPlaying ? 0 : Math.hypot(dx, dz);
      if (introPlaying) travelTarget = null;
      if (length > 0.08 && mode === 'god') events.onWantFirstPerson?.();
      if (length > 0.08) travelTarget = null;
      if (travelTarget !== null && mode === 'first') {
        const goal = STOPS[travelTarget];
        const gx = goal.x - player.position.x;
        const gz = goal.z - player.position.z;
        const dist = Math.hypot(gx, gz);
        if (dist < 2.9) {
          const arrived = travelTarget;
          travelTarget = null;
          events.onArrive?.(arrived);
        } else {
          yaw += Math.atan2(Math.sin(Math.atan2(-gx, -gz) - yaw), Math.cos(Math.atan2(-gx, -gz) - yaw)) * Math.min(1, dt * 3);
          const step = Math.min(dist - 2.8, dt * 6.5);
          player.position.x += (gx / dist) * step;
          player.position.z += (gz / dist) * step;
          events.onMove(player.position.x, player.position.z);
          length = 1;
        }
      }
      if (length > 0.08 && travelTarget === null) {
        const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
        const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
        const moveX = (right.x * dx + forward.x * -dz) / Math.max(1, length) * dt * 5.2;
        const moveZ = (right.z * dx + forward.z * -dz) / Math.max(1, length) * dt * 5.2;
        const nextX = player.position.x + moveX;
        const nextZ = player.position.z + moveZ;
        const buildingCollision = STOPS.some((stop) => Math.hypot(nextX - stop.x, nextZ - stop.z) < 1.55);
        const hillCollision = hillPositions.some(([x, z, r]) => Math.hypot(nextX - x, nextZ - z) < r * 0.7);
        if (walkable(nextX, nextZ) && !buildingCollision && !hillCollision) {
          player.position.x = nextX;
          player.position.z = nextZ;
          events.onMove(nextX, nextZ);
        } else if (now - fogMessageAt > 1700 && zoneCenters.some((zone, index) => index > unlockedZone && Math.hypot(nextX - zone.x, nextZ - zone.z) < zone.radius)) {
          fogMessageAt = now;
          events.onFogEdge();
        }
      }
      if (verticalSpeed !== 0 || jumping > 0) {
        jumping = Math.max(0, jumping + verticalSpeed * dt);
        verticalSpeed -= 15 * dt;
        if (jumping === 0) { verticalSpeed = 0; landedAt = elapsed; }
      }
      player.position.y = 1.55 + jumping + (length > 0.08 ? Math.sin(elapsed * 13) * 0.07 : 0);
      // 人物微動作：站著呼吸、走路擺動、落地壓扁
      const pose = characterPose({ elapsed, moving: length > 0.08 && jumping === 0, sinceLanded: elapsed - landedAt });
      player.scale.set(1.8 * pose.scaleX, 2.3 * pose.scaleY, 1);
      player.material.rotation = pose.tilt;
      xiaoling.material.rotation = Math.sin(elapsed * 2.2) * 0.07;
      xiaoling.position.set(player.position.x + 0.67, player.position.y + 0.85 + Math.sin(elapsed * 3) * 0.14, player.position.z + 0.12);
      let closest: number | null = null;
      let best = 3.25;
      STOPS.forEach((stop, index) => {
        if (stop.zone > unlockedZone) return;
        const d = Math.hypot(player.position.x - stop.x, player.position.z - stop.z);
        if (d < best) { best = d; closest = index; }
      });
      if (introPlaying) closest = null;
      if (closest !== near) { near = closest; events.onNear(closest); }
      babies.forEach((baby, index) => {
        const data = BABIES[index];
        baby.position.set(data.x + Math.sin(elapsed + index) * 0.32, 1.65 + Math.sin(elapsed * 2 + index) * 0.14, data.z + Math.cos(elapsed + index) * 0.3);
        baby.material.rotation = Math.hypot(player.position.x - data.x, player.position.z - data.z) < 3 ? Math.sin(elapsed * 2) * 0.16 : 0;
      });
      if (turnTo !== null) {
        const target = STOPS[turnTo];
        const want = Math.atan2(-(target.x - player.position.x), -(target.z - player.position.z));
        let diff = want - yaw;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        yaw += diff * Math.min(1, dt * 2.2);
        if (Math.abs(diff) < 0.02) turnTo = null;
      }
      if (mode === 'first') {
        player.visible = false;
        const eye = new THREE.Vector3(player.position.x, 1.75 + jumping + (length > 0.08 ? Math.sin(elapsed * 11) * 0.05 : 0), player.position.z);
        const look = new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
        const intro = introStart >= 0 ? introProgress(elapsed - introStart, INTRO_SECONDS) : 1;
        if (intro < 1) {
          // 從高空、主角背後遠處推近，視線從整座島慢慢收到主角前方
          const from = new THREE.Vector3(player.position.x + Math.sin(yaw) * 46, 34, player.position.z + Math.cos(yaw) * 46);
          camera.position.copy(from.lerp(eye, intro));
          const target = new THREE.Vector3(player.position.x, 0, player.position.z - 8).lerp(eye.clone().add(look), intro);
          camera.lookAt(target);
        } else {
          introStart = -1;
          camera.position.lerp(eye, Math.min(1, dt * 14));
          camera.lookAt(camera.position.clone().add(look));
        }
        xiaoling.scale.copy(XL_FIRST);
        xiaoling.position.copy(camera.position).add(new THREE.Vector3(Math.cos(yaw) * 1.25 - Math.sin(yaw) * 2.4, -0.55 + Math.sin(elapsed * 3) * 0.08, -Math.sin(yaw) * 1.25 - Math.cos(yaw) * 2.4));
      } else {
        player.visible = true;
        xiaoling.scale.set(0.9, 1.1, 1);
        const open = zoneCenters.filter((_, index) => index <= unlockedZone);
        const cx = open.reduce((sum, zone) => sum + zone.x, 0) / open.length;
        const cz = open.reduce((sum, zone) => sum + zone.z, 0) / open.length;
        const span = 22 + unlockedZone * 9;
        const desired = new THREE.Vector3(cx + Math.sin(yaw) * span * 0.55, span, cz + Math.cos(yaw) * span * 0.55);
        camera.position.lerp(desired, Math.min(1, dt * 3));
        camera.lookAt(cx, 0, cz);
      }
    }
    zonedThings.forEach((thing) => { thing.visible = (thing.userData.zone as number) <= unlockedZone; });
    skyNow.lerp(zoneSky[zoneOf(player.position.x, player.position.z)], Math.min(1, dt * 0.8));
    (scene.background as THREE.Color).copy(skyNow);
    (scene.fog as THREE.FogExp2).color.copy(skyNow);
    lighthouseBeams.forEach((pivot) => { pivot.visible = mode === 'first'; pivot.rotation.y -= dt * 0.9; });
    // 對準建築：第一人稱看畫面中央，上帝視角看滑鼠
    raycaster.setFromCamera(mode === 'first' ? new THREE.Vector2(0, 0) : pointerNdc, camera);
    const hit = raycaster.intersectObjects(buildingGroups.filter((group) => group.visible), true)[0];
    let found: number | null = null;
    if (hit) { let o: THREE.Object3D | null = hit.object; while (o && o.userData.index === undefined) o = o.parent; found = (o?.userData.index as number | undefined) ?? null; }
    if (found !== hovered) { hovered = found; events.onHover?.(found); }
    halos.forEach((halo, index) => {
      const mat = halo.material as THREE.MeshBasicMaterial;
      const on = index === hovered || index === near;
      mat.opacity += ((on ? 0.95 : index === nextStop ? 0.45 : 0) - mat.opacity) * Math.min(1, dt * 8);
      halo.scale.setScalar(1 + (on ? 0.12 * Math.sin(elapsed * 6) : 0.04 * Math.sin(elapsed * 2)));
      buildingGroups[index].scale.setScalar(1 + (index === hovered ? 0.035 : 0));
    });
    // 下一關的引導光柱與光點
    if (nextStop !== null && STOPS[nextStop].zone <= unlockedZone) {
      const target = STOPS[nextStop];
      const closeToTarget = Math.hypot(player.position.x - target.x, player.position.z - target.z) < 6;
      beam.visible = !closeToTarget || mode === 'god';
      beam.position.set(target.x, 14, target.z);
      (beam.material as THREE.MeshBasicMaterial).opacity = 0.12 + 0.06 * Math.sin(elapsed * 2.5) + (elapsed < guideUntil ? 0.15 : 0);
      const from = new THREE.Vector3(player.position.x, 0.6, player.position.z);
      const to = new THREE.Vector3(target.x, 0.6, target.z);
      const gap = from.distanceTo(to);
      const showTrail = gap > 8;
      const t0 = Math.min(0.9, 3 / Math.max(gap, 0.001)); // 光點離主角至少 3 公尺
      trailDots.forEach((dot, k) => {
        // 光點從腳前 2 公尺開始，不擠在鏡頭前
        const t = t0 + (((k / trailDots.length) + elapsed * 0.18) % 1) * (1 - t0);
        dot.visible = showTrail;
        dot.position.lerpVectors(from, to, t);
        dot.position.y = 0.6 + Math.sin(t * Math.PI) * 1.2 + Math.sin(elapsed * 4 + k) * 0.06;
        dot.scale.setScalar(0.6 + Math.sin(t * Math.PI) * 0.8);
      });
    } else {
      beam.visible = false;
      trailDots.forEach((dot) => { dot.visible = false; });
    }
    fogs.forEach((fog, index) => {
      const open = index + 1 <= unlockedZone;
      const target = open ? 0.001 : 1;
      const scale = fog.scale.x + (target - fog.scale.x) * Math.min(1, dt * 0.55);
      fog.scale.setScalar(Math.max(0.001, scale));
      fog.visible = scale > 0.03;
      fog.rotation.y += dt * 0.015;
    });
    glowMaterials.forEach((mat, index) => { mat.emissiveIntensity = completed.includes(index) ? 2.2 + Math.sin(elapsed * 3) * 0.3 : 0; });
    renderer.render(scene, camera);
  };
  frame = requestAnimationFrame(animate);
  return {
    setProgress(nextZone: number, done: number[]) {
      const newlyDone = done.length > completed.length;
      unlockedZone = nextZone;
      completed = done;
      const next = STOPS.findIndex((_, index) => !done.includes(index));
      nextStop = next < 0 ? null : next;
      if (newlyDone && nextStop !== null) { guideUntil = elapsed + 12; turnTo = nextStop; }
    },
    setMode(next: ViewMode) { mode = next; if (next === 'first') pitch = -0.05; },
    travelTo(index: number) { travelTarget = index; mode = 'first'; pitch = -0.05; },
    setStick(x: number, z: number) { stickDirection = { x, z }; },
    setPaused(value: boolean) { paused = value; },
    jump() { if (jumping === 0) verticalSpeed = 5.5; },
    playIntro() { introStart = elapsed; mode = 'first'; pitch = -0.05; },
    getPosition() { return { x: player.position.x, z: player.position.z }; },
    dispose() {
      cancelAnimationFrame(frame);
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('keyup', keyup);
      window.removeEventListener('resize', resize);
      renderer.domElement.removeEventListener('pointerdown', pointerdown);
      renderer.domElement.removeEventListener('pointermove', pointermove);
      renderer.domElement.removeEventListener('pointerup', pointerup);
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) object.geometry.dispose();
        if (object instanceof THREE.Sprite) object.material.map?.dispose();
      });
      renderer.dispose();
      container.removeChild(renderer.domElement);
    },
  };
}
