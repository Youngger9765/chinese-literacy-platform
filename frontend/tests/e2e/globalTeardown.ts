/**
 * #3242 —— 跑完再確認一次環境沒被換掉。
 *
 * `globalSetup` 只證明「開跑那一刻沒在部署」。若部署在測試**中途**開始，
 * 前面的門攔不到 —— 這裡補上出口檢查：hash 變了就大聲說「這一輪的結果不可信」。
 *
 * ⛔ 這裡**不 throw**。跑完了才發現環境變了，讓整輪從 FAIL 變成 error 沒有幫助；
 *    要的是讓讀 log 的人知道「別去修一個沒壞的東西」。
 *    （真正的修法是讓 E2E 不打共用 staging —— 那要改 workflow，見 #3242。）
 */


export default async function globalTeardown() {
  const before = process.env.E2E_ENTRY_FINGERPRINT;
  if (!before) return;
  const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'https://lingoleap-staging.web.app';
  try {
    const res = await fetch(baseURL, { headers: { 'cache-control': 'no-cache' } });
    const html = await res.text();
    const m = html.match(/\/assets\/index-[A-Za-z0-9_-]+\.js/);
    const after = m ? m[0] : null;
    if (after && after !== before) {
      // eslint-disable-next-line no-console
      console.error(
        `\n⛔ 這一輪的結果不可信（#3242）：測試期間 ${baseURL} 被重新部署了\n` +
        `   開跑時 entry=${before}\n` +
        `   結束時 entry=${after}\n` +
        `   任何失敗都可能是環境在中途換掉造成的 —— 等部署完成後重跑再判斷。\n`,
      );
    }
  } catch {
    // 探測失敗不要蓋掉測試結果
  }

}
