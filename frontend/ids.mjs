import { chromium } from 'playwright';
const F = 'https://lingoleap-staging.web.app';
const b = await chromium.launch({ headless: true });
const p = await b.newPage({ viewport: { width: 1600, height: 1600 } });
await p.goto(`${F}/login`, { waitUntil: 'networkidle' });
await p.waitForTimeout(1500);
await p.locator('button', { hasText: '小明' }).first().click();
await p.waitForTimeout(4000);
await p.goto(`${F}/learn/20063/full-text-annotate`, { waitUntil: 'networkidle' });
await p.waitForTimeout(3500);
// 步驟晶片的所有屬性，找得到 id/title 就印
const info = await p.evaluate(() => {
  const out = [];
  document.querySelectorAll('button, a').forEach(e => {
    const t = (e.textContent || '').trim();
    if (t.length <= 2 && t && !/chevron|arrow/.test(t)) {
      out.push({ t, title: e.getAttribute('title'), aria: e.getAttribute('aria-label'),
                 dt: e.getAttribute('data-step') || e.getAttribute('data-testid') });
    }
  });
  return out;
});
console.log(JSON.stringify(info.slice(0, 22), null, 0));
await b.close();
