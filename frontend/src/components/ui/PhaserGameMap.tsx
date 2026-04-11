/**
 * PhaserGameMap — Phaser 3 RPG-style tile map for learning step navigation.
 *
 * Renders a 2D top-down tile map with:
 * - Three themed regions (探索森林, 字詞城堡, 挑戰火山)
 * - Buildings for each of the 10 learning steps
 * - A player character that moves via arrow keys or click-to-walk
 * - Visual states: completed (green), current (pulsing), locked (grey)
 *
 * All graphics are generated programmatically — no external assets needed.
 * Uses Canvas renderer for Chromebook compatibility.
 */
import React, { useEffect, useRef, useCallback } from 'react';
import Phaser from 'phaser';

// ── Types ────────────────────────────────────────────────────────────────────

export interface PhaserGameMapProps {
  steps: { id: string; label: string }[];
  completedSteps: Set<string>;
  currentStepId: string;
  onStepClick: (stepId: string) => void;
}

// ── Constants ────────────────────────────────────────────────────────────────

const TILE = 32;
const MAP_COLS = 20;
const MAP_ROWS = 22;
const PLAYER_SPEED = 160;

/** Step labels for the 10 learning steps */
const STEP_LABELS = [
  '讀全文做記號', '逐段朗讀', '全文朗讀',
  '生字練習', '詞語定義', '語詞應用',
  '課文理解', '語詞複習', '知識補給站', '診斷報告',
];

/** Region definitions */
const REGIONS = [
  { name: '探索森林', color: 0x228b22, tint: 0x2d8f2d, steps: [0, 1, 2] },
  { name: '字詞城堡', color: 0xd4a017, tint: 0xc8a830, steps: [3, 4, 5] },
  { name: '挑戰火山', color: 0xcc4422, tint: 0xb8442a, steps: [6, 7, 8, 9] },
];

/** Building positions on the tile grid (col, row) — hand-crafted layout */
const BUILDING_POSITIONS: [number, number][] = [
  [4, 3],    // 0: 讀全文做記號
  [10, 2],   // 1: 逐段朗讀
  [16, 4],   // 2: 全文朗讀
  [3, 9],    // 3: 生字練習
  [10, 8],   // 4: 詞語定義
  [16, 10],  // 5: 語詞應用
  [4, 15],   // 6: 課文理解
  [10, 14],  // 7: 語詞複習
  [16, 16],  // 8: 知識補給站
  [10, 20],  // 9: 診斷報告
];

// ── Phaser Scene ─────────────────────────────────────────────────────────────

class RPGMapScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Container;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private buildings: Phaser.GameObjects.Container[] = [];
  private buildingZones: Phaser.GameObjects.Zone[] = [];
  private pathTarget: { x: number; y: number } | null = null;
  private nearBuilding: number = -1;
  private promptText!: Phaser.GameObjects.Text;
  private pulsingBuildings: number[] = [];

  // Props passed from React
  public stepIds: string[] = [];
  public completedSet: Set<string> = new Set();
  public currentId = '';
  public onStepClick: (id: string) => void = () => {};

  constructor() {
    super({ key: 'RPGMapScene' });
  }

  create() {
    const cam = this.cameras.main;
    cam.setBackgroundColor('#3a7d44');

    // Draw tile map
    this.drawTileMap();

    // Draw paths between buildings
    this.drawPaths();

    // Draw region labels
    this.drawRegionLabels();

    // Draw buildings
    this.drawBuildings();

    // Create player
    this.createPlayer();

    // Keyboard input
    if (this.input.keyboard) {
      this.cursors = this.input.keyboard.createCursorKeys();
      // Enter key to interact
      this.input.keyboard.on('keydown-ENTER', () => {
        if (this.nearBuilding >= 0) {
          const stepId = this.stepIds[this.nearBuilding];
          if (stepId && (this.completedSet.has(stepId) || stepId === this.currentId)) {
            this.onStepClick(stepId);
          }
        }
      });
      this.input.keyboard.on('keydown-SPACE', () => {
        if (this.nearBuilding >= 0) {
          const stepId = this.stepIds[this.nearBuilding];
          if (stepId && (this.completedSet.has(stepId) || stepId === this.currentId)) {
            this.onStepClick(stepId);
          }
        }
      });
    }

    // Click to walk
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      this.pathTarget = { x: pointer.worldX, y: pointer.worldY };
    });

    // Prompt text
    this.promptText = this.add.text(0, 0, '', {
      fontSize: '11px',
      fontFamily: 'sans-serif',
      color: '#ffffff',
      backgroundColor: '#00000088',
      padding: { x: 4, y: 2 },
    }).setOrigin(0.5).setDepth(100).setVisible(false);

    // Camera follows player
    cam.setBounds(0, 0, MAP_COLS * TILE, MAP_ROWS * TILE);
    cam.startFollow(this.player, true, 0.08, 0.08);

    // Decorations
    this.addDecorations();
  }

  update() {
    if (!this.player) return;

    const body = (this.player.body as Phaser.Physics.Arcade.Body);
    body.setVelocity(0);

    let moving = false;

    // Keyboard movement
    if (this.cursors) {
      if (this.cursors.left.isDown) { body.setVelocityX(-PLAYER_SPEED); moving = true; }
      else if (this.cursors.right.isDown) { body.setVelocityX(PLAYER_SPEED); moving = true; }
      if (this.cursors.up.isDown) { body.setVelocityY(-PLAYER_SPEED); moving = true; }
      else if (this.cursors.down.isDown) { body.setVelocityY(PLAYER_SPEED); moving = true; }
    }

    // Cancel click-path if keyboard used
    if (moving) {
      this.pathTarget = null;
    }

    // Click-to-walk
    if (this.pathTarget && !moving) {
      const dx = this.pathTarget.x - this.player.x;
      const dy = this.pathTarget.y - this.player.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 4) {
        this.pathTarget = null;
      } else {
        const vx = (dx / dist) * PLAYER_SPEED;
        const vy = (dy / dist) * PLAYER_SPEED;
        body.setVelocity(vx, vy);
      }
    }

    // Check proximity to buildings
    this.nearBuilding = -1;
    for (let i = 0; i < this.buildings.length; i++) {
      const b = this.buildings[i];
      const dx = b.x - this.player.x;
      const dy = b.y - this.player.y;
      if (Math.sqrt(dx * dx + dy * dy) < TILE * 2) {
        this.nearBuilding = i;
        break;
      }
    }

    // Show/hide prompt
    if (this.nearBuilding >= 0) {
      const stepId = this.stepIds[this.nearBuilding];
      const accessible = stepId && (this.completedSet.has(stepId) || stepId === this.currentId);
      const b = this.buildings[this.nearBuilding];
      this.promptText.setPosition(b.x, b.y - TILE * 1.8);
      this.promptText.setText(accessible ? '按 Enter 進入' : '🔒 尚未解鎖');
      this.promptText.setVisible(true);
    } else {
      this.promptText.setVisible(false);
    }

    // Pulse current step buildings
    const time = this.time.now;
    for (const idx of this.pulsingBuildings) {
      const b = this.buildings[idx];
      if (b) {
        const scale = 1 + 0.05 * Math.sin(time / 300);
        b.setScale(scale);
      }
    }
  }

  private drawTileMap() {
    const gfx = this.add.graphics();

    // Region row ranges
    const regionRows = [
      { startRow: 0, endRow: 7, color: 0x2d8f2d },   // forest - green
      { startRow: 7, endRow: 13, color: 0x8b7d3c },   // castle - amber
      { startRow: 13, endRow: MAP_ROWS, color: 0x8b4422 }, // volcano - red/brown
    ];

    for (const region of regionRows) {
      for (let r = region.startRow; r < region.endRow; r++) {
        for (let c = 0; c < MAP_COLS; c++) {
          // Base grass with slight variation
          const variation = ((r * 7 + c * 13) % 5) * 4;
          const baseR = (region.color >> 16) & 0xff;
          const baseG = (region.color >> 8) & 0xff;
          const baseB = region.color & 0xff;
          const tileColor = Phaser.Display.Color.GetColor(
            Math.min(255, baseR + variation),
            Math.min(255, baseG + variation),
            Math.min(255, baseB + variation),
          );
          gfx.fillStyle(tileColor);
          gfx.fillRect(c * TILE, r * TILE, TILE, TILE);

          // Subtle grid lines
          gfx.lineStyle(1, 0x00000015);
          gfx.strokeRect(c * TILE, r * TILE, TILE, TILE);
        }
      }
    }
  }

  private drawPaths() {
    const gfx = this.add.graphics();
    gfx.lineStyle(6, 0xd2b48c, 0.8);

    for (let i = 0; i < BUILDING_POSITIONS.length - 1; i++) {
      const [c1, r1] = BUILDING_POSITIONS[i];
      const [c2, r2] = BUILDING_POSITIONS[i + 1];
      const x1 = c1 * TILE + TILE / 2;
      const y1 = r1 * TILE + TILE / 2;
      const x2 = c2 * TILE + TILE / 2;
      const y2 = r2 * TILE + TILE / 2;

      // Draw path with a slight curve (L-shaped segments)
      const midX = (x1 + x2) / 2;
      gfx.beginPath();
      gfx.moveTo(x1, y1);
      gfx.lineTo(midX, y1);
      gfx.lineTo(midX, y2);
      gfx.lineTo(x2, y2);
      gfx.strokePath();

      // Dotted texture on path
      gfx.fillStyle(0xc4a87c, 0.4);
      const steps = 8;
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        let px: number, py: number;
        if (t < 0.33) {
          px = x1 + (midX - x1) * (t / 0.33);
          py = y1;
        } else if (t < 0.66) {
          px = midX;
          py = y1 + (y2 - y1) * ((t - 0.33) / 0.33);
        } else {
          px = midX + (x2 - midX) * ((t - 0.66) / 0.34);
          py = y2;
        }
        gfx.fillCircle(px, py, 2);
      }
    }
  }

  private drawRegionLabels() {
    const regions = [
      { name: '🌲 探索森林', y: 0 },
      { name: '🏰 字詞城堡', y: 7 },
      { name: '🌋 挑戰火山', y: 13 },
    ];

    for (const r of regions) {
      // Banner background
      const gfx = this.add.graphics();
      gfx.fillStyle(0x000000, 0.35);
      gfx.fillRoundedRect(TILE * 0.5, r.y * TILE + TILE * 0.2, TILE * 5, TILE * 0.9, 4);

      this.add.text(TILE * 0.8, r.y * TILE + TILE * 0.35, r.name, {
        fontSize: '13px',
        fontFamily: 'sans-serif',
        color: '#ffffff',
        fontStyle: 'bold',
      }).setDepth(10);
    }
  }

  private drawBuildings() {
    this.buildings = [];
    this.buildingZones = [];
    this.pulsingBuildings = [];

    for (let i = 0; i < BUILDING_POSITIONS.length; i++) {
      const [col, row] = BUILDING_POSITIONS[i];
      const x = col * TILE + TILE / 2;
      const y = row * TILE + TILE / 2;
      const stepId = this.stepIds[i] ?? '';
      const label = STEP_LABELS[i] ?? `步驟${i + 1}`;

      const isCompleted = this.completedSet.has(stepId);
      const isCurrent = stepId === this.currentId;
      const isLocked = !isCompleted && !isCurrent;

      // Building color
      let buildingColor = 0x888888; // locked grey
      let roofColor = 0x666666;
      if (isCompleted) {
        buildingColor = 0x4caf50;
        roofColor = 0x2e7d32;
      } else if (isCurrent) {
        buildingColor = 0xffc107;
        roofColor = 0xf57f17;
      }

      const container = this.add.container(x, y);

      // Building shadow
      const shadow = this.add.graphics();
      shadow.fillStyle(0x000000, 0.2);
      shadow.fillEllipse(2, TILE * 0.4, TILE * 1.5, TILE * 0.4);
      container.add(shadow);

      // Building body
      const body = this.add.graphics();
      body.fillStyle(buildingColor);
      body.fillRoundedRect(-TILE * 0.6, -TILE * 0.5, TILE * 1.2, TILE, 3);
      // Roof
      body.fillStyle(roofColor);
      body.fillTriangle(
        -TILE * 0.7, -TILE * 0.5,
        0, -TILE,
        TILE * 0.7, -TILE * 0.5,
      );
      // Door
      body.fillStyle(0x5d4037);
      body.fillRect(-TILE * 0.15, TILE * 0.1, TILE * 0.3, TILE * 0.4);
      container.add(body);

      // Step number badge
      const badge = this.add.graphics();
      badge.fillStyle(0x000000, 0.5);
      badge.fillCircle(TILE * 0.5, -TILE * 0.3, 9);
      container.add(badge);

      this.add.text(x + TILE * 0.5, y - TILE * 0.3, `${i + 1}`, {
        fontSize: '10px',
        fontFamily: 'sans-serif',
        color: '#ffffff',
        fontStyle: 'bold',
      }).setOrigin(0.5).setDepth(20);

      // Label below building
      this.add.text(x, y + TILE * 0.7, label, {
        fontSize: '10px',
        fontFamily: 'sans-serif',
        color: '#ffffff',
        backgroundColor: '#00000066',
        padding: { x: 3, y: 1 },
      }).setOrigin(0.5).setDepth(20);

      // Lock icon for locked buildings
      if (isLocked) {
        this.add.text(x, y - TILE * 0.1, '🔒', {
          fontSize: '14px',
        }).setOrigin(0.5).setDepth(25);
      }

      // Checkmark for completed
      if (isCompleted) {
        this.add.text(x, y - TILE * 0.1, '✓', {
          fontSize: '16px',
          fontFamily: 'sans-serif',
          color: '#ffffff',
          fontStyle: 'bold',
        }).setOrigin(0.5).setDepth(25);
      }

      // Star for current
      if (isCurrent) {
        this.add.text(x, y - TILE * 0.1, '⭐', {
          fontSize: '14px',
        }).setOrigin(0.5).setDepth(25);
        this.pulsingBuildings.push(i);
      }

      container.setDepth(15);
      this.buildings.push(container);

      // Clickable zone
      const zone = this.add.zone(x, y, TILE * 2, TILE * 2).setInteractive();
      zone.on('pointerdown', () => {
        // Walk to building
        this.pathTarget = { x, y: y + TILE };
        // If already near and accessible, trigger step
        if (this.nearBuilding === i) {
          if (isCompleted || isCurrent) {
            this.onStepClick(stepId);
          }
        }
      });
      this.buildingZones.push(zone);
    }
  }

  private createPlayer() {
    // Start at first building position
    const [startCol, startRow] = BUILDING_POSITIONS[0];
    const startX = startCol * TILE + TILE / 2;
    const startY = startRow * TILE + TILE / 2 + TILE;

    const container = this.add.container(startX, startY);

    // Character body (simple pixel-art style)
    const gfx = this.add.graphics();
    // Body
    gfx.fillStyle(0x4488ff);
    gfx.fillRoundedRect(-8, -4, 16, 16, 3);
    // Head
    gfx.fillStyle(0xffcc99);
    gfx.fillCircle(0, -10, 8);
    // Eyes
    gfx.fillStyle(0x333333);
    gfx.fillCircle(-3, -11, 2);
    gfx.fillCircle(3, -11, 2);
    // Hat
    gfx.fillStyle(0xcc3333);
    gfx.fillRect(-7, -18, 14, 4);
    gfx.fillRect(-4, -22, 8, 5);

    container.add(gfx);

    // Direction indicator
    const arrow = this.add.text(0, 16, '▼', {
      fontSize: '8px',
      color: '#4488ff',
    }).setOrigin(0.5);
    container.add(arrow);

    container.setDepth(50);

    // Physics
    this.physics.world.enable(container);
    const body = container.body as Phaser.Physics.Arcade.Body;
    body.setCollideWorldBounds(true);
    body.setSize(16, 16);
    body.setOffset(-8, -4);

    this.player = container;
  }

  private addDecorations() {
    const trees = [
      [1, 1], [18, 1], [0, 5], [19, 5], [7, 5], [13, 6],
      [1, 12], [18, 12], [6, 11], [14, 11],
      [0, 17], [19, 17], [7, 18], [13, 19],
    ];

    for (const [c, r] of trees) {
      const x = c * TILE + TILE / 2;
      const y = r * TILE + TILE / 2;
      // Tree trunk
      const gfx = this.add.graphics();
      gfx.fillStyle(0x5d4037);
      gfx.fillRect(x - 2, y - 2, 4, 8);
      // Tree crown
      const regionIdx = r < 7 ? 0 : r < 13 ? 1 : 2;
      const crownColors = [0x1b5e20, 0x6d5f00, 0x8b2500];
      gfx.fillStyle(crownColors[regionIdx]);
      gfx.fillCircle(x, y - 6, 8);
      gfx.setDepth(5);
    }

    // Water/pond near castle region
    const pondGfx = this.add.graphics();
    pondGfx.fillStyle(0x2196f3, 0.6);
    pondGfx.fillEllipse(TILE * 8, TILE * 11.5, TILE * 2, TILE * 1.2);
    pondGfx.setDepth(3);
  }

  /** Called from React when props change */
  refreshState(stepIds: string[], completedSet: Set<string>, currentId: string, onStepClick: (id: string) => void) {
    this.stepIds = stepIds;
    this.completedSet = completedSet;
    this.currentId = currentId;
    this.onStepClick = onStepClick;
  }
}

// ── React Component ──────────────────────────────────────────────────────────

const PhaserGameMap: React.FC<PhaserGameMapProps> = ({
  steps,
  completedSteps,
  currentStepId,
  onStepClick,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const sceneRef = useRef<RPGMapScene | null>(null);

  // Keep a stable ref for the callback
  const onStepClickRef = useRef(onStepClick);
  onStepClickRef.current = onStepClick;

  const stableOnStepClick = useCallback((id: string) => {
    onStepClickRef.current(id);
  }, []);

  // Initialize Phaser
  useEffect(() => {
    if (!containerRef.current || gameRef.current) return;

    const scene = new RPGMapScene();
    scene.stepIds = steps.map((s) => s.id);
    scene.completedSet = completedSteps;
    scene.currentId = currentStepId;
    scene.onStepClick = stableOnStepClick;
    sceneRef.current = scene;

    const parentEl = containerRef.current;
    const w = parentEl.clientWidth || 320;
    const h = parentEl.clientHeight || 600;

    const game = new Phaser.Game({
      type: Phaser.CANVAS,
      parent: parentEl,
      width: w,
      height: h,
      backgroundColor: '#3a7d44',
      physics: {
        default: 'arcade',
        arcade: {
          gravity: { x: 0, y: 0 },
          debug: false,
        },
      },
      scene: scene,
      scale: {
        mode: Phaser.Scale.RESIZE,
        autoCenter: Phaser.Scale.CENTER_BOTH,
      },
      input: {
        keyboard: true,
        mouse: true,
        touch: true,
      },
      render: {
        pixelArt: true,
        antialias: false,
      },
    });

    gameRef.current = game;

    // ResizeObserver to keep canvas in sync
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          game.scale.resize(width, height);
        }
      }
    });
    resizeObserver.observe(parentEl);

    return () => {
      resizeObserver.disconnect();
      game.destroy(true);
      gameRef.current = null;
      sceneRef.current = null;
    };
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update scene when props change (without recreating the game)
  useEffect(() => {
    if (sceneRef.current) {
      sceneRef.current.refreshState(
        steps.map((s) => s.id),
        completedSteps,
        currentStepId,
        stableOnStepClick,
      );
    }
  }, [steps, completedSteps, currentStepId, stableOnStepClick]);

  return (
    <div className="flex flex-col h-full">
      {/* Instructions */}
      <div className="px-3 py-2 text-xs text-gray-500 bg-white/60 border-b border-gray-100 flex items-center gap-2">
        <span>🎮</span>
        <span>方向鍵移動 · 點擊建築走過去 · Enter 進入關卡</span>
      </div>
      {/* Phaser canvas container */}
      <div
        ref={containerRef}
        className="flex-1 min-h-0"
        style={{ cursor: 'pointer' }}
      />
    </div>
  );
};

export default PhaserGameMap;
