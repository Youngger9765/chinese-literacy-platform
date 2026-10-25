/**
 * 喝采島的動態數字（純函式，方便測試）。
 * 幅度參考 game-juice-motion：微動作要「感覺得到、說不出來」，呼吸 2–3%、擺動約 3 度。
 */

/** 開場鏡頭推近的進度 0→1，ease-out：前段快、最後慢慢停到主角眼前 */
export function introProgress(t: number, duration: number): number {
  if (t <= 0) return 0;
  if (t >= duration) return 1;
  const x = t / duration;
  return 1 - (1 - x) ** 3;
}

export interface CharacterPose {
  scaleX: number;
  scaleY: number;
  /** 左右擺動的角度（弧度） */
  tilt: number;
}

const LAND_SQUASH_SECONDS = 0.25;

export function characterPose({ elapsed, moving, sinceLanded }: { elapsed: number; moving: boolean; sinceLanded: number }): CharacterPose {
  // 落地：先壓扁再彈回，體積守恆（變矮就變寬）
  if (sinceLanded >= 0 && sinceLanded < LAND_SQUASH_SECONDS) {
    const k = 1 - sinceLanded / LAND_SQUASH_SECONDS;
    const squash = 0.14 * k;
    return { scaleX: 1 + squash * 0.7, scaleY: 1 - squash, tilt: 0 };
  }
  if (moving) {
    return { scaleX: 1, scaleY: 1, tilt: Math.sin(elapsed * 13) * 0.055 };
  }
  // 站著：一分鐘大約 24 次呼吸（每 2.5 秒一次）
  const breath = Math.sin(elapsed * Math.PI * 0.8) * 0.022;
  return { scaleX: 1 - breath * 0.5, scaleY: 1 + breath, tilt: 0 };
}
