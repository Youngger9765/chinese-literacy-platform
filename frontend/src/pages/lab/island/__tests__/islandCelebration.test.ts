/**
 * #3780 P0-3：慶祝分級是資料表驅動的，鎖兩件事——① 輕重分級本身要合理
 * （至少各有一個代表站）② 重的站拿到的回饋一定要比輕的站大（停留更久、
 * 粒子更多），不然「分級」就只是換個名字，沒有實際差異。
 */
import { describe, expect, it } from 'vitest';
import {
  celebrationProfileForStep,
  CELEBRATION_PROFILES,
  startCelebration,
  advanceOnTurnConverged,
  isHoldComplete,
  diffProgress,
  resolveCelebrationTrigger,
  INITIAL_PROGRESS_DIFF_STATE,
} from '../islandCelebration';

describe('celebrationProfileForStep', () => {
  it('課程簡介（lesson-intro）是輕量站', () => {
    expect(celebrationProfileForStep('lesson-intro').tier).toBe('light');
  });

  it('全文做記號（full-text-annotate）是重量站', () => {
    expect(celebrationProfileForStep('full-text-annotate').tier).toBe('heavy');
  });

  it('帶 #slug 的 step id（多篇課文）也查得到，看的是 # 前面的 type', () => {
    expect(celebrationProfileForStep('full-text-annotate#dcavv').tier).toBe('heavy');
    expect(celebrationProfileForStep('lesson-intro#anything').tier).toBe('light');
  });

  it('查不到的 step type 一律當 heavy，不是沒反應', () => {
    expect(celebrationProfileForStep('some-brand-new-step-type').tier).toBe('heavy');
  });

  it('重量站給的停留時間跟粒子數都要比輕量站多，不是只換個標籤', () => {
    expect(CELEBRATION_PROFILES.heavy.holdSeconds).toBeGreaterThan(CELEBRATION_PROFILES.light.holdSeconds);
    expect(CELEBRATION_PROFILES.heavy.particleCount).toBeGreaterThan(CELEBRATION_PROFILES.light.particleCount);
  });

  it('兩種分級的停留時間都要有感（至少 1 秒），不能短到看不見', () => {
    expect(CELEBRATION_PROFILES.light.holdSeconds).toBeGreaterThanOrEqual(1);
    expect(CELEBRATION_PROFILES.heavy.holdSeconds).toBeGreaterThanOrEqual(1);
  });
});

/**
 * 三段式狀態機的回歸鎖——#3780 P0-3 二次審查訂正（2026-10-27）。
 *
 * 第一版把這三個狀態（phase／holdUntil／pendingNextStop）攤開寫在
 * `createIslandWorld.ts` 的 three.js 閉包裡，審查員抓到：所有既有測試
 * 都 mock 掉 `createIslandWorld`，退回舊 bug 寫法（「setProgress 當下
 * 就設 celebrationUntil，不等轉頭收斂」）1528 條測試照樣全綠——因為
 * 真正的狀態機從沒被任何測試跑到過。這裡直接測不碰 three.js 的純函式，
 * 不需要 mock 掉任何東西，退回舊寫法一定會讓下面某條紅。
 */
describe('慶祝序列三段式狀態機（startCelebration / advanceOnTurnConverged / isHoldComplete）', () => {
  it('🔒 回歸鎖：還沒轉到（turning 階段）之前，不管經過多久都不算停留完成——這是鎖住「setProgress 當下就設 celebrationUntil」那個舊 bug 的斷言', () => {
    const state = startCelebration(0, 'lesson-intro', 1);
    expect(state.phase).toBe('turning');
    // 即使 elapsed 已經遠遠超過 holdSeconds，'turning' 階段也不能算完成——
    // 舊寫法是 setProgress 當下就把 holdUntil 設成 elapsed+holdSeconds，
    // 這條用一個遠大於任何合理 holdSeconds 的 elapsed 直接戳破那個寫法。
    expect(isHoldComplete(state, 999999)).toBe(false);
  });

  it('轉到了（turnTo 收斂）才切到 holding 階段，並且從轉到的那一刻開始算停留秒數', () => {
    const state = startCelebration(0, 'full-text-annotate', 2); // heavy tier，holdSeconds=1.6
    const convergedAt = 10; // 玩家離得遠，轉了 10 秒才轉到
    const converged = advanceOnTurnConverged(state, convergedAt);
    expect(converged.phase).toBe('holding');
    expect(isHoldComplete(converged, convergedAt)).toBe(false); // 剛轉到，一秒都還沒停留
    expect(isHoldComplete(converged, convergedAt + CELEBRATION_PROFILES.heavy.holdSeconds - 0.01)).toBe(false);
    expect(isHoldComplete(converged, convergedAt + CELEBRATION_PROFILES.heavy.holdSeconds + 0.01)).toBe(true);
  });

  it('已經在 holding 階段時再呼叫 advanceOnTurnConverged 是安全的 no-op——不會把停留時間往後挪（呼叫端每一幀轉到之後都會重複呼叫到這支）', () => {
    const state = startCelebration(0, 'lesson-intro', 1);
    const converged = advanceOnTurnConverged(state, 10);
    const calledAgainLater = advanceOnTurnConverged(converged, 15);
    expect(calledAgainLater).toEqual(converged);
  });

  it('慶祝中又完成另一站：後者直接取代前者，前者沒有機會走到 isHoldComplete（已定義的規則，不是沒想到——見 startCelebration 的註解）', () => {
    const first = startCelebration(0, 'lesson-intro', 1);
    const firstConverged = advanceOnTurnConverged(first, 5);
    // 還在慶祝 first（holding 階段）時，又完成了另一站（index 2）——
    // 呼叫端（createIslandWorld.ts 的 setProgress）這時會直接呼叫
    // startCelebration 覆蓋掉 celebration 變數，first 這個物件本身
    // 不會被修改，但再也沒有任何程式碼持有它的參照、也不會再被傳進
    // isHoldComplete——它的「轉向下一站」事件因此永遠不會觸發。
    const second = startCelebration(2, 'full-text-annotate', 3);
    expect(second.index).toBe(2);
    expect(second.pendingNextStop).toBe(3);
    expect(second.phase).toBe('turning'); // 全新開始，不繼承 first 的 holding 狀態
    // first 物件本身是不可變的，拿舊的參照出來看它的欄位仍維持原樣——
    // 只是這條規則下，呼叫端已經不會再用它。
    expect(firstConverged.index).toBe(0);
  });

  it('pendingNextStop 可以是 null（理論上不會發生，setProgress 已經用 resolvedNextStop !== null 擋過一次，這裡只確認型別允許、不會噴錯）', () => {
    const state = startCelebration(0, 'report', null);
    expect(state.pendingNextStop).toBeNull();
  });
});

/**
 * diffProgress 的回歸鎖——#3780 P0-3 三次審查訂正（2026-10-27）。
 *
 * 真實 bug：世界剛建立時引擎的 `completed` 內部變數永遠從空陣列開始，
 * 但 React 傳進來的第一筆 `done` 可能已經含有玩家之前就做完的站（任何
 * 帶著既有進度回到喝采島的學生都是這個情境）。沒有基準保護的 diff 會把
 * 這些早就做完的站全部誤判成「剛完成」，世界剛建立那一刻就安靜播一次
 * 玩家沒看到的假慶祝、把 turnTo 轉掉，真正的慶祝之後看起來就像完全沒
 * 轉向。
 */
describe('diffProgress（世界剛建立時不能把既有進度誤判成剛完成）', () => {
  it('🔒 回歸鎖：第一次呼叫不管 done 裡已經有幾個，都不能產生 newlyDoneIndices——這是鎖住「世界剛建立就誤判既有進度」那個真實 bug 的斷言', () => {
    const { nextState, newlyDoneIndices } = diffProgress(INITIAL_PROGRESS_DIFF_STATE, [0, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(newlyDoneIndices).toEqual([]);
    expect(nextState.baselineSet).toBe(true);
    expect(nextState.completed).toEqual([0, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('第一次呼叫就算 done 是空陣列，也正確建立基準（學生從全新課文開始的情境）', () => {
    const { nextState, newlyDoneIndices } = diffProgress(INITIAL_PROGRESS_DIFF_STATE, []);
    expect(newlyDoneIndices).toEqual([]);
    expect(nextState.baselineSet).toBe(true);
    expect(nextState.completed).toEqual([]);
  });

  it('基準建立之後，真正新完成的站會被正確抓到（這是真正該觸發慶祝的情境）', () => {
    const afterFirstCall = diffProgress(INITIAL_PROGRESS_DIFF_STATE, [0, 3, 4]).nextState;
    const { newlyDoneIndices } = diffProgress(afterFirstCall, [0, 1, 3, 4]);
    expect(newlyDoneIndices).toEqual([1]);
  });

  it('基準建立之後，同一組 done 再呼叫一次不會重複觸發（沒有新完成就是空陣列）', () => {
    const afterFirstCall = diffProgress(INITIAL_PROGRESS_DIFF_STATE, [0, 3, 4]).nextState;
    const { newlyDoneIndices } = diffProgress(afterFirstCall, [0, 3, 4]);
    expect(newlyDoneIndices).toEqual([]);
  });

  it('一次呼叫同時多出好幾個新完成的站，全部都要被抓到（不是只抓第一個，呼叫端自己決定要處理哪一個）', () => {
    const afterFirstCall = diffProgress(INITIAL_PROGRESS_DIFF_STATE, [0]).nextState;
    const { newlyDoneIndices } = diffProgress(afterFirstCall, [0, 2, 5]);
    expect(newlyDoneIndices.sort()).toEqual([2, 5]);
  });
});

describe('resolveCelebrationTrigger（同一次呼叫一次完成 2 站以上時，只慶祝第一個）', () => {
  it('一次只完成 1 站——正常觸發慶祝', () => {
    const trigger = resolveCelebrationTrigger([3], 5);
    expect(trigger).toEqual({ justCompleted: 3, resolvedNextStop: 5 });
  });

  it('同一次呼叫一次完成 2 站以上（例如另一個分頁做完回來）——只慶祝清單裡的第一個，不是全部排隊播', () => {
    const trigger = resolveCelebrationTrigger([2, 5, 7], 8);
    expect(trigger).toEqual({ justCompleted: 2, resolvedNextStop: 8 });
  });

  it('沒有新完成的站——不觸發', () => {
    expect(resolveCelebrationTrigger([], 5)).toBeNull();
  });

  it('全部完成（resolvedNextStop 是 null）——不觸發慶祝流程，交給結尾慶祝層處理', () => {
    expect(resolveCelebrationTrigger([3], null)).toBeNull();
  });
});
