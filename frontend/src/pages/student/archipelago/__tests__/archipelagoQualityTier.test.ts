/**
 * archipelagoQualityTier.test.ts — #3780 PRD 效能要求（iPad／390 手機都要
 * ≥30fps）的畫質分級邏輯。SSAO 是這批新加的後製 pass 裡最貴的一個（每像素
 * 都要額外取樣深度/法線緩衝），窄螢幕（手機）或低階裝置預設關掉，只留
 * bloom／暈影——分級邏輯是純函式，骨架呼叫它決定要不要把 SSAOPass 加進
 * composer 鏈、要不要降低 pixelRatio 上限。
 */
import { describe, it, expect } from 'vitest';
import { qualityTierForWidth, NARROW_WIDTH_THRESHOLD } from '../createArchipelagoWorld';

describe('qualityTierForWidth — 窄螢幕關 SSAO、降 pixelRatio 上限，寬螢幕維持原設定', () => {
  it('390 寬手機：SSAO 關閉', () => {
    expect(qualityTierForWidth(390).ssaoEnabled).toBe(false);
  });

  it('1280 寬桌機：SSAO 開啟', () => {
    expect(qualityTierForWidth(1280).ssaoEnabled).toBe(true);
  });

  it('390 寬手機：pixelRatio 上限比桌機低（降 fill-rate 負擔）', () => {
    const phone = qualityTierForWidth(390);
    const desktop = qualityTierForWidth(1280);
    expect(phone.pixelRatioCap).toBeLessThan(desktop.pixelRatioCap);
  });

  it('門檻用既有 PRD §6「手機 < 640 寬」同一個數字，不是另外發明一個', () => {
    expect(NARROW_WIDTH_THRESHOLD).toBe(640);
  });

  it('🔒 門檻邊界：640 本身（不小於門檻）算寬螢幕，639 算窄螢幕', () => {
    expect(qualityTierForWidth(640).ssaoEnabled).toBe(true);
    expect(qualityTierForWidth(639).ssaoEnabled).toBe(false);
  });

  it('iPad 常見寬度（768／1024）落在寬螢幕分級（SSAO 開啟，PRD 要求 iPad 也要 ≥30fps，但 iPad 效能足夠不需要降級）', () => {
    expect(qualityTierForWidth(768).ssaoEnabled).toBe(true);
    expect(qualityTierForWidth(1024).ssaoEnabled).toBe(true);
  });

  it('決定性：同一個寬度兩次呼叫結果一樣', () => {
    expect(qualityTierForWidth(390)).toEqual(qualityTierForWidth(390));
  });
});
