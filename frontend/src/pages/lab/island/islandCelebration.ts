/**
 * #3780 P0-3（playtest 2026-10-26）：「點亮那一刻要看得到，回饋強度要跟
 * 努力成正比。現在回島時鏡頭已經轉向下一站，剛點亮的那一站根本不在畫面
 * 裡」——回饋分級（哪一站給多大的慶祝）要寫成資料表，不要寫死在判斷式裡
 * （之前每加一種站都要改一次 if/else，而且散落在呼叫端各處）。
 *
 * 「輕」給小亮（課程簡介、純複習性質的站），「重」給大一點的慶祝（真正
 * 要花力氣完成的練習站）——不是按「用的時間長短」分，是按「這一關對
 * 學生而言是不是一次真正的努力」分。
 */

export type CelebrationTier = 'light' | 'heavy';

export const STATION_CELEBRATION_TIER: Record<string, CelebrationTier> = {
  'lesson-intro': 'light',
  'full-text-annotate': 'heavy',
  'key-passage-reading': 'heavy',
  'vocab-definition': 'light',
  'vocab-application': 'heavy',
  spotlight: 'heavy',
  'keypoints-table': 'heavy',
  comprehension: 'heavy',
  'vocab-review': 'light',
  'knowledge-station': 'light',
  report: 'heavy',
  'classical-text': 'heavy',
  'classical-sentence-matching': 'heavy',
  'classical-word-matching': 'light',
  'classical-self-challenge': 'light',
};

export interface CelebrationProfile {
  tier: CelebrationTier;
  /** 回島後先面向剛完成的站，停留這麼多秒再轉向下一站。 */
  holdSeconds: number;
  /** 慶祝粒子數量。 */
  particleCount: number;
}

export const CELEBRATION_PROFILES: Record<CelebrationTier, CelebrationProfile> = {
  light: { tier: 'light', holdSeconds: 1.1, particleCount: 6 },
  heavy: { tier: 'heavy', holdSeconds: 1.6, particleCount: 18 },
};

/**
 * 查不到的 step type（理論上不該發生，`STEP_BUILDING_META` 涵蓋全平台用過
 * 的所有 step）一律當 heavy——寧可多慶祝，也不要讓一個新站型漏接時悄悄
 * 變成「什麼反應都沒有」。
 */
export function celebrationProfileForStep(step: string): CelebrationProfile {
  const tier = STATION_CELEBRATION_TIER[step.split('#')[0]] ?? 'heavy';
  return CELEBRATION_PROFILES[tier];
}

/**
 * 慶祝序列的三段式狀態機——#3780 P0-3 二次審查訂正（2026-10-27）。
 *
 * 原本「轉向剛完成的站」跟「算停留秒數」寫在 `createIslandWorld.ts` 裡，
 * 是同一刻一起開始的（`celebrationUntil = elapsed + holdSeconds` 跟
 * `turnTo = justCompleted` 同一行）。玩家離那棟建築很遠時（例如用清單
 * 模式直接開站、沒有真的走過去，需要轉動較大角度），轉頭動畫跟停留計時
 * 並行跑，停留秒數會被轉頭時間吃掉，甚至轉到一半就已經開始轉去下一站
 * ——剛完成的站從頭到尾沒有真的入鏡（team-lead/Young 2026-10-27 真瀏覽器
 * 截圖退件）。
 *
 * 第一版修法直接把這三個變數（`celebrationPhase`／`celebrationUntil`／
 * `pendingNextStop`）攤開寫在 `createIslandWorld.ts` 的 three.js 閉包裡，
 * 審查員抓到：所有既有測試都 mock 掉 `createIslandWorld`，真正的狀態機
 * 從沒被任何測試跑到過——退回舊寫法（「setProgress 當下就設
 * celebrationUntil」）1528 條測試照樣全綠。抽成這幾個不碰 three.js／
 * WebGL 的純函式，`createIslandWorld.ts` 的 `animate()` 只呼叫它們，
 * 才鎖得住。
 */
export interface CelebrationState {
  /** 剛完成的那一站在 `content.stops` 裡的 index。 */
  readonly index: number;
  readonly profile: CelebrationProfile;
  readonly phase: 'turning' | 'holding';
  /** 只有 `phase === 'holding'` 才有意義——'turning' 階段這個值不會被讀。 */
  readonly holdUntil: number;
  readonly pendingNextStop: number | null;
}

/**
 * 開始慶祝一個剛完成的站——永遠從 'turning' 階段開始。這一刻還不知道
 * 「轉到」要花多久，所以 `holdUntil` 填 0 只是佔位，`isHoldComplete` 在
 * 'turning' 階段永遠回傳 false，不會去讀這個值（這正是鎖住舊 bug 的
 * 關鍵：舊寫法是這裡就直接把 phase 設成等同 'holding' 並算好
 * `holdUntil`，等於轉頭動畫還沒開始跑，停留計時已經在倒數）。
 *
 * 呼叫端若在前一個慶祝還沒播完時又呼叫一次（「慶祝中又完成另一站」），
 * 這裡**不會**合併或排隊前一個——直接回傳全新的 state，等於放棄前一個
 * （它永遠不會走到 holdUntil、呼叫端也就永遠不會對它觸發「轉向下一站」
 * 事件）。這是刻意的規則，不是沒想到：目前產品面一次只會回報一站完成
 * （見 `returnToIsland`），真的連續撞上這個情境時，「以最新完成的為準」
 * 比「排隊播完每一個」更不會讓玩家對著一個已經過去的畫面空等。
 */
export function startCelebration(index: number, step: string, pendingNextStop: number | null): CelebrationState {
  return { index, profile: celebrationProfileForStep(step), phase: 'turning', holdUntil: 0, pendingNextStop };
}

/**
 * 鏡頭轉向剛完成的站這個動作收斂了（呼叫端的 `turnTo` 插值歸零）——這時
 * 候才真正開始算停留秒數。已經在 'holding' 階段時是安全的 no-op（不會
 * 把 `holdUntil` 往後挪）——呼叫端是每一幀檢查一次「turnTo 是不是
 * null」，轉到之後的每一幀都會符合條件、重複呼叫到這支。
 */
export function advanceOnTurnConverged(state: CelebrationState, elapsed: number): CelebrationState {
  if (state.phase === 'holding') return state;
  return { ...state, phase: 'holding', holdUntil: elapsed + state.profile.holdSeconds };
}

/**
 * 停留夠了沒——'turning' 階段（還沒轉到）永遠回傳 false，不管 `elapsed`
 * 多大。這就是鎖住舊 bug 的斷言點：舊寫法讓「停留完成」從 `setProgress`
 * 呼叫的那一刻就可能成立，不等轉頭動畫收斂。
 */
export function isHoldComplete(state: CelebrationState, elapsed: number): boolean {
  return state.phase === 'holding' && elapsed >= state.holdUntil;
}

/**
 * 「剛完成」判斷的基準狀態——#3780 P0-3 三次審查訂正（2026-10-27）。
 *
 * 真實 bug（連拍截圖＋即時狀態抓到）：引擎剛建立的世界物件，`completed`
 * 內部變數永遠從空陣列開始，但 `setProgress()` 第一次被呼叫時，React
 * 傳進來的 `done` 可能早就含有「這個學生之前就做完」的站（正常情境：
 * 任何帶著既有進度回到喝采島的學生）。用「跟空陣列比對」算出來的
 * `newlyDoneIndices` 會把這些早就做完的站全部誤判成「剛完成」，引擎在
 * **世界剛建立的那一刻**安靜播放一次完整的假慶祝（轉向、停留、轉向下
 * 一站）——玩家從沒看到這段，但它已經把 `turnTo` 轉到了某個方向。等到
 * 玩家真的完成一站、真正的慶祝觸發時，鏡頭早就（在假慶祝裡）轉到那個
 * 方向了，看起來就像「鏡頭完全沒有轉向剛完成的建築」。
 *
 * 修法：不管 `setProgress` 第一次呼叫收到的 `done` 內容是什麼，一律當成
 * 「這個世界實例已知的既有基準」直接接受，不產生任何 `newlyDoneIndices`
 * ——只有基準建立「之後」的呼叫才做真正的「跟上一次比對」diff。
 */
export interface ProgressDiffState {
  readonly baselineSet: boolean;
  readonly completed: readonly number[];
}

export const INITIAL_PROGRESS_DIFF_STATE: ProgressDiffState = { baselineSet: false, completed: [] };

export function diffProgress(
  state: ProgressDiffState,
  done: readonly number[],
): { nextState: ProgressDiffState; newlyDoneIndices: number[] } {
  if (!state.baselineSet) {
    // 第一次呼叫——不管 done 已經有幾個，都當既有基準，不是「剛完成」。
    return { nextState: { baselineSet: true, completed: done }, newlyDoneIndices: [] };
  }
  const newlyDoneIndices = done.filter((index) => !state.completed.includes(index));
  return { nextState: { baselineSet: true, completed: done }, newlyDoneIndices };
}

/**
 * 一次 `setProgress` 呼叫裡，`newlyDoneIndices` 可能同時有好幾個（例如
 * 學生在另一個分頁完成了某一站、回到這個分頁時進度一次跳了兩站以上）。
 * 規則（刻意的設計，不是遺漏）：只慶祝清單裡的第一個，其餘的站照樣會
 * 透過 `nextState.completed` 正確標記成已完成（亮燈、建築發光），只是
 * 不會各自播一次轉向＋停留＋粒子的完整慶祝——跟「慶祝中又完成另一站」
 * （見 `startCelebration` 的註解）同一個精神：以「這次呼叫裡最前面那個」
 * 為準，不嘗試排隊播完每一個，避免玩家對著一串已經錯過的畫面連續等待。
 */
export function resolveCelebrationTrigger(
  newlyDoneIndices: readonly number[],
  resolvedNextStop: number | null,
): { justCompleted: number; resolvedNextStop: number } | null {
  if (newlyDoneIndices.length === 0 || resolvedNextStop === null) return null;
  return { justCompleted: newlyDoneIndices[0], resolvedNextStop };
}

/**
 * 慶祝期間讓正在慶祝那棟建築的窗戶材質（`glowMaterials[index]`，emissive
 * 顏色已經是暖黃色 `0xffd277`，平常「已完成」的穩定發光是
 * `2.2 + sin(elapsed*3)*0.3`）額外加亮加強——不然「它亮了」這件事只靠
 * 鏡頭轉過去跟一道白色光柱表示，跟平常走近任何一個已完成的站沒有視覺
 * 差異（team-lead/Young 2026-10-27 真瀏覽器截圖退件）。heavy tier 比
 * light tier 明顯更亮、脈動幅度也更大，跟 halo／粒子的分級邏輯一致
 * （見 `CELEBRATION_PROFILES`）。
 */
export function celebrationGlowBoost(profile: CelebrationProfile, elapsed: number): number {
  const base = profile.tier === 'heavy' ? 6.5 : 3.5;
  const pulseAmp = profile.tier === 'heavy' ? 1.2 : 0.6;
  return base + Math.sin(elapsed * 6) * pulseAmp;
}

/** 完成/慶祝時整棟建築共用的暖色——跟原本 `windowMat` 的 emissive 色號一致。 */
export const CELEBRATION_EMISSIVE_HEX = 0xffd277;

/**
 * 四度審查訂正：這一棟「現在該不該發光、多亮」的判斷，跟「怎麼把判斷
 * 結果寫進 three.js 材質」要分開——這支不碰 three.js，純粹把一個強度
 * 數字轉成「要不要發光＋發多亮」的決定。`intensity <= 0`（沒完成、也
 * 沒在慶祝）回傳 `null`，請呼叫端（`islandBuildingShapes.ts` 的
 * `applyBuildingGlow`）把材質還原成它自己建造時的基準值，而不是直接
 * 設成黑——有些材質（`gold`／聚光閣水晶）本來就帶裝飾性的常態微光，
 * 那個微光跟「這一站完不完成」無關，不該被這裡的判斷關掉。
 */
export function resolveCelebrationGlow(intensity: number): { emissiveHex: number; emissiveIntensity: number } | null {
  if (intensity <= 0) return null;
  return { emissiveHex: CELEBRATION_EMISSIVE_HEX, emissiveIntensity: intensity };
}
