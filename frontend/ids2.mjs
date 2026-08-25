import { chromium } from 'playwright';
const F = 'https://lingoleap-staging.web.app';
const b = await chromium.launch({ headless: true });
const p = await b.newPage({ viewport: { width: 1600, height: 1600 } });
await p.goto(`${F}/login`, { waitUntil: 'networkidle' });
await p.waitForTimeout(1500);
await p.locator('button', { hasText: '小明' }).first().click();
await p.waitForTimeout(4000);
for (const [code, id, want] of [['G5-L17',20029,18],['G6-L22',20063,21],['G8-L13',20111,8],['G9-L16',20137,10],['G9-L23',20144,17]]) {
  await p.goto(`${F}/learn/${id}/full-text-annotate`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(3000);
  const labels = await p.evaluate(() => Array.from(document.querySelectorAll('[aria-label]'))
    .map(e => e.getAttribute('aria-label'))
    .filter(a => /^\d+\.\s/.test(a || '')));
  const full = labels.filter(l => /讀全文/.test(l)).length;
  const key  = labels.filter(l => /重點朗讀/.test(l)).length;
  console.log(`  ${code}  步驟 ${labels.length}/${want}  讀全文×${full} 重點朗讀×${key}  ${labels.length===want?'✅':'🔴'}`);
}
await b.close();
