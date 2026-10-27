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
