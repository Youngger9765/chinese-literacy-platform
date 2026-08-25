import { chromium } from 'playwright';
const F = 'https://lingoleap-staging.web.app';
const b = await chromium.launch({ headless: true });
const p = await b.newPage({ viewport: { width: 1700, height: 1400 } });
await p.goto(`${F}/login`, { waitUntil: 'networkidle' });
await p.waitForTimeout(1500);
await p.locator('button', { hasText: '王管理員' }).first().click();
await p.waitForTimeout(4000);
await p.goto(`${F}/admin/lesson-audio`, { waitUntil: 'networkidle' }).catch(()=>{});
await p.waitForTimeout(5000);
const rows = await p.locator('[role="row"]').count();
const txt = (await p.locator('body').innerText().catch(()=>'')).replace(/\s+/g,'');
console.log(`  總表列數: ${rows}   標題含課數: ${(txt.match(/(\d+)課/)||[])[0] ?? '?'}`);
console.log(`  有沒有「篇1/篇2」分列: ${/篇1|篇2|（篇/.test(txt) ? '✅ 有' : '🔴 沒有'}`);
// G6-L22 那一列的兩個 QR 值
const row = p.locator('[role="row"]').filter({ hasText: 'G6-L22' }).first();
if (await row.count()) {
  const titles = await row.locator('button[title]').evaluateAll(es => es.map(e => e.getAttribute('title')).filter(t => t?.includes('/q/')));
  console.log(`  G6-L22 那一列的 QR: ${JSON.stringify(titles)}  → ${titles.length} 個（該是 6 個：三篇×全文/重點）`);
}
await b.close();
